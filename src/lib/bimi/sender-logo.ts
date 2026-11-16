import { getEmailAddress } from "@/lib/email/address";
import { readSesAuthentication } from "@/lib/email/provider-trace";
import { BimiTransientError, lookupBimiLogo, type BimiLookupDeps } from "./lookup";

// Senders' logos. Mail that passed DMARC may carry the logo its domain publishes through BIMI. The
// server looks it up and keeps it in R2, so the sender never learns when or whether a message was
// read and a logo is fetched once per domain, not once per message.

type Bucket = CloudflareEnv["BUCKET"];

const CACHE_PREFIX = "bimi-cache/";
const SETTINGS_KEY = "bimi/settings.json";
export const SENDER_LOGO_TTL_MS = 24 * 60 * 60 * 1000;
export const NO_LOGO_TTL_MS = 6 * 60 * 60 * 1000;
export const FAILED_LOOKUP_TTL_MS = 10 * 60 * 1000;
/** Authentication headers are in the leading header block, so a partial read is enough. */
const HEADER_SCAN_BYTES = 64 * 1024;

export type BimiSettings = { senderLogos: boolean };

/** The switch for showing senders' logos. It lives in R2 beside the logos because it needs no table; on by default. */
export async function getBimiSettings(bucket: Bucket): Promise<BimiSettings> {
	const object = await bucket.get(SETTINGS_KEY);
	if (!object) return { senderLogos: true };
	try {
		const parsed = JSON.parse(await object.text()) as { senderLogos?: unknown };
		return { senderLogos: parsed.senderLogos !== false };
	} catch {
		return { senderLogos: true };
	}
}

export async function setBimiSettings(bucket: Bucket, settings: BimiSettings): Promise<void> {
	await bucket.put(SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: "application/json" } });
}

export function senderDomain(fromAddr: string): string | null {
	const address = getEmailAddress(fromAddr);
	const at = address.lastIndexOf("@");
	return at > 0 ? address.slice(at + 1).trim().toLowerCase() : null;
}

/**
 * Whether the receiving provider recorded a DMARC pass for this message, so mail that spoofs a
 * domain never shows its logo. The spam analysis stores the verdicts of the providers it trusts;
 * a message received through SES without an analysis falls back to the headers SES wrote.
 */
export async function messagePassedDmarc(bucket: Bucket, message: { spamSignals: string | null; rawR2Key: string | null; fromAddr: string }): Promise<boolean> {
	if (message.spamSignals) {
		try {
			const ids = new Set((JSON.parse(message.spamSignals) as { id?: unknown }[]).map((signal) => signal.id));
			if (ids.has("dmarc_failed")) return false;
			if (ids.has("dmarc_passed")) return true;
		} catch {
			// Unreadable signals say nothing; look at the headers.
		}
	}
	if (!message.rawR2Key) return false;
	const object = await bucket.get(message.rawR2Key, { range: { offset: 0, length: HEADER_SCAN_BYTES } });
	if (!object) return false;
	return readSesAuthentication(await object.arrayBuffer(), getEmailAddress(message.fromAddr))?.dmarc?.status === "PASS";
}

/** The cached or freshly looked up logo of a sender domain, or null when it has none. */
export async function getSenderLogo(bucket: Bucket, domain: string, deps: BimiLookupDeps = {}, now = Date.now()): Promise<string | null> {
	const key = `${CACHE_PREFIX}${domain}`;
	const cached = await bucket.get(key);
	const checkedAt = Number(cached?.customMetadata?.checkedAt);
	const ttl = Number(cached?.customMetadata?.ttl);
	const stale = cached ? await cached.text() : "";
	if (cached && Number.isFinite(checkedAt) && Number.isFinite(ttl) && now - checkedAt < ttl) return stale || null;

	const store = (svg: string, ttlMs: number) =>
		bucket.put(key, svg, { httpMetadata: { contentType: "image/svg+xml" }, customMetadata: { checkedAt: String(now), ttl: String(ttlMs) } });
	try {
		const svg = await lookupBimiLogo(domain, deps);
		await store(svg ?? "", svg ? SENDER_LOGO_TTL_MS : NO_LOGO_TTL_MS);
		return svg;
	} catch (error) {
		if (!(error instanceof BimiTransientError)) throw error;
		// Keep what was cached through a DNS or network hiccup and ask again soon.
		await store(stale, FAILED_LOOKUP_TTL_MS);
		return stale || null;
	}
}
