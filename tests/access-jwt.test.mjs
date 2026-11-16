import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-access-jwt-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: { jwt: join(root, "src/lib/security/access-jwt.ts") },
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});

const { verifyAccessJwt, enforceCloudflareAccess, normalizeAccessTeamDomain, clearAccessJwksCache } = await import(pathToFileURL(join(outDir, "jwt.mjs")).href);

const TEAM = "tarle.cloudflareaccess.com";
const AUD = "a".repeat(64);
const NOW = Date.parse("2026-11-16T12:00:00Z");
const nowSeconds = NOW / 1000;
const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const json = (value) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function keyPair() {
	return crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
}

async function sign(privateKey, claims, header = { alg: "RS256", kid: "k1", typ: "JWT" }) {
	const input = `${json(header)}.${json(claims)}`;
	const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(input));
	return `${input}.${b64url(new Uint8Array(signature))}`;
}

const goodClaims = () => ({ iss: `https://${TEAM}`, aud: [AUD], exp: nowSeconds + 3600, iat: nowSeconds - 10, email: "me@example.com" });

const primary = await keyPair();
const other = await keyPair();
const primaryJwk = { ...(await crypto.subtle.exportKey("jwk", primary.publicKey)), kid: "k1" };

let fetchCalls = [];
function jwksFetch(keys = [primaryJwk]) {
	fetchCalls = [];
	return async (url) => {
		fetchCalls.push(String(url));
		return Response.json({ keys });
	};
}

async function quietly(method, run) {
	const original = console[method];
	console[method] = () => {};
	try {
		return await run();
	} finally {
		console[method] = original;
	}
}

beforeEach(() => clearAccessJwksCache());

const verify = (token, fetchImpl = jwksFetch(), now = NOW) => verifyAccessJwt(token, { teamHost: TEAM, aud: AUD, now, fetchImpl });

test("accepts a valid token and reads the JWKS from the team domain", async () => {
	const result = await verify(await sign(primary.privateKey, goodClaims()));
	assert.equal(result.ok, true);
	assert.equal(result.payload.email, "me@example.com");
	assert.deepEqual(fetchCalls, [`https://${TEAM}/cdn-cgi/access/certs`]);
});

test("accepts a string aud claim", async () => {
	assert.equal((await verify(await sign(primary.privateKey, { ...goodClaims(), aud: AUD }))).ok, true);
});

test("rejects a wrong audience", async () => {
	const result = await verify(await sign(primary.privateKey, { ...goodClaims(), aud: ["b".repeat(64)] }));
	assert.deepEqual(result, { ok: false, reason: "wrong audience" });
});

test("rejects a wrong issuer", async () => {
	const result = await verify(await sign(primary.privateKey, { ...goodClaims(), iss: "https://evil.cloudflareaccess.com" }));
	assert.deepEqual(result, { ok: false, reason: "wrong issuer" });
});

test("rejects an expired token but tolerates a small clock skew", async () => {
	const expired = await verify(await sign(primary.privateKey, { ...goodClaims(), exp: nowSeconds - 120 }));
	assert.deepEqual(expired, { ok: false, reason: "expired" });
	const skewed = await verify(await sign(primary.privateKey, { ...goodClaims(), exp: nowSeconds - 30 }));
	assert.equal(skewed.ok, true);
});

test("rejects a token without exp", async () => {
	const claims = { ...goodClaims(), exp: undefined };
	assert.equal((await verify(await sign(primary.privateKey, claims))).ok, false);
});

test("rejects a token that is not valid yet, within skew", async () => {
	assert.deepEqual(await verify(await sign(primary.privateKey, { ...goodClaims(), nbf: nowSeconds + 300 })), { ok: false, reason: "not yet valid" });
	assert.equal((await verify(await sign(primary.privateKey, { ...goodClaims(), nbf: nowSeconds + 30 }))).ok, true);
});

test("rejects a bad signature: foreign key and tampered payload", async () => {
	assert.deepEqual(await verify(await sign(other.privateKey, goodClaims())), { ok: false, reason: "bad signature" });
	const [header, , signature] = (await sign(primary.privateKey, goodClaims())).split(".");
	const forged = `${header}.${json({ ...goodClaims(), email: "attacker@example.com" })}.${signature}`;
	assert.deepEqual(await verify(forged), { ok: false, reason: "bad signature" });
});

test("rejects an unknown kid and does not refetch the JWKS for it every time", async () => {
	const token = await sign(primary.privateKey, goodClaims(), { alg: "RS256", kid: "rotated" });
	const fetchImpl = jwksFetch();
	assert.deepEqual(await verify(token, fetchImpl), { ok: false, reason: "unknown kid" });
	assert.deepEqual(await verify(token, fetchImpl, NOW + 1000), { ok: false, reason: "unknown kid" });
	assert.equal(fetchCalls.length, 1);
});

