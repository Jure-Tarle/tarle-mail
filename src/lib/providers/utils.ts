import { getEmailAddress, parseEmailAddressParts } from "@/lib/email/address";
import type { OutboundProviderAttachment, OutboundProviderMessage } from "@/lib/email/outbound-provider-types";

export function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

/** Providers that do not return the RFC 5322 Message-ID get one minted here, so replies can thread against it. */
export function mintMessageId(from: string): string {
	const domain = getEmailAddress(from).split("@")[1] || "tarle-mail.local";
	return `<${crypto.randomUUID()}@${domain}>`;
}

/** Headers a provider sets itself or refuses in its custom-header field. Message-ID is handled by each adapter. */
const STANDARD_HEADERS = new Set([
	"from", "sender", "to", "cc", "bcc", "subject", "reply-to", "date", "mime-version", "content-type", "content-transfer-encoding", "return-path",
]);

export type PersonField = { address: string; name: string | null };

export function toPerson(value: string): PersonField {
	const { address, name } = parseEmailAddressParts(value);
	return { address, name: name ? name.replace(/[\r\n]+/g, " ") : null };
}

export function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
	const wanted = name.toLowerCase();
	return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === wanted)?.[1];
}

/** The custom headers worth forwarding to an API provider (threading, list and auto-reply headers). */
export function customHeaders(headers: Record<string, string> | undefined, extra: string[] = []): Record<string, string> {
	const skipped = new Set([...STANDARD_HEADERS, "message-id", ...extra]);
	return Object.fromEntries(Object.entries(headers ?? {}).filter(([name, value]) => !skipped.has(name.toLowerCase()) && !/[\r\n]/.test(value)));
}

/**
 * Providers that assign their own Message-ID cannot be asked to use ours, so ours is appended to
 * References: a reply to the provider's id still carries it, and threading finds the conversation.
 */
export function referencesWith(headers: Record<string, string> | undefined, messageId: string): string {
	const existing = headerValue(headers, "References")?.trim();
	return existing ? `${existing} ${messageId}` : messageId;
}

export function isInline(attachment: OutboundProviderAttachment): attachment is OutboundProviderAttachment & { contentId: string } {
	return attachment.disposition === "inline" && !!attachment.contentId;
}

export function recipientCount(message: Pick<OutboundProviderMessage, "to" | "cc" | "bcc">): number {
	return Math.max(1, message.to.length + (message.cc?.length ?? 0) + (message.bcc?.length ?? 0));
}
