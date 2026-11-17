import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { agentApiKeys, appSettings } from "@/db/schema";
import { isMissingTableError } from "@/lib/database-errors";
import { newId } from "@/lib/ids";
import { isEncryptedSecret, openSecret, sealSecret } from "@/lib/crypto/secret-box";
import { orderAgentKeysForUse, type ProviderKeyFailure } from "./api-key-failover";
import { AGENT_SETTINGS_ID } from "./provider-constants";

export type AgentKeyForUse = { id: string; secret: string };

export type AgentKeySummary = {
	id: string;
	label: string;
	hint: string;
	position: number;
	disabled: boolean;
	encrypted: boolean;
	cooldownUntil: string | null;
	lastError: string | null;
	lastFailureAt: string | null;
	lastUsedAt: string | null;
};

const hintOf = (secret: string) => secret.trim().slice(-4);

async function selectKeys(env: CloudflareEnv, baseUrl: string) {
	return getDb(env).select().from(agentApiKeys).where(eq(agentApiKeys.baseUrl, baseUrl)).orderBy(asc(agentApiKeys.position), asc(agentApiKeys.createdAt));
}

/**
 * Moves a key from the old single-key column into the key list, encrypted, the first time the list is
 * read. Returns false while the key table does not exist yet, so callers keep using the old column.
 */
async function migrateLegacyKey(env: CloudflareEnv, baseUrl: string): Promise<boolean> {
	const db = getDb(env);
	try {
		const [settings] = await db.select({ apiKey: appSettings.agentApiKey, baseUrl: appSettings.agentBaseUrl }).from(appSettings).where(eq(appSettings.id, AGENT_SETTINGS_ID)).limit(1);
		const legacy = settings?.apiKey?.trim();
		if (!legacy) return true;
		const existing = await selectKeys(env, settings!.baseUrl || baseUrl);
		if (existing.length === 0) {
			await db.insert(agentApiKeys).values({ id: newId("aik"), baseUrl: settings!.baseUrl || baseUrl, label: "Key 1", secret: await sealSecret(env, legacy), hint: hintOf(legacy), position: 0 });
		}
		await db.update(appSettings).set({ agentApiKey: null }).where(eq(appSettings.id, AGENT_SETTINGS_ID));
		return true;
	} catch (error) {
		if (isMissingTableError(error)) return false;
		throw error;
	}
}

/** The keys to try for a provider endpoint, decrypted and in failover order; null before the migration. */
export async function getAgentKeysForUse(env: CloudflareEnv, baseUrl: string): Promise<AgentKeyForUse[] | null> {
	if (!(await migrateLegacyKey(env, baseUrl))) return null;
	const rows = orderAgentKeysForUse(await selectKeys(env, baseUrl));
	const keys: AgentKeyForUse[] = [];
	for (const row of rows) {
		const secret = await openSecret(env, row.secret);
		if (secret) keys.push({ id: row.id, secret });
	}
	return keys;
}

export async function listAgentKeys(env: CloudflareEnv, baseUrl: string): Promise<AgentKeySummary[]> {
	await migrateLegacyKey(env, baseUrl);
	return (await selectKeys(env, baseUrl)).map((row) => ({
		id: row.id,
		label: row.label,
		hint: row.hint,
		position: row.position,
		disabled: row.disabled,
		encrypted: isEncryptedSecret(row.secret),
		cooldownUntil: row.cooldownUntil && row.cooldownUntil.getTime() > Date.now() ? row.cooldownUntil.toISOString() : null,
		lastError: row.lastError,
		lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
		lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
	}));
}

/** Whether this exact key is already in the list for the endpoint (decrypting each stored key to compare). */
export async function hasAgentKey(env: CloudflareEnv, baseUrl: string, secret: string): Promise<boolean> {
	const wanted = secret.trim();
	for (const row of await selectKeys(env, baseUrl)) {
		if (row.hint === wanted.slice(-4) && (await openSecret(env, row.secret)) === wanted) return true;
	}
	return false;
}

export async function addAgentKey(env: CloudflareEnv, input: { baseUrl: string; label: string; secret: string }): Promise<void> {
	const db = getDb(env);
	const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${agentApiKeys.position}), -1) + 1` }).from(agentApiKeys).where(eq(agentApiKeys.baseUrl, input.baseUrl));
	await db.insert(agentApiKeys).values({ id: newId("aik"), baseUrl: input.baseUrl, label: input.label, secret: await sealSecret(env, input.secret.trim()), hint: hintOf(input.secret), position: Number(next) || 0 });
}

export async function updateAgentKey(env: CloudflareEnv, id: string, changes: { label?: string; disabled?: boolean }): Promise<void> {
	const values: Partial<typeof agentApiKeys.$inferInsert> = {};
	if (changes.label !== undefined) values.label = changes.label;
	if (changes.disabled !== undefined) {
		values.disabled = changes.disabled;
		// Switching a key back on gives it a fresh start.
		if (!changes.disabled) Object.assign(values, { cooldownUntil: null, lastError: null });
	}
	if (Object.keys(values).length) await getDb(env).update(agentApiKeys).set(values).where(eq(agentApiKeys.id, id));
}

export async function deleteAgentKey(env: CloudflareEnv, id: string): Promise<void> {
	await getDb(env).delete(agentApiKeys).where(eq(agentApiKeys.id, id));
}

export async function reorderAgentKeys(env: CloudflareEnv, baseUrl: string, ids: string[]): Promise<void> {
	const db = getDb(env);
	for (const [position, id] of ids.entries()) {
		await db.update(agentApiKeys).set({ position }).where(and(eq(agentApiKeys.id, id), eq(agentApiKeys.baseUrl, baseUrl)));
	}
}

/** Records how a key fared, so the next request starts with a key that works. Never throws. */
export async function recordAgentKeyResult(env: CloudflareEnv, id: string, failure: (ProviderKeyFailure & { status: number }) | null): Promise<void> {
	try {
		const now = new Date();
		await getDb(env).update(agentApiKeys).set(failure
			? { cooldownUntil: new Date(now.getTime() + failure.cooldownMs), lastError: `${failure.reason} (HTTP ${failure.status})`, lastFailureAt: now }
			: { lastUsedAt: now, cooldownUntil: null }).where(eq(agentApiKeys.id, id));
	} catch {
		// Bookkeeping must never break a model call.
	}
}
