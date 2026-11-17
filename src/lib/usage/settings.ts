import { normalizeBillingDay } from "@/lib/usage/forecast";

type Bucket = CloudflareEnv["BUCKET"];

const SETTINGS_KEY = "config/usage.json";

export type UsageSettings = { billingDay: number };

/** The day of the month Cloudflare renews the subscription and resets its allowances; kept in R2 as JSON (no table). Day 1 until an admin sets it. */
export async function getUsageSettings(bucket: Bucket): Promise<UsageSettings> {
	const object = await bucket.get(SETTINGS_KEY);
	if (!object) return { billingDay: 1 };
	try {
		return { billingDay: normalizeBillingDay((JSON.parse(await object.text()) as { billingDay?: unknown }).billingDay) };
	} catch {
		return { billingDay: 1 };
	}
}

export async function setUsageSettings(bucket: Bucket, settings: UsageSettings): Promise<void> {
	await bucket.put(SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: "application/json" } });
}
