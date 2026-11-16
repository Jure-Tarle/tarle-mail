import type { OutboundProviderAttachment, OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { httpFailure, networkFailure, readErrorDetail } from "@/lib/providers/errors";
import { customHeaders, headerValue, isInline, mintMessageId, referencesWith, toBase64, toPerson } from "@/lib/providers/utils";

export const BREVO_API_BASE = "https://api.brevo.com/v3";

type BrevoConfig = { apiKey: string; apiBase?: string };
type BrevoPerson = { email: string; name?: string };

const person = (value: string): BrevoPerson => {
	const { address, name } = toPerson(value);
	return name ? { email: address, name } : { email: address };
};

async function brevoRequest(config: BrevoConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(`${(config.apiBase || BREVO_API_BASE).replace(/\/+$/, "")}${path}`, {
			method,
			headers: { "api-key": config.apiKey, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch (error) {
		throw networkFailure("Brevo", error);
	}
	if (!response.ok) throw httpFailure("Brevo", response.status, await readErrorDetail(response));
	return response;
}

/**
 * Brevo's v3 API has no Content-ID field, so an inline image the HTML points at with `cid:` is
 * embedded as a data URI instead; inline parts nothing points at are sent as ordinary attachments.
 */
function embedInlineImages(html: string | undefined, attachments: OutboundProviderAttachment[]): { html: string | undefined; files: OutboundProviderAttachment[] } {
	let result = html;
	const files: OutboundProviderAttachment[] = [];
	for (const attachment of attachments) {
		const cid = isInline(attachment) ? attachment.contentId.replace(/^<|>$/g, "") : null;
		if (cid && result?.includes(`cid:${cid}`)) {
			result = result.split(`cid:${cid}`).join(`data:${attachment.type};base64,${toBase64(attachment.content)}`);
		} else {
			files.push(attachment);
		}
	}
	return { html: result, files };
}

export async function sendWithBrevo(config: BrevoConfig, message: OutboundProviderMessage): Promise<{ messageId: string }> {
	const ownId = mintMessageId(message.from);
	const { html, files } = embedInlineImages(message.html, message.attachments ?? []);
	const replyTo = headerValue(message.headers, "Reply-To");
	const response = await brevoRequest(config, "POST", "/smtp/email", {
		sender: person(message.from),
		to: message.to.map(person),
		...(message.cc?.length ? { cc: message.cc.map(person) } : {}),
		...(message.bcc?.length ? { bcc: message.bcc.map(person) } : {}),
		...(replyTo ? { replyTo: person(replyTo) } : {}),
		subject: message.subject,
		...(html ? { htmlContent: html } : {}),
		// Brevo needs some content; a space stands in for a message with no text and no HTML.
		...(message.text || !html ? { textContent: message.text || " " } : {}),
		headers: { ...customHeaders(message.headers, ["references"]), References: referencesWith(message.headers, ownId) },
		...(files.length ? { attachment: files.map((file) => ({ name: file.filename, content: toBase64(file.content) })) } : {}),
	});
	const body = (await response.json().catch(() => null)) as { messageId?: string } | null;
	const assigned = body?.messageId?.trim();
	return { messageId: assigned ? (assigned.startsWith("<") ? assigned : `<${assigned}>`) : ownId };
}

/** A cheap authenticated call; the account's company name or email identifies the key. */
export async function checkBrevo(config: BrevoConfig): Promise<{ account: string | null }> {
	const response = await brevoRequest(config, "GET", "/account");
	const account = (await response.json().catch(() => null)) as { companyName?: string; email?: string } | null;
	return { account: account?.companyName || account?.email || null };
}
