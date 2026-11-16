import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { httpFailure, networkFailure, ProviderSendError } from "@/lib/providers/errors";
import { customHeaders, headerValue, isInline, mintMessageId, referencesWith, toBase64, toPerson } from "@/lib/providers/utils";

export const MAILJET_API_BASE = "https://api.mailjet.com";

type MailjetConfig = { apiKey: string; apiSecret: string; apiBase?: string };
type MailjetPerson = { Email: string; Name?: string };
type MailjetError = { ErrorMessage?: string; ErrorRelatedTo?: string[] };
type MailjetSendResponse = { Messages?: { Status?: string; Errors?: MailjetError[]; To?: { MessageID?: number }[] }[] };

/**
 * Send API v3.1 refuses these in `Headers` (error send-0011) because they have a property of their
 * own or Mailjet sets them; Message-ID is among them, which is why References carries ours.
 */
const RESERVED_HEADERS = [
	"delivered-to", "list-id", "dkim-signature", "domainkey-status", "received-spf", "authentication-results", "received",
	"user-agent", "x-mailer", "x-feedback-id", "x-csa-complaints", "x-mailjet-prio", "x-mailjet-debug", "x-mailjet-trackopen",
	"x-mailjet-trackclick", "x-mailjet-segmentation", "x-mailjet-campaign", "x-mj-customid", "x-mj-eventpayload", "x-mj-vars",
	"x-mj-templateerrordeliver", "x-mj-templateerrorreporting", "x-mj-templatelanguage", "x-mj-templateid", "x-mj-workflowid",
	"x-mj-mid", "x-mj-errormessage", "x-mj-statisticscontactslistid",
];

const person = (value: string): MailjetPerson => {
	const { address, name } = toPerson(value);
	return name ? { Email: address, Name: name } : { Email: address };
};

const describe = (error: MailjetError | undefined) =>
	error?.ErrorMessage ? `${error.ErrorMessage}${error.ErrorRelatedTo?.length ? ` (${error.ErrorRelatedTo.join(", ")})` : ""}` : undefined;

async function mailjetRequest(config: MailjetConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(`${(config.apiBase || MAILJET_API_BASE).replace(/\/+$/, "")}${path}`, {
			method,
			headers: { Authorization: `Basic ${btoa(`${config.apiKey}:${config.apiSecret}`)}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch (error) {
		throw networkFailure("Mailjet", error);
	}
	if (!response.ok) {
		// Send API v3.1 reports its errors per message; the other endpoints answer with ErrorMessage.
		const parsed = (await response.json().catch(() => null)) as (MailjetSendResponse & MailjetError) | null;
		const detail = describe(parsed?.Messages?.flatMap((message) => message.Errors ?? [])[0]) ?? parsed?.ErrorMessage;
		throw httpFailure("Mailjet", response.status, detail?.slice(0, 300));
	}
	return response;
}

export async function sendWithMailjet(config: MailjetConfig, message: OutboundProviderMessage): Promise<{ messageId: string }> {
	const ownId = mintMessageId(message.from);
	const attachments = message.attachments ?? [];
	const inline = attachments.filter(isInline);
	const files = attachments.filter((attachment) => !isInline(attachment));
	const replyTo = headerValue(message.headers, "Reply-To");
	const response = await mailjetRequest(config, "POST", "/v3.1/send", {
		Messages: [{
			From: person(message.from),
			To: message.to.map(person),
			...(message.cc?.length ? { Cc: message.cc.map(person) } : {}),
			...(message.bcc?.length ? { Bcc: message.bcc.map(person) } : {}),
			...(replyTo ? { ReplyTo: person(replyTo) } : {}),
			Subject: message.subject,
			...(message.text ? { TextPart: message.text } : {}),
			...(message.html ? { HTMLPart: message.html } : {}),
			Headers: { ...customHeaders(message.headers, ["references", ...RESERVED_HEADERS]), References: referencesWith(message.headers, ownId) },
			...(files.length ? { Attachments: files.map((file) => ({ ContentType: file.type, Filename: file.filename, Base64Content: toBase64(file.content) })) } : {}),
			...(inline.length
				? { InlinedAttachments: inline.map((file) => ({ ContentType: file.type, Filename: file.filename, ContentID: file.contentId.replace(/^<|>$/g, ""), Base64Content: toBase64(file.content) })) }
				: {}),
		}],
	});
	const result = ((await response.json().catch(() => null)) as MailjetSendResponse | null)?.Messages?.[0];
	if (result?.Status !== "success") throw new ProviderSendError(`Mailjet: ${describe(result?.Errors?.[0]) ?? "send failed"}`, false);
	// Mailjet's own Message-ID is not in the response, so replies thread through ours in References.
	return { messageId: ownId };
}

export async function checkMailjet(config: MailjetConfig): Promise<{ account: string | null }> {
	const response = await mailjetRequest(config, "GET", "/v3/REST/myprofile");
	const profile = ((await response.json().catch(() => null)) as { Data?: { CompanyName?: string; Email?: string }[] } | null)?.Data?.[0];
	return { account: profile?.CompanyName || profile?.Email || null };
}
