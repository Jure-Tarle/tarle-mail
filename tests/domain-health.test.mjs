import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "tarle-mail-domain-health-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `export * from "./src/lib/domains/health-diff.ts";`,
		resolveDir: root,
		sourcefile: "domain-health-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});
const diff = await import(pathToFileURL(join(directory, "entry.mjs")).href);

const txt = (id, name, content) => ({ id, type: "TXT", name, content });
const mx = (id, content, priority) => ({ id, type: "MX", name: "example.com", content, priority });
const CF_SPF = "include:_spf.mx.cloudflare.net";
const CF_MX = [
	{ content: "route1.mx.cloudflare.net", priority: 25 },
	{ content: "route2.mx.cloudflare.net", priority: 69 },
	{ content: "route3.mx.cloudflare.net", priority: 90 },
];

test("SPF merge adds a missing include ahead of the closing all and keeps everything else", () => {
	assert.equal(diff.mergeSpf("v=spf1 include:_spf.google.com ~all", [CF_SPF]), "v=spf1 include:_spf.google.com include:_spf.mx.cloudflare.net ~all");
	assert.equal(diff.mergeSpf("v=spf1 ip4:192.0.2.1 mx -all", [CF_SPF]), "v=spf1 ip4:192.0.2.1 mx include:_spf.mx.cloudflare.net -all");
	assert.equal(diff.mergeSpf("v=spf1 include:a.example", [CF_SPF]), "v=spf1 include:a.example include:_spf.mx.cloudflare.net");
});

test("SPF merge does not repeat a term the record already has, whatever its case", () => {
	assert.equal(diff.mergeSpf("v=spf1 INCLUDE:_SPF.MX.CLOUDFLARE.NET ~all", [CF_SPF]), "v=spf1 INCLUDE:_SPF.MX.CLOUDFLARE.NET ~all");
});

test("a missing SPF record is created once; an existing one is merged, never duplicated", () => {
	const missing = diff.evaluateSpf("example.com", [txt("t1", "example.com", "google-site-verification=abc")], [CF_SPF]);
	assert.equal(missing.status, "missing");
	assert.deepEqual(missing.actions.map((action) => action.kind), ["create-dns"]);
	assert.equal(missing.actions[0].record.content, "v=spf1 include:_spf.mx.cloudflare.net ~all");

	const wrong = diff.evaluateSpf("example.com", [txt("t1", "example.com", "google-site-verification=abc"), txt("spf1", "example.com", "\"v=spf1 include:_spf.google.com ~all\"")], [CF_SPF]);
	assert.equal(wrong.status, "wrong");
	assert.equal(wrong.actions.length, 1);
	assert.deepEqual(wrong.actions[0], { kind: "update-dns", recordId: "spf1", type: "TXT", name: "example.com", before: "v=spf1 include:_spf.google.com ~all", content: "v=spf1 include:_spf.google.com include:_spf.mx.cloudflare.net ~all" });

	const ok = diff.evaluateSpf("example.com", [txt("spf1", "example.com", "v=spf1 include:_spf.google.com include:_spf.mx.cloudflare.net ~all")], [CF_SPF]);
	assert.equal(ok.status, "ok");
	assert.deepEqual(ok.actions, []);
});

test("SPF records read from split quoted chunks", () => {
	const chunked = diff.evaluateSpf("example.com", [txt("spf1", "example.com", "\"v=spf1 include:_spf.google.com \" \"include:_spf.mx.cloudflare.net ~all\"")], [CF_SPF]);
	assert.equal(chunked.status, "ok");
});

test("SPF with two records or a redirect is reported without a repair", () => {
	const two = diff.evaluateSpf("example.com", [txt("a", "example.com", "v=spf1 -all"), txt("b", "example.com", "v=spf1 include:x.example ~all")], [CF_SPF]);
	assert.equal(two.status, "wrong");
	assert.deepEqual(two.actions, []);
	const redirect = diff.evaluateSpf("example.com", [txt("a", "example.com", "v=spf1 redirect=_spf.example.net")], [CF_SPF]);
	assert.equal(redirect.status, "wrong");
	assert.deepEqual(redirect.actions, []);
});

test("DMARC: missing is created, a valid policy is ok, broken or duplicate records are left alone", () => {
	const missing = diff.evaluateDmarc("_dmarc.example.com", [txt("t", "_dmarc.example.com", "something-else")]);
	assert.equal(missing.status, "missing");
	assert.equal(missing.actions[0].record.content, "v=DMARC1; p=none");
	assert.equal(diff.evaluateDmarc("_dmarc.example.com", [txt("d", "_dmarc.example.com", "v=DMARC1; p=quarantine; rua=mailto:a@example.com")]).status, "ok");
	const noPolicy = diff.evaluateDmarc("_dmarc.example.com", [txt("d", "_dmarc.example.com", "v=DMARC1; rua=mailto:a@example.com")]);
	assert.equal(noPolicy.status, "wrong");
	assert.deepEqual(noPolicy.actions, []);
	const twice = diff.evaluateDmarc("_dmarc.example.com", [txt("d1", "_dmarc.example.com", "v=DMARC1; p=none"), txt("d2", "_dmarc.example.com", "v=DMARC1; p=reject")]);
	assert.equal(twice.status, "wrong");
	assert.deepEqual(twice.actions, []);
});

