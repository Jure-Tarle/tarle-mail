export type FlowStatus = "delivered" | "spam" | "sent" | "queued" | "failed" | "rejected" | "bounced";

export type DailyFlow = { date: string; received: number; spam: number; sent: number; failed: number };

export type ProviderUsage = {
	provider: string;
	label: string;
	today: number;
	month: number;
	limits: { perDay: number | null; perMonth: number | null };
	hosts: string[];
};

export type FlowEvent = {
	id: string;
	createdAt: string;
	direction: "inbound" | "outbound";
	status: FlowStatus;
	from: string;
	to: string;
	detail: string | null;
};

export type Optional<T> = { available: true; value: T } | { available: false; reason: string };

export type UsageResponse = {
	timeZone: string;
	daily: DailyFlow[];
	totals: { received: number; spam: number; sent: number; failed: number };
	providers: ProviderUsage[];
	flow: FlowEvent[];
	database: Optional<{ bytes: number; freeLimitBytes: number }>;
	storage: { attachmentBytes: number; driveBytes: number };
	worker: Optional<{ days: { date: string; requests: number; errors: number }[]; requests: number; errors: number }>;
	error?: string;
};
