import { cfRequest } from "@/lib/cloudflare-api";
import { getCloudflareAuth, getCloudflareAuthHeaders } from "@/lib/cloudflare-api-utils";
import { r2OperationClass } from "@/lib/usage/pricing";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

/** The account a zone belongs to; the analytics API is queried per account. */
export async function getZoneAccountId(env: CloudflareEnv, zoneId: string): Promise<string | null> {
	const zone = await cfRequest<{ account?: { id?: string } }>(env, `/zones/${zoneId}`);
	return zone.account?.id ?? null;
}

/**
 * Runs one query against the account and returns the account's node. Needs a token with Account
 * Analytics read, so a refusal throws and the caller treats the numbers as unavailable.
 * Datasets: https://developers.cloudflare.com/analytics/graphql-api/
 */
async function queryAccount<T>(env: CloudflareEnv, query: string, variables: Record<string, unknown>): Promise<T | undefined> {
	const response = await fetch(GRAPHQL_URL, {
		method: "POST",
		headers: { ...getCloudflareAuthHeaders(getCloudflareAuth(env)), "Content-Type": "application/json" },
		signal: AbortSignal.timeout(10_000),
		body: JSON.stringify({ query, variables }),
	});
	const json = (await response.json()) as { data?: { viewer?: { accounts?: T[] } }; errors?: { message?: string }[] };
	if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).filter(Boolean).join("; ") || "Analytics query failed");
	if (!response.ok) throw new Error(`Analytics request failed (${response.status})`);
	return json.data?.viewer?.accounts?.[0];
}

type WorkerHourRow = { sum?: { requests?: number; errors?: number }; dimensions?: { datetimeHour?: string } };

/** Hourly invocations of one Worker over a window. */
export async function getWorkerInvocationHours(
	env: CloudflareEnv,
	accountId: string,
	scriptName: string,
	since: Date,
	until: Date,
): Promise<{ hour: string; requests: number; errors: number }[]> {
	const account = await queryAccount<{ workersInvocationsAdaptive?: WorkerHourRow[] }>(
		env,
		`query($accountTag: String!, $scriptName: String!, $since: Time!, $until: Time!) {
			viewer { accounts(filter: { accountTag: $accountTag }) {
				workersInvocationsAdaptive(limit: 10000, filter: { scriptName: $scriptName, datetime_geq: $since, datetime_leq: $until }) {
					sum { requests errors }
					dimensions { datetimeHour }
				}
			} }
		}`,
		{ accountTag: accountId, scriptName, since: since.toISOString(), until: until.toISOString() },
	);
	return (account?.workersInvocationsAdaptive ?? []).map((row) => ({
		hour: row.dimensions?.datetimeHour ?? "",
		requests: row.sum?.requests ?? 0,
		errors: row.sum?.errors ?? 0,
	})).filter((row) => row.hour);
}

/**
 * Rows read and written by every D1 database on the account, which is how D1 bills them.
 * Dataset `d1AnalyticsAdaptiveGroups`, as `wrangler d1 info` queries it.
 */
export async function getD1RowCounts(env: CloudflareEnv, accountId: string, since: Date, until: Date): Promise<{ rowsRead: number; rowsWritten: number }> {
	const account = await queryAccount<{ d1AnalyticsAdaptiveGroups?: { sum?: { rowsRead?: number; rowsWritten?: number } }[] }>(
		env,
		`query($accountTag: String!, $since: Time!, $until: Time!) {
			viewer { accounts(filter: { accountTag: $accountTag }) {
				d1AnalyticsAdaptiveGroups(limit: 10000, filter: { datetimeHour_geq: $since, datetimeHour_leq: $until }) {
					sum { rowsRead rowsWritten }
					dimensions { datetimeHour }
				}
			} }
		}`,
		{ accountTag: accountId, since: since.toISOString(), until: until.toISOString() },
	);
	const rows = account?.d1AnalyticsAdaptiveGroups ?? [];
	return {
		rowsRead: rows.reduce((sum, row) => sum + (row.sum?.rowsRead ?? 0), 0),
		rowsWritten: rows.reduce((sum, row) => sum + (row.sum?.rowsWritten ?? 0), 0),
	};
}

/** R2 operations on the account in a window, sorted into Class A and Class B by action type (free actions are left out). Dataset `r2OperationsAdaptiveGroups`. */
export async function getR2OperationCounts(env: CloudflareEnv, accountId: string, since: Date, until: Date): Promise<{ classA: number; classB: number }> {
	const account = await queryAccount<{ r2OperationsAdaptiveGroups?: { sum?: { requests?: number }; dimensions?: { actionType?: string } }[] }>(
		env,
		`query($accountTag: String!, $since: Time!, $until: Time!) {
			viewer { accounts(filter: { accountTag: $accountTag }) {
				r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until }) {
					sum { requests }
					dimensions { actionType }
				}
			} }
		}`,
		{ accountTag: accountId, since: since.toISOString(), until: until.toISOString() },
	);
	const counts = { classA: 0, classB: 0 };
	for (const row of account?.r2OperationsAdaptiveGroups ?? []) {
		const operationClass = r2OperationClass(row.dimensions?.actionType ?? "");
		if (operationClass === "A") counts.classA += row.sum?.requests ?? 0;
		else if (operationClass === "B") counts.classB += row.sum?.requests ?? 0;
	}
	return counts;
}

type R2StorageRow = { max?: { payloadSize?: number; metadataSize?: number }; dimensions?: { datetime?: string; bucketName?: string } };

const r2StorageQuery = (dimensions: string) => `query($accountTag: String!, $since: Time!, $until: Time!) {
	viewer { accounts(filter: { accountTag: $accountTag }) {
		r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until }, orderBy: [datetime_ASC]) {
			max { payloadSize metadataSize }
			dimensions { ${dimensions} }
		}
	} }
}`;

/**
 * Bytes stored in R2 over a window, one sample per reported time, summed over the account's buckets.
 * Dataset `r2StorageAdaptiveGroups`, as `wrangler r2 bucket info` queries it. If the dataset does not
 * offer the bucket as a dimension, the per-time maximum is used, which is exact for a single bucket.
 */
export async function getR2StorageSamples(env: CloudflareEnv, accountId: string, since: Date, until: Date): Promise<{ at: number; bytes: number }[]> {
	const variables = { accountTag: accountId, since: since.toISOString(), until: until.toISOString() };
	let rows: R2StorageRow[];
	try {
		rows = (await queryAccount<{ r2StorageAdaptiveGroups?: R2StorageRow[] }>(env, r2StorageQuery("datetime bucketName"), variables))?.r2StorageAdaptiveGroups ?? [];
	} catch {
		rows = (await queryAccount<{ r2StorageAdaptiveGroups?: R2StorageRow[] }>(env, r2StorageQuery("datetime"), variables))?.r2StorageAdaptiveGroups ?? [];
	}
	const byTime = new Map<string, number>();
	for (const row of rows) {
		const time = row.dimensions?.datetime;
		if (time) byTime.set(time, (byTime.get(time) ?? 0) + (row.max?.payloadSize ?? 0) + (row.max?.metadataSize ?? 0));
	}
	return [...byTime].map(([time, bytes]) => ({ at: Date.parse(time), bytes })).filter((sample) => Number.isFinite(sample.at)).sort((a, b) => a.at - b.at);
}
