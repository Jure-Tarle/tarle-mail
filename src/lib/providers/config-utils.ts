import type { MailjetCredentials, OutboundProviderName, ProviderLimit, SmtpConfig } from "@/lib/email/outbound-provider-types";

export const OUTBOUND_PROVIDERS: OutboundProviderName[] = ["cloudflare", "resend", "ses", "brevo", "mailjet", "smtp"];
/** The providers whose credentials this module stores, as opposed to Resend and SES which have their own settings. */
export const STORED_PROVIDERS = ["brevo", "mailjet", "smtp"] as const;
export type StoredProvider = (typeof STORED_PROVIDERS)[number];

export const MAX_FALLBACKS = OUTBOUND_PROVIDERS.length - 1;

export function isOutboundProvider(value: unknown): value is OutboundProviderName {
	return typeof value === "string" && (OUTBOUND_PROVIDERS as string[]).includes(value);
}

export function isStoredProvider(value: unknown): value is StoredProvider {
	return typeof value === "string" && (STORED_PROVIDERS as readonly string[]).includes(value);
}

export class ProviderConfigError extends Error {}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Checks the credentials a form submitted and returns what is stored: the validation messages are shown to the admin. */
export function parseCredentials(provider: "brevo", input: unknown): { apiKey: string };
export function parseCredentials(provider: "mailjet", input: unknown): MailjetCredentials;
export function parseCredentials(provider: "smtp", input: unknown): SmtpConfig;
export function parseCredentials(provider: StoredProvider, input: unknown): { apiKey: string } | MailjetCredentials | SmtpConfig;
export function parseCredentials(provider: StoredProvider, input: unknown): { apiKey: string } | MailjetCredentials | SmtpConfig {
	const fields = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	if (provider === "brevo") {
		const apiKey = text(fields.apiKey, 500);
		if (!apiKey) throw new ProviderConfigError("Enter the Brevo API key");
		return { apiKey };
	}
	if (provider === "mailjet") {
		const apiKey = text(fields.apiKey, 200);
		const apiSecret = text(fields.apiSecret, 200);
		if (!apiKey || !apiSecret) throw new ProviderConfigError("Enter the Mailjet API key and secret key");
		return { apiKey, apiSecret };
	}
	const host = text(fields.host, 255);
	const port = Number(fields.port);
	if (!host || /[\s/@]/.test(host)) throw new ProviderConfigError("Enter the SMTP server host name");
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ProviderConfigError("Enter a valid SMTP port");
	if (port === 25) throw new ProviderConfigError("Port 25 is not supported. Use 587 (STARTTLS) or 465 (TLS)");
	const security = fields.security === "tls" || fields.security === "starttls" ? fields.security : port === 465 ? "tls" : "starttls";
	const username = text(fields.username, 255);
	// Passwords are kept as typed: surrounding spaces can be part of one.
	const password = typeof fields.password === "string" ? fields.password.slice(0, 500) : "";
	if (username && !password) throw new ProviderConfigError("Enter the SMTP password");
	return { host, port, security, username, password };
}

/** First and last characters only; a short secret is hidden entirely. */
export function maskSecret(secret: string): string {
	return secret.length <= 8 ? "••••" : `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

/** What the settings page shows for stored credentials; it never contains the secret. */
export function summarizeCredentials(provider: StoredProvider, config: { apiKey: string } | MailjetCredentials | SmtpConfig): string {
	if (provider === "smtp") {
		const smtp = config as SmtpConfig;
		return `${smtp.username ? `${smtp.username}@` : ""}${smtp.host}:${smtp.port}`;
	}
	return maskSecret((config as { apiKey: string }).apiKey);
}

export function parseStoredJson<T>(raw: string | null | undefined): T | null {
	if (!raw) return null;
	try { return JSON.parse(raw) as T; } catch { return null; }
}

export function parseFallbackList(raw: string | null | undefined, primary?: string): OutboundProviderName[] {
	const parsed = parseStoredJson<unknown[]>(raw);
	if (!Array.isArray(parsed)) return [];
	return [...new Set(parsed.filter(isOutboundProvider))].filter((provider) => provider !== primary);
}

export type ProviderLimits = Partial<Record<OutboundProviderName, ProviderLimit>>;

const count = (value: unknown): number | null =>
	typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

export function normalizeLimit(value: unknown): ProviderLimit {
	const fields = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
	return { daily: count(fields.daily), monthly: count(fields.monthly) };
}

export function parseLimits(raw: string | null | undefined): ProviderLimits {
	const parsed = parseStoredJson<Record<string, unknown>>(raw) ?? {};
	return Object.fromEntries(Object.entries(parsed).filter(([provider]) => isOutboundProvider(provider)).map(([provider, limit]) => [provider, normalizeLimit(limit)]));
}

/** Recipients still allowed today, or null when the provider has no cap. */
export function remainingQuota(limit: ProviderLimit | undefined, usage: { today: number; month: number }): number | null {
	const rooms = [
		limit?.daily != null ? limit.daily - usage.today : null,
		limit?.monthly != null ? limit.monthly - usage.month : null,
	].filter((room): room is number => room !== null);
	return rooms.length ? Math.max(0, Math.min(...rooms)) : null;
}

export function dayKey(date: Date = new Date()): string {
	return date.toISOString().slice(0, 10);
}
