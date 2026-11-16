import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-access-bypass-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: { bypass: join(root, "src/lib/security/access-bypass.ts") },
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
});

const { ACCESS_BYPASS_GROUPS, isAccessBypassPath } = await import(pathToFileURL(join(outDir, "bypass.mjs")).href);
const script = join(root, "scripts", "setup-access.mjs");
const { BYPASS_GROUPS, buildPlan, destinationsFor, parseArgs } = await import(pathToFileURL(script).href);

test("bypass matcher accepts the externally called paths", () => {
	for (const path of [
		"/api/inbound",
		"/api/inbound/resend",
		"/api/inbound/ses",
		"/book/user1",
		"/book/user1/event1",
		"/c/alice",
		"/c/alice/intro",
		"/api/public/booking",
		"/api/public/booking/event1",
		"/d/token",
		"/api/drive/public/token",
		"/api/shared-files/abc",
		"/api/i/abcdefghijklmnopqrst.gif",
		"/api/calendar/feed",
		"/api/v1/send",
		"/api/calendar/events/e1",
		"/mcp",
		"/jmap/session",
		"/.well-known/jmap",
		"/api/mobile/push",
		"/api/auth/device",
		"/_next/static/chunks/a.js",
		"/locales/de.json",
		"/manifest.webmanifest",
		"/sw.js",
		"/icon-192.png",
		"/api/branding/icon",
	]) {
		assert.equal(isAccessBypassPath(path), true, path);
	}
});

test("bypass matcher does not confuse prefixes or open the app", () => {
	for (const path of [
		"/",
		"/inbox",
		"/setup",
		"/login",
		"/bookx",
		"/book-admin",
		"/booking",
		"/cx",
		"/calendar",
		"/dx/token",
		"/drive",
		"/mcpx",
		"/jmapx",
		"/api/inboundx",
		"/api/inbound-admin",
		"/api/ix",
		"/api/internal",
		"/api/messages",
		"/api/admin/general",
		"/api/auth/login",
		"/api/auth/device/extra-not-exact",
		"/api/calendar",
		"/api/calendar/feedx",
		"/api/calendar/feed/x",
		"/api/branding",
		"/api/branding/icon/x",
		"/api/remote-images",
		"/api/seed",
		"/sw.js/x",
		"/sw.jsx",
		"/_next/image",
		"/_next/staticx/a.js",
		"/.well-known/jmapx",
		"/.well-known/other",
		"/api/v10",
		"/api/booking",
		"/api/drive/items",
		"/api/shared-filesx",
	]) {
		assert.equal(isAccessBypassPath(path), false, path);
	}
});

test("bypass matcher compares the raw path, so encoded look-alikes stay protected", () => {
	assert.equal(isAccessBypassPath("/boo%6B/x"), false);
	assert.equal(isAccessBypassPath("/book%2Fx"), false);
	assert.equal(isAccessBypassPath("/api/inbound%2F..%2Fadmin"), false);
});

test("every group has an id, a reason and rooted rules", () => {
	assert.equal(new Set(ACCESS_BYPASS_GROUPS.map((group) => group.id)).size, ACCESS_BYPASS_GROUPS.length);
	for (const group of ACCESS_BYPASS_GROUPS) {
		assert.ok(group.reason.length > 20, group.id);
		for (const rule of group.rules) {
			assert.match(rule.path, /^\/[^*]*[^/*]$/, `${group.id}: ${rule.path}`);
			assert.ok(rule.match === "exact" || rule.match === "prefix");
		}
	}
});

test("the setup script's bypass groups mirror src/lib/security/access-bypass.ts", () => {
	assert.deepEqual(
		BYPASS_GROUPS,
		ACCESS_BYPASS_GROUPS.map((group) => ({ id: group.id, rules: group.rules })),
	);
});

const domain = "mail.tarle.de";

test("the plan has a login app and one bypass app per group, with matching destinations", () => {
	const plan = buildPlan({ domain, email: "owner@example.com" });
	assert.equal(plan.length, 1 + ACCESS_BYPASS_GROUPS.length);
	const [main, ...bypass] = plan;
	assert.deepEqual(main.destinations, [{ type: "public", uri: domain }]);
	assert.equal(main.session_duration, "24h");
	assert.deepEqual(main.policies, [{ name: "Owner", decision: "allow", include: [{ email: { email: "owner@example.com" } }] }]);
	ACCESS_BYPASS_GROUPS.forEach((group, index) => {
		const app = bypass[index];
		assert.ok(app.name.endsWith(`bypass: ${group.id})`));
		assert.deepEqual(app.destinations.map((destination) => destination.uri), destinationsFor(domain, group.rules));
		assert.equal(app.domain, app.destinations[0].uri);
		assert.deepEqual(app.policies, [{ name: "Bypass everyone", decision: "bypass", include: [{ everyone: {} }] }]);
	});
});

test("prefix rules become the bare path and the wildcard form, exact rules one destination", () => {
	assert.deepEqual(destinationsFor(domain, [{ match: "prefix", path: "/book" }, { match: "exact", path: "/sw.js" }]), [`${domain}/book`, `${domain}/book/*`, `${domain}/sw.js`]);
});

test("dry run prints the planned calls for every bypass path and needs no credentials", () => {
	const result = spawnSync(process.execPath, [script, "--domain", domain, "--email", "owner@example.com", "--dry-run"], {
		encoding: "utf8",
		env: { PATH: process.env.PATH },
	});
	assert.equal(result.status, 0, result.stderr);
	const bodies = [...result.stdout.matchAll(/^ {2}body (.+)$/gm)].map((match) => JSON.parse(match[1]));
	assert.deepEqual(bodies, buildPlan({ domain, email: "owner@example.com" }));
	const printed = new Set(bodies.flatMap((body) => body.destinations.map((destination) => destination.uri)));
	for (const group of ACCESS_BYPASS_GROUPS) {
		for (const uri of destinationsFor(domain, group.rules)) assert.ok(printed.has(uri), uri);
	}
	assert.match(result.stdout, /^POST \/accounts\/<CF_ACCOUNT_ID>\/access\/apps/m);
});

test("the script rejects a bad domain, a bad email and unknown flags without calling the API", () => {
	assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
	assert.deepEqual(parseArgs(["--domain=mail.tarle.de", "--email", "a@b.de", "--dry-run"]), { dryRun: true, help: false, domain, email: "a@b.de" });
	for (const args of [["--domain", "not a host", "--email", "a@b.de", "--dry-run"], ["--domain", domain, "--email", "nope", "--dry-run"]]) {
		const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /--domain|--email/);
	}
});

test("a real run without credentials stops before any request", () => {
	const result = spawnSync(process.execPath, [script, "--domain", domain, "--email", "a@b.de"], { encoding: "utf8", env: { PATH: process.env.PATH } });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /CF_ACCOUNT_ID and CF_ACCESS_API_TOKEN/);
});
