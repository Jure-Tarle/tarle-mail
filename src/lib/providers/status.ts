import { getAwsConfigStatus } from "@/lib/aws/config";
import type { MailjetCredentials, OutboundProviderName, ProviderCredentialStatus, SmtpConfig } from "@/lib/email/outbound-provider-types";
import { getResendKeyStatus } from "@/lib/email/outbound-provider";
import { checkBrevo } from "@/lib/providers/brevo";
import { OUTBOUND_PROVIDERS, type StoredProvider } from "@/lib/providers/config-utils";
import { describeStoredProvider } from "@/lib/providers/credentials";
import { checkMailjet } from "@/lib/providers/mailjet";
import { getProviderLimits, getProviderUsage } from "@/lib/providers/quota";
import { checkSmtp } from "@/lib/providers/smtp";
import { getSmtpConnect } from "@/lib/providers/smtp-socket";

async function describe(env: CloudflareEnv, provider: OutboundProviderName): Promise<{ configured: boolean; summary: string | null }> {
	if (provider === "cloudflare") return { configured: true, summary: null };
	if (provider === "resend") return { configured: (await getResendKeyStatus(env)).configured, summary: null };
	if (provider === "ses") {
		const status = await getAwsConfigStatus(env);
		return { configured: status.configured, summary: status.configured ? `${status.region} (…${status.accessKeyHint})` : null };
	}
	const summary = await describeStoredProvider(env, provider);
	return { configured: summary !== null, summary };
}

/** Every provider's state for the settings page: whether it is set up, a masked summary, its caps and what it sent. */
export async function getProviderStatuses(env: CloudflareEnv): Promise<ProviderCredentialStatus[]> {
	const limits = await getProviderLimits(env);
	return Promise.all(OUTBOUND_PROVIDERS.map(async (provider) => ({
		provider,
		...(await describe(env, provider)),
		limit: limits[provider] ?? { daily: null, monthly: null },
		usage: await getProviderUsage(env, provider),
	})));
}

/** Calls the provider with the given credentials without sending mail; throws when they are refused or unreachable. */
export async function checkProviderConnection(
	env: CloudflareEnv,
	provider: StoredProvider,
	credentials: { apiKey: string } | MailjetCredentials | SmtpConfig,
): Promise<{ account: string | null }> {
	const vars = env as { BREVO_API_BASE?: string; MAILJET_API_BASE?: string };
	if (provider === "brevo") return checkBrevo({ apiKey: (credentials as { apiKey: string }).apiKey, apiBase: vars.BREVO_API_BASE?.trim() || undefined });
	if (provider === "mailjet") return checkMailjet({ ...(credentials as MailjetCredentials), apiBase: vars.MAILJET_API_BASE?.trim() || undefined });
	return checkSmtp(credentials as SmtpConfig, getSmtpConnect(env));
}
