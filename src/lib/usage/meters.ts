/**
 * Turns the raw readings (database size, Cloudflare analytics, send counts) into the meters, the bill
 * forecast and the per-service forecasts the usage page shows. Pure: `service.ts` gathers the readings.
 */
import type { CloudflareMetrics } from "@/lib/usage/cloudflare-metrics";
import {
	costCurve,
	meterLevel,
	projectMetric,
	projectedCost,
	projectFlow,
	serviceForecast,
	type BillingPeriod,
	type CostMetric,
} from "@/lib/usage/forecast";
import { GB, PRICING, WORKERS_PAID_BASE_USD, type Allowance } from "@/lib/usage/pricing";
import type { Meter, MeterGroup, Optional, ServiceForecastView, UsageOverview } from "@/lib/usage/types";

export type ProviderReading = { provider: string; label: string; today: number; month: number; perDay: number | null; perMonth: number | null };

export type MeterReadings = {
	/** Size of the D1 database now. */
	database: Optional<{ bytes: number }>;
	cloudflare: CloudflareMetrics;
	/** Messages sent through Cloudflare Email Sending in the billing period. */
	emailSent: number;
	/** Third-party providers with their sends this calendar month. */
	providers: ProviderReading[];
};

type Spec = { id: string; group: MeterGroup; kind: "storage" | "flow"; allowance: Allowance };

const SPECS = {
	d1Storage: { id: "d1Storage", group: "d1", kind: "storage", allowance: PRICING.d1.storageGb },
	d1Read: { id: "d1Read", group: "d1", kind: "flow", allowance: PRICING.d1.rowsRead },
	d1Write: { id: "d1Write", group: "d1", kind: "flow", allowance: PRICING.d1.rowsWritten },
	r2Storage: { id: "r2Storage", group: "r2", kind: "storage", allowance: PRICING.r2.storageGb },
	r2ClassA: { id: "r2ClassA", group: "r2", kind: "flow", allowance: PRICING.r2.classA },
	r2ClassB: { id: "r2ClassB", group: "r2", kind: "flow", allowance: PRICING.r2.classB },
	emailSending: { id: "emailSending", group: "sending", kind: "flow", allowance: PRICING.emailSending },
	requests: { id: "requests", group: "worker", kind: "flow", allowance: PRICING.workerRequests },
} satisfies Record<string, Spec>;

type Reading = { used: number; growthPerDay: number };

/** A billed meter and the cost model behind it; `metric` is in the allowance's unit (GB for storage), the meter in bytes. */
function billedMeter(spec: Spec, reading: Optional<Reading>, period: BillingPeriod): { meter: Meter; metric?: CostMetric } {
	const base = { id: spec.id, group: spec.group, kind: spec.kind, unit: spec.kind === "storage" ? "bytes" : "count" } as const;
	if (!reading.available) return { meter: { ...base, available: false, reason: reading.reason } };
	const scale = spec.kind === "storage" ? GB : 1;
	const metric: CostMetric = { kind: spec.kind, used: reading.value.used / scale, growthPerDay: reading.value.growthPerDay / scale, allowance: spec.allowance };
	const projected = projectMetric(metric, period) * scale;
	const included = spec.allowance.included * scale;
	return {
		meter: { ...base, available: true, used: reading.value.used, projected, included, level: meterLevel(projected, included), cost: projectedCost(metric, period) },
		metric,
	};
}

const reading = <T>(source: Optional<T>, pick: (value: T) => Reading): Optional<Reading> => (source.available ? { available: true, value: pick(source.value) } : source);

/** Sending providers with a limit of their own: nothing is billed, but sending stops at the limit. Measured by the calendar month, like the limits themselves. */
function providerMeter(item: ProviderReading, monthPeriod: BillingPeriod): Meter {
	const included = item.perMonth ?? item.perDay;
	const used = item.perMonth ? item.month : item.perDay ? item.today : item.month;
	// A daily cap has no month-end projection: it resets every day.
	const projected = item.perMonth ? projectFlow(item.month, monthPeriod) : used;
	return {
		id: `provider:${item.provider}`,
		group: "sending",
		kind: "flow",
		unit: "count",
		available: true,
		used,
		projected,
		included,
		level: meterLevel(projected, included),
		cost: 0,
		provider: { label: item.label, today: item.today, perDay: item.perDay },
	};
}

const SERVICE_ORDER: MeterGroup[] = ["d1", "r2", "sending", "worker"];

export function buildMeters(readings: MeterReadings, period: BillingPeriod, monthPeriod: BillingPeriod): Pick<UsageOverview, "meters" | "forecast" | "services"> {
	const { cloudflare } = readings;
	const rows: { meter: Meter; metric?: CostMetric }[] = [
		billedMeter(SPECS.d1Storage, reading(readings.database, (value) => ({ used: value.bytes, growthPerDay: 0 })), period),
		billedMeter(SPECS.d1Read, reading(cloudflare.d1Rows, (value) => ({ used: value.rowsRead, growthPerDay: 0 })), period),
		billedMeter(SPECS.d1Write, reading(cloudflare.d1Rows, (value) => ({ used: value.rowsWritten, growthPerDay: 0 })), period),
		billedMeter(SPECS.r2Storage, reading(cloudflare.r2Storage, (value) => ({ used: value.bytes, growthPerDay: value.growthPerDay })), period),
		billedMeter(SPECS.r2ClassA, reading(cloudflare.r2Operations, (value) => ({ used: value.classA, growthPerDay: 0 })), period),
		billedMeter(SPECS.r2ClassB, reading(cloudflare.r2Operations, (value) => ({ used: value.classB, growthPerDay: 0 })), period),
		billedMeter(SPECS.emailSending, { available: true, value: { used: readings.emailSent, growthPerDay: 0 } }, period),
		...readings.providers.map((item) => ({ meter: providerMeter(item, monthPeriod) })),
		billedMeter(SPECS.requests, reading(cloudflare.workerRequests, (value) => ({ used: value.requests, growthPerDay: 0 })), period),
	];

	const billed = rows.filter((row): row is { meter: Meter; metric: CostMetric } => row.metric !== undefined);
	const overage = billed.reduce((sum, row) => sum + (row.meter.available ? row.meter.cost : 0), 0);
	const services: ServiceForecastView[] = SERVICE_ORDER.map((id) => {
		const inService = billed.filter((row) => row.meter.group === id);
		if (inService.length === 0) return { id, available: false, cost: 0, soFar: 0, curve: [], status: { kind: "within" }, items: [] };
		const forecast = serviceForecast(inService.map((row) => ({ key: row.meter.id, metric: row.metric })), period);
		return { id, available: true, cost: forecast.cost, soFar: forecast.soFar, curve: forecast.curve, status: forecast.status, items: forecast.items.map(({ key, ratio, cost }) => ({ id: key, ratio, cost })) };
	});

	return {
		meters: rows.map((row) => row.meter),
		forecast: {
			base: WORKERS_PAID_BASE_USD,
			overage,
			total: WORKERS_PAID_BASE_USD + overage,
			lines: billed.flatMap((row) => (row.meter.available && row.meter.cost > 0 ? [{ id: row.meter.id, cost: row.meter.cost }] : [])),
			curve: costCurve(billed.map((row) => row.metric), period),
		},
		services,
	};
}
