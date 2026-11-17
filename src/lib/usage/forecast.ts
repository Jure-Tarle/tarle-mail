/**
 * Pure math behind the usage forecast: billing periods, month-end projections, overage cost,
 * the day an allowance runs out and the split of cost between users. No I/O, no clock reads.
 */
import type { Allowance } from "@/lib/usage/pricing";

export const DAY_MS = 86_400_000;

export type BillingPeriod = {
	/** First instant of the period (00:00 UTC on the billing day). */
	start: Date;
	/** First instant of the next period. */
	end: Date;
	/** Length of the period in days. */
	days: number;
	/** Days since `start`, kept between 1 and `days` so a period that has just begun does not extrapolate from minutes of data. */
	elapsedDays: number;
};

/** A billing day an admin may pick: a whole number from 1 to 28, which every month has. Anything else falls back to the 1st. */
export function normalizeBillingDay(value: unknown): number {
	const day = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	return typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1;
}

/** 00:00 UTC on `day` of the month, clamped to the month's last day (billing day 31 in February is the 28th). `month` may run past 11 or below 0. */
function monthDay(year: number, month: number, day: number): Date {
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

/** The billing period containing `now`: allowances reset on the renewal day, not on the 1st. */
export function billingPeriod(now: Date, billingDay: number): BillingPeriod {
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth();
	const thisMonth = monthDay(year, month, billingDay);
	const start = thisMonth.getTime() <= now.getTime() ? thisMonth : monthDay(year, month - 1, billingDay);
	const end = start.getTime() === thisMonth.getTime() ? monthDay(year, month + 1, billingDay) : thisMonth;
	const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
	const elapsedDays = Math.min(days, Math.max(1, (now.getTime() - start.getTime()) / DAY_MS));
	return { start, end, days, elapsedDays };
}

/** `YYYY-MM-DD` of an instant in UTC, the key `provider_usage` rows use. */
export const utcDayKey = (date: Date) => date.toISOString().slice(0, 10);

const nonNegative = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

/** Month-end value of a counter that grows at the rate seen so far. */
export function projectFlow(used: number, period: Pick<BillingPeriod, "days" | "elapsedDays">): number {
	const usedSoFar = nonNegative(used);
	return period.elapsedDays > 0 ? (usedSoFar / period.elapsedDays) * period.days : usedSoFar;
}

/** Month-end size of something stored: its size now plus the average daily growth over the remaining days. It never drops below zero. */
export function projectStorage(current: number, growthPerDay: number, period: Pick<BillingPeriod, "days" | "elapsedDays">): number {
	const remaining = Math.max(0, period.days - period.elapsedDays);
	return nonNegative(current + (Number.isFinite(growthPerDay) ? growthPerDay : 0) * remaining);
}

export type Sample = { at: number; value: number };

/** Average daily change between the first and last sample; 0 when there are fewer than two or they are under a day apart. */
export function dailyGrowth(samples: Sample[]): number {
	if (samples.length < 2) return 0;
	const sorted = [...samples].sort((a, b) => a.at - b.at);
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	const spanDays = (last.at - first.at) / DAY_MS;
	return spanDays >= 1 ? (last.value - first.value) / spanDays : 0;
}

/** What `used` costs beyond the included amount. */
export function overageCost(used: number, allowance: Allowance): number {
	return Math.max(0, used - allowance.included) * allowance.perUnit;
}

export type MeterLevel = "ok" | "warn" | "over";

/** Blue below 80% of the allowance, amber from 80%, red from 100%; null when there is no allowance to measure against. */
export function meterLevel(value: number, limit: number | null): MeterLevel | null {
	if (!limit || limit <= 0) return null;
	const ratio = value / limit;
	return ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok";
}

/** A billed quantity: counters (`flow`) grow with time, stored data (`storage`) is billed by the GB-month. `used` and the allowance share a unit. */
export type CostMetric = { kind: "flow" | "storage"; used: number; growthPerDay: number; allowance: Allowance };

/** The value of a metric on day `day` of the period, measured from the start (flow) or extended from today's size (storage). */
export function valueAtDay(metric: CostMetric, day: number, period: BillingPeriod): number {
	if (metric.kind === "flow") return (nonNegative(metric.used) / period.elapsedDays) * day;
	return nonNegative(metric.used + metric.growthPerDay * (day - period.elapsedDays));
}

export function projectMetric(metric: CostMetric, period: BillingPeriod): number {
	return metric.kind === "flow" ? projectFlow(metric.used, period) : projectStorage(metric.used, metric.growthPerDay, period);
}

/** Overage cost accrued by day `day`. Storage is billed per GB-month, so its overage accrues in proportion to the days elapsed. */
export function costAtDay(metric: CostMetric, day: number, period: BillingPeriod): number {
	const cost = overageCost(valueAtDay(metric, day, period), metric.allowance);
	return metric.kind === "storage" ? cost * (day / period.days) : cost;
}

/** Overage cost for the whole period at the projected usage. */
export function projectedCost(metric: CostMetric, period: BillingPeriod): number {
	return costAtDay(metric, period.days, period);
}

export type CostPoint = { day: number; cost: number };

/** Accrued overage by day for the whole period, with a point at today so a chart can switch from solid to dashed exactly there. */
export function costCurve(metrics: CostMetric[], period: BillingPeriod): CostPoint[] {
	const days = new Set<number>([period.elapsedDays]);
	for (let day = 0; day <= period.days; day += 1) days.add(day);
	return [...days].sort((a, b) => a - b).map((day) => ({ day, cost: metrics.reduce((sum, metric) => sum + costAtDay(metric, day, period), 0) }));
}

/** The first whole day on which the metric is over its allowance, and whether that day has already passed; null if it stays within it. */
export function exceedDay(metric: CostMetric, period: BillingPeriod): { day: number; past: boolean } | null {
	for (let day = 1; day <= period.days; day += 1) {
		if (valueAtDay(metric, day, period) > metric.allowance.included) return { day, past: day <= period.elapsedDays };
	}
	return null;
}

export type ServiceStatus = { kind: "within" } | { kind: "exceeded" | "expected"; day: number };

export type ServiceForecast = {
	/** Overage expected by the end of the period. */
	cost: number;
	/** Overage accrued up to today. */
	soFar: number;
	curve: CostPoint[];
	status: ServiceStatus;
	items: { key: string; ratio: number; cost: number }[];
};

/** One service (D1, R2, sending, Worker) as the sum of the metrics it bills. */
export function serviceForecast(metrics: { key: string; metric: CostMetric }[], period: BillingPeriod): ServiceForecast {
	const all = metrics.map((item) => item.metric);
	const items = metrics.map(({ key, metric }) => ({ key, ratio: projectMetric(metric, period) / metric.allowance.included, cost: projectedCost(metric, period) }));
	const cost = items.reduce((sum, item) => sum + item.cost, 0);
	const first = metrics
		.map(({ metric }) => (projectedCost(metric, period) > 0 ? exceedDay(metric, period) : null))
		.filter((hit): hit is { day: number; past: boolean } => hit !== null)
		.sort((a, b) => a.day - b.day)[0];
	return {
		cost,
		soFar: all.reduce((sum, metric) => sum + costAtDay(metric, period.elapsedDays, period), 0),
		curve: costCurve(all, period),
		status: cost > 0 && first ? { kind: first.past ? "exceeded" : "expected", day: first.day } : { kind: "within" },
		items,
	};
}

export type CostShareInput = { id: string; sent: number; storageBytes: number };
export type CostShare = { sendShare: number; storageShare: number; cost: number };

/**
 * Splits the sending overage by each user's share of sent mail and the storage overage by their share of
 * stored bytes. The base fee is not split. Without any sends (or stored bytes) that part is left unassigned.
 */
export function splitCosts(users: CostShareInput[], sendingCost: number, storageCost: number): Map<string, CostShare> {
	const totalSent = users.reduce((sum, user) => sum + user.sent, 0);
	const totalBytes = users.reduce((sum, user) => sum + user.storageBytes, 0);
	return new Map(users.map((user) => {
		const sendShare = totalSent > 0 ? user.sent / totalSent : 0;
		const storageShare = totalBytes > 0 ? user.storageBytes / totalBytes : 0;
		return [user.id, { sendShare, storageShare, cost: sendShare * sendingCost + storageShare * storageCost }];
	}));
}
