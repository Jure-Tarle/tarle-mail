import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, domains } from "@/db/schema";
import { requireAwsConfig } from "@/lib/aws/config";
import { sendSesEmail } from "@/lib/aws/ses";
import { getEmailAddress } from "@/lib/email/address";
import type { OutboundProviderConfig, OutboundProviderMessage, OutboundProviderName, OutboundSendAttempt, ResendKeyStatus } from "@/lib/email/outbound-provider-types";
import { sendWithBrevo } from "@/lib/providers/brevo";
import { parseFallbackList } from "@/lib/providers/config-utils";
import { getStoredCredentials } from "@/lib/providers/credentials";
import { httpFailure, networkFailure, readErrorDetail } from "@/lib/providers/errors";
import { sendWithFallback } from "@/lib/providers/fallback";
import { sendWithMailjet } from "@/lib/providers/mailjet";
import { hasProviderRoom, recordProviderUsage } from "@/lib/providers/quota";
import { sendWithSmtp } from "@/lib/providers/smtp";
import { getSmtpConnect } from "@/lib/providers/smtp-socket";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Each domain picks its own sender: Cloudflare Email Sending, Resend, or none
 * (receive-only). Receiving and storage always stay on Cloudflare. The Resend key
 * is shared by every domain; it comes from the admin setting, falling back to a
 * RESEND_API_KEY secret so it can be provisioned outside the database.
 */
export async function getResendKeyStatus(env: CloudflareEnv): Promise<ResendKeyStatus & { apiKey: string | null }> {
	const [settings] = await getDb(env)
		.select({ resendApiKey: appSettings.resendApiKey })
		.from(appSettings)
		.where(eq(appSettings.id, "default"))
		.limit(1);
	const saved = settings?.resendApiKey?.trim();
	const fromEnv = (env as { RESEND_API_KEY?: string }).RESEND_API_KEY?.trim();
	return {
		configured: !!(saved || fromEnv),
		source: saved ? "settings" : fromEnv ? "environment" : null,
		apiKey: saved || fromEnv || null,
	};
}

export async function getResendApiKey(env: CloudflareEnv): Promise<string> {
	const { apiKey } = await getResendKeyStatus(env);
	if (!apiKey) throw new Error("Resend is selected but no API key is configured");
	return apiKey;
}

const notConfigured = (label: string) => new Error(`${label} is selected but no credentials are configured`);

/** The ready-to-use settings for one provider; throws when its credentials are missing. */
export async function resolveProviderConfig(env: CloudflareEnv, provider: OutboundProviderName): Promise<OutboundProviderConfig> {
	if (provider === "resend") return { provider, apiKey: await getResendApiKey(env) };
	if (provider === "ses") return { provider, config: await requireAwsConfig(env) };
	if (provider === "brevo") {
		const credentials = await getStoredCredentials(env, "brevo");
		if (!credentials) throw notConfigured("Brevo");
		return { provider, apiKey: credentials.apiKey, apiBase: (env as { BREVO_API_BASE?: string }).BREVO_API_BASE?.trim() || undefined };
	}
	if (provider === "mailjet") {
		const credentials = await getStoredCredentials(env, "mailjet");
		if (!credentials) throw notConfigured("Mailjet");
		return { provider, ...credentials, apiBase: (env as { MAILJET_API_BASE?: string }).MAILJET_API_BASE?.trim() || undefined };
	}
	if (provider === "smtp") {
		const config = await getStoredCredentials(env, "smtp");
		if (!config) throw notConfigured("SMTP");
		return { provider, config };
	}
	return { provider: "cloudflare" };
}

async function readSendingDomain(env: CloudflareEnv, fromAddress: string) {
	const hostname = getEmailAddress(fromAddress).split("@")[1]?.toLowerCase();
	const [domain] = hostname
		? await getDb(env).select({ provider: domains.sendingProvider, fallback: domains.sendingFallback }).from(domains).where(eq(domains.hostname, hostname)).limit(1)
		: [];
	const provider = domain?.provider;
	if (!domain || !provider || provider === "none") {
		throw new Error(`Sending is not set up for ${hostname ?? "this domain"}. Choose a sending provider on the Domains page.`);
	}
	return { provider, fallback: domain.fallback };
}

/** The provider for the domain a message is sent from. */
export async function getOutboundProviderConfig(env: CloudflareEnv, fromAddress: string): Promise<OutboundProviderConfig> {
	return resolveProviderConfig(env, (await readSendingDomain(env, fromAddress)).provider);
}

