import type { CfDnsRecord } from "@/lib/cloudflare-api.types";
import type { CloudflareDnsRecordCreate } from "@/lib/cloudflare-dns.types";

/**
 * Pure comparison of the DNS and routing a domain should have against what the
 * zone has. Nothing here talks to Cloudflare: `health.ts` gathers the inputs and
 * applies the plan. A repair action can only create a record or rewrite the
 * content of one named record, so a plan cannot delete anything.
 */

export type HealthStatus = "ok" | "missing" | "wrong" | "unknown" | "skipped";
export type HealthCheckId = "mx" | "spf" | "dkim" | "dmarc" | "routing" | "catchAll";

export type RepairAction =
	| { kind: "create-dns"; record: CloudflareDnsRecordCreate }
	| { kind: "update-dns"; recordId: string; type: string; name: string; before: string; content: string }
	| { kind: "enable-routing" }
	| { kind: "bind-catch-all"; worker: string; current: string }
	| { kind: "sending-subdomain" }
	| { kind: "provider-setup"; provider: "resend" | "ses" };

export type Evaluation = {
	status: HealthStatus;
	message: string;
	found: string[];
	expected: string[];
	actions: RepairAction[];
};

export type ExpectedRecord = {
	type: "MX" | "TXT" | "CNAME";
	name: string;
	content: string;
	priority?: number;
	ttl?: number;
};

export type RecordLookup = (type: string, name: string) => CfDnsRecord[];

const DEFAULT_TTL = 3600;

export function normalizeHost(value: string): string {
	return value.trim().toLowerCase().replace(/\.$/, "");
}

/** TXT content as the zone reports it: quoted, and possibly split into several quoted chunks. */
export function normalizeTxt(content: string | undefined): string {
	const value = (content ?? "").trim();
	const chunks = value.match(/"(?:[^"\\]|\\.)*"/g);
	return chunks ? chunks.map((chunk) => chunk.slice(1, -1)).join("") : value;
}

/** Providers list names relative to the domain; the zone needs them absolute. */
export function absoluteName(name: string, hostname: string): string {
	const value = normalizeHost(name);
	const host = normalizeHost(hostname);
	if (!value || value === "@") return host;
	return value === host || value.endsWith(`.${host}`) ? value : `${value}.${host}`;
}

const sameContent = (type: string, a: string | undefined, b: string | undefined) =>
	type === "TXT" ? normalizeTxt(a) === normalizeTxt(b) : normalizeHost(a ?? "") === normalizeHost(b ?? "");

export const isSpfRecord = (record: CfDnsRecord) => record.type?.toUpperCase() === "TXT" && /^v=spf1(\s|$)/i.test(normalizeTxt(record.content));
const isDmarcRecord = (record: CfDnsRecord) => record.type?.toUpperCase() === "TXT" && /^v=DMARC1\s*(;|$)/i.test(normalizeTxt(record.content));
const isAllTerm = (term: string) => /^[+\-~?]?all$/i.test(term);
const isModifier = (term: string) => /^(redirect|exp)=/i.test(term);

/** Terms of an SPF record after `v=spf1`, as written. */
export function spfTerms(content: string): string[] {
	return normalizeTxt(content).trim().split(/\s+/).slice(1).filter(Boolean);
}

/** What a sender's SPF record asks of the domain: its mechanisms, without the closing `all` or modifiers. */
export function requiredSpfTerms(content: string): string[] {
	return spfTerms(content).filter((term) => !isAllTerm(term) && !isModifier(term));
}

export function buildSpf(terms: string[]): string {
	return ["v=spf1", ...terms, "~all"].join(" ");
}

const hasTerm = (terms: string[], wanted: string) => terms.some((term) => term.toLowerCase() === wanted.toLowerCase());

/**
 * Adds the missing terms to an existing SPF record, ahead of its closing `all`,
 * so a domain that already sends through another service keeps that service and
 * gains the new one in the same record. Everything already in it is kept.
 */
export function mergeSpf(existing: string, required: string[]): string {
	const terms = spfTerms(existing);
	const additions = required.filter((term) => !hasTerm(terms, term));
	const allIndex = terms.findIndex(isAllTerm);
	const merged = allIndex === -1 ? [...terms, ...additions] : [...terms.slice(0, allIndex), ...additions, ...terms.slice(allIndex)];
	return ["v=spf1", ...merged].join(" ");
}

const result = (status: HealthStatus, message: string, extra: Partial<Evaluation> = {}): Evaluation => ({ status, message, found: [], expected: [], actions: [], ...extra });

