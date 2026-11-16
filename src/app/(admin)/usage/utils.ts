import { authFetch } from "@/lib/auth/client";
import { defaultTranslator } from "@/lib/i18n/utils";
import { formatUserDate } from "@/lib/time/utils";
import { limitLevel, type LimitLevel } from "@/lib/usage/aggregate";
import type { FlowStatus, UsageResponse } from "./types";

export async function fetchUsage(): Promise<UsageResponse> {
	const response = await authFetch("/api/admin/usage");
	const data = (await response.json()) as UsageResponse;
	if (!response.ok) throw new Error(data.error ?? defaultTranslator("usage.loadFailed"));
	return data;
}

export const formatCount = (value: number) => new Intl.NumberFormat().format(value);

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

export const formatFlowDate = (value: string) => formatUserDate(value, { dateStyle: "medium", timeStyle: "short" });

export function formatDayLabel(value: string) {
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export const barClass: Record<LimitLevel, string> = { ok: "bg-blue-600", warn: "bg-amber-500", over: "bg-red-600" };

/** Width and colour of a usage bar against an allowance; null when there is no allowance to measure against. */
export function usageBar(used: number, limit: number | null) {
	const state = limitLevel(used, limit);
	return state ? { percent: Math.min(100, state.ratio * 100), className: barClass[state.level] } : null;
}

export const flowStatusClass: Record<FlowStatus, string> = {
	delivered: "bg-green-600/10 text-green-800",
	sent: "bg-green-600/10 text-green-800",
	queued: "bg-neutral-100 text-neutral-700",
	spam: "bg-amber-100 text-amber-800",
	failed: "bg-red-100 text-red-800",
	rejected: "bg-red-100 text-red-800",
	bounced: "bg-red-100 text-red-800",
};
