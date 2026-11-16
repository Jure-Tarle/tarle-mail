import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "mailflare-bimi-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	stdin: {
		contents: [
			'export * from "@/lib/bimi/svg";',
			'export * from "@/lib/bimi/record";',
			'export * from "@/lib/bimi/lookup";',
			'export * from "@/lib/bimi/sender-logo";',
		].join("\n"),
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "bimi.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	logLevel: "silent",
	alias: { "@": join(root, "src") },
});

const bimi = await import(pathToFileURL(join(outDir, "bimi.mjs")).href);

const GOOD_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100">
<title>Example</title><rect width="100" height="100" fill="#0a0"/></svg>`;

const withRoot = (attributes, body = "<title>Example</title><rect width='1' height='1'/>") =>
	`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
const TINY = 'version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"';

test("accepts a square SVG Tiny PS logo with a title", () => {
	assert.equal(bimi.checkBimiSvg(GOOD_SVG), null);
	assert.equal(bimi.checkBimiSvg(withRoot(TINY.replace('0 0 100 100', '0, 0, 64, 64'))), null);
});

for (const [name, svg, message] of [
	["not an svg", "<html></html>", /not an SVG/],
	["a DOCTYPE", `<!DOCTYPE svg><svg ${TINY}><title>x</title></svg>`, /DOCTYPE/],
	["the wrong profile", withRoot('version="1.1" viewBox="0 0 10 10"'), /SVG Tiny PS/],
	["no baseProfile", withRoot('version="1.2" viewBox="0 0 10 10"'), /SVG Tiny PS/],
	["x and y on the root", withRoot(`${TINY} x="3"`), /x or y/],
	["a non-square viewBox", withRoot('version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 60"'), /square/],
	["no viewBox or size", withRoot('version="1.2" baseProfile="tiny-ps"'), /viewBox/],
	["no title", withRoot(TINY, "<rect width='1' height='1'/>"), /title/],
	["an empty title", withRoot(TINY, "<title> </title>"), /title/],
	["a script", withRoot(TINY, "<title>x</title><script>alert(1)</script>"), /scripts or animation/],
	["a foreignObject", withRoot(TINY, "<title>x</title><foreignObject/>"), /scripts or animation/],
	["animation", withRoot(TINY, "<title>x</title><rect><animate attributeName='x'/></rect>"), /scripts or animation/],
	["an event handler", withRoot(TINY, "<title>x</title><rect onload='f()'/>"), /event handlers/],
	["an entity declaration", `<?xml version="1.0"?><svg ${TINY}><!ENTITY a "b"><title>x</title></svg>`, /entities|DOCTYPE/],
	["an external href", withRoot(TINY, "<title>x</title><image href='https://example.com/a.png'/>"), /other files/],
	["a javascript href", withRoot(TINY, "<title>x</title><a xlink:href='javascript:alert(1)'><rect/></a>"), /other files/],
	["an external url()", withRoot(TINY, "<title>x</title><rect style='fill:url(https://example.com/a)'/>"), /other files/],
	["an @import", withRoot(TINY, "<title>x</title><style>@import 'a.css';</style>"), /other files/],
	["a file over 32 KB", withRoot(TINY, `<title>x</title><!-- -->${"<rect/>".repeat(6000)}`), /32 KB/],
]) {
	test(`rejects ${name}`, () => {
		assert.match(bimi.checkBimiSvg(svg) ?? "", message);
	});
}

test("accepts same-document references", () => {
	assert.equal(bimi.checkBimiSvg(withRoot(TINY, "<title>x</title><defs><linearGradient id='g'/></defs><rect fill='url(#g)'/><use href='#g'/>")), null);
});

test("a script hidden in a comment is not flagged, one outside a comment is", () => {
	assert.equal(bimi.checkBimiSvg(withRoot(TINY, "<title>x</title><!-- <script> -->")), null);
	assert.notEqual(bimi.checkBimiSvg(withRoot(TINY, "<title>x</title><SCRIPT>1</SCRIPT>")), null);
});

