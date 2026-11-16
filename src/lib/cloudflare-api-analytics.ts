import { cfRequest } from "@/lib/cloudflare-api";
import { getCloudflareAuth, getCloudflareAuthHeaders } from "@/lib/cloudflare-api-utils";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

/** The account a zone belongs to; the analytics API is queried per account. */
export async function getZoneAccountId(env: CloudflareEnv, zoneId: string): Promise<string | null> {
	const zone = await cfRequest<{ account?: { id?: string } }>(env, `/zones/${zoneId}`);
	return zone.account?.id ?? null;
}

type WorkerHourRow = { sum?: { requests?: number; errors?: number }; dimensions?: { datetimeHour?: string } };

/**
 * Hourly invocations of one Worker over a window. Needs a token with Account
 * Analytics read, so a refusal throws and the caller treats the numbers as unavailable.
 */
export async function getWorkerInvocationHours(
	env: CloudflareEnv,
	accountId: string,
	scriptName: string,
	since: Date,
	until: Date,
): Promise<{ hour: string; requests: number; errors: number }[]> {
	const response = await fetch(GRAPHQL_URL, {
		method: "POST",
		headers: { ...getCloudflareAuthHeaders(getCloudflareAuth(env)), "Content-Type": "application/json" },
		signal: AbortSignal.timeout(10_000),
		body: JSON.stringify({
			query: `query($accountTag: String!, $scriptName: String!, $since: Time!, $until: Time!) {
				viewer { accounts(filter: { accountTag: $accountTag }) {
					workersInvocationsAdaptive(limit: 10000, filter: { scriptName: $scriptName, datetime_geq: $since, datetime_leq: $until }) {
						sum { requests errors }
						dimensions { datetimeHour }
					}
				} }
			}`,
			variables: { accountTag: accountId, scriptName, since: since.toISOString(), until: until.toISOString() },
		}),
	});
	const json = (await response.json()) as {
		data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: WorkerHourRow[] }[] } };
		errors?: { message?: string }[];
	};
	if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).filter(Boolean).join("; ") || "Analytics query failed");
	if (!response.ok) throw new Error(`Analytics request failed (${response.status})`);
	return (json.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []).map((row) => ({
		hour: row.dimensions?.datetimeHour ?? "",
		requests: row.sum?.requests ?? 0,
		errors: row.sum?.errors ?? 0,
	})).filter((row) => row.hour);
}
