import { queryDns } from "@/lib/dns-query";
import { isForbiddenHostname, isIpLiteral, isPublicAddress } from "@/lib/remote-images/fetch";
import { registrableDomain } from "@/lib/spam/domain-utils";
import { dmarcEnforced, isBimiRecord, parseBimiRecord } from "./record";
import { BIMI_MAX_SVG_BYTES, checkSvgSafety } from "./svg";

export const BIMI_FETCH_TIMEOUT_MS = 5_000;
export const BIMI_MAX_REDIRECTS = 2;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const VALID_DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type BimiLookupDeps = {
	fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
	queryTxt?: (name: string) => Promise<string[]>;
	/** A and AAAA addresses of a host; every one must be public. */
	resolveHost?: (hostname: string) => Promise<string[]>;
	timeoutMs?: number;
};

/** The lookup could not be completed (DNS or network trouble); the answer may differ next time. */
export class BimiTransientError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BimiTransientError";
	}
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
	const [v4, v6] = await Promise.all([queryDns(hostname, "A"), queryDns(hostname, "AAAA")]);
	return [...v4, ...v6];
}

/** https only, a public hostname (no address literal, no port, no credentials). */
export function parseLogoUrl(value: string): URL | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
	if (!url.hostname || isIpLiteral(url.hostname) || isForbiddenHostname(url.hostname)) return null;
	return url;
}

/** The domain and then its organizational domain, which BIMI and DMARC fall back to. */
function candidates(domain: string): string[] {
	const organizational = registrableDomain(domain);
	return organizational === domain ? [domain] : [domain, organizational];
}

async function findTxt(queryTxt: (name: string) => Promise<string[]>, names: string[], match: (record: string) => boolean): Promise<{ record: string; name: string } | null> {
	for (const name of names) {
		let records: string[];
		try {
			records = await queryTxt(name);
		} catch (error) {
			throw new BimiTransientError(error instanceof Error ? error.message : "DNS lookup failed");
		}
		const record = records.find(match);
		if (record) return { record, name };
	}
	return null;
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
	if (Number(response.headers.get("content-length") ?? 0) > maxBytes || !response.body) {
		await response.body?.cancel().catch(() => undefined);
		return null;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel().catch(() => undefined);
			return null;
		}
		chunks.push(value);
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

/**
 * Downloads a logo from a sender-controlled address: https only, every hop (redirects are followed
 * by hand, at most BIMI_MAX_REDIRECTS) a public host, a short timeout, at most 32 KB, an SVG content
 * type and nothing unsafe inside. Returns null for anything that is not a usable logo.
 */
export async function fetchBimiLogo(value: string, deps: BimiLookupDeps = {}): Promise<string | null> {
	const fetchImpl = deps.fetch ?? fetch;
	const resolveHost = deps.resolveHost ?? defaultResolveHost;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? BIMI_FETCH_TIMEOUT_MS);
	try {
		let current = parseLogoUrl(value);
		for (let redirects = 0; current; redirects += 1) {
			try {
				const addresses = await resolveHost(current.hostname);
				if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) return null;
			} catch {
				throw new BimiTransientError("Could not verify the logo host");
			}
			let response: Response;
			try {
				response = await fetchImpl(current.href, {
					method: "GET",
					headers: { Accept: "image/svg+xml", "User-Agent": "TarleMail-BIMI/1.0" },
					cache: "no-store",
					redirect: "manual",
					signal: controller.signal,
				});
			} catch {
				throw new BimiTransientError("Could not fetch the logo");
			}
			if (REDIRECT_STATUSES.has(response.status)) {
				await response.body?.cancel().catch(() => undefined);
				const location = response.headers.get("location");
				if (!location || redirects >= BIMI_MAX_REDIRECTS) return null;
				try {
					current = parseLogoUrl(new URL(location, current).href);
				} catch {
					return null;
				}
				continue;
			}
			if (response.status >= 500) {
				await response.body?.cancel().catch(() => undefined);
				throw new BimiTransientError(`The logo server answered ${response.status}`);
			}
			if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "image/svg+xml") {
				await response.body?.cancel().catch(() => undefined);
				return null;
			}
			let bytes: Uint8Array | null;
			try {
				bytes = await readLimited(response, BIMI_MAX_SVG_BYTES);
			} catch {
				throw new BimiTransientError("Could not read the logo");
			}
			if (!bytes) return null;
			let svg: string;
			try {
				svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch {
				return null;
			}
			return checkSvgSafety(svg) ? null : svg;
		}
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * The logo a sender domain publishes through BIMI, or null when it publishes none, declines one,
 * does not enforce DMARC, or serves something that is not a safe SVG over https. Throws
 * BimiTransientError when DNS or the network failed, so callers can retry sooner than for "none".
 */
export async function lookupBimiLogo(domain: string, deps: BimiLookupDeps = {}): Promise<string | null> {
	const name = domain.trim().toLowerCase().replace(/\.$/, "");
	if (!VALID_DOMAIN.test(name) || isForbiddenHostname(name)) return null;
	const queryTxt = deps.queryTxt ?? ((record: string) => queryDns(record, "TXT"));
	const names = candidates(name);

	const bimi = await findTxt(queryTxt, names.map((n) => `default._bimi.${n}`), isBimiRecord);
	const logoUrl = bimi ? parseBimiRecord(bimi.record)?.logoUrl : null;
	if (!logoUrl) return null;

	const dmarc = await findTxt(queryTxt, names.map((n) => `_dmarc.${n}`), (record) => /^\s*v\s*=\s*DMARC1\b/i.test(record));
	if (!dmarc || !dmarcEnforced(dmarc.record, { subdomain: dmarc.name !== `_dmarc.${name}` })) return null;

	return fetchBimiLogo(logoUrl, deps);
}
