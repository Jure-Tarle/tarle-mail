import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxes, messages, outboundJobs, providerUsage, users } from "@/db/schema";
import { getAwsConfig } from "@/lib/aws/config";
import { awsJson } from "@/lib/aws/client";
import { isManualZone } from "@/lib/domains/provision";
import { getStorageUsageByUser } from "@/lib/mailboxes/storage-usage";
import { getProviderLimits } from "@/lib/providers/quota";
import { recentZonedDays } from "@/lib/time/utils";
import { classifyFlow, fillDailyFlow, foldUserFlow, PROVIDER_LIMITS, type FlowCountRow, type SendingProviderId } from "@/lib/usage/aggregate";
import { readCloudflareMetrics } from "@/lib/usage/cloudflare-metrics";
import { billingPeriod, splitCosts, utcDayKey } from "@/lib/usage/forecast";
import { buildMeters, type ProviderReading } from "@/lib/usage/meters";
import { getUsageSettings } from "@/lib/usage/settings";
import type { Optional, UsageOverview, UserUsage } from "@/lib/usage/types";

export type { UsageOverview } from "@/lib/usage/types";

const FLOW_LOG_SIZE = 50;

/** D1 reports the database's size with every result; other databases report nothing. */
async function readDatabaseSize(env: CloudflareEnv): Promise<Optional<{ bytes: number }>> {
	try {
		const result = await env.DB.prepare("SELECT 1").run();
		const bytes = Number(result.meta?.size_after);
		return bytes > 0 ? { available: true, value: { bytes } } : { available: false, reason: "This database does not report its size." };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : "Could not read the database size" };
	}
}

/** SES's own 24-hour send quota replaces a fixed free tier, since AWS accounts differ. */
async function readSesQuota(env: CloudflareEnv): Promise<{ max: number; sent: number } | null> {
	try {
		const config = await getAwsConfig(env);
		if (!config) return null;
		const account = await awsJson<{ SendQuota?: { Max24HourSend?: number; SentLast24Hours?: number } }>({ config, service: "ses", host: `email.${config.region}.amazonaws.com`, path: "/v2/email/account" });
		const max = account.SendQuota?.Max24HourSend;
		return max && max > 0 ? { max, sent: account.SendQuota?.SentLast24Hours ?? 0 } : null;
	} catch {
		return null;
	}
}

