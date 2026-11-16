import { parseEmailAddressParts } from "@/lib/email/address";
import type { OutboundProviderMessage } from "@/lib/email/outbound-provider-types";
import { isInline, toBase64 } from "@/lib/providers/utils";

const encoder = new TextEncoder();

/** Headers this builder writes itself; a caller's copy would produce a duplicate. */
const OWN_HEADERS = new Set(["from", "to", "cc", "bcc", "subject", "date", "message-id", "mime-version", "content-type", "content-transfer-encoding", "return-path"]);

/** An RFC 2047 encoded word keeps a header ASCII; plain ASCII passes through untouched. */
export function encodeHeaderText(value: string): string {
	const single = value.replace(/[\r\n]+/g, " ");
	// eslint-disable-next-line no-control-regex
	if (/^[\x20-\x7e]*$/.test(single)) return single;
	const bytes = encoder.encode(single);
	// 45 bytes of UTF-8 become 60 base64 characters; with the wrapper the encoded word stays under 75.
	const words: string[] = [];
	let start = 0;
	while (start < bytes.length) {
		let end = Math.min(bytes.length, start + 45);
		// Never split a UTF-8 sequence: back up to the start of a character.
		while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
		words.push(`=?UTF-8?B?${toBase64(bytes.slice(start, end).buffer as ArrayBuffer)}?=`);
		start = end;
	}
	return words.join("\r\n ");
}

/** `Name <a@b>` with the display name encoded when needed; a bare address is returned as is. */
export function encodeAddress(value: string): string {
	const { name, address } = parseEmailAddressParts(value);
	if (!name) return address;
	// eslint-disable-next-line no-control-regex
	const plain = /^[\x20-\x7e]*$/.test(name);
	const display = plain ? `"${name.replace(/[\\"]/g, "\\$&")}"` : encodeHeaderText(name);
	return `${display} <${address}>`;
}

function wrap76(base64: string): string {
	return base64.replace(/(.{76})/g, "$1\r\n");
}

function base64Part(content: ArrayBuffer | Uint8Array): string {
	const buffer = content instanceof Uint8Array ? (content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer) : content;
	return wrap76(toBase64(buffer));
}

function textPart(type: "text/plain" | "text/html", body: string): string {
	return `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Part(encoder.encode(body))}`;
}

/** Client-supplied values written into a MIME part header (type, Content-ID) lose CR, LF and other control characters. */
function headerToken(value: string | null | undefined): string {
	return (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function quoteParam(value: string): string {
	return `"${encodeHeaderText(value).replace(/\r\n /g, "").replace(/[\\"]/g, "\\$&")}"`;
}

function multipart(subtype: "mixed" | "alternative" | "related", parts: string[]): string {
	const boundary = `=_mf_${crypto.randomUUID().replaceAll("-", "")}`;
	return `Content-Type: multipart/${subtype}; boundary="${boundary}"\r\n\r\n${parts.map((part) => `--${boundary}\r\n${part}\r\n`).join("")}--${boundary}--`;
}

/**
 * The message as RFC 5322 text, for providers (SMTP) that take a finished message instead of fields.
 * Layout: mixed( related( alternative(text, html), inline images ), attachments ); levels with
 * nothing in them are left out.
 */
export function buildMime(message: OutboundProviderMessage, messageId: string, date: Date = new Date()): string {
	const attachments = message.attachments ?? [];
	const inline = attachments.filter(isInline);
	const files = attachments.filter((attachment) => !isInline(attachment));

	let body: string;
	if (message.html && message.text) body = multipart("alternative", [textPart("text/plain", message.text), textPart("text/html", message.html)]);
	else if (message.html) body = textPart("text/html", message.html);
	else body = textPart("text/plain", message.text ?? "");

	if (inline.length && message.html) {
		body = multipart("related", [
			body,
			...inline.map((file) => `Content-Type: ${headerToken(file.type)}; name=${quoteParam(file.filename)}\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${headerToken(file.contentId.replace(/^<|>$/g, ""))}>\r\nContent-Disposition: inline; filename=${quoteParam(file.filename)}\r\n\r\n${base64Part(file.content)}`),
		]);
	}
	const attached = inline.length && message.html ? files : attachments;
	if (attached.length) {
		body = multipart("mixed", [
			body,
			...attached.map((file) => `Content-Type: ${headerToken(file.type) || "application/octet-stream"}; name=${quoteParam(file.filename)}\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=${quoteParam(file.filename)}\r\n\r\n${base64Part(file.content)}`),
		]);
	}

	const headers = [
		`From: ${encodeAddress(message.from)}`,
		`To: ${message.to.map(encodeAddress).join(", ")}`,
		...(message.cc?.length ? [`Cc: ${message.cc.map(encodeAddress).join(", ")}`] : []),
		`Subject: ${encodeHeaderText(message.subject)}`,
		`Date: ${date.toUTCString().replace("GMT", "+0000")}`,
		`Message-ID: ${messageId}`,
		"MIME-Version: 1.0",
		...Object.entries(message.headers ?? {})
			.filter(([name, value]) => /^[\w-]+$/.test(name) && !OWN_HEADERS.has(name.toLowerCase()) && !/[\r\n]/.test(value))
			.map(([name, value]) => `${name}: ${value}`),
	];
	return `${headers.join("\r\n")}\r\n${body}\r\n`;
}