test("the safety check does not need the Tiny PS profile", () => {
	assert.equal(bimi.checkSvgSafety(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`), null);
	assert.notEqual(bimi.checkSvgSafety(`<svg><script/></svg>`), null);
});

test("parses BIMI records", () => {
	assert.deepEqual(bimi.parseBimiRecord("v=BIMI1; l=https://example.com/logo.svg;"), { logoUrl: "https://example.com/logo.svg", authorityUrl: null });
	assert.deepEqual(
		bimi.parseBimiRecord("V=BIMI1;L=https://example.com/a.svg, https://example.com/b.svg; a=https://example.com/vmc.pem"),
		{ logoUrl: "https://example.com/a.svg", authorityUrl: "https://example.com/vmc.pem" },
	);
	assert.deepEqual(bimi.parseBimiRecord("v=BIMI1; l="), { logoUrl: null, authorityUrl: null });
	assert.equal(bimi.parseBimiRecord("v=spf1 -all"), null);
	assert.equal(bimi.parseBimiRecord("l=https://example.com/logo.svg; v=BIMI1"), null);
	assert.equal(bimi.isBimiRecord('v=BIMI1'), true);
});

test("builds records and public addresses", () => {
	assert.equal(bimi.buildBimiRecord("https://mail.example.com/bimi/example.com.svg"), "v=BIMI1; l=https://mail.example.com/bimi/example.com.svg;");
	assert.equal(bimi.buildBimiRecord("https://x/y.svg", "https://x/vmc.pem"), "v=BIMI1; l=https://x/y.svg; a=https://x/vmc.pem;");
	assert.equal(bimi.publicLogoUrl("https://mail.example.com/", "Example.COM"), "https://mail.example.com/bimi/example.com.svg");
	assert.equal(bimi.logoFileHostname("Example.com.svg"), "example.com");
	assert.equal(bimi.logoFileHostname("example.com.png"), null);
	assert.equal(bimi.logoFileHostname("../x.svg"), null);
	assert.equal(bimi.unquoteTxt('"v=BIMI1; " "l=https://a/b.svg"'), "v=BIMI1; l=https://a/b.svg");
});

test("DMARC counts as enforced for quarantine or reject at pct 100", () => {
	assert.equal(bimi.dmarcEnforced("v=DMARC1; p=reject"), true);
	assert.equal(bimi.dmarcEnforced("v=DMARC1; p=quarantine; pct=100; rua=mailto:a@b.c"), true);
	assert.equal(bimi.dmarcEnforced("v=DMARC1; p=none"), false);
	assert.equal(bimi.dmarcEnforced("v=DMARC1; p=reject; pct=50"), false);
	assert.equal(bimi.dmarcEnforced("p=reject"), false);
	assert.equal(bimi.dmarcEnforced(null), false);
	// A subdomain follows sp= when the organizational domain's record has one.
	assert.equal(bimi.dmarcEnforced("v=DMARC1; p=reject; sp=none", { subdomain: true }), false);
	assert.equal(bimi.dmarcEnforced("v=DMARC1; p=none; sp=reject", { subdomain: true }), true);
	assert.equal(bimi.dmarcEnforced("v=DMARC1; p=reject", { subdomain: true }), true);
});

// --- lookup -----------------------------------------------------------------------------------

const PUBLIC = async () => ["93.184.216.34"];

function dns(zone) {
	return async (name) => {
		const value = zone[name];
		if (value instanceof Error) throw value;
		return value ?? [];
	};
}

const BIMI_ZONE = {
	"default._bimi.example.com": ["v=BIMI1; l=https://logos.example.net/logo.svg;"],
	"_dmarc.example.com": ["v=DMARC1; p=reject"],
};

function svgResponse(body = GOOD_SVG, headers = {}) {
	return new Response(body, { headers: { "content-type": "image/svg+xml", ...headers } });
}

function recorder(handler) {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return handler(String(url), init, calls.length);
	};
	return { fetch, calls };
}

test("looks up and downloads a published logo", async () => {
	const { fetch, calls } = recorder(() => svgResponse());
	const svg = await bimi.lookupBimiLogo("example.com", { queryTxt: dns(BIMI_ZONE), fetch, resolveHost: PUBLIC });
	assert.equal(svg, GOOD_SVG);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://logos.example.net/logo.svg");
	assert.equal(calls[0].init.redirect, "manual");
	assert.equal(calls[0].init.credentials, undefined);
});

test("falls back to the organizational domain for a subdomain sender", async () => {
	const { fetch } = recorder(() => svgResponse());
	const svg = await bimi.lookupBimiLogo("news.example.com", { queryTxt: dns(BIMI_ZONE), fetch, resolveHost: PUBLIC });
	assert.equal(svg, GOOD_SVG);
});

test("a subdomain with its own record uses it, and sp=none at the organizational domain blocks the fallback", async () => {
	const { fetch, calls } = recorder(() => svgResponse());
	const zone = { ...BIMI_ZONE, "_dmarc.example.com": ["v=DMARC1; p=reject; sp=none"] };
	assert.equal(await bimi.lookupBimiLogo("news.example.com", { queryTxt: dns(zone), fetch, resolveHost: PUBLIC }), null);
	assert.equal(calls.length, 0);
});

test("DMARC gating: a domain without enforced DMARC shows no logo and nothing is fetched", async () => {
	for (const dmarc of [[], ["v=DMARC1; p=none"], ["v=DMARC1; p=quarantine; pct=10"]]) {
		const { fetch, calls } = recorder(() => svgResponse());
		const zone = { ...BIMI_ZONE, "_dmarc.example.com": dmarc };
		assert.equal(await bimi.lookupBimiLogo("example.com", { queryTxt: dns(zone), fetch, resolveHost: PUBLIC }), null);
		assert.equal(calls.length, 0);
	}
});

test("no BIMI record, a declined record or a non-https address yields nothing", async () => {
	for (const record of [[], ["v=BIMI1; l="], ["v=BIMI1; l=http://logos.example.net/logo.svg"], ["v=BIMI1; l=https://127.0.0.1/logo.svg"], ["v=BIMI1; l=https://logos.example.net:8443/logo.svg"], ["v=BIMI1; l=https://u:p@logos.example.net/logo.svg"], ["v=BIMI1; l=https://localhost/logo.svg"]]) {
		const { fetch, calls } = recorder(() => svgResponse());
		const zone = { ...BIMI_ZONE, "default._bimi.example.com": record };
		assert.equal(await bimi.lookupBimiLogo("example.com", { queryTxt: dns(zone), fetch, resolveHost: PUBLIC }), null, JSON.stringify(record));
		assert.equal(calls.length, 0, JSON.stringify(record));
	}
});

test("a logo host that resolves to a private address is not fetched", async () => {
	for (const addresses of [["10.0.0.5"], ["93.184.216.34", "192.168.1.1"], ["::1"], ["fd00::1"], []]) {
		const { fetch, calls } = recorder(() => svgResponse());
		assert.equal(await bimi.lookupBimiLogo("example.com", { queryTxt: dns(BIMI_ZONE), fetch, resolveHost: async () => addresses }), null);
		assert.equal(calls.length, 0);
	}
});

test("redirects are followed by hand and every hop is checked", async () => {
	const hop = (location) => new Response(null, { status: 302, headers: { location } });
	let { fetch, calls } = recorder((url) => (url.endsWith("/logo.svg") ? hop("https://cdn.example.org/real.svg") : svgResponse()));
	assert.equal(await bimi.fetchBimiLogo("https://logos.example.net/logo.svg", { fetch, resolveHost: PUBLIC }), GOOD_SVG);
	assert.equal(calls.length, 2);

	for (const target of ["http://cdn.example.org/real.svg", "https://127.0.0.1/real.svg", "https://localhost/real.svg", "https://intranet.internal/real.svg"]) {
		({ fetch, calls } = recorder(() => hop(target)));
		assert.equal(await bimi.fetchBimiLogo("https://logos.example.net/logo.svg", { fetch, resolveHost: PUBLIC }), null, target);
		assert.equal(calls.length, 1, target);
	}

	// A hop whose name resolves to a private address.
	({ fetch, calls } = recorder(() => hop("https://rebind.example.org/real.svg")));
	const resolveHost = async (host) => (host === "rebind.example.org" ? ["10.1.1.1"] : ["93.184.216.34"]);
	assert.equal(await bimi.fetchBimiLogo("https://logos.example.net/logo.svg", { fetch, resolveHost }), null);
	assert.equal(calls.length, 1);

	// An endless chain stops.
	({ fetch, calls } = recorder(() => hop("https://logos.example.net/again.svg")));
	assert.equal(await bimi.fetchBimiLogo("https://logos.example.net/logo.svg", { fetch, resolveHost: PUBLIC }), null);
	assert.equal(calls.length, bimi.BIMI_MAX_REDIRECTS + 1);
});

test("fetch limits: declared size, streamed size, content type, status and content", async () => {
	const check = async (response) => bimi.fetchBimiLogo("https://logos.example.net/logo.svg", { fetch: async () => response, resolveHost: PUBLIC });

	assert.equal(await check(svgResponse(GOOD_SVG, { "content-length": String(bimi.BIMI_MAX_SVG_BYTES + 1) })), null);

	// No content-length: the stream is cut off once it passes the limit.
	let pulled = 0;
	const stream = new ReadableStream({
		pull(controller) {
			pulled += 1;
			controller.enqueue(new TextEncoder().encode("x".repeat(8 * 1024)));
			if (pulled > 100) controller.close();
		},
	});
	assert.equal(await check(new Response(stream, { headers: { "content-type": "image/svg+xml" } })), null);
	assert.ok(pulled <= 6, `read ${pulled} chunks`);

	assert.equal(await check(svgResponse(GOOD_SVG, { "content-type": "text/html" })), null);
	assert.equal(await check(svgResponse(GOOD_SVG, { "content-type": "image/png" })), null);
	assert.equal(await check(new Response(GOOD_SVG, { status: 404, headers: { "content-type": "image/svg+xml" } })), null);
	assert.equal(await check(svgResponse(`<svg><script>alert(1)</script></svg>`)), null);
	assert.equal(await check(svgResponse("not svg at all")), null);
	assert.equal(await check(new Response(new Uint8Array([0xff, 0xfe, 0x00]), { headers: { "content-type": "image/svg+xml" } })), null);
	assert.equal(await check(svgResponse(GOOD_SVG, { "content-type": "Image/SVG+XML; charset=utf-8" })), GOOD_SVG);
});

test("a timeout or server error is transient, not a missing logo", async () => {
	const never = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
	await assert.rejects(
		bimi.fetchBimiLogo("https://logos.example.net/logo.svg", { fetch: never, resolveHost: PUBLIC, timeoutMs: 20 }),
		(error) => error instanceof bimi.BimiTransientError,
	);
	await assert.rejects(
		bimi.fetchBimiLogo("https://logos.example.net/logo.svg", { fetch: async () => new Response("", { status: 503 }), resolveHost: PUBLIC }),
		(error) => error instanceof bimi.BimiTransientError,
	);
	await assert.rejects(
		bimi.lookupBimiLogo("example.com", { queryTxt: dns({ "default._bimi.example.com": new Error("SERVFAIL") }), fetch: async () => svgResponse(), resolveHost: PUBLIC }),
		(error) => error instanceof bimi.BimiTransientError,
	);
});

test("sender domains that cannot be looked up are refused before any request", async () => {
	for (const domain of ["localhost", "192.168.0.1", "a", "foo.internal", "x.nip.io", "bad domain.com", ""]) {
		let queried = 0;
		assert.equal(await bimi.lookupBimiLogo(domain, { queryTxt: async () => { queried += 1; return []; } }), null, domain);
		assert.equal(queried, 0, domain);
	}
});

// --- DMARC gating on a message, settings and cache ---------------------------------------------

function memoryBucket() {
	const objects = new Map();
	return {
		objects,
		async get(key, options) {
			const entry = objects.get(key);
			if (!entry) return null;
			const bytes = options?.range ? entry.body.slice(options.range.offset, options.range.offset + options.range.length) : entry.body;
			return {
				customMetadata: entry.customMetadata,
				text: async () => new TextDecoder().decode(entry.body),
				arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			};
		},
		async put(key, value, options) {
			objects.set(key, { body: typeof value === "string" ? new TextEncoder().encode(value) : value, customMetadata: options?.customMetadata });
		},
	};
}

const SES_RAW = (dmarc) => new TextEncoder().encode([
	"Return-Path: <bounce@example.com>",
	"Received: from mail.example.com (mail.example.com [93.184.216.34]) by inbound-smtp.eu-west-1.amazonaws.com with SMTP id abc",
	"Received-SPF: pass",
	`Authentication-Results: amazonses.com; spf=pass smtp.mailfrom=example.com; dkim=pass header.i=@example.com; dmarc=${dmarc} header.from=example.com;`,
	"X-SES-RECEIPT: AEFBQUFBQUFBQUFFZ0E9PQ==",
	"From: Example <news@example.com>",
	"",
	"Body",
].join("\r\n"));

test("a message shows a sender logo only when DMARC passed", async () => {
	const bucket = memoryBucket();
	const message = (extra) => ({ spamSignals: null, rawR2Key: null, fromAddr: "Example <news@example.com>", ...extra });

	assert.equal(await bimi.messagePassedDmarc(bucket, message({ spamSignals: JSON.stringify([{ id: "dmarc_passed", score: -1 }]) })), true);
	assert.equal(await bimi.messagePassedDmarc(bucket, message({ spamSignals: JSON.stringify([{ id: "spf_passed" }, { id: "dmarc_failed" }]) })), false);
	assert.equal(await bimi.messagePassedDmarc(bucket, message({ spamSignals: JSON.stringify([{ id: "dkim_passed" }]) })), false);
	assert.equal(await bimi.messagePassedDmarc(bucket, message({ spamSignals: "not json" })), false);
	assert.equal(await bimi.messagePassedDmarc(bucket, message()), false);

	// Without an analysis, SES's own headers decide.
	bucket.objects.set("raw/pass", { body: SES_RAW("pass") });
	bucket.objects.set("raw/fail", { body: SES_RAW("fail") });
	assert.equal(await bimi.messagePassedDmarc(bucket, message({ rawR2Key: "raw/pass" })), true);
	assert.equal(await bimi.messagePassedDmarc(bucket, message({ rawR2Key: "raw/fail" })), false);
	assert.equal(await bimi.messagePassedDmarc(bucket, message({ rawR2Key: "raw/missing" })), false);

	// A sender-written Authentication-Results line in the body of the message is not trusted.
	bucket.objects.set("raw/forged", {
		body: new TextEncoder().encode("From: a@example.com\r\nAuthentication-Results: amazonses.com; dmarc=pass header.from=example.com\r\n\r\nBody"),
	});
	assert.equal(await bimi.messagePassedDmarc(bucket, message({ rawR2Key: "raw/forged" })), false);
});

test("extracts the sender domain", () => {
	assert.equal(bimi.senderDomain("Example <News@Example.COM>"), "example.com");
	assert.equal(bimi.senderDomain("news@example.com"), "example.com");
	assert.equal(bimi.senderDomain("no address"), null);
});

test("sender logos are off unless the setting turns them on (no VMC/CMC check, so opt-in)", async () => {
	const bucket = memoryBucket();
	assert.deepEqual(await bimi.getBimiSettings(bucket), { senderLogos: false });
	await bimi.setBimiSettings(bucket, { senderLogos: true });
	assert.deepEqual(await bimi.getBimiSettings(bucket), { senderLogos: true });
	await bimi.setBimiSettings(bucket, { senderLogos: false });
	assert.deepEqual(await bimi.getBimiSettings(bucket), { senderLogos: false });
	bucket.objects.set("bimi/settings.json", { body: new TextEncoder().encode("{broken") });
	assert.deepEqual(await bimi.getBimiSettings(bucket), { senderLogos: false });
});

test("a sender logo is cached, and so is its absence, until the time to live passes", async () => {
	const bucket = memoryBucket();
	const { fetch, calls } = recorder(() => svgResponse());
	const deps = { queryTxt: dns(BIMI_ZONE), fetch, resolveHost: PUBLIC };
	const t0 = 1_000_000;

	assert.equal(await bimi.getSenderLogo(bucket, "example.com", deps, t0), GOOD_SVG);
	assert.equal(await bimi.getSenderLogo(bucket, "example.com", deps, t0 + 60_000), GOOD_SVG);
	assert.equal(calls.length, 1);
	assert.equal(await bimi.getSenderLogo(bucket, "example.com", deps, t0 + bimi.SENDER_LOGO_TTL_MS + 1), GOOD_SVG);
	assert.equal(calls.length, 2);

	const quiet = { ...deps, queryTxt: dns({}) };
	assert.equal(await bimi.getSenderLogo(bucket, "other.org", quiet, t0), null);
	assert.equal(await bimi.getSenderLogo(bucket, "other.org", quiet, t0 + 1000), null);
	assert.equal(await bimi.getSenderLogo(bucket, "other.org", deps, t0 + 2000), null, "negative result is served from the cache");
	assert.equal(calls.length, 2);
	assert.equal(await bimi.getSenderLogo(bucket, "other.org", { ...deps, queryTxt: dns({ "default._bimi.other.org": BIMI_ZONE["default._bimi.example.com"], "_dmarc.other.org": ["v=DMARC1; p=reject"] }) }, t0 + bimi.NO_LOGO_TTL_MS + 1), GOOD_SVG);
});

test("a failed lookup keeps the cached logo and retries soon", async () => {
	const bucket = memoryBucket();
	const t0 = 5_000_000;
	const ok = { queryTxt: dns(BIMI_ZONE), fetch: async () => svgResponse(), resolveHost: PUBLIC };
	assert.equal(await bimi.getSenderLogo(bucket, "example.com", ok, t0), GOOD_SVG);

	const broken = { ...ok, queryTxt: dns({ "default._bimi.example.com": new Error("SERVFAIL") }) };
	const later = t0 + bimi.SENDER_LOGO_TTL_MS + 1;
	assert.equal(await bimi.getSenderLogo(bucket, "example.com", broken, later), GOOD_SVG);
	// The retry is not postponed for a day.
	assert.equal(await bimi.getSenderLogo(bucket, "example.com", { ...ok, queryTxt: dns({}) }, later + bimi.FAILED_LOOKUP_TTL_MS + 1), null);

	assert.equal(await bimi.getSenderLogo(bucket, "fresh.example.org", broken, later), null);
});
