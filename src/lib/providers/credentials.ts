import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import type { MailjetCredentials, SmtpConfig } from "@/lib/email/outbound-provider-types";
import { parseStoredJson, summarizeCredentials, type StoredProvider } from "@/lib/providers/config-utils";

/**
 * Brevo, Mailjet and SMTP credentials live in `app_settings` beside the Resend key and the AWS
 * configuration, shared by every domain that uses them. Only these functions read the secrets;
 * the settings API returns `describeStoredProvider` summaries.
 */
type StoredCredentials = {
	brevo: { apiKey: string };
	mailjet: MailjetCredentials;
	smtp: SmtpConfig;
};

const COLUMN = { brevo: "brevoApiKey", mailjet: "mailjetConfig", smtp: "smtpConfig" } as const;

async function readRow(env: CloudflareEnv) {
	const [row] = await getDb(env)
		.select({ brevoApiKey: appSettings.brevoApiKey, mailjetConfig: appSettings.mailjetConfig, smtpConfig: appSettings.smtpConfig, providerLimits: appSettings.providerLimits })
		.from(appSettings)
		.where(eq(appSettings.id, "default"))
		.limit(1);
	return row ?? null;
}

export async function getStoredCredentials<P extends StoredProvider>(env: CloudflareEnv, provider: P): Promise<StoredCredentials[P] | null> {
	const row = await readRow(env);
	if (provider === "brevo") {
		const apiKey = row?.brevoApiKey?.trim();
		return (apiKey ? { apiKey } : null) as StoredCredentials[P] | null;
	}
	const stored = parseStoredJson<Partial<MailjetCredentials & SmtpConfig>>(row?.[COLUMN[provider]]);
	if (provider === "mailjet") return (stored?.apiKey && stored.apiSecret ? { apiKey: stored.apiKey, apiSecret: stored.apiSecret } : null) as StoredCredentials[P] | null;
	return (stored?.host && stored.port && stored.security
		? { host: stored.host, port: stored.port, security: stored.security, username: stored.username ?? "", password: stored.password ?? "" }
		: null) as StoredCredentials[P] | null;
}

export async function saveCredentials(env: CloudflareEnv, provider: StoredProvider, credentials: StoredCredentials[StoredProvider]): Promise<void> {
	const value = provider === "brevo" ? (credentials as StoredCredentials["brevo"]).apiKey : JSON.stringify(credentials);
	const values = { [COLUMN[provider]]: value, updatedAt: new Date() };
	await getDb(env).insert(appSettings).values({ id: "default", ...values }).onConflictDoUpdate({ target: appSettings.id, set: values });
}

export async function clearCredentials(env: CloudflareEnv, provider: StoredProvider): Promise<void> {
	await getDb(env).update(appSettings).set({ [COLUMN[provider]]: null, updatedAt: new Date() }).where(eq(appSettings.id, "default"));
}

/** A masked one-line description of saved credentials, or null when none are saved. */
export async function describeStoredProvider(env: CloudflareEnv, provider: StoredProvider): Promise<string | null> {
	const stored = await getStoredCredentials(env, provider);
	return stored ? summarizeCredentials(provider, stored) : null;
}

export async function readProviderLimitsJson(env: CloudflareEnv): Promise<string | null> {
	return (await readRow(env))?.providerLimits ?? null;
}

export async function saveProviderLimitsJson(env: CloudflareEnv, json: string): Promise<void> {
	const values = { providerLimits: json, updatedAt: new Date() };
	await getDb(env).insert(appSettings).values({ id: "default", ...values }).onConflictDoUpdate({ target: appSettings.id, set: values });
}
