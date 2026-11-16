import type { AwsConfig } from "@/lib/aws/aws-types";

export type SendingProvider = "none" | "cloudflare" | "resend" | "ses" | "brevo" | "mailjet" | "smtp";

/** The providers that can send mail, which is every provider except "none". */
export type OutboundProviderName = Exclude<SendingProvider, "none">;

export type SmtpSecurity = "tls" | "starttls";

export type SmtpConfig = {
	host: string;
	/** 465 (implicit TLS) or 587 (STARTTLS); port 25 is refused. */
	port: number;
	security: SmtpSecurity;
	username: string;
	password: string;
};

export type MailjetCredentials = { apiKey: string; apiSecret: string };

export type OutboundProviderConfig =
	| { provider: "cloudflare" }
	| { provider: "resend"; apiKey: string }
	| { provider: "ses"; config: AwsConfig }
	| { provider: "brevo"; apiKey: string; /** Replaces the Brevo API origin (tests, proxies). */ apiBase?: string }
	| { provider: "mailjet"; apiKey: string; apiSecret: string; apiBase?: string }
	| { provider: "smtp"; config: SmtpConfig };

export type OutboundProviderAttachment = {
	filename: string;
	type: string;
	content: ArrayBuffer;
	disposition: "attachment" | "inline";
	contentId?: string | null;
};

export type OutboundProviderMessage = {
	from: string;
	to: string[];
	cc?: string[];
	bcc?: string[];
	subject: string;
	html?: string;
	text?: string;
	headers?: Record<string, string>;
	attachments?: OutboundProviderAttachment[];
};

export type ResendKeyStatus = {
	configured: boolean;
	/** Where the key in use comes from; the key itself never leaves the server. */
	source: "settings" | "environment" | null;
};

/** A daily and/or monthly cap on the recipients one provider may send to; null means no cap. */
export type ProviderLimit = { daily: number | null; monthly: number | null };

export type ProviderUsage = { today: number; month: number };

/** What the settings page may see about a provider: never a secret. */
export type ProviderCredentialStatus = {
	provider: OutboundProviderName;
	configured: boolean;
	/** Masked identifiers (for example `xkey••••1234`, or `user@host:587`). */
	summary: string | null;
	limit: ProviderLimit;
	usage: ProviderUsage;
};

/** One provider's try in a send, kept in the job record so an operator can see why a fallback happened. */
export type OutboundSendAttempt = { provider: OutboundProviderName; outcome: "sent" | "failed" | "skipped"; detail?: string };
