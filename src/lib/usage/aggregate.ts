/**
 * Pure aggregation for the usage dashboard: folding grouped database rows into
 * a daily series, attributing sends to providers and judging them against free
 * tiers. `service.ts` reads the rows; nothing here touches I/O.
 */

export type SendingProviderId = "cloudflare" | "resend" | "ses" | "brevo" | "mailjet" | "smtp" | "none";

export type FlowCountRow = { date: string; direction: string; status: string; count: number };
export type DailyFlow = { date: string; received: number; spam: number; sent: number; failed: number };

/**
 * Published allowances per sending provider. Cloudflare's is what Email Sending
 * includes with a Workers Paid plan; SES has no fixed free tier, so its limit is
 * read from the account's own send quota instead. Brevo and Mailjet show their
 * free plans; SMTP servers have no known limit. Limits an admin sets under
 * Admin → General (provider limits) replace these in `service.ts`.
 */
export const PROVIDER_LIMITS: Record<SendingProviderId, { label: string; perDay?: number; perMonth?: number }> = {
	resend: { label: "Resend", perDay: 100, perMonth: 3000 },
	cloudflare: { label: "Cloudflare Email Sending", perMonth: 3000 },
	ses: { label: "Amazon SES" },
	brevo: { label: "Brevo", perDay: 300 },
	mailjet: { label: "Mailjet", perDay: 200, perMonth: 6000 },
	smtp: { label: "SMTP" },
	none: { label: "Not configured" },
};

/** Fills every day of the window, so days without mail show as zero rather than gaps. */
export function fillDailyFlow(dates: string[], rows: FlowCountRow[]): DailyFlow[] {
	const byDate = new Map<string, DailyFlow>(dates.map((date) => [date, { date, received: 0, spam: 0, sent: 0, failed: 0 }]));
	for (const row of rows) {
		const day = byDate.get(row.date);
		if (!day) continue;
		const count = Number(row.count) || 0;
		if (row.direction === "inbound") {
			if (row.status === "spam") day.spam += count;
			else day.received += count;
		} else if (row.status === "sent") day.sent += count;
		else if (row.status === "failed") day.failed += count;
	}
	return dates.map((date) => byDate.get(date)!);
}

/** The host of an address that may carry a display name: `Name <a@b.com>` and `a@b.com` both give `b.com`. */
export function senderHost(address: string): string {
	const bare = address.match(/<([^>]+)>/)?.[1] ?? address;
	return bare.slice(bare.lastIndexOf("@") + 1).trim().toLowerCase();
}

export type SenderCount = { fromAddr: string; today: number; month: number };
export type ProviderUsage = {
	provider: SendingProviderId | "unmapped";
	label: string;
	today: number;
	month: number;
	limits: { perDay: number | null; perMonth: number | null };
	hosts: string[];
};

/** The provider that sends for `host`: its own domain row, or the nearest parent domain's. */
export function providerForHost(host: string, providerByHost: Map<string, SendingProviderId>): SendingProviderId | undefined {
	const labels = host.split(".");
	for (let index = 0; index < labels.length - 1; index += 1) {
		const provider = providerByHost.get(labels.slice(index).join("."));
		if (provider) return provider;
	}
	return undefined;
}

/**
 * Sends per provider, attributed through the From domain's current provider (messages do not record which
 * provider carried them). Providers with a domain on them are listed even at zero, so the limit stays visible.
 */
export function tallyProviders(senders: SenderCount[], providerByHost: Map<string, SendingProviderId>): ProviderUsage[] {
	const tally = new Map<ProviderUsage["provider"], ProviderUsage>();
	const entry = (provider: ProviderUsage["provider"]): ProviderUsage => {
		let usage = tally.get(provider);
		if (!usage) {
			const known = provider === "unmapped" ? undefined : PROVIDER_LIMITS[provider];
			usage = {
				provider,
				label: known?.label ?? "Other senders",
				today: 0,
				month: 0,
				limits: { perDay: known?.perDay ?? null, perMonth: known?.perMonth ?? null },
				hosts: [],
			};
			tally.set(provider, usage);
		}
		return usage;
	};
	for (const [host, provider] of providerByHost) {
		if (provider === "none") continue;
		const usage = entry(provider);
		if (!usage.hosts.includes(host)) usage.hosts.push(host);
	}
	for (const sender of senders) {
		const host = senderHost(sender.fromAddr);
		const provider = providerForHost(host, providerByHost);
		const usage = entry(provider && provider !== "none" ? provider : "unmapped");
		usage.today += Number(sender.today) || 0;
		usage.month += Number(sender.month) || 0;
	}
	return [...tally.values()].sort((a, b) => b.month - a.month || a.label.localeCompare(b.label));
}

export type LimitLevel = "ok" | "warn" | "over";

/** How much of an allowance is used; warns from 80%. */
export function limitLevel(used: number, limit: number | null): { ratio: number; level: LimitLevel } | null {
	if (!limit || limit <= 0) return null;
	const ratio = used / limit;
	return { ratio, level: ratio > 1 ? "over" : ratio >= 0.8 ? "warn" : "ok" };
}

export type FlowStatus = "delivered" | "spam" | "sent" | "queued" | "failed" | "rejected" | "bounced";

/**
 * The status shown in the mail-flow log. Mail the app refused before storing it is not recorded anywhere, so
 * inbound rows are delivered or spam; a failed send is told apart as rejected or bounced from the provider's error text.
 */
export function classifyFlow(direction: string, status: string, error?: string | null): FlowStatus {
	if (direction === "inbound") return status === "spam" ? "spam" : "delivered";
	if (status === "queued") return "queued";
	if (status !== "failed") return "sent";
	if (error && /bounce/i.test(error)) return "bounced";
	if (error && /reject|refus|denied|blocked|not allowed|\b5\d\d\b/i.test(error)) return "rejected";
	return "failed";
}

/** First moments of the UTC day and month containing `now`, as epoch seconds. */
export function utcWindows(now = new Date()): { dayStart: Date; monthStart: Date } {
	return {
		dayStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
		monthStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
	};
}

export type WorkerDay = { date: string; requests: number; errors: number };

/** Sums hourly analytics rows into days. */
export function foldWorkerHours(rows: { hour: string; requests: number; errors: number }[]): WorkerDay[] {
	const days = new Map<string, WorkerDay>();
	for (const row of rows) {
		const date = row.hour.slice(0, 10);
		const day = days.get(date) ?? { date, requests: 0, errors: 0 };
		day.requests += Number(row.requests) || 0;
		day.errors += Number(row.errors) || 0;
		days.set(date, day);
	}
	return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
