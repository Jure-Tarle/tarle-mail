import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "mailflare-usage-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `export * from "./src/lib/usage/aggregate.ts";`,
		resolveDir: root,
		sourcefile: "usage-entry.ts",
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
const usage = await import(pathToFileURL(join(directory, "entry.mjs")).href);

test("the daily series covers every day and splits inbound spam from received mail", () => {
	const dates = ["2026-11-14", "2026-11-15", "2026-11-16"];
	const daily = usage.fillDailyFlow(dates, [
		{ date: "2026-11-14", direction: "inbound", status: "received", count: 4 },
		{ date: "2026-11-14", direction: "inbound", status: "archived", count: 1 },
		{ date: "2026-11-14", direction: "inbound", status: "spam", count: 2 },
		{ date: "2026-11-16", direction: "outbound", status: "sent", count: "3" },
		{ date: "2026-11-16", direction: "outbound", status: "failed", count: 1 },
		{ date: "2026-11-16", direction: "outbound", status: "queued", count: 9 },
		{ date: "2026-10-01", direction: "inbound", status: "received", count: 50 },
	]);
	assert.deepEqual(daily, [
		{ date: "2026-11-14", received: 5, spam: 2, sent: 0, failed: 0 },
		{ date: "2026-11-15", received: 0, spam: 0, sent: 0, failed: 0 },
		{ date: "2026-11-16", received: 0, spam: 0, sent: 3, failed: 1 },
	]);
});

test("sender hosts are read from bare and display-name addresses", () => {
	assert.equal(usage.senderHost("Ana <Ana@Mail.Example.com>"), "mail.example.com");
	assert.equal(usage.senderHost("ana@example.com"), "example.com");
});

test("sends are attributed to the provider of the From domain, falling back to its parent domain", () => {
	const providers = new Map([["example.com", "resend"], ["other.org", "cloudflare"], ["idle.net", "ses"], ["off.io", "none"]]);
	const result = usage.tallyProviders([
		{ fromAddr: "a@example.com", today: 10, month: 40 },
		{ fromAddr: "Bob <b@news.example.com>", today: 5, month: 20 },
		{ fromAddr: "c@other.org", today: 1, month: 7 },
		{ fromAddr: "d@stranger.dev", today: 2, month: 3 },
		{ fromAddr: "e@off.io", today: 1, month: 1 },
	], providers);
	const byProvider = Object.fromEntries(result.map((entry) => [entry.provider, entry]));
	assert.deepEqual([byProvider.resend.today, byProvider.resend.month], [15, 60]);
	assert.deepEqual(byProvider.resend.limits, { perDay: 100, perMonth: 3000 });
	assert.deepEqual([byProvider.cloudflare.today, byProvider.cloudflare.month], [1, 7]);
	assert.deepEqual([byProvider.unmapped.today, byProvider.unmapped.month], [3, 4]);
	assert.equal(byProvider.unmapped.limits.perDay, null);
	// A configured provider with no sends yet is still listed, so its allowance is visible.
	assert.deepEqual([byProvider.ses.today, byProvider.ses.month, byProvider.ses.hosts], [0, 0, ["idle.net"]]);
	assert.equal(result[0].provider, "resend");
	assert.equal("none" in byProvider, false);
});

test("allowance levels warn from 80% and flag overage", () => {
	assert.equal(usage.limitLevel(5, null), null);
	assert.equal(usage.limitLevel(5, 0), null);
	assert.equal(usage.limitLevel(79, 100).level, "ok");
	assert.equal(usage.limitLevel(80, 100).level, "warn");
	assert.equal(usage.limitLevel(100, 100).level, "warn");
	assert.equal(usage.limitLevel(101, 100).level, "over");
});

test("mail-flow statuses: inbound is delivered or spam, a failed send is told apart by the provider's error", () => {
	assert.equal(usage.classifyFlow("inbound", "received"), "delivered");
	assert.equal(usage.classifyFlow("inbound", "trash"), "delivered");
	assert.equal(usage.classifyFlow("inbound", "spam"), "spam");
	assert.equal(usage.classifyFlow("outbound", "queued"), "queued");
	assert.equal(usage.classifyFlow("outbound", "sent"), "sent");
	assert.equal(usage.classifyFlow("outbound", "failed", "550 5.1.1 Recipient rejected"), "rejected");
	assert.equal(usage.classifyFlow("outbound", "failed", "Message bounced by the recipient server"), "bounced");
	assert.equal(usage.classifyFlow("outbound", "failed", "fetch failed"), "failed");
	assert.equal(usage.classifyFlow("outbound", "failed", null), "failed");
});

test("limit windows start at the UTC day and month", () => {
	const { dayStart, monthStart } = usage.utcWindows(new Date("2026-11-16T23:59:59Z"));
	assert.equal(dayStart.toISOString(), "2026-11-16T00:00:00.000Z");
	assert.equal(monthStart.toISOString(), "2026-11-01T00:00:00.000Z");
});

test("hourly Worker analytics fold into sorted days", () => {
	const days = usage.foldWorkerHours([
		{ hour: "2026-11-16T09:00:00Z", requests: 5, errors: 1 },
		{ hour: "2026-11-15T23:00:00Z", requests: 7, errors: 0 },
		{ hour: "2026-11-16T10:00:00Z", requests: 3, errors: 2 },
	]);
	assert.deepEqual(days, [
		{ date: "2026-11-15", requests: 7, errors: 0 },
		{ date: "2026-11-16", requests: 8, errors: 3 },
	]);
});
