import { getEmailRoutingSettings } from "@/lib/cloudflare-api";
import { getEmailWorkerName } from "@/lib/cloudflare-api-utils";
import { createDnsRecord, listDnsRecordsByName, updateDnsRecordContent } from "@/lib/cloudflare-dns";
import { getSesSendingView, setupSesSending } from "@/lib/aws/ses-sending";
import { ensureEmailRoutingCatchAllToWorker, getEmailRoutingCatchAll } from "@/lib/domains/catch-all-routing";
import { setupDomainDnsRecord } from "@/lib/domains/dns-setup";
import {
	absoluteName,
	buildRepairPlan,
	evaluateCatchAll,
	evaluateDmarc,
	evaluateMx,
	evaluateRecordSet,
	evaluateRouting,
	evaluateSpf,
	isSpfRecord,
	normalizeHost,
	normalizeTxt,
	requiredSpfTerms,
	type Evaluation,
	type ExpectedRecord,
	type HealthCheck,
	type HealthCheckId,
	type MxExpectation,
	type PlanItem,
	type RecordLookup,
	type RepairAction,
} from "@/lib/domains/health-diff";
import { isManualZone, shouldBindEmailCatchAllToWorker } from "@/lib/domains/provision";
import { isInboundSmtpMx } from "@/lib/domains/receiving-dns";
import { getResendDomainView, setupResendDomain } from "@/lib/domains/resend-domain";
import { getDomainDns } from "@/lib/domains/service";
import type { DomainRow } from "@/lib/domains/types";

export type DomainHealth = {
	hostname: string;
	/** DNS is managed by hand, so there is no zone to compare against or repair. */
	manual: boolean;
	checkedAt: string;
	checks: HealthCheck[];
	plan: PlanItem[];
};

export type RepairResult = { key: string; summary: string; ok: boolean; error?: string };

/** Cloudflare's SPF mechanism for Email Routing, used when the zone does not report its own record. */
const CLOUDFLARE_ROUTING_SPF = "include:_spf.mx.cloudflare.net";

const LABELS: Record<HealthCheckId, string> = {
	routing: "Email Routing",
	mx: "MX",
	catchAll: "Catch-all rule",
	spf: "SPF",
	dkim: "DKIM",
	dmarc: "DMARC",
};

const skipped = (message: string): Evaluation => ({ status: "skipped", message, found: [], expected: [], actions: [] });
const unknown = (message: string): Evaluation => ({ status: "unknown", message, found: [], expected: [], actions: [] });

const SEVERITY = { wrong: 3, missing: 2, unknown: 1, ok: 0, skipped: 0 } as const;

/** The checks of several names read as one: the worst status wins and every action is kept. */
function combine(evaluations: Evaluation[]): Evaluation {
	const worst = evaluations.reduce((current, item) => (SEVERITY[item.status] > SEVERITY[current.status] ? item : current));
	const problems = evaluations.filter((item) => item.status !== "ok");
	return {
		status: worst.status,
		message: (problems.length ? problems : evaluations).map((item) => item.message).join(" "),
		found: evaluations.flatMap((item) => item.found),
		expected: evaluations.flatMap((item) => item.expected),
		actions: evaluations.flatMap((item) => item.actions),
	};
}

