import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "tarle-mail-forecast-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `export * from "./src/lib/usage/forecast.ts"; export * from "./src/lib/usage/pricing.ts"; export { foldUserFlow } from "./src/lib/usage/aggregate.ts";`,
		resolveDir: root,
		sourcefile: "forecast-entry.ts",
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
const f = await import(pathToFileURL(join(directory, "entry.mjs")).href);

const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);
const close = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9 * Math.max(1, Math.abs(expected)), `${message} ${actual} !== ${expected}`);

test("a billing day outside 1-28 falls back to the 1st", () => {
	assert.equal(f.normalizeBillingDay(15), 15);
	assert.equal(f.normalizeBillingDay("7"), 7);
	for (const bad of [0, 29, 31, -1, 1.5, "", "x", null, undefined, Number.NaN]) assert.equal(f.normalizeBillingDay(bad), 1, String(bad));
});

test("the billing period starts on the renewal day, not the 1st", () => {
	const period = f.billingPeriod(new Date("2026-11-17T12:00:00Z"), 5);
	assert.equal(iso(period.start), "2026-11-05");
	assert.equal(iso(period.end), "2026-12-05");
	assert.equal(period.days, 30);
	close(period.elapsedDays, 12.5);
});

test("before the renewal day the period began last month and wraps over the year end", () => {
	const early = f.billingPeriod(new Date("2026-11-03T00:00:00Z"), 5);
	assert.equal(iso(early.start), "2026-10-05");
	assert.equal(iso(early.end), "2026-11-05");
	assert.equal(early.days, 31);
	const january = f.billingPeriod(new Date("2027-01-02T10:00:00Z"), 20);
	assert.equal(iso(january.start), "2026-12-20");
	assert.equal(iso(january.end), "2027-01-20");
	const december = f.billingPeriod(new Date("2026-12-25T00:00:00Z"), 20);
	assert.equal(iso(december.end), "2027-01-20");
});

test("on the renewal day itself a new period begins", () => {
	const period = f.billingPeriod(new Date("2026-11-05T00:00:00Z"), 5);
	assert.equal(iso(period.start), "2026-11-05");
	assert.equal(period.elapsedDays, 1);
});

test("a billing day beyond the month's length is clamped to its last day", () => {
	const february = f.billingPeriod(new Date("2027-03-10T00:00:00Z"), 31);
	assert.equal(iso(february.start), "2027-02-28");
	assert.equal(iso(february.end), "2027-03-31");
	assert.equal(february.days, 31);
	const leap = f.billingPeriod(new Date("2028-02-28T06:00:00Z"), 31);
	assert.equal(iso(leap.start), "2028-01-31");
	assert.equal(iso(leap.end), "2028-02-29");
	const leapDay = f.billingPeriod(new Date("2028-02-29T06:00:00Z"), 31);
	assert.equal(iso(leapDay.start), "2028-02-29");
	assert.equal(iso(leapDay.end), "2028-03-31");
	const april = f.billingPeriod(new Date("2026-05-10T00:00:00Z"), 31);
	assert.equal(iso(april.start), "2026-04-30");
	assert.equal(iso(april.end), "2026-05-31");
});

test("zero elapsed time never divides by zero or explodes the projection", () => {
	const period = f.billingPeriod(new Date("2026-11-05T00:00:00Z"), 5);
	assert.equal(f.projectFlow(120, period), 120 * 30);
	assert.equal(f.projectFlow(0, period), 0);
	assert.equal(f.projectFlow(10, { days: 30, elapsedDays: 0 }), 10);
	assert.equal(f.projectFlow(Number.NaN, period), 0);
	assert.equal(f.projectFlow(-5, period), 0);
});

test("counters project linearly to the end of the period", () => {
	const period = { days: 30, elapsedDays: 17 };
	close(f.projectFlow(412e6, period), (412e6 / 17) * 30);
	assert.equal(f.projectFlow(50, { days: 30, elapsedDays: 30 }), 50);
});

test("storage projects as today's size plus the average growth over the remaining days", () => {
	const period = { days: 30, elapsedDays: 17 };
	close(f.projectStorage(7.8, 0.12, period), 7.8 + 0.12 * 13);
	assert.equal(f.projectStorage(7.8, 0, period), 7.8);
	assert.equal(f.projectStorage(1, -1, period), 0, "shrinking storage stops at zero");
	assert.equal(f.projectStorage(5, Number.NaN, period), 5);
});