test("MX: another service's records make the check wrong and are never replaced by a repair", () => {
	const foreign = diff.evaluateMx("example.com", [mx("m1", "aspmx.l.google.com", 1)], { expected: CF_MX });
	assert.equal(foreign.status, "wrong");
	assert.deepEqual(foreign.actions, []);

	const mixed = diff.evaluateMx("example.com", [mx("m1", "aspmx.l.google.com", 1), mx("m2", "route1.mx.cloudflare.net", 25)], { expected: CF_MX });
	assert.equal(mixed.status, "wrong");
	assert.deepEqual(mixed.actions, []);
});

test("MX: absent Cloudflare records are created, present ones are not repeated", () => {
	const none = diff.evaluateMx("example.com", [], { expected: CF_MX });
	assert.equal(none.status, "missing");
	assert.equal(none.actions.length, 3);
	assert.ok(none.actions.every((action) => action.kind === "create-dns" && action.record.type === "MX" && action.record.name === "example.com"));

	const partial = diff.evaluateMx("example.com", [mx("m1", "route1.mx.cloudflare.net.", 25)], { expected: CF_MX });
	assert.equal(partial.status, "missing");
	assert.deepEqual(partial.actions.map((action) => action.record.content), ["route2.mx.cloudflare.net", "route3.mx.cloudflare.net"]);

	assert.equal(diff.evaluateMx("example.com", CF_MX.map((item, index) => mx(`m${index}`, item.content, item.priority)), { expected: CF_MX }).status, "ok");
});

test("MX for a provider that accepts a shape of host: ok, wrong or missing, never repaired here", () => {
	const accepts = (content) => /inbound-smtp\.[a-z0-9-]+\.amazonaws\.com$/i.test(content);
	const expectation = { accepts, hint: "Run setup." };
	assert.equal(diff.evaluateMx("example.com", [mx("m", "inbound-smtp.eu-west-1.amazonaws.com", 10)], expectation).status, "ok");
	assert.equal(diff.evaluateMx("example.com", [mx("m", "mx.other.example", 10)], expectation).status, "wrong");
	const missing = diff.evaluateMx("example.com", [], expectation);
	assert.equal(missing.status, "missing");
	assert.deepEqual(missing.actions, []);
});

test("a rotated DKIM key is rewritten in place only when it is the sole record at that name", () => {
	const expected = [{ type: "TXT", name: "k1._domainkey.example.com", content: "v=DKIM1; p=NEW" }];
	const lookupOf = (records) => (type, name) => records.filter((record) => record.type === type && record.name === name);

	const rotated = diff.evaluateRecordSet(expected, lookupOf([txt("old", "k1._domainkey.example.com", "\"v=DKIM1; p=OLD\"")]), "sending");
	assert.equal(rotated.status, "wrong");
	assert.deepEqual(rotated.actions.map((action) => [action.kind, action.recordId]), [["update-dns", "old"]]);

	const shared = diff.evaluateRecordSet(expected, lookupOf([txt("a", "k1._domainkey.example.com", "other"), txt("b", "k1._domainkey.example.com", "another")]), "sending");
	assert.equal(shared.status, "missing");
	assert.deepEqual(shared.actions.map((action) => action.kind), ["create-dns"]);

	assert.equal(diff.evaluateRecordSet(expected, lookupOf([txt("ok", "k1._domainkey.example.com", "\"v=DKIM1; p=NEW\"")]), "sending").status, "ok");
});

test("CNAME records compare without case or trailing dot, and MX records are only ever added", () => {
	const lookup = (type, name) => type === "CNAME" && name === "t._domainkey.example.com" ? [{ id: "c", type: "CNAME", name, content: "T.dkim.amazonses.com." }] : [];
	assert.equal(diff.evaluateRecordSet([{ type: "CNAME", name: "t._domainkey.example.com", content: "t.dkim.amazonses.com" }], lookup, "sending").status, "ok");
	const added = diff.evaluateRecordSet([{ type: "MX", name: "send.example.com", content: "feedback-smtp.example.amazonses.com", priority: 10 }], () => [{ id: "x", type: "MX", name: "send.example.com", content: "other.example", priority: 5 }], "sending");
	assert.deepEqual(added.actions.map((action) => action.kind), ["create-dns"]);
});