export async function getUsageOverview(env: CloudflareEnv, timeZone: string, now = new Date()): Promise<UsageOverview> {
	const db = getDb(env);
	const days = recentZonedDays(timeZone, 30, now);
	const windowStart = days[0].start;
	const windowEnd = days[days.length - 1].end;
	// Each boundary uses the offset on that date, including daylight-saving changes.
	const day = sql<string>`CASE ${sql.join(days.map((item) => sql`WHEN ${messages.createdAt} < ${item.end.getTime() / 1000} THEN ${item.date}`), sql` `)} END`;

	const { billingDay } = await getUsageSettings(env.BUCKET);
	const period = billingPeriod(now, billingDay);
	const monthPeriod = billingPeriod(now, 1);
	const todayKey = utcDayKey(now);
	// Provider counters are kept per UTC day; the billing period and the calendar month each need their own slice.
	const counterSince = utcDayKey(period.start < monthPeriod.start ? period.start : monthPeriod.start);
	const periodSince = utcDayKey(period.start);
	const monthSince = utcDayKey(monthPeriod.start);
	const inWindow = and(gte(messages.createdAt, windowStart), lt(messages.createdAt, windowEnd), ne(messages.status, "draft"));

	const [dailyRows, userRows, domainRows, flowRows, counterRows, userList, mailboxRows, storageByUser] = await Promise.all([
		db.select({ date: day.as("date"), direction: messages.direction, status: messages.status, count: sql<number>`count(*)` })
			.from(messages)
			.where(inWindow)
			.groupBy(sql`1`, messages.direction, messages.status),
		// Mail counts toward the mailbox owner, like storage; mail whose mailbox is gone stays with the user it was stored for.
		db.select({ userId: sql<string>`coalesce(${mailboxes.userId}, ${messages.userId})`, direction: messages.direction, status: messages.status, count: sql<number>`count(*)` })
			.from(messages)
			.leftJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
			.where(inWindow)
			.groupBy(sql`1`, messages.direction, messages.status),
		db.select({ sendingProvider: domains.sendingProvider, zoneId: domains.zoneId }).from(domains),
		db.select({
			id: messages.id,
			createdAt: messages.createdAt,
			direction: messages.direction,
			status: messages.status,
			fromAddr: messages.fromAddr,
			toAddr: messages.toAddr,
			error: outboundJobs.error,
		})
			.from(messages)
			.leftJoin(outboundJobs, eq(outboundJobs.messageId, messages.id))
			.where(ne(messages.status, "draft"))
			.orderBy(desc(messages.createdAt), desc(messages.id))
			.limit(FLOW_LOG_SIZE),
		db.select({ provider: providerUsage.provider, day: providerUsage.day, count: providerUsage.count }).from(providerUsage).where(gte(providerUsage.day, counterSince)),
		db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users),
		db.select({ userId: mailboxes.userId, type: mailboxes.type, count: sql<number>`count(*)` }).from(mailboxes).groupBy(mailboxes.userId, mailboxes.type),
		getStorageUsageByUser(env),
	]);

	const daily = fillDailyFlow(days.map((item) => item.date), dailyRows as FlowCountRow[]);
	const totals = daily.reduce((sum, item) => ({ received: sum.received + item.received, spam: sum.spam + item.spam, sent: sum.sent + item.sent, failed: sum.failed + item.failed }), { received: 0, spam: 0, sent: 0, failed: 0 });

	// Recipients sent per provider, from the counters that also enforce the limits.
	const sentBy = (provider: string, since: string) => counterRows.filter((row) => row.provider === provider && row.day >= since).reduce((sum, row) => sum + row.count, 0);
	const emailSent = counterRows.filter((row) => row.provider === "cloudflare" && row.day >= periodSince && row.day < utcDayKey(period.end)).reduce((sum, row) => sum + row.count, 0);

	const configuredLimits = await getProviderLimits(env);
	const providerIds = [...new Set(domainRows.map((row) => row.sendingProvider))].filter((id): id is Exclude<SendingProviderId, "none" | "cloudflare"> => id !== "none" && id !== "cloudflare");
	const sesQuota = providerIds.includes("ses") ? await readSesQuota(env) : null;
	const providers: ProviderReading[] = providerIds.map((id) => ({
		provider: id,
		label: PROVIDER_LIMITS[id].label,
		today: sentBy(id, todayKey),
		month: sentBy(id, monthSince),
		perDay: (id === "ses" ? sesQuota?.max : undefined) ?? configuredLimits[id]?.daily ?? PROVIDER_LIMITS[id].perDay ?? null,
		perMonth: configuredLimits[id]?.monthly ?? PROVIDER_LIMITS[id].perMonth ?? null,
	}));

	const [database, cloudflare] = await Promise.all([
		readDatabaseSize(env),
		readCloudflareMetrics(env, domainRows.find((row) => !isManualZone(row.zoneId))?.zoneId, period, now),
	]);
	const { meters, forecast, services } = buildMeters({ database, cloudflare, emailSent, providers }, period, monthPeriod);

	const flowByUser = foldUserFlow(userRows);
	const mailboxCount = (userId: string, shared?: boolean) => mailboxRows.filter((row) => row.userId === userId && (shared === undefined || (row.type === "shared") === shared)).reduce((sum, row) => sum + Number(row.count), 0);
	const rows = userList.map((user) => {
		const flow = flowByUser.get(user.id) ?? { received: 0, spam: 0, sent: 0, failed: 0 };
		const stored = storageByUser.get(user.id);
		return { user, flow, storageBytes: (stored?.mailBytes ?? 0) + (stored?.driveBytes ?? 0) };
	});
	const meterCost = (id: string) => forecast.lines.find((line) => line.id === id)?.cost ?? 0;
	const shares = splitCosts(rows.map((row) => ({ id: row.user.id, sent: row.flow.sent, storageBytes: row.storageBytes })), meterCost("emailSending"), meterCost("d1Storage") + meterCost("r2Storage"));
	const userUsage: UserUsage[] = rows
		.map(({ user, flow, storageBytes }) => ({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			mailboxes: mailboxCount(user.id),
			sharedMailboxes: mailboxCount(user.id, true),
			...flow,
			storageBytes,
			sendShare: shares.get(user.id)?.sendShare ?? 0,
			cost: shares.get(user.id)?.cost ?? 0,
		}))
		.sort((a, b) => b.sent + b.received - (a.sent + a.received) || a.name.localeCompare(b.name));

	return {
		timeZone,
		billing: { day: billingDay, start: period.start.toISOString(), end: period.end.toISOString(), days: period.days, elapsedDays: period.elapsedDays },
		daily,
		totals,
		meters,
		forecast,
		services,
		users: userUsage,
		flow: flowRows.map((row) => ({
			id: row.id,
			createdAt: row.createdAt.toISOString(),
			direction: row.direction,
			status: classifyFlow(row.direction, row.status, row.error),
			from: row.fromAddr,
			to: row.toAddr,
			detail: row.error ? row.error.slice(0, 200) : null,
		})),
	};
}