test("growth is the average change between the first and last sample", () => {
	const day = 86_400_000;
	assert.equal(f.dailyGrowth([]), 0);
	assert.equal(f.dailyGrowth([{ at: 0, value: 10 }]), 0);
	assert.equal(f.dailyGrowth([{ at: 0, value: 10 }, { at: day / 2, value: 20 }]), 0, "under a day apart says nothing");
	close(f.dailyGrowth([{ at: 10 * day, value: 14 }, { at: 0, value: 10 }, { at: 5 * day, value: 12 }]), 0.4);
	close(f.dailyGrowth([{ at: 0, value: 10 }, { at: 4 * day, value: 6 }]), -1);
});

test("overage is charged only beyond the included amount", () => {
	const allowance = { included: 100, perUnit: 0.5 };
	assert.equal(f.overageCost(80, allowance), 0);
	assert.equal(f.overageCost(100, allowance), 0);
	assert.equal(f.overageCost(110, allowance), 5);
	close(f.overageCost(60_000_000, f.PRICING.d1.rowsWritten), 10);
	close(f.overageCost(5_000, f.PRICING.emailSending), 0.7);
});

test("meter colour turns amber at 80% and red at 100% of the projection", () => {
	assert.equal(f.meterLevel(79, 100), "ok");
	assert.equal(f.meterLevel(80, 100), "warn");
	assert.equal(f.meterLevel(99.9, 100), "warn");
	assert.equal(f.meterLevel(100, 100), "over");
	assert.equal(f.meterLevel(250, 100), "over");
	assert.equal(f.meterLevel(5, null), null);
	assert.equal(f.meterLevel(5, 0), null);
});

const period = { start: utc("2026-11-01"), end: utc("2026-12-01"), days: 30, elapsedDays: 17 };
const flow = (used, allowance) => ({ kind: "flow", used, growthPerDay: 0, allowance });
const storage = (used, growthPerDay, allowance) => ({ kind: "storage", used, growthPerDay, allowance });

test("flow cost accrues only once the allowance is used up", () => {
	assert.equal(f.projectedCost(flow(2140, f.PRICING.emailSending), period), ((2140 / 17) * 30 - 3000) * 0.00035);
	const heavy = flow(6000, f.PRICING.emailSending);
	close(f.projectedCost(heavy, period), ((6000 / 17) * 30 - 3000) * 0.00035);
	assert.equal(f.costAtDay(heavy, 0, period), 0);
	assert.equal(f.costAtDay(heavy, 8, period), 0);
	assert.ok(f.costAtDay(heavy, 10, period) > 0);
	assert.equal(f.projectedCost(flow(100, f.PRICING.emailSending), period), 0);
});

test("storage cost accrues in proportion to the days elapsed", () => {
	const r2 = storage(12, 0.5, f.PRICING.r2.storageGb);
	close(f.projectedCost(r2, period), (12 + 0.5 * 13 - 10) * 0.015);
	close(f.costAtDay(r2, 17, period), (12 - 10) * 0.015 * (17 / 30));
});

test("the cost curve is non-decreasing, starts at zero and has a point at today", () => {
	const curve = f.costCurve([flow(6000, f.PRICING.emailSending), storage(12, 0.5, f.PRICING.r2.storageGb)], period);
	assert.equal(curve[0].day, 0);
	assert.equal(curve[0].cost, 0);
	assert.equal(curve[curve.length - 1].day, 30);
	assert.ok(curve.some((point) => point.day === 17));
	for (let index = 1; index < curve.length; index += 1) assert.ok(curve[index].cost >= curve[index - 1].cost - 1e-12);
	const fractional = f.costCurve([], { ...period, elapsedDays: 17.5 });
	assert.ok(fractional.some((point) => point.day === 17.5));
});

test("the day an allowance runs out is found for counters and for storage", () => {
	assert.deepEqual(f.exceedDay(flow(2140, f.PRICING.emailSending), period), { day: 24, past: false });
	assert.deepEqual(f.exceedDay(flow(6000, f.PRICING.emailSending), period), { day: 9, past: true });
	assert.equal(f.exceedDay(flow(100, f.PRICING.emailSending), period), null);
	assert.equal(f.exceedDay(flow(0, f.PRICING.emailSending), period), null);
	assert.equal(f.exceedDay(storage(7.8, 0.12, f.PRICING.r2.storageGb), period), null, "7.8 GB growing 0.12 GB a day ends the period at 9.4 GB");
	assert.deepEqual(f.exceedDay(storage(7.8, 0.3, f.PRICING.r2.storageGb), period), { day: 25, past: false });
	assert.equal(f.exceedDay(storage(7.8, 0, f.PRICING.r2.storageGb), period), null);
	assert.deepEqual(f.exceedDay(storage(11, 0, f.PRICING.r2.storageGb), period), { day: 1, past: true });
});