/**
 * The domain's provider followed by its fallbacks, in order. A fallback that has no credentials is
 * left out; the primary one is too when a fallback can take over, otherwise its error is the answer.
 */
export async function getOutboundProviderChain(env: CloudflareEnv, fromAddress: string): Promise<OutboundProviderConfig[]> {
	const domain = await readSendingDomain(env, fromAddress);
	const names = [domain.provider, ...parseFallbackList(domain.fallback, domain.provider)];
	const chain: OutboundProviderConfig[] = [];
	let firstError: unknown = null;
	for (const name of names) {
		try { chain.push(await resolveProviderConfig(env, name)); } catch (error) { firstError ??= error; }
	}
	if (!chain.length) throw firstError;
	return chain;
}

function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

/** Resend does not return the RFC 5322 Message-ID, so we mint one for replies to thread against. */
function mintMessageId(from: string): string {
	const domain = getEmailAddress(from).split("@")[1] || "tarle-mail.local";
	return `<${crypto.randomUUID()}@${domain}>`;
}

async function sendWithResend(
	apiKey: string,
	message: OutboundProviderMessage,
	idempotencyKey?: string,
): Promise<{ messageId: string }> {
	const messageId = message.headers?.["Message-ID"] ?? mintMessageId(message.from);
	const response = await fetch(RESEND_ENDPOINT, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
		},
		body: JSON.stringify({
			from: message.from,
			to: message.to,
			...(message.cc?.length ? { cc: message.cc } : {}),
			...(message.bcc?.length ? { bcc: message.bcc } : {}),
			subject: message.subject,
			html: message.html,
			text: message.text,
			headers: { ...message.headers, "Message-ID": messageId },
			attachments: message.attachments?.map((attachment) => ({
				filename: attachment.filename,
				content: toBase64(attachment.content),
				content_type: attachment.type,
				...(attachment.disposition === "inline" && attachment.contentId ? { content_id: attachment.contentId } : {}),
			})),
		}),
	}).catch((error) => { throw networkFailure("Resend", error); });
	if (!response.ok) throw httpFailure("Resend", response.status, await readErrorDetail(response));
	return { messageId };
}

export async function sendThroughProvider(
	env: CloudflareEnv,
	config: OutboundProviderConfig,
	message: OutboundProviderMessage,
	idempotencyKey?: string,
): Promise<{ messageId: string }> {
	if (config.provider === "resend") return sendWithResend(config.apiKey, message, idempotencyKey);
	if (config.provider === "ses") return sendSesEmail(config.config, message);
	if (config.provider === "brevo") return sendWithBrevo(config, message);
	if (config.provider === "mailjet") return sendWithMailjet(config, message);
	if (config.provider === "smtp") return sendWithSmtp(config.config, message, getSmtpConnect(env));
	const response = await env.EMAIL.send({
		from: message.from,
		to: message.to,
		...(message.cc?.length ? { cc: message.cc } : {}),
		...(message.bcc?.length ? { bcc: message.bcc } : {}),
		subject: message.subject,
		headers: message.headers && Object.keys(message.headers).length ? message.headers : undefined,
		html: message.html,
		text: message.text,
		attachments: message.attachments?.map((attachment) =>
			attachment.disposition === "inline" && attachment.contentId
				? { filename: attachment.filename, type: attachment.type, content: attachment.content, disposition: "inline" as const, contentId: attachment.contentId }
				: { filename: attachment.filename, type: attachment.type, content: attachment.content, disposition: "attachment" as const },
		),
	});
	return { messageId: response.messageId };
}

/**
 * Sends through the domain's provider, then its fallbacks. `build` receives the provider about to
 * be tried so it can shape the message for it (Cloudflare turns big attachments into links).
 * Each provider counts `recipients` against its daily and monthly caps.
 */
export async function sendThroughChain(
	env: CloudflareEnv,
	chain: OutboundProviderConfig[],
	recipients: number,
	build: (config: OutboundProviderConfig) => Promise<OutboundProviderMessage>,
	idempotencyKey?: string,
): Promise<{ messageId: string; provider: OutboundProviderName; attempts: OutboundSendAttempt[] }> {
	return sendWithFallback(chain, {
		async send(config) {
			return sendThroughProvider(env, config, await build(config), idempotencyKey);
		},
		hasRoom: (provider) => hasProviderRoom(env, provider, recipients),
		record: (provider) => recordProviderUsage(env, provider, recipients),
	});
}
