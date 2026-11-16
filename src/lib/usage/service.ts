import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, driveItems, messageAttachments, messages, outboundJobs } from "@/db/schema";
import { getAwsConfig } from "@/lib/aws/config";
import { awsJson } from "@/lib/aws/client";
import { getWorkerInvocationHours, getZoneAccountId } from "@/lib/cloudflare-api-analytics";
import { getEmailWorkerName } from "@/lib/cloudflare-api-utils";
import { isManualZone } from "@/lib/domains/provision";
import { getProviderLimits } from "@/lib/providers/quota";
import { hasCloudflareCredentials } from "@/lib/runtime";
import { recentZonedDays } from "@/lib/time/utils";
import {
	classifyFlow,
	fillDailyFlow,
	foldWorkerHours,
	tallyProviders,
	utcWindows,
	type DailyFlow,
	type FlowCountRow,
	type FlowStatus,
	type ProviderUsage,
	type SendingProviderId,
	type WorkerDay,
} from "@/lib/usage/aggregate";

const FLOW_LOG_SIZE = 50;

/** Cloudflare's published D1 limit per database on the Free plan; the Paid plan allows far more. */
export const D1_FREE_LIMIT_BYTES = 500 * 1024 * 1024;

export type FlowEvent = { id: string; createdAt: string; direction: "inbound" | "outbound"; status: FlowStatus; from: string; to: string; detail: string | null };

/** A figure that may be unavailable: why, rather than a silent gap, when it is. */
export type Optional<T> = { available: true; value: T } | { available: false; reason: string };

export type UsageOverview = {
	timeZone: string;
	daily: DailyFlow[];
	totals: { received: number; spam: number; sent: number; failed: number };
	providers: ProviderUsage[];
	flow: FlowEvent[];
	database: Optional<{ bytes: number; freeLimitBytes: number }>;
	storage: { attachmentBytes: number; driveBytes: number };
	worker: Optional<{ days: WorkerDay[]; requests: number; errors: number }>;
};

const failure = (error: unknown, fallback: string): { available: false; reason: string } => ({ available: false, reason: error instanceof Error ? error.message : fallback });

/** D1 reports the database's size with every result; other databases report nothing. */
async function readDatabaseSize(env: CloudflareEnv): Promise<UsageOverview["database"]> {
	try {
		const result = await env.DB.prepare("SELECT 1").run();
		const bytes = Number(result.meta?.size_after);
		return bytes > 0 ? { available: true, value: { bytes, freeLimitBytes: D1_FREE_LIMIT_BYTES } } : { available: false, reason: "This database does not report its size." };
	} catch (error) {
		return failure(error, "Could not read the database size");
	}
}

async function readWorkerStats(env: CloudflareEnv, zoneId: string | undefined, now: Date): Promise<UsageOverview["worker"]> {
	if (!hasCloudflareCredentials(env)) return { available: false, reason: "Cloudflare API credentials are not configured." };
	if (!zoneId) return { available: false, reason: "No domain is on a Cloudflare zone, so the account cannot be identified." };
	try {
		const accountId = await getZoneAccountId(env, zoneId);
		if (!accountId) return { available: false, reason: "Cloudflare did not report the account for this zone." };
		const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
		const days = foldWorkerHours(await getWorkerInvocationHours(env, accountId, getEmailWorkerName(), since, now));
		return { available: true, value: { days, requests: days.reduce((sum, day) => sum + day.requests, 0), errors: days.reduce((sum, day) => sum + day.errors, 0) } };
	} catch (error) {
		return failure(error, "Cloudflare analytics are not available to this token (it needs Account Analytics read).");
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
	const { dayStart, monthStart } = utcWindows(now);

	const [dailyRows, senderRows, domainRows, flowRows, attachmentRows, driveRows] = await Promise.all([
		db.select({ date: day.as("date"), direction: messages.direction, status: messages.status, count: sql<number>`count(*)` })
			.from(messages)
			.where(and(gte(messages.createdAt, windowStart), lt(messages.createdAt, windowEnd), ne(messages.status, "draft")))
			.groupBy(sql`1`, messages.direction, messages.status),
		db.select({
			fromAddr: messages.fromAddr,
			today: sql<number>`coalesce(sum(CASE WHEN ${messages.createdAt} >= ${dayStart.getTime() / 1000} THEN 1 ELSE 0 END), 0)`,
			month: sql<number>`count(*)`,
		})
			.from(messages)
			.where(and(eq(messages.direction, "outbound"), eq(messages.status, "sent"), gte(messages.createdAt, monthStart)))
			.groupBy(messages.fromAddr),
		db.select({ hostname: domains.hostname, sendingProvider: domains.sendingProvider, zoneId: domains.zoneId }).from(domains),
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
		db.select({ bytes: sql<number>`coalesce(sum(${messageAttachments.size}), 0)` }).from(messageAttachments),
		db.select({ bytes: sql<number>`coalesce(sum(${driveItems.size}), 0)` }).from(driveItems).where(eq(driveItems.kind, "file")),
	]);

	const daily = fillDailyFlow(days.map((item) => item.date), dailyRows as FlowCountRow[]);
	const totals = daily.reduce((sum, item) => ({ received: sum.received + item.received, spam: sum.spam + item.spam, sent: sum.sent + item.sent, failed: sum.failed + item.failed }), { received: 0, spam: 0, sent: 0, failed: 0 });

	const providerByHost = new Map<string, SendingProviderId>(domainRows.map((row) => [row.hostname.toLowerCase(), row.sendingProvider]));
	const providers = tallyProviders(senderRows, providerByHost);
	const configuredLimits = await getProviderLimits(env);
	for (const item of providers) {
		const configured = item.provider === "unmapped" || item.provider === "none" ? undefined : configuredLimits[item.provider];
		if (configured?.daily) item.limits.perDay = configured.daily;
		if (configured?.monthly) item.limits.perMonth = configured.monthly;
	}
	const ses = providers.find((item) => item.provider === "ses");
	if (ses) {
		const quota = await readSesQuota(env);
		if (quota) ses.limits.perDay = quota.max;
	}

	const [database, worker] = await Promise.all([
		readDatabaseSize(env),
		readWorkerStats(env, domainRows.find((row) => !isManualZone(row.zoneId))?.zoneId, now),
	]);

	return {
		timeZone,
		daily,
		totals,
		providers,
		flow: flowRows.map((row) => ({
			id: row.id,
			createdAt: row.createdAt.toISOString(),
			direction: row.direction,
			status: classifyFlow(row.direction, row.status, row.error),
			from: row.fromAddr,
			to: row.toAddr,
			detail: row.error ? row.error.slice(0, 200) : null,
		})),
		database,
		storage: { attachmentBytes: Number(attachmentRows[0]?.bytes) || 0, driveBytes: Number(driveRows[0]?.bytes) || 0 },
		worker,
	};
}