test("a service within its allowances costs nothing and says so", () => {
	const forecast = f.serviceForecast([{ key: "mail", metric: flow(100, f.PRICING.emailSending) }], period);
	assert.equal(forecast.cost, 0);
	assert.equal(forecast.soFar, 0);
	assert.deepEqual(forecast.status, { kind: "within" });
	assert.equal(forecast.items[0].key, "mail");
	close(forecast.items[0].ratio, ((100 / 17) * 30) / 3000);
});

test("a service tells whether it exceeded its allowance or is expected to", () => {
	const past = f.serviceForecast([{ key: "mail", metric: flow(6000, f.PRICING.emailSending) }], period);
	assert.equal(past.status.kind, "exceeded");
	assert.equal(past.status.day, 9);
	assert.ok(past.cost > 0 && past.soFar > 0 && past.soFar < past.cost);
	const ahead = f.serviceForecast([{ key: "mail", metric: flow(2140, f.PRICING.emailSending) }], period);
	assert.deepEqual(ahead.status, { kind: "expected", day: 24 });
	assert.equal(ahead.soFar, 0);
});

test("the earliest exhausted metric names the service's status day", () => {
	const forecast = f.serviceForecast([
		{ key: "a", metric: flow(2140, f.PRICING.emailSending) },
		{ key: "b", metric: flow(6000, f.PRICING.emailSending) },
	], period);
	assert.deepEqual(forecast.status, { kind: "exceeded", day: 9 });
});

test("costs are split by sent and stored shares and leave the base fee out", () => {
	const shares = f.splitCosts([
		{ id: "a", sent: 60, storageBytes: 300 },
		{ id: "b", sent: 40, storageBytes: 100 },
	], 10, 4);
	close(shares.get("a").sendShare, 0.6);
	close(shares.get("a").cost, 6 + 3);
	close(shares.get("b").cost, 4 + 1);
	close([...shares.values()].reduce((sum, share) => sum + share.cost, 0), 14);
});

test("nothing sent or stored leaves that part of the cost unassigned instead of dividing by zero", () => {
	const shares = f.splitCosts([{ id: "a", sent: 0, storageBytes: 0 }, { id: "b", sent: 0, storageBytes: 50 }], 10, 4);
	assert.equal(shares.get("a").cost, 0);
	assert.equal(shares.get("b").cost, 4);
	assert.equal(f.splitCosts([], 5, 5).size, 0);
});

test("R2 operations are sorted into price classes", () => {
	assert.equal(f.r2OperationClass("PutObject"), "A");
	assert.equal(f.r2OperationClass("ListObjectsV2"), "A");
	assert.equal(f.r2OperationClass("CompleteMultipartUpload"), "A");
	assert.equal(f.r2OperationClass("GetObject"), "B");
	assert.equal(f.r2OperationClass("HeadObject"), "B");
	assert.equal(f.r2OperationClass("DeleteObject"), null);
	assert.equal(f.r2OperationClass("AbortMultipartUpload"), null);
	assert.equal(f.r2OperationClass("SomethingNew"), null);
});

test("per-user flow counts follow the same rules as the daily series", () => {
	const users = f.foldUserFlow([
		{ userId: "a", direction: "inbound", status: "received", count: 4 },
		{ userId: "a", direction: "inbound", status: "spam", count: 2 },
		{ userId: "a", direction: "outbound", status: "sent", count: "3" },
		{ userId: "a", direction: "outbound", status: "queued", count: 9 },
		{ userId: "b", direction: "outbound", status: "failed", count: 1 },
		{ userId: "b", direction: "inbound", status: "archived", count: 5 },
	]);
	assert.deepEqual(users.get("a"), { received: 4, spam: 2, sent: 3, failed: 0 });
	assert.deepEqual(users.get("b"), { received: 5, spam: 0, sent: 0, failed: 1 });
	assert.equal(users.get("c"), undefined);
});
