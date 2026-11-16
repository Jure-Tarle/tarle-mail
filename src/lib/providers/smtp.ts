import { getEmailAddress } from "@/lib/email/address";
import type { OutboundProviderMessage, SmtpConfig } from "@/lib/email/outbound-provider-types";
import { ProviderSendError } from "@/lib/providers/errors";
import { buildMime } from "@/lib/providers/mime";
import type { SmtpConnect, SmtpSocket } from "@/lib/providers/smtp-socket";
import { headerValue, mintMessageId } from "@/lib/providers/utils";

const TIMEOUT_MS = 20_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Reply = { code: number; text: string };

/** Line-oriented reader and writer over a socket's streams. */
class SmtpIo {
	private buffer = "";
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private writer: WritableStreamDefaultWriter<Uint8Array>;

	constructor(socket: SmtpSocket) {
		this.reader = socket.readable.getReader();
		this.writer = socket.writable.getWriter();
	}

	release(): void {
		this.reader.releaseLock();
		this.writer.releaseLock();
	}

	private async readLine(): Promise<string> {
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline >= 0) {
				const line = this.buffer.slice(0, newline).replace(/\r$/, "");
				this.buffer = this.buffer.slice(newline + 1);
				return line;
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new ProviderSendError("SMTP: the server timed out", true)), TIMEOUT_MS);
			});
			const { value, done } = await Promise.race([this.reader.read(), timeout]).finally(() => clearTimeout(timer));
			if (done) throw new ProviderSendError("SMTP: the server closed the connection", true);
			this.buffer += decoder.decode(value, { stream: true });
		}
	}

	/** One reply, which may span several `250-` lines. */
	async reply(): Promise<Reply> {
		const lines: string[] = [];
		for (;;) {
			const line = await this.readLine();
			lines.push(line);
			if (line.length < 4 || line[3] !== "-") return { code: parseInt(line.slice(0, 3), 10), text: lines.map((entry) => entry.slice(4)).join("\n") };
		}
	}

	async write(data: string): Promise<void> {
		await this.writer.write(encoder.encode(data));
	}

	/** `label` replaces the line in error messages; pass one whenever the line carries a credential. */
	async command(line: string, expect: number[], label?: string): Promise<Reply> {
		await this.write(`${line}\r\n`);
		return this.expect(await this.reply(), expect, label ?? line);
	}

	expect(reply: Reply, expect: number[], what: string): Reply {
		if (expect.includes(reply.code)) return reply;
		// 4xx is a transient refusal another provider may not share; 5xx is permanent (bad recipient, bad credentials).
		throw new ProviderSendError(`SMTP ${what}: ${reply.code} ${reply.text}`.slice(0, 300), reply.code >= 400 && reply.code < 500, reply.code);
	}
}

const base64Text = (value: string) => btoa(String.fromCharCode(...encoder.encode(value)));

/** Lines that start with a dot get a second one (RFC 5321 section 4.5.2). */
export function dotStuff(raw: string): string {
	// A lone CR counts as a line break too, so "\r.\r\n" cannot end DATA early on a lenient server (SMTP smuggling).
	return raw.replace(/\r\n|\r|\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
}

/** Port 25 is blocked on Workers and unauthenticated relaying belongs to an MTA, so only submission ports are used. */
export function assertSubmissionPort(config: Pick<SmtpConfig, "port">): void {
	if (config.port === 25) throw new ProviderSendError("SMTP: port 25 is not supported. Use 587 (STARTTLS) or 465 (TLS).", false);
}

/** Connects, upgrades to TLS and authenticates, then hands the session to `work`. */
async function smtpSession<T>(config: SmtpConfig, connect: SmtpConnect, heloName: string, work: (io: SmtpIo) => Promise<T>): Promise<T> {
	assertSubmissionPort(config);
	let socket: SmtpSocket;
	try {
		socket = await connect({ hostname: config.host, port: config.port, secure: config.security === "tls" });
	} catch (error) {
		throw new ProviderSendError(`SMTP: ${error instanceof Error ? error.message : "could not connect"}`, true);
	}
	let io = new SmtpIo(socket);
	try {
		const greeting = await io.reply();
		io.expect(greeting, [220], "greeting");
		let ehlo = await io.command(`EHLO ${heloName}`, [250]);
		if (config.security === "starttls") {
			if (!/^STARTTLS\s*$/im.test(ehlo.text)) throw new ProviderSendError("SMTP: the server does not offer STARTTLS on this port", false);
			await io.command("STARTTLS", [220]);
			io.release();
			socket = socket.startTls();
			io = new SmtpIo(socket);
			ehlo = await io.command(`EHLO ${heloName}`, [250]);
		}
		if (config.username) {
			const methods = (/^AUTH[ =](.*)$/im.exec(ehlo.text)?.[1] ?? "").toUpperCase();
			if (methods.includes("PLAIN") || !methods.includes("LOGIN")) {
				await io.command(`AUTH PLAIN ${base64Text(`\0${config.username}\0${config.password}`)}`, [235], "AUTH PLAIN ...");
			} else {
				await io.command("AUTH LOGIN", [334]);
				await io.command(base64Text(config.username), [334], "AUTH LOGIN username");
				await io.command(base64Text(config.password), [235], "AUTH LOGIN password");
			}
		}
		const result = await work(io);
		await io.command("QUIT", [221]).catch(() => undefined);
		return result;
	} catch (error) {
		// A reset, TLS failure or aborted stream is a network error, not a rejection by the server.
		throw error instanceof ProviderSendError ? error : new ProviderSendError(`SMTP: ${error instanceof Error ? error.message : "connection failed"}`, true);
	} finally {
		await socket.close().catch(() => undefined);
	}
}

/** Addresses go into command lines: whitespace, control characters or angle brackets would let the rest run as commands. */
const SAFE_ADDRESS = /^[^\s\p{Cc}<>]+@[^\s\p{Cc}<>]+$/u;

export async function sendWithSmtp(config: SmtpConfig, message: OutboundProviderMessage, connect: SmtpConnect): Promise<{ messageId: string }> {
	const sender = getEmailAddress(message.from);
	const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map(getEmailAddress);
	if ([sender, ...recipients].some((address) => !SAFE_ADDRESS.test(address))) {
		throw new ProviderSendError("SMTP: an address contains characters SMTP cannot carry", false);
	}
	const messageId = headerValue(message.headers, "Message-ID") ?? mintMessageId(message.from);
	const raw = dotStuff(buildMime(message, messageId));
	await smtpSession(config, connect, sender.split("@")[1], async (io) => {
		await io.command(`MAIL FROM:<${sender}>`, [250]);
		for (const recipient of recipients) await io.command(`RCPT TO:<${recipient}>`, [250, 251]);
		await io.command("DATA", [354]);
		await io.write(raw.endsWith("\r\n") ? `${raw}.\r\n` : `${raw}\r\n.\r\n`);
		io.expect(await io.reply(), [250], "DATA");
	});
	return { messageId };
}

/** Connects, upgrades and authenticates without sending anything, to prove the settings work. */
export async function checkSmtp(config: SmtpConfig, connect: SmtpConnect): Promise<{ account: string }> {
	await smtpSession(config, connect, "localhost", async () => undefined);
	return { account: `${config.username || "anonymous"}@${config.host}:${config.port}` };
}