export function evaluateSpf(name: string, records: CfDnsRecord[], required: string[]): Evaluation {
	const expected = [buildSpf(required)];
	const spf = records.filter(isSpfRecord);
	const found = spf.map((record) => normalizeTxt(record.content));
	if (spf.length === 0) {
		return result("missing", `No SPF record at ${name}.`, {
			expected,
			actions: [{ kind: "create-dns", record: { type: "TXT", name, content: expected[0], ttl: DEFAULT_TTL } }],
		});
	}
	if (spf.length > 1) {
		return result("wrong", `${name} has ${spf.length} SPF records. Receivers reject a domain with more than one, so merge them into one by hand.`, { found, expected });
	}
	const terms = spfTerms(found[0]);
	const missing = required.filter((term) => !hasTerm(terms, term));
	if (missing.length === 0) return result("ok", "SPF authorises the configured senders.", { found, expected });
	if (terms.some((term) => /^redirect=/i.test(term))) {
		return result("wrong", `SPF at ${name} redirects to another record, so ${missing.join(", ")} cannot be added here.`, { found, expected });
	}
	const [record] = spf;
	const merged = mergeSpf(found[0], required);
	return result("wrong", `SPF at ${name} does not include ${missing.join(", ")}.`, {
		found,
		expected: [merged],
		actions: record.id ? [{ kind: "update-dns", recordId: record.id, type: "TXT", name, before: found[0], content: merged }] : [],
	});
}

