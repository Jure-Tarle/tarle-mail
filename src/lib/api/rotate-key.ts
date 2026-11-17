import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { apiKeys } from "@/db/schema";
import { generateApiKey, generateAppPassword } from "@/lib/api-keys";

/**
 * Gives an access key a new secret in place: name, permissions, mailboxes and history stay, the old
 * secret stops working on the next request (key lookups always re-read the row), and the new one is
 * returned once. App passwords get a new app password, everything else a new API key.
 */
export async function rotateApiKeySecret(db: AppDatabase, id: string, appPassword: boolean): Promise<{ key: string; prefix: string }> {
	const { fullKey, prefix, hash, sha256 } = appPassword ? await generateAppPassword() : await generateApiKey();
	await db.update(apiKeys).set({ prefix, keyHash: hash, keySha256: sha256, lastUsedAt: null }).where(eq(apiKeys.id, id));
	return { key: fullKey, prefix };
}
