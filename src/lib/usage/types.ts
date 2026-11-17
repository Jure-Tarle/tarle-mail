/** What `/api/admin/usage` returns; the usage page and the service share these shapes. */
import type { DailyFlow, FlowStatus } from "@/lib/usage/aggregate";
import type { MeterLevel, CostPoint, ServiceStatus } from "@/lib/usage/forecast";

export type { FlowStatus, DailyFlow } from "@/lib/usage/aggregate";
export type { MeterLevel, CostPoint, ServiceStatus } from "@/lib/usage/forecast";

/** A figure that may be unavailable: why, rather than a silent gap, when it is. */
export type Optional<T> = { available: true; value: T } | { available: false; reason: string };

export type FlowEvent = { id: string; createdAt: string; direction: "inbound" | "outbound"; status: FlowStatus; from: string; to: string; detail: string | null };

export type MeterGroup = "d1" | "r2" | "sending" | "worker";

export type MeterFigures = {
	/** So far this period (storage: its size now). Bytes for storage, a count otherwise. */
	used: number;
	/** Expected at the end of the period. */
	projected: number;
	/** The allowance (or provider limit) the figures are measured against; null when none is known. */
	included: number | null;
	level: MeterLevel | null;
	/** Overage cost expected for the period, in dollars. */
	cost: number;
};

/** One bar on the usage page. `id` is a metric (`d1Read`, `r2Storage`...) or `provider:<name>` for a sending provider. */
export type Meter = {
	id: string;
	group: MeterGroup;
	kind: "storage" | "flow";
	unit: "bytes" | "count";
} & (
	| ({ available: true } & MeterFigures & { provider?: { label: string; today: number; perDay: number | null } })
	| { available: false; reason: string }
);

export type ServiceForecastView = {
	id: MeterGroup;
	available: boolean;
	cost: number;
	soFar: number;
	curve: CostPoint[];
	status: ServiceStatus;
	items: { id: string; ratio: number; cost: number }[];
};

export type UserUsage = {
	id: string;
	name: string;
	email: string;
	role: "admin" | "user";
	mailboxes: number;
	sharedMailboxes: number;
	received: number;
	sent: number;
	spam: number;
	failed: number;
	storageBytes: number;
	/** Fraction of all sent mail, 0 to 1. */
	sendShare: number;
	/** Dollars of sending and storage overage attributed to the user. */
	cost: number;
};

export type UsageOverview = {
	timeZone: string;
	billing: { day: number; start: string; end: string; days: number; elapsedDays: number };
	daily: DailyFlow[];
	totals: { received: number; spam: number; sent: number; failed: number };
	meters: Meter[];
	forecast: { base: number; overage: number; total: number; lines: { id: string; cost: number }[]; curve: CostPoint[] };
	services: ServiceForecastView[];
	users: UserUsage[];
	flow: FlowEvent[];
};
