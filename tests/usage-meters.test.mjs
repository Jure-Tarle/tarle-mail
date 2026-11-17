import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "tarle-mail-meters-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `export * from "./src/lib/usage/meters.ts"; export { billingPeriod } from "./src/lib/usage/forecast.ts"; export { GB } from "./src/lib/usage/pricing.ts";`,
		resolveDir: root,
		sourcefile: "meters-entry.ts",
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
const m = await import(pathToFileURL(join(directory, "entry.mjs")).href);

// Day 17 of a 30-day period, the example used in the design prototype.
const now = new Date("2026-11-17T12:00:00Z");
const period = { ...m.billingPeriod(now, 1), elapsedDays: 17 };
const monthPeriod = period;
const ok = (value) => ({ available: true, value });
const denied = { available: false, reason: "not authorized" };

const readings = {
	database: ok({ bytes: 1.42 * m.GB }),
	cloudflare: {
		d1Rows: ok({ rowsRead: 412e6, rowsWritten: 3.1e6 }),
		r2Operations: ok({ classA: 210e3, classB: 1.9e6 }),
		r2Storage: ok({ bytes: 7.8 * m.GB, growthPerDay: 0.12 * m.GB }),
		workerRequests: ok({ requests: 3.2e6 }),
	},
	emailSent: 6000,
	providers: [{ provider: "resend", label: "Resend", today: 34, month: 812, perDay: 100, perMonth: 3000 }],
};
const byId = (result, id) => result.meters.find((meter) => meter.id === id);

test("available readings become meters with used, projected, allowance and cost", () => {
	const result = m.buildMeters(readings, period, monthPeriod);
	const mail = byId(result, "emailSending");
	assert.equal(mail.available, true);
	assert.equal(mail.used, 6000);
	assert.ok(Math.abs(mail.projected - (6000 / 17) * 30) < 1e-6);
	assert.equal(mail.included, 3000);
	assert.equal(mail.level, "over");
	assert.ok(Math.abs(mail.cost - ((6000 / 17) * 30 - 3000) * 0.00035) < 1e-9);

	const read = byId(result, "d1Read");
	assert.equal(read.used, 412e6);
	assert.equal(read.level, "ok");
	assert.equal(read.cost, 0);

	const storage = byId(result, "r2Storage");
	assert.equal(storage.unit, "bytes");
	assert.equal(storage.included, 10 * m.GB);
	assert.ok(Math.abs(storage.projected - (7.8 + 0.12 * 13) * m.GB) < 1);
	assert.equal(storage.level, "warn", "9.4 of 10 GB is over 80%");
});

test("the bill is the base fee plus the overage of every metered cost", () => {
	const { forecast } = m.buildMeters(readings, period, monthPeriod);
	assert.equal(forecast.base, 5);
	assert.deepEqual(forecast.lines.map((line) => line.id), ["emailSending"]);
	assert.ok(Math.abs(forecast.total - (5 + forecast.lines[0].cost)) < 1e-12);
	assert.equal(forecast.curve[0].cost, 0);
	assert.ok(Math.abs(forecast.curve.at(-1).cost - forecast.overage) < 1e-9);
});

test("each service forecasts its own overage and says when its allowance ran out", () => {
	const { services } = m.buildMeters(readings, period, monthPeriod);
	assert.deepEqual(services.map((service) => service.id), ["d1", "r2", "sending", "worker"]);
	const sending = services.find((service) => service.id === "sending");
	assert.equal(sending.status.kind, "exceeded");
	assert.ok(sending.cost > 0 && sending.soFar > 0);
	assert.deepEqual(sending.items.map((item) => item.id), ["emailSending"], "provider limits are not billed and stay out");
	const d1 = services.find((service) => service.id === "d1");
	assert.equal(d1.cost, 0);
	assert.deepEqual(d1.status, { kind: "within" });
	assert.deepEqual(d1.items.map((item) => item.id), ["d1Storage", "d1Read", "d1Write"]);
});

test("a provider with a monthly limit is measured against it and costs nothing", () => {
	const resend = byId(m.buildMeters(readings, period, monthPeriod), "provider:resend");
	assert.equal(resend.used, 812);
	assert.equal(resend.included, 3000);
	assert.equal(resend.cost, 0);
	assert.deepEqual(resend.provider, { label: "Resend", today: 34, perDay: 100 });
	const capped = byId(m.buildMeters({ ...readings, providers: [{ provider: "brevo", label: "Brevo", today: 290, month: 4000, perDay: 300, perMonth: null }] }, period, monthPeriod), "provider:brevo");
	assert.equal(capped.used, 290, "a daily cap is measured by today's sends");
	assert.equal(capped.level, "warn");
	const open = byId(m.buildMeters({ ...readings, providers: [{ provider: "smtp", label: "SMTP", today: 1, month: 9, perDay: null, perMonth: null }] }, period, monthPeriod), "provider:smtp");
	assert.equal(open.included, null);
	assert.equal(open.level, null);
});

test("analytics the token cannot read degrade those meters while the rest still computes", () => {
	const result = m.buildMeters({ ...readings, cloudflare: { d1Rows: denied, r2Operations: denied, r2Storage: denied, workerRequests: denied } }, period, monthPeriod);
	for (const id of ["d1Read", "d1Write", "r2Storage", "r2ClassA", "r2ClassB", "requests"]) {
		const meter = byId(result, id);
		assert.equal(meter.available, false, id);
		assert.equal(meter.reason, "not authorized");
	}
	assert.equal(byId(result, "d1Storage").available, true, "the database size comes from D1 itself");
	assert.equal(byId(result, "emailSending").available, true);
	const r2 = result.services.find((service) => service.id === "r2");
	assert.equal(r2.available, false);
	assert.equal(result.services.find((service) => service.id === "d1").available, true);
	assert.deepEqual(result.forecast.lines.map((line) => line.id), ["emailSending"]);
});

test("a database that does not report its size leaves only that meter unavailable", () => {
	const result = m.buildMeters({ ...readings, database: { available: false, reason: "no size" } }, period, monthPeriod);
	assert.equal(byId(result, "d1Storage").available, false);
	assert.equal(byId(result, "d1Read").available, true);
});