test("refreshes the JWKS for an unknown kid once the minimum interval has passed", async () => {
	const rotated = await keyPair();
	const rotatedJwk = { ...(await crypto.subtle.exportKey("jwk", rotated.publicKey)), kid: "k2" };
	const token = await sign(rotated.privateKey, { ...goodClaims(), exp: nowSeconds + 7200 }, { alg: "RS256", kid: "k2" });
	assert.equal((await verify(token, jwksFetch([primaryJwk]))).ok, false);
	const later = await verify(token, jwksFetch([primaryJwk, rotatedJwk]), NOW + 61_000);
	assert.equal(later.ok, true);
	assert.equal(fetchCalls.length, 1);
});

test("caches the JWKS within the TTL and refetches after it", async () => {
	const token = await sign(primary.privateKey, { ...goodClaims(), exp: nowSeconds + 7200 });
	const fetchImpl = jwksFetch();
	await verify(token, fetchImpl);
	await verify(token, fetchImpl, NOW + 5 * 60_000);
	assert.equal(fetchCalls.length, 1);
	await verify(token, fetchImpl, NOW + 11 * 60_000);
	assert.equal(fetchCalls.length, 2);
});

test("falls back to the cached keys when the JWKS endpoint fails after the TTL", async () => {
	const token = await sign(primary.privateKey, { ...goodClaims(), exp: nowSeconds + 7200 });
	await verify(token);
	const failing = async () => new Response("down", { status: 503 });
	const result = await quietly("error", () => verify(token, failing, NOW + 11 * 60_000));
	assert.equal(result.ok, true);
});

test("rejects unsupported algorithms and malformed tokens", async () => {
	assert.deepEqual(await verify(await sign(primary.privateKey, goodClaims(), { alg: "none", kid: "k1" })), { ok: false, reason: "unsupported header" });
	assert.deepEqual(await verify(await sign(primary.privateKey, goodClaims(), { alg: "HS256", kid: "k1" })), { ok: false, reason: "unsupported header" });
	assert.deepEqual(await verify("not-a-jwt"), { ok: false, reason: "malformed" });
	assert.deepEqual(await verify("a.b.c"), { ok: false, reason: "malformed" });
});

test("normalizes team domains and refuses other hosts", () => {
	assert.equal(normalizeAccessTeamDomain("tarle"), TEAM);
	assert.equal(normalizeAccessTeamDomain("https://Tarle.cloudflareaccess.com/"), TEAM);
	assert.equal(normalizeAccessTeamDomain("evil.example.com"), null);
	assert.equal(normalizeAccessTeamDomain("tarle.cloudflareaccess.com.evil.com"), null);
	assert.equal(normalizeAccessTeamDomain(undefined), null);
});

const env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
const request = (path, headers = {}) => new Request(`https://mail.tarle.de${path}`, { headers });

test("enforcement is a no-op when the variables are unset", async () => {
	assert.equal(await enforceCloudflareAccess(request("/inbox"), {}), null);
});

test("enforcement lets bypass paths through without a token", async () => {
	assert.equal(await enforceCloudflareAccess(request("/api/inbound/resend"), env, { now: NOW, fetchImpl: jwksFetch() }), null);
	assert.equal(fetchCalls.length, 0);
});

test("enforcement answers 403 HTML for pages and JSON for /api without a token", async () => {
	const page = await enforceCloudflareAccess(request("/inbox"), env, { now: NOW, fetchImpl: jwksFetch() });
	assert.equal(page.status, 403);
	assert.match(page.headers.get("content-type"), /text\/html/);
	const api = await enforceCloudflareAccess(request("/api/messages"), env, { now: NOW, fetchImpl: jwksFetch() });
	assert.equal(api.status, 403);
	assert.match(api.headers.get("content-type"), /application\/json/);
	assert.deepEqual(await api.json(), { error: "Forbidden" });
});

test("enforcement does not treat a look-alike path as a bypass", async () => {
	const response = await enforceCloudflareAccess(request("/bookx"), env, { now: NOW, fetchImpl: jwksFetch() });
	assert.equal(response.status, 403);
});

test("enforcement passes a valid token and rejects an invalid one", async () => {
	const good = await sign(primary.privateKey, goodClaims());
	assert.equal(await enforceCloudflareAccess(request("/inbox", { "Cf-Access-Jwt-Assertion": good }), env, { now: NOW, fetchImpl: jwksFetch() }), null);
	const bad = await sign(other.privateKey, goodClaims());
	const response = await quietly("warn", () => enforceCloudflareAccess(request("/inbox", { "Cf-Access-Jwt-Assertion": bad }), env, { now: NOW, fetchImpl: jwksFetch() }));
	assert.equal(response.status, 403);
});

test("enforcement fails closed when only one variable is set or the team domain is foreign", async () => {
	await quietly("error", async () => {
		assert.equal((await enforceCloudflareAccess(request("/inbox"), { CF_ACCESS_AUD: AUD })).status, 503);
		assert.equal((await enforceCloudflareAccess(request("/inbox"), { CF_ACCESS_TEAM_DOMAIN: TEAM })).status, 503);
		assert.equal((await enforceCloudflareAccess(request("/inbox"), { CF_ACCESS_TEAM_DOMAIN: "evil.example.com", CF_ACCESS_AUD: AUD })).status, 503);
	});
});
