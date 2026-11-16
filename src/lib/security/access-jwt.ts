import { isAccessBypassPath } from "./access-bypass";

/**
 * Defense in depth behind Cloudflare Access: the edge already blocks anonymous requests, and this check
 * rejects any request that reaches the Worker without a valid `Cf-Access-Jwt-Assertion` (for example when the
 * Access application is later misconfigured or the route is exposed on another hostname).
 * Active only when both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are set; WebCrypto only.
 */
export const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";

const JWKS_TTL_MS = 10 * 60_000;
/** A token with an unknown `kid` forces a refresh (Cloudflare rotates keys), but never more often than this. */
const JWKS_MIN_REFRESH_MS = 60_000;
const CLOCK_SKEW_MS = 60_000;
const JWKS_FETCH_TIMEOUT_MS = 5_000;
const TEAM_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;

export type AccessEnv = { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string };

export type AccessJwtResult = { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string };

type JwksCache = { keys: Map<string, CryptoKey>; fetchedAt: number };
const jwksCache = new Map<string, JwksCache>();

export function clearAccessJwksCache() {
	jwksCache.clear();
}

/**
 * Accepts `team`, `team.cloudflareaccess.com` or `https://team.cloudflareaccess.com/` and returns the host,
 * or null for anything that is not a cloudflareaccess.com team domain (the value becomes a fetch target).
 */
export function normalizeAccessTeamDomain(value: string | undefined): string | null {
	const raw = value?.trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/+$/, "");
	if (!raw) return null;
	const host = raw.includes(".") ? raw : `${raw}.cloudflareaccess.com`;
	return TEAM_HOST_PATTERN.test(host) ? host : null;
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
	const padded = input.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
	return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function decodeJson(segment: string): Record<string, unknown> | null {
	try {
		const value = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
		return value && typeof value === "object" && !Array.isArray(value) ? value : null;
	} catch {
		return null;
	}
}

async function fetchJwks(teamHost: string, fetchImpl: typeof fetch): Promise<Map<string, CryptoKey>> {
	const response = await fetchImpl(`https://${teamHost}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS) });
	if (!response.ok) throw new Error(`Access certs request failed with ${response.status}`);
	const body = (await response.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
	const keys = new Map<string, CryptoKey>();
	for (const jwk of body.keys ?? []) {
		if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue;
		const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
		keys.set(jwk.kid, key);
	}
	if (keys.size === 0) throw new Error("Access certs response held no RSA keys");
	return keys;
}

async function getSigningKey(teamHost: string, kid: string, fetchImpl: typeof fetch, now: number): Promise<CryptoKey | null> {
	const cached = jwksCache.get(teamHost);
	const fresh = cached && now - cached.fetchedAt < JWKS_TTL_MS;
	if (fresh && cached.keys.has(kid)) return cached.keys.get(kid) ?? null;
	// Unknown kid on a fresh cache: refresh only when the last fetch is old enough, so garbage kids cannot hammer the certs endpoint.
	if (cached && fresh && now - cached.fetchedAt < JWKS_MIN_REFRESH_MS) return null;
	try {
		const keys = await fetchJwks(teamHost, fetchImpl);
		jwksCache.set(teamHost, { keys, fetchedAt: now });
		return keys.get(kid) ?? null;
	} catch (error) {
		console.error("Fetching the Cloudflare Access signing keys failed", error);
		// A stale key set still verifies tokens signed before the outage.
		return cached?.keys.get(kid) ?? null;
	}
}

export async function verifyAccessJwt(
	token: string,
	options: { teamHost: string; aud: string; now?: number; fetchImpl?: typeof fetch },
): Promise<AccessJwtResult> {
	const now = options.now ?? Date.now();
	const parts = token.split(".");
	if (parts.length !== 3) return { ok: false, reason: "malformed" };
	const [headerPart, payloadPart, signaturePart] = parts;
	const header = decodeJson(headerPart);
	const payload = decodeJson(payloadPart);
	if (!header || !payload) return { ok: false, reason: "malformed" };
	if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "unsupported header" };

	const key = await getSigningKey(options.teamHost, header.kid, options.fetchImpl ?? fetch, now);
	if (!key) return { ok: false, reason: "unknown kid" };
	let signature: Uint8Array<ArrayBuffer>;
	try {
		signature = base64UrlToBytes(signaturePart);
	} catch {
		return { ok: false, reason: "malformed" };
	}
	const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${headerPart}.${payloadPart}`));
	if (!valid) return { ok: false, reason: "bad signature" };

	if (payload.iss !== `https://${options.teamHost}`) return { ok: false, reason: "wrong issuer" };
	const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!audience.includes(options.aud)) return { ok: false, reason: "wrong audience" };
	if (typeof payload.exp !== "number" || payload.exp * 1000 + CLOCK_SKEW_MS <= now) return { ok: false, reason: "expired" };
	if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf * 1000 - CLOCK_SKEW_MS > now)) return { ok: false, reason: "not yet valid" };
	return { ok: true, payload };
}

const FORBIDDEN_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function forbidden(pathname: string, status = 403): Response {
	if (pathname.startsWith("/api/")) return Response.json({ error: status === 403 ? "Forbidden" : "Cloudflare Access is misconfigured" }, { status, headers: FORBIDDEN_HEADERS });
	const message = status === 403 ? "Access denied. Sign in through Cloudflare Access to use this site." : "Cloudflare Access is misconfigured on this Worker.";
	return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${status}</title></head><body><h1>${status}</h1><p>${message}</p></body></html>`, {
		status,
		headers: { ...FORBIDDEN_HEADERS, "Content-Type": "text/html; charset=utf-8" },
	});
}

/**
 * Returns a rejection response, or null to let the request continue. A no-op when neither variable is set;
 * when only one is set (or the team domain is invalid) it fails closed with 503 rather than silently serving unprotected.
 */
export async function enforceCloudflareAccess(request: Request, env: AccessEnv, options: { now?: number; fetchImpl?: typeof fetch } = {}): Promise<Response | null> {
	const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
	const aud = env.CF_ACCESS_AUD?.trim();
	if (!teamDomain && !aud) return null;
	const { pathname } = new URL(request.url);
	if (isAccessBypassPath(pathname)) return null;
	const teamHost = normalizeAccessTeamDomain(teamDomain);
	if (!teamHost || !aud) {
		console.error("Cloudflare Access is half-configured: set both CF_ACCESS_TEAM_DOMAIN (a *.cloudflareaccess.com team domain) and CF_ACCESS_AUD, or neither");
		return forbidden(pathname, 503);
	}
	const token = request.headers.get(ACCESS_JWT_HEADER);
	if (!token) return forbidden(pathname);
	const result = await verifyAccessJwt(token, { teamHost, aud, ...options });
	if (result.ok) return null;
	console.warn("Cloudflare Access token rejected", result.reason);
	return forbidden(pathname);
}