export function evaluateDmarc(name: string, records: CfDnsRecord[]): Evaluation {
	const dmarc = records.filter(isDmarcRecord);
	const found = dmarc.map((record) => normalizeTxt(record.content));
	const expected = ["v=DMARC1; p=none"];
	if (dmarc.length === 0) {
		return result("missing", `No DMARC record at ${name}.`, {
			expected,
			actions: [{ kind: "create-dns", record: { type: "TXT", name, content: expected[0], ttl: DEFAULT_TTL } }],
		});
	}
	if (dmarc.length > 1) return result("wrong", `${name} has ${dmarc.length} DMARC records. Receivers ignore them all, so keep one.`, { found, expected });
	const policy = found[0].match(/(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\s*(?:;|$)/i)?.[1];
	if (!policy) return result("wrong", "The DMARC record has no valid p= policy, so receivers ignore it.", { found, expected });
	return result("ok", `DMARC policy is ${policy.toLowerCase()}.`, { found, expected });
}

const describeMx = (record: CfDnsRecord) => `${record.priority ?? "?"} ${normalizeHost(record.content ?? "")}`;

export type MxExpectation =
	| { expected: { content: string; priority: number; ttl?: number }[] }
	| { accepts: (content: string) => boolean; hint: string };

/**
 * MX records are checked, never rewritten over another service's: records that
 * point elsewhere make the check "wrong" and leave the replacement to the
 * receiving setup, which asks before replacing them.
 */
export function evaluateMx(hostname: string, records: CfDnsRecord[], expectation: MxExpectation): Evaluation {
	const found = records.map(describeMx);
	if ("accepts" in expectation) {
		if (records.length === 0) return result("missing", `${hostname} has no MX record. ${expectation.hint}`, { found });
		if (records.some((record) => expectation.accepts(record.content ?? ""))) return result("ok", "MX points at the receiving provider.", { found });
		return result("wrong", `MX records point somewhere other than the receiving provider. ${expectation.hint}`, { found });
	}
	const expected = expectation.expected.map((record) => `${record.priority} ${normalizeHost(record.content)}`);
	const present = new Set(records.map((record) => normalizeHost(record.content ?? "")));
	const wanted = new Set(expectation.expected.map((record) => normalizeHost(record.content)));
	const foreign = records.filter((record) => !wanted.has(normalizeHost(record.content ?? "")));
	if (foreign.length > 0) {
		return result("wrong", `${hostname} has MX records for another mail service (${foreign.map((record) => normalizeHost(record.content ?? "")).join(", ")}). Replace them from the receiving setup to receive here.`, { found, expected });
	}
	const missing = expectation.expected.filter((record) => !present.has(normalizeHost(record.content)));
	if (missing.length === 0) return result("ok", "MX points at Cloudflare Email Routing.", { found, expected });
	return result("missing", records.length === 0 ? `${hostname} has no MX record.` : `${missing.length} of ${expected.length} Cloudflare MX records are missing.`, {
		found,
		expected,
		actions: missing.map((record): RepairAction => ({ kind: "create-dns", record: { type: "MX", name: hostname, content: record.content, priority: record.priority, ttl: record.ttl ?? 1 } })),
	});
}

/**
 * Compares the records a provider asks for with the zone. An absent record is
 * created; a TXT or CNAME that is the only record at its name but carries other
 * content (a rotated DKIM key, say) is rewritten in place. Anything else at that
 * name is left alone and the expected record is added beside it.
 */
export function evaluateRecordSet(expected: ExpectedRecord[], lookup: RecordLookup, label: string): Evaluation {
	if (expected.length === 0) return result("unknown", `No ${label} records were reported to check against.`);
	const actions: RepairAction[] = [];
	const found: string[] = [];
	let missing = 0;
	let wrong = 0;
	for (const record of expected) {
		const atName = lookup(record.type, record.name).filter((item) => item.type?.toUpperCase() === record.type);
		found.push(...atName.map((item) => `${record.type} ${record.name} → ${item.type === "TXT" ? normalizeTxt(item.content) : item.content}`));
		if (atName.some((item) => sameContent(record.type, item.content, record.content))) continue;
		const ttl = record.ttl ?? DEFAULT_TTL;
		const [only] = atName;
		if (record.type !== "MX" && atName.length === 1 && only.id) {
			wrong += 1;
			actions.push({ kind: "update-dns", recordId: only.id, type: record.type, name: record.name, before: only.content ?? "", content: record.content });
			continue;
		}
		missing += 1;
		actions.push({
			kind: "create-dns",
			record: record.type === "MX"
				? { type: "MX", name: record.name, content: record.content, priority: record.priority ?? 10, ttl }
				: record.type === "CNAME"
					? { type: "CNAME", name: record.name, content: record.content, ttl, proxied: false }
					: { type: "TXT", name: record.name, content: record.content, ttl },
		});
	}
	const expectedLines = expected.map((record) => `${record.type} ${record.name} → ${record.content}`);
	if (actions.length === 0) return result("ok", `All ${label} records are in the zone.`, { found, expected: expectedLines });
	const parts = [missing ? `${missing} missing` : "", wrong ? `${wrong} with different content` : ""].filter(Boolean).join(", ");
	return result(wrong > 0 ? "wrong" : "missing", `${label} records: ${parts}.`, { found, expected: expectedLines, actions });
}

export function evaluateRouting(enabled: boolean | undefined): Evaluation {
	if (enabled) return result("ok", "Cloudflare Email Routing is enabled for the zone.");
	return result("missing", "Cloudflare Email Routing is not enabled for the zone.", { actions: [{ kind: "enable-routing" }] });
}

type CatchAllRule = { enabled?: boolean; actions?: { type: string; value?: string[] }[] } | null;

function describeCatchAll(rule: CatchAllRule): string {
	if (!rule?.actions?.length) return "not set";
	const action = rule.actions[0];
	const target = action.type === "drop" ? "drops mail" : `${action.type} to ${(action.value ?? []).join(", ") || "nowhere"}`;
	return rule.enabled ? target : `${target} (disabled)`;
}

export function evaluateCatchAll(rule: CatchAllRule, worker: string): Evaluation {
	const current = describeCatchAll(rule);
	const toWorker = !!rule?.enabled && !!rule.actions?.some((action) => action.type === "worker" && (action.value?.length ? action.value.includes(worker) : true));
	if (toWorker) return result("ok", `The catch-all rule delivers to the ${worker} Worker.`, { found: [current] });
	const action: RepairAction = { kind: "bind-catch-all", worker, current };
	return result(rule?.actions?.length ? "wrong" : "missing", `The catch-all rule is ${current}, so mail to unknown addresses does not reach ${worker}.`, { found: [current], expected: [`worker to ${worker}`], actions: [action] });
}

export function actionKey(action: RepairAction): string {
	switch (action.kind) {
		case "create-dns": return `create-dns|${action.record.type}|${normalizeHost(action.record.name)}|${normalizeHost(action.record.content)}`;
		case "update-dns": return `update-dns|${action.recordId}|${normalizeHost(action.content)}`;
		case "provider-setup": return `provider-setup|${action.provider}`;
		default: return action.kind;
	}
}

export function describeAction(action: RepairAction): string {
	switch (action.kind) {
		case "create-dns": {
			const { record } = action;
			return `Add ${record.type} record ${record.name} → ${"priority" in record ? `${record.priority} ` : ""}${record.content}`;
		}
		case "update-dns": return `Change ${action.type} record ${action.name} from "${action.before}" to "${action.content}"`;
		case "enable-routing": return "Enable Cloudflare Email Routing for the zone (adds its MX and SPF records)";
		case "bind-catch-all": return `Set the catch-all rule to deliver to the ${action.worker} Worker (currently: ${action.current})`;
		case "sending-subdomain": return "Enable Cloudflare Email Sending for this domain (creates its DKIM records)";
		case "provider-setup": return `Register the domain with ${action.provider === "resend" ? "Resend" : "Amazon SES"} and publish its sending records`;
	}
}

export type HealthCheck = Evaluation & { id: HealthCheckId; label: string };
export type PlanItem = { key: string; checkId: HealthCheckId; summary: string };

/** The repair plan for a set of checks: each distinct action once, in check order. */
export function buildRepairPlan(checks: HealthCheck[]): { item: PlanItem; action: RepairAction }[] {
	const seen = new Set<string>();
	const plan: { item: PlanItem; action: RepairAction }[] = [];
	for (const check of checks) {
		for (const action of check.actions) {
			const key = actionKey(action);
			if (seen.has(key)) continue;
			seen.add(key);
			plan.push({ item: { key, checkId: check.id, summary: describeAction(action) }, action });
		}
	}
	return plan;
}