test("Email Routing and catch-all: disabled routing and a catch-all that goes elsewhere both offer a repair", () => {
	assert.equal(diff.evaluateRouting(true).status, "ok");
	assert.deepEqual(diff.evaluateRouting(false).actions, [{ kind: "enable-routing" }]);

	assert.equal(diff.evaluateCatchAll({ enabled: true, actions: [{ type: "worker", value: ["tarle-mail"] }] }, "tarle-mail").status, "ok");
	assert.equal(diff.evaluateCatchAll(null, "tarle-mail").status, "missing");
	const forward = diff.evaluateCatchAll({ enabled: true, actions: [{ type: "forward", value: ["me@example.net"] }] }, "tarle-mail");
	assert.equal(forward.status, "wrong");
	assert.deepEqual(forward.actions, [{ kind: "bind-catch-all", worker: "tarle-mail", current: "forward to me@example.net" }]);
	assert.equal(diff.evaluateCatchAll({ enabled: false, actions: [{ type: "worker", value: ["tarle-mail"] }] }, "tarle-mail").status, "wrong");
});

test("relative provider names become absolute", () => {
	assert.equal(diff.absoluteName("send", "example.com"), "send.example.com");
	assert.equal(diff.absoluteName("@", "example.com"), "example.com");
	assert.equal(diff.absoluteName("resend._domainkey.example.com", "example.com"), "resend._domainkey.example.com");
});

test("a repair plan only creates records or rewrites the one record it names, and never touches unrelated ones", () => {
	const unrelated = [
		txt("verify", "example.com", "google-site-verification=abc"),
		txt("other", "example.com", "ms=ms12345"),
		{ id: "www", type: "CNAME", name: "www.example.com", content: "example.net" },
		mx("foreign-mx", "aspmx.l.google.com", 1),
	];
	const spfRecord = txt("spf1", "example.com", "v=spf1 include:_spf.google.com ~all");
	const zone = [...unrelated, spfRecord];
	const lookup = (type, name) => zone.filter((record) => record.type === type && record.name === name);
	const checks = [
		{ id: "mx", label: "MX", ...diff.evaluateMx("example.com", lookup("MX", "example.com"), { expected: CF_MX }) },
		{ id: "spf", label: "SPF", ...diff.evaluateSpf("example.com", lookup("TXT", "example.com"), [CF_SPF]) },
		{ id: "dmarc", label: "DMARC", ...diff.evaluateDmarc("_dmarc.example.com", lookup("TXT", "_dmarc.example.com")) },
		{ id: "routing", label: "Email Routing", ...diff.evaluateRouting(false) },
		{ id: "catchAll", label: "Catch-all rule", ...diff.evaluateCatchAll(null, "tarle-mail") },
	];
	const plan = diff.buildRepairPlan(checks);
	assert.ok(plan.length >= 3);

	const allowed = new Set(["create-dns", "update-dns", "enable-routing", "bind-catch-all", "sending-subdomain", "provider-setup"]);
	const unrelatedIds = new Set(unrelated.map((record) => record.id));
	for (const { action } of plan) {
		assert.ok(allowed.has(action.kind), `unexpected action ${action.kind}`);
		assert.ok(!/delete|remove/i.test(action.kind));
		if (action.kind === "update-dns") assert.ok(!unrelatedIds.has(action.recordId), `rewrote unrelated record ${action.recordId}`);
		if (action.kind === "create-dns") assert.equal("id" in action.record, false);
	}
	// The SPF repair is the single rewrite, and it targets the SPF record only.
	assert.deepEqual(plan.filter(({ action }) => action.kind === "update-dns").map(({ action }) => action.recordId), ["spf1"]);
	// The foreign MX record is not replaced and the plan creates no MX beside it.
	assert.equal(plan.some(({ action }) => action.kind === "create-dns" && action.record.type === "MX"), false);
});

test("the plan lists each action once and gives every item a stable key and a description", () => {
	const create = { kind: "create-dns", record: { type: "TXT", name: "_dmarc.example.com", content: "v=DMARC1; p=none", ttl: 3600 } };
	const check = (id, actions) => ({ id, label: id, status: "missing", message: "", found: [], expected: [], actions });
	const plan = diff.buildRepairPlan([check("dmarc", [create]), check("spf", [create, { kind: "enable-routing" }]), check("routing", [{ kind: "enable-routing" }])]);
	assert.equal(plan.length, 2);
	assert.equal(new Set(plan.map(({ item }) => item.key)).size, 2);
	assert.ok(plan.every(({ item }) => item.summary.length > 0));
	assert.equal(diff.actionKey(create), diff.actionKey({ ...create, record: { ...create.record, ttl: 1 } }));
});
