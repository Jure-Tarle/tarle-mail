import { createDnsRecord, deleteDnsRecord, listDnsRecords } from "@/lib/cloudflare-dns";
import { queryDns } from "@/lib/dns-query";
import { isManualZone } from "@/lib/domains/provision";
import { hasCloudflareCredentials } from "@/lib/runtime";
import { buildBimiRecord, dmarcEnforced, isBimiRecord, parseBimiRecord, publicLogoUrl, unquoteTxt } from "./record";
import { checkBimiSvg } from "./svg";

// The logo this app publishes for one of its domains. The SVG lives in R2 under bimi/<domainId>.svg
// and is served without a login at /bimi/<hostname>.svg (src/app/bimi/[file]/route.ts); the domain's
// default._bimi TXT record points mail apps at that address.

type Domain = { id: string; hostname: string; zoneId: string; dnsSkipped: boolean };
type DnsRecord = { id?: string; content?: string };

export const ownLogoKey = (domainId: string) => `bimi/${domainId}.svg`;

export class BimiLogoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BimiLogoError";
	}
}

export type OwnLogoStatus = {
	hasLogo: boolean;
	logoUrl: string;
	/** Mail apps fetch logos over https only. */
	https: boolean;
	record: {
		name: string;
		/** What the TXT record should say; the admin adds it by hand when `managed` is false. */
		expected: string;
		/** What DNS has now, or null for none; undefined when it could not be read. */
		current: string | null | undefined;
		state: "ok" | "missing" | "different" | "unchecked";
	};
	dmarc: { record: string | null | undefined; enforced: boolean };
	/** Whether this app can write the record through the Cloudflare API. */
	managed: boolean;
	/** Set when the logo was saved but the DNS record could not be written. */
	dnsError?: string;
};

const recordName = (domain: Domain) => `default._bimi.${domain.hostname}`;

function isManaged(env: CloudflareEnv, domain: Domain): boolean {
	return hasCloudflareCredentials(env) && !isManualZone(domain.zoneId) && !domain.dnsSkipped;
}

async function listBimiRecords(env: CloudflareEnv, domain: Domain): Promise<(DnsRecord & { content: string })[]> {
	const records = await listDnsRecords(env, domain.zoneId, { type: "TXT", name: recordName(domain) });
	return records.map((record) => ({ ...record, content: unquoteTxt(record.content ?? "") })).filter((record) => isBimiRecord(record.content));
}

async function readTxt(name: string): Promise<string[] | undefined> {
	try {
		return await queryDns(name, "TXT");
	} catch {
		return undefined;
	}
}

export async function getOwnLogoStatus(env: CloudflareEnv, domain: Domain, origin: string): Promise<OwnLogoStatus> {
	const logoUrl = publicLogoUrl(origin, domain.hostname);
	const managed = isManaged(env, domain);
	const hasLogo = !!(await env.BUCKET.head(ownLogoKey(domain.id)));

	let current: string | null | undefined;
	try {
		current = managed
			? ((await listBimiRecords(env, domain))[0]?.content ?? null)
			: ((await readTxt(recordName(domain)))?.find(isBimiRecord) ?? undefined);
	} catch {
		current = undefined;
	}
	const dmarcRecords = await readTxt(`_dmarc.${domain.hostname}`);
	const dmarc = dmarcRecords?.find((record) => /^\s*v\s*=\s*DMARC1\b/i.test(record)) ?? null;

	const expected = buildBimiRecord(logoUrl, current ? parseBimiRecord(current)?.authorityUrl : null);
	const state = current === undefined ? "unchecked" : current === null ? "missing" : parseBimiRecord(current)?.logoUrl === logoUrl ? "ok" : "different";
	return {
		hasLogo,
		logoUrl,
		https: logoUrl.startsWith("https://"),
		record: { name: recordName(domain), expected, current, state },
		dmarc: { record: dmarcRecords === undefined ? undefined : dmarc, enforced: dmarcEnforced(dmarc) },
		managed,
	};
}

/** Points the domain's BIMI record at our logo, keeping a certificate address already published. */
async function writeRecord(env: CloudflareEnv, domain: Domain, logoUrl: string): Promise<void> {
	const existing = await listBimiRecords(env, domain);
	const authorityUrl = existing.map((record) => parseBimiRecord(record.content)?.authorityUrl).find(Boolean) ?? null;
	const content = buildBimiRecord(logoUrl, authorityUrl);
	if (existing.length === 1 && existing[0].content.trim().replace(/;$/, "") === content.replace(/;$/, "")) return;
	for (const record of existing) if (record.id) await deleteDnsRecord(env, domain.zoneId, record.id);
	await createDnsRecord(env, domain.zoneId, { type: "TXT", name: recordName(domain), content, ttl: 1, comment: "BIMI sender logo (Tarle Mail)" });
}

/** Validates and stores the logo, then publishes the record. A DNS failure leaves the logo saved and is reported in `dnsError`. */
export async function saveOwnLogo(env: CloudflareEnv, domain: Domain, origin: string, svg: string): Promise<OwnLogoStatus> {
	const problem = checkBimiSvg(svg);
	if (problem) throw new BimiLogoError(problem);
	await env.BUCKET.put(ownLogoKey(domain.id), svg, { httpMetadata: { contentType: "image/svg+xml" } });
	let dnsError: string | undefined;
	if (isManaged(env, domain)) {
		try {
			await writeRecord(env, domain, publicLogoUrl(origin, domain.hostname));
		} catch (error) {
			dnsError = error instanceof Error ? error.message : "The DNS record could not be written";
		}
	}
	return { ...(await getOwnLogoStatus(env, domain, origin)), dnsError };
}

/** Removes the logo and the BIMI records that point at it; records for another address stay. */
export async function removeOwnLogo(env: CloudflareEnv, domain: Domain, origin: string): Promise<OwnLogoStatus> {
	if (isManaged(env, domain)) {
		const path = `/bimi/${domain.hostname.toLowerCase()}.svg`;
		for (const record of await listBimiRecords(env, domain)) {
			if (record.id && parseBimiRecord(record.content)?.logoUrl?.toLowerCase().endsWith(path)) await deleteDnsRecord(env, domain.zoneId, record.id);
		}
	}
	await env.BUCKET.delete(ownLogoKey(domain.id));
	return getOwnLogoStatus(env, domain, origin);
}
