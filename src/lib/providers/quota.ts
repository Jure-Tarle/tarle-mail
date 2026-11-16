import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { providerUsage } from "@/db/schema";
import type { OutboundProviderName, ProviderLimit, ProviderUsage } from "@/lib/email/outbound-provider-types";
import { dayKey, normalizeLimit, parseLimits, remainingQuota, type ProviderLimits } from "@/lib/providers/config-utils";
import { readProviderLimitsJson, saveProviderLimitsJson } from "@/lib/providers/credentials";

export async function getProviderLimits(env: CloudflareEnv): Promise<ProviderLimits> {
	return parseLimits(await readProviderLimitsJson(env));
}

export async function setProviderLimit(env: CloudflareEnv, provider: OutboundProviderName, limit: ProviderLimit): Promise<void> {
	const limits = await getProviderLimits(env);
	await saveProviderLimitsJson(env, JSON.stringify({ ...limits, [provider]: normalizeLimit(limit) }));
}

/** Recipients sent through the provider today and this month (UTC). */
export async function getProviderUsage(env: CloudflareEnv, provider: OutboundProviderName, now: Date = new Date()): Promise<ProviderUsage> {
	const today = dayKey(now);
	const rows = await getDb(env)
		.select({ day: providerUsage.day, count: providerUsage.count })
		.from(providerUsage)
		.where(and(eq(providerUsage.provider, provider), gte(providerUsage.day, `${today.slice(0, 7)}-01`)));
	return { today: rows.filter((row) => row.day === today).reduce((sum, row) => sum + row.count, 0), month: rows.reduce((sum, row) => sum + row.count, 0) };
}

/** Whether `recipients` more recipients fit under the provider's caps. Providers without a cap always have room. */
export async function hasProviderRoom(env: CloudflareEnv, provider: OutboundProviderName, recipients: number): Promise<boolean> {
	const limit = (await getProviderLimits(env))[provider];
	if (!limit || (limit.daily === null && limit.monthly === null)) return true;
	const remaining = remainingQuota(limit, await getProviderUsage(env, provider));
	return remaining === null || remaining >= recipients;
}

export async function recordProviderUsage(env: CloudflareEnv, provider: OutboundProviderName, recipients: number, now: Date = new Date()): Promise<void> {
	const day = dayKey(now);
	await getDb(env)
		.insert(providerUsage)
		.values({ id: `${provider}:${day}`, provider, day, count: recipients })
		.onConflictDoUpdate({ target: providerUsage.id, set: { count: sql`${providerUsage.count} + ${recipients}` } });
}
