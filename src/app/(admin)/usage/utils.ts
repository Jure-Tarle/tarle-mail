import { authFetch } from "@/lib/auth/client";
import { defaultTranslator, type Translator } from "@/lib/i18n/utils";
import { formatUserDate } from "@/lib/time/utils";
import { DAY_MS } from "@/lib/usage/forecast";
import type { FlowStatus, Meter, MeterGroup, MeterLevel, UsageResponse } from "./types";

export async function fetchUsage(): Promise<UsageResponse> {
	const response = await authFetch("/api/admin/usage", { cache: "no-store" });
	const data = (await response.json()) as UsageResponse & { error?: string };
	if (!response.ok) throw new Error(data.error ?? defaultTranslator("usage.loadFailed"));
	return data;
}

export async function saveBillingDay(billingDay: number): Promise<void> {
	const response = await authFetch("/api/admin/usage", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ billingDay }),
	});
	if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? defaultTranslator("usage.saveFailed"));
}

export const formatCount = (value: number) => new Intl.NumberFormat().format(value);

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const formatDecimal = (value: number) => decimal.format(value);

/** Counts below 10,000 in full, larger ones short (412M), so a meter row stays readable beside its allowance. */
export const formatMeterCount = (value: number) => (value >= 10_000 ? compact.format(value) : formatCount(Math.round(value)));

const usdPrecise = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 });
const usdCents = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Dollars to the cent, or to the tenth of a cent for per-unit prices such as $0.001. */
export const formatUsd = (value: number, precise = false) => (precise ? usdPrecise : usdCents).format(value);

/** Decimal units, the way Cloudflare bills storage (1 GB = 1,000,000,000 bytes). */
export function formatBytes(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1000;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit += 1;
	}
	return `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 2 : value < 100 ? 1 : 0 })} ${units[unit]}`;
}

export const formatMeterValue = (meter: Pick<Meter, "unit">, value: number) => (meter.unit === "bytes" ? formatBytes(value) : formatMeterCount(value));

export const formatFlowDate = (value: string) => formatUserDate(value, { dateStyle: "medium", timeStyle: "short" });

export function formatDayLabel(value: string) {
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

/** The calendar day (as `YYYY-MM-DD`) that is day `day` of the billing period starting at `start`. */
export const periodDayKey = (start: string, day: number) => new Date(Date.parse(start) + (day - 1) * DAY_MS).toISOString().slice(0, 10);

export const levelColor: Record<MeterLevel, string> = { ok: "var(--u-blue)", warn: "var(--u-amber)", over: "var(--u-red)" };

export const flowStatusClass: Record<FlowStatus, string> = {
	delivered: "bg-green-600/10 text-green-800",
	sent: "bg-green-600/10 text-green-800",
	queued: "bg-neutral-100 text-neutral-700",
	spam: "bg-amber-100 text-amber-800",
	failed: "bg-red-100 text-red-800",
	rejected: "bg-red-100 text-red-800",
	bounced: "bg-red-100 text-red-800",
};

const meterKeys = {
	d1Storage: "usage.meter.d1Storage",
	d1Read: "usage.meter.d1Read",
	d1Write: "usage.meter.d1Write",
	r2Storage: "usage.meter.r2Storage",
	r2ClassA: "usage.meter.r2ClassA",
	r2ClassB: "usage.meter.r2ClassB",
	emailSending: "usage.meter.emailSending",
	requests: "usage.meter.requests",
} as const;

export const groupKeys = {
	d1: "usage.group.d1",
	r2: "usage.group.r2",
	sending: "usage.group.sending",
	worker: "usage.group.worker",
} as const satisfies Record<MeterGroup, string>;

/** A meter's name: a provider's own, or the translated metric. */
export function meterLabel(t: Translator, meter: Pick<Meter, "id"> & { provider?: { label: string } }): string {
	return meter.provider?.label ?? t(meterKeys[meter.id as keyof typeof meterKeys]);
}
