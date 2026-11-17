import { getD1RowCounts, getR2OperationCounts, getR2StorageSamples, getWorkerInvocationHours, getZoneAccountId } from "@/lib/cloudflare-api-analytics";
import { getEmailWorkerName } from "@/lib/cloudflare-api-utils";
import { hasCloudflareCredentials } from "@/lib/runtime";
import { DAY_MS, dailyGrowth, type BillingPeriod } from "@/lib/usage/forecast";
import type { Optional } from "@/lib/usage/types";

/** Analytics answers are reused for this long, so reloading the page does not spend API quota. */
const CACHE_MS = 5 * 60 * 1000;
const GROWTH_WINDOW_DAYS = 30;

export type CloudflareMetrics = {
	d1Rows: Optional<{ rowsRead: number; rowsWritten: number }>;
	r2Operations: Optional<{ classA: number; classB: number }>;
	r2Storage: Optional<{ bytes: number; growthPerDay: number }>;
	workerRequests: Optional<{ requests: number }>;
};

const cache = new Map<string, { at: number; value: unknown }>();

/** Only successful answers are kept: a refused query is retried at once when the token is fixed. */
async function cached<T>(key: string, now: Date, load: () => Promise<T>): Promise<T> {
	const hit = cache.get(key);
	if (hit && now.getTime() - hit.at < CACHE_MS) return hit.value as T;
	const value = await load();
	cache.set(key, { at: now.getTime(), value });
	if (cache.size > 64) cache.delete(cache.keys().next().value!);
	return value;
}

const settle = async <T>(load: () => Promise<T>): Promise<Optional<T>> => {
	try {
		return { available: true, value: await load() };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : "Cloudflare analytics are not available to this token (it needs Account Analytics read)." };
	}
};

const unavailable = (reason: string): CloudflareMetrics => {
	const missing = { available: false, reason } as const;
	return { d1Rows: missing, r2Operations: missing, r2Storage: missing, workerRequests: missing };
};

/**
 * What Cloudflare bills by usage, read from its GraphQL analytics for the billing period so far. D1 rows and
 * R2 operations cover the whole account (that is what is billed); Worker requests cover this app's Worker.
 * Each figure fails on its own, so one dataset the token cannot read does not hide the others.
 */
export async function readCloudflareMetrics(env: CloudflareEnv, zoneId: string | undefined, period: BillingPeriod, now: Date): Promise<CloudflareMetrics> {
	if (!hasCloudflareCredentials(env)) return unavailable("Cloudflare API credentials are not configured.");
	if (!zoneId) return unavailable("No domain is on a Cloudflare zone, so the account cannot be identified.");
	let accountId: string | null;
	try {
		accountId = await cached(`account:${zoneId}`, now, () => getZoneAccountId(env, zoneId));
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : "Could not look up the Cloudflare account.");
	}
	if (!accountId) return unavailable("Cloudflare did not report the account for this zone.");

	const key = (name: string) => `${name}:${accountId}:${period.start.toISOString()}`;
	const growthSince = new Date(now.getTime() - GROWTH_WINDOW_DAYS * DAY_MS);
	const [d1Rows, r2Operations, r2Storage, workerRequests] = await Promise.all([
		settle(() => cached(key("d1"), now, () => getD1RowCounts(env, accountId, period.start, now))),
		settle(() => cached(key("r2ops"), now, () => getR2OperationCounts(env, accountId, period.start, now))),
		settle(() => cached(`r2storage:${accountId}`, now, async () => {
			const samples = await getR2StorageSamples(env, accountId, growthSince, now);
			return { bytes: samples.at(-1)?.bytes ?? 0, growthPerDay: dailyGrowth(samples.map((sample) => ({ at: sample.at, value: sample.bytes }))) };
		})),
		settle(() => cached(key("requests"), now, async () => {
			const hours = await getWorkerInvocationHours(env, accountId, getEmailWorkerName(), period.start, now);
			return { requests: hours.reduce((sum, hour) => sum + hour.requests, 0) };
		})),
	]);
	return { d1Rows, r2Operations, r2Storage, workerRequests };
}