async function loadLookup(env: CloudflareEnv, zoneId: string, names: Set<string>): Promise<RecordLookup> {
	const entries = await Promise.all([...names].map(async (name) => [name, await listDnsRecordsByName(env, zoneId, name)] as const));
	const byName = new Map(entries);
	return (type, name) => (byName.get(normalizeHost(name)) ?? []).filter((record) => record.type?.toUpperCase() === type.toUpperCase());
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** What a provider's record list asks of SPF and DKIM, kept apart so each check reads only its own records. */
type SendingNeeds = { dkim: ExpectedRecord[]; spf: { name: string; content: string }[]; failure?: string; setup?: RepairAction };

async function readSendingNeeds(env: CloudflareEnv, domain: DomainRow, dns: Awaited<ReturnType<typeof getDomainDns>>): Promise<SendingNeeds> {
	const hostname = domain.hostname;
	if (domain.sendingProvider === "cloudflare") {
		const spf = dns.sending.filter(isSpfRecord).map((record) => ({ name: normalizeHost(record.name ?? hostname), content: normalizeTxt(record.content) }));
		const dkim = dns.sending
			.filter((record) => record.type?.toUpperCase() === "TXT" && /_domainkey/i.test(record.name ?? "") && record.content)
			.map((record): ExpectedRecord => ({ type: "TXT", name: normalizeHost(record.name ?? ""), content: normalizeTxt(record.content), ttl: record.ttl && record.ttl > 1 ? record.ttl : undefined }));
		return { dkim, spf, setup: dns.sendingSubdomain ? undefined : { kind: "sending-subdomain" } };
	}
	// Brevo, Mailjet and SMTP servers keep their own sender authentication; their records are set up in the
	// provider's dashboard, so there is nothing this check can compare or repair.
	if (domain.sendingProvider === "brevo" || domain.sendingProvider === "mailjet" || domain.sendingProvider === "smtp") return { dkim: [], spf: [] };
	try {
		if (domain.sendingProvider === "resend") {
			const view = await getResendDomainView(env, domain);
			const setup: RepairAction | undefined = view.registered ? undefined : { kind: "provider-setup", provider: "resend" };
			const own = view.records.map((record) => ({ ...record, name: absoluteName(record.name, hostname) }));
			return {
				spf: own.filter((record) => record.type === "TXT" && /^v=spf1(\s|$)/i.test(normalizeTxt(record.value))).map((record) => ({ name: record.name, content: normalizeTxt(record.value) })),
				dkim: own
					.filter((record) => !(record.type === "TXT" && /^v=spf1(\s|$)/i.test(normalizeTxt(record.value))))
					.map((record): ExpectedRecord => ({ type: record.type, name: record.name, content: record.type === "TXT" ? normalizeTxt(record.value) : record.value, priority: record.priority ?? undefined })),
				setup,
			};
		}
		const view = await getSesSendingView(env, domain);
		return { spf: [], dkim: view.records.map((record): ExpectedRecord => ({ type: "CNAME", name: normalizeHost(record.name), content: record.value })), setup: view.registered ? undefined : { kind: "provider-setup", provider: "ses" } };
	} catch (error) {
		return { dkim: [], spf: [], failure: messageOf(error, "Could not read the sending provider") };
	}
}

/**
 * Compares what this domain should have, given its receiving and sending
 * providers, with the Cloudflare zone, and lists the repairs that would close
 * the gaps. Reads only; `repairDomainHealth` applies a confirmed subset.
 */
export async function checkDomainHealth(env: CloudflareEnv, domain: DomainRow): Promise<DomainHealth> {
	const hostname = normalizeHost(domain.hostname);
	const base = { hostname, checkedAt: new Date().toISOString() };
	if (isManualZone(domain.zoneId)) return { ...base, manual: true, checks: [], plan: [] };

	const receiving = domain.receivingProvider;
	const worker = getEmailWorkerName();
	const [dns, settings, catchAll] = await Promise.all([
		getDomainDns(env, domain),
		receiving === "cloudflare" ? getEmailRoutingSettings(env, domain.zoneId).catch(() => null) : null,
		receiving === "cloudflare" && shouldBindEmailCatchAllToWorker(env) ? getEmailRoutingCatchAll(env, domain.zoneId) : null,
	]);
	const sending = domain.sendingProvider === "none" ? null : await readSendingNeeds(env, domain, dns);

	// SPF requirements by name: the routing provider's mechanism lives on the domain itself, a sender's wherever it asks.
	const spfRequirements = new Map<string, Set<string>>();
	const requireSpf = (name: string, content: string) => {
		const key = normalizeHost(name);
		const terms = spfRequirements.get(key) ?? new Set<string>();
		for (const term of requiredSpfTerms(content)) terms.add(term);
		spfRequirements.set(key, terms);
	};
	if (receiving === "cloudflare") {
		const routing = [...dns.routing.records, ...dns.routing.missing].filter(isSpfRecord);
		if (routing.length > 0) for (const record of routing) requireSpf(hostname, record.content ?? "");
		else requireSpf(hostname, `v=spf1 ${CLOUDFLARE_ROUTING_SPF} ~all`);
	}
	for (const record of sending?.spf ?? []) requireSpf(record.name, record.content);

	const names = new Set<string>([hostname, `_dmarc.${hostname}`, ...spfRequirements.keys(), ...(sending?.dkim ?? []).map((record) => normalizeHost(record.name))]);
	const lookup = await loadLookup(env, domain.zoneId, names);

	const mxRecords = lookup("MX", hostname);
	let mx: Evaluation;
	if (receiving === "none") mx = skipped("Receiving is not configured for this domain.");
	else if (receiving === "cloudflare") {
		const expected = new Map<string, { content: string; priority: number; ttl?: number }>();
		for (const record of [...dns.routing.records, ...dns.routing.missing]) {
			if (record.type?.toUpperCase() === "MX" && record.content && record.priority !== undefined) {
				expected.set(normalizeHost(record.content), { content: record.content, priority: record.priority, ttl: record.ttl });
			}
		}
		mx = expected.size === 0 ? unknown("Cloudflare did not report the MX records to expect.") : evaluateMx(hostname, mxRecords, { expected: [...expected.values()] } satisfies MxExpectation);
	} else {
		const label = receiving === "resend" ? "Resend" : "Amazon SES";
		mx = evaluateMx(hostname, mxRecords, { accepts: isInboundSmtpMx, hint: `Run the ${label} receiving setup on this page.` });
	}

	let dkim: Evaluation;
	if (!sending) dkim = skipped("No sending provider is configured for this domain.");
	else if (sending.failure) dkim = unknown(sending.failure);
	else if (sending.setup && sending.dkim.length === 0) {
		dkim = { status: "missing", message: domain.sendingProvider === "cloudflare" ? "Cloudflare Email Sending is not enabled for this domain." : "The domain is not registered with the sending provider.", found: [], expected: [], actions: [sending.setup] };
	} else {
		dkim = evaluateRecordSet(sending.dkim, lookup, "sending");
		if (dkim.status === "ok" && domain.sendingProvider === "cloudflare" && !dns.sendingEnabled) {
			dkim = { ...dkim, status: "unknown", message: "The DKIM records are in place; Cloudflare has not verified the sending domain yet." };
		}
		if (sending.setup && dkim.actions.length === 0) dkim = { ...dkim, actions: [sending.setup] };
	}

	const spf = spfRequirements.size === 0
		? skipped("No configured provider asks for an SPF record.")
		: combine([...spfRequirements].map(([name, terms]) => evaluateSpf(name, lookup("TXT", name), [...terms])));

	const checks: HealthCheck[] = [
		{ id: "routing", ...(receiving === "cloudflare" ? evaluateRouting(settings?.enabled) : skipped("Mail is not received through Cloudflare Email Routing.")) },
		{ id: "mx", ...mx },
		{ id: "catchAll", ...(receiving !== "cloudflare" ? skipped("Mail is not received through Cloudflare Email Routing.") : !shouldBindEmailCatchAllToWorker(env) ? skipped("This runtime has no Email Worker to bind a catch-all to.") : evaluateCatchAll(catchAll, worker)) },
		{ id: "spf", ...spf },
		{ id: "dkim", ...dkim },
		{ id: "dmarc", ...evaluateDmarc(`_dmarc.${hostname}`, lookup("TXT", `_dmarc.${hostname}`)) },
	].map((check) => ({ ...check, label: LABELS[check.id as HealthCheckId] })) as HealthCheck[];

	return { ...base, manual: false, checks, plan: buildRepairPlan(checks).map(({ item }) => item) };
}

async function applyAction(env: CloudflareEnv, domain: DomainRow, action: RepairAction): Promise<void> {
	switch (action.kind) {
		case "create-dns": await createDnsRecord(env, domain.zoneId, action.record); return;
		case "update-dns": await updateDnsRecordContent(env, domain.zoneId, action.recordId, action.content); return;
		case "enable-routing": await setupDomainDnsRecord(env, domain, "mx"); return;
		case "bind-catch-all": await ensureEmailRoutingCatchAllToWorker(env, domain.zoneId); return;
		case "sending-subdomain": await setupDomainDnsRecord(env, domain, "dkim"); return;
		case "provider-setup":
			if (action.provider === "resend") await setupResendDomain(env, domain);
			else await setupSesSending(env, domain);
			return;
	}
}

/**
 * Applies the repairs the caller confirmed. The plan is recomputed here, so only
 * actions the zone still needs and the caller listed by key run; a stale or
 * forged key does nothing. Each action is attempted on its own and reported.
 */
export async function repairDomainHealth(env: CloudflareEnv, domain: DomainRow, confirmedKeys: string[]): Promise<{ results: RepairResult[]; health: DomainHealth }> {
	const current = await checkDomainHealth(env, domain);
	const confirmed = new Set(confirmedKeys);
	const results: RepairResult[] = [];
	for (const { item, action } of buildRepairPlan(current.checks)) {
		if (!confirmed.has(item.key)) continue;
		try {
			await applyAction(env, domain, action);
			results.push({ key: item.key, summary: item.summary, ok: true });
		} catch (error) {
			results.push({ key: item.key, summary: item.summary, ok: false, error: messageOf(error, "Repair failed") });
		}
	}
	return { results, health: await checkDomainHealth(env, domain) };
}
