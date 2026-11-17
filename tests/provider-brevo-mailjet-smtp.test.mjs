import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, afterEach } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "tarle-mail-providers-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

async function bundle(entry, outfile) {
	await build({
		entryPoints: [join(root, entry)],
		outfile: join(outDir, outfile),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "silent",
		alias: { "@": join(root, "src") },
	});
	return import(pathToFileURL(join(outDir, outfile)).href);
}

const brevo = await bundle("src/lib/providers/brevo.ts", "brevo.mjs");
const mailjet = await bundle("src/lib/providers/mailjet.ts", "mailjet.mjs");
const smtp = await bundle("src/lib/providers/smtp.ts", "smtp.mjs");
const mime = await bundle("src/lib/providers/mime.ts", "mime.mjs");
const fallback = await bundle("src/lib/providers/fallback.ts", "fallback.mjs");
const utils = await bundle("src/lib/providers/config-utils.ts", "config-utils.mjs");
const errors = await bundle("src/lib/providers/errors.ts", "errors.mjs");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Replaces fetch with a recorder that answers each call with the next canned response. */
function mockFetch(...responses) {
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), method: init?.method, headers: init?.headers, body: init?.body ? JSON.parse(init.body) : undefined });
		const next = responses.shift();
		if (next instanceof Error) throw next;
		return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200, headers: { "Content-Type": "application/json" } });
	};
	return calls;
}

const bytes = (text) => new TextEncoder().encode(text).buffer;
const message = {
	from: '"Tarle Mail" <hello@example.com>',
	to: ["ann@example.net", '"Bob B" <bob@example.net>'],
	cc: ["cc@example.net"],
	bcc: ["bcc@example.net"],
	subject: "Hello",
	html: '<p>Hi <img src="cid:logo123"></p>',
	text: "Hi",
	headers: { "In-Reply-To": "<parent@example.net>", References: "<root@example.net> <parent@example.net>", "Message-ID": "<ignored@example.com>", "Reply-To": "support@example.com", "Auto-Submitted": "auto-generated" },
	attachments: [
		{ filename: "a.txt", type: "text/plain", content: bytes("file body"), disposition: "attachment" },
		{ filename: "logo.png", type: "image/png", content: bytes("PNG"), disposition: "inline", contentId: "logo123" },
	],
};

test("Brevo sends the v3 payload to the overridden base with the api-key header", async () => {
	const calls = mockFetch({ status: 201, body: { messageId: "<202611160000.1@smtp-relay.brevo.com>" } });
	const result = await brevo.sendWithBrevo({ apiKey: "xkeysib-secret", apiBase: "http://127.0.0.1:9/v3/" }, message);
	assert.equal(result.messageId, "<202611160000.1@smtp-relay.brevo.com>");
	const [call] = calls;
	assert.equal(call.url, "http://127.0.0.1:9/v3/smtp/email");
	assert.equal(call.headers["api-key"], "xkeysib-secret");
	assert.deepEqual(call.body.sender, { email: "hello@example.com", name: "Tarle Mail" });
	assert.deepEqual(call.body.to, [{ email: "ann@example.net" }, { email: "bob@example.net", name: "Bob B" }]);
	assert.deepEqual(call.body.cc, [{ email: "cc@example.net" }]);
	assert.deepEqual(call.body.bcc, [{ email: "bcc@example.net" }]);
	assert.deepEqual(call.body.replyTo, { email: "support@example.com" });
	assert.equal(call.body.subject, "Hello");
	assert.equal(call.body.textContent, "Hi");
	// Brevo has no Content-ID field: the referenced inline image becomes a data URI and is not attached again.
	assert.ok(call.body.htmlContent.includes("data:image/png;base64,UE5H"));
	assert.ok(!call.body.htmlContent.includes("cid:logo123"));
	assert.deepEqual(call.body.attachment, [{ name: "a.txt", content: Buffer.from("file body").toString("base64") }]);
	// Standard headers are not custom headers; our id joins References so replies to Brevo's id still thread.
	assert.equal(call.body.headers["In-Reply-To"], "<parent@example.net>");
	assert.equal(call.body.headers["Auto-Submitted"], "auto-generated");
	assert.equal(call.body.headers["Message-ID"], undefined);
	assert.equal(call.body.headers["Reply-To"], undefined);
	assert.match(call.body.headers.References, /^<root@example\.net> <parent@example\.net> <[0-9a-f-]+@example\.com>$/);
});

test("Brevo falls back to a minted Message-ID when the response carries none", async () => {
	mockFetch({ status: 201, body: {} });
	const result = await brevo.sendWithBrevo({ apiKey: "k" }, { from: "a@example.com", to: ["b@example.net"], subject: "s", text: "t" });
	assert.match(result.messageId, /^<[0-9a-f-]+@example\.com>$/);
});

test("Brevo errors: 4xx is a rejection, 429, 5xx and network failures are fallback candidates", async () => {
	const cases = [
		[{ status: 400, body: { code: "invalid_parameter", message: "Invalid sender" } }, false, 400, /Invalid sender/],
		[{ status: 401, body: { message: "Key not found" } }, false, 401, /Key not found/],
		[{ status: 429, body: { message: "Too many requests" } }, true, 429, /Too many/],
		[{ status: 503, body: {} }, true, 503, /request failed \(503\)/],
	];
	for (const [response, expectFallback, status, pattern] of cases) {
		mockFetch(response);
		const error = await brevo.sendWithBrevo({ apiKey: "k" }, message).catch((failure) => failure);
		assert.equal(error.fallback, expectFallback, `status ${status}`);
		assert.equal(error.status, status);
		assert.match(error.message, pattern);
	}
	mockFetch(new TypeError("fetch failed"));
	const network = await brevo.sendWithBrevo({ apiKey: "k" }, message).catch((failure) => failure);
	assert.equal(network.fallback, true);
	assert.equal(errors.shouldFallBack(network), true);
});

test("Brevo connection check reads the account", async () => {
	const calls = mockFetch({ body: { companyName: "Acme" } });
	assert.deepEqual(await brevo.checkBrevo({ apiKey: "k", apiBase: "http://127.0.0.1:9/v3" }), { account: "Acme" });
	assert.equal(calls[0].url, "http://127.0.0.1:9/v3/account");
	assert.equal(calls[0].method, "GET");
});

test("Mailjet sends Send API v3.1 with basic auth, inline images and only allowed headers", async () => {
	const calls = mockFetch({ body: { Messages: [{ Status: "success", To: [{ MessageID: 1 }] }] } });
	const result = await mailjet.sendWithMailjet({ apiKey: "pub", apiSecret: "priv", apiBase: "http://127.0.0.1:9" }, message);
	const [call] = calls;
	assert.equal(call.url, "http://127.0.0.1:9/v3.1/send");
	assert.equal(call.headers.Authorization, `Basic ${Buffer.from("pub:priv").toString("base64")}`);
	const sent = call.body.Messages[0];
	assert.deepEqual(sent.From, { Email: "hello@example.com", Name: "Tarle Mail" });
	assert.deepEqual(sent.To, [{ Email: "ann@example.net" }, { Email: "bob@example.net", Name: "Bob B" }]);
	assert.deepEqual(sent.Cc, [{ Email: "cc@example.net" }]);
	assert.deepEqual(sent.Bcc, [{ Email: "bcc@example.net" }]);
	assert.deepEqual(sent.ReplyTo, { Email: "support@example.com" });
	assert.equal(sent.TextPart, "Hi");
	assert.equal(sent.HTMLPart, message.html);
	assert.deepEqual(sent.Attachments, [{ ContentType: "text/plain", Filename: "a.txt", Base64Content: Buffer.from("file body").toString("base64") }]);
	assert.deepEqual(sent.InlinedAttachments, [{ ContentType: "image/png", Filename: "logo.png", ContentID: "logo123", Base64Content: "UE5H" }]);
	assert.equal(sent.Headers["Message-ID"], undefined);
	assert.equal(sent.Headers["Auto-Submitted"], "auto-generated");
	assert.match(sent.Headers.References, /<parent@example\.net> <[0-9a-f-]+@example\.com>$/);
	// Mailjet keeps its own Message-ID, so the id we return is the one in References.
	assert.ok(sent.Headers.References.endsWith(result.messageId));
});

test("Mailjet reports per-message errors and classifies them", async () => {
	mockFetch({ status: 400, body: { Messages: [{ Status: "error", Errors: [{ ErrorMessage: "Header cannot be customized", ErrorRelatedTo: ['Headers["Message-ID"]'] }] }] } });
	const rejected = await mailjet.sendWithMailjet({ apiKey: "a", apiSecret: "b" }, message).catch((failure) => failure);
	assert.equal(rejected.fallback, false);
	assert.match(rejected.message, /Header cannot be customized.*Message-ID/);

	mockFetch({ status: 429, body: { ErrorMessage: "Too many requests" } });
	const limited = await mailjet.sendWithMailjet({ apiKey: "a", apiSecret: "b" }, message).catch((failure) => failure);
	assert.equal(limited.fallback, true);

	mockFetch({ status: 200, body: { Messages: [{ Status: "error", Errors: [{ ErrorMessage: "Bad address" }] }] } });
	const soft = await mailjet.sendWithMailjet({ apiKey: "a", apiSecret: "b" }, message).catch((failure) => failure);
	assert.equal(soft.fallback, false);
	assert.match(soft.message, /Bad address/);
});

test("MIME builder nests alternative, related and mixed and encodes non-ASCII headers", () => {
	const raw = mime.buildMime({ ...message, subject: "Grüße", from: '"Jürgen" <j@example.com>' }, "<id@example.com>", new Date("2026-11-16T10:00:00Z"));
	assert.match(raw, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <j@example\.com>\r\n/);
	assert.match(raw, /\r\nSubject: =\?UTF-8\?B\?R3LDvMOfZQ==\?=\r\n/);
	assert.match(raw, /\r\nDate: Mon, 16 Nov 2026 10:00:00 \+0000\r\n/);
	assert.match(raw, /\r\nMessage-ID: <id@example\.com>\r\n/);
	assert.ok(raw.indexOf("multipart/mixed") < raw.indexOf("multipart/related"));
	assert.ok(raw.indexOf("multipart/related") < raw.indexOf("multipart/alternative"));
	assert.match(raw, /Content-ID: <logo123>\r\nContent-Disposition: inline; filename="logo\.png"/);
	assert.match(raw, /Content-Disposition: attachment; filename="a\.txt"/);
	assert.match(raw, /\r\nCc: cc@example\.net\r\n/);
	assert.ok(!/bcc@example\.net/i.test(raw), "Bcc never appears in the headers");
	assert.ok(!raw.includes("ignored@example.com"), "a caller Message-ID header is not duplicated");
	assert.match(raw, /\r\nIn-Reply-To: <parent@example\.net>\r\n/);
});

test("MIME builder drops header lines that would inject another header", () => {
	const raw = mime.buildMime({ from: "a@example.com", to: ["b@example.net"], subject: "Hi\r\nBcc: evil@example.net", text: "x", headers: { "X-Test": "a\r\nBcc: evil@example.net", "X-Ok": "fine" } }, "<id@example.com>");
	assert.ok(!/\r\nBcc:/i.test(raw));
	assert.match(raw, /\r\nX-Ok: fine\r\n/);
	assert.ok(!raw.includes("X-Test"));
});

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * A scripted SMTP server behind the same stream interface the Workers socket has. Every client
 * line is logged; `replies` maps a command prefix to the reply that replaces the default.
 */
function fakeSmtpServer({ replies = {}, ehlo = ["250-fake.example", "250-STARTTLS", "250-AUTH PLAIN LOGIN", "250 8BITMIME"] } = {}) {
	const log = [];
	const connections = [];
	const state = { dataLines: null, authStep: null };

	function makeSocket(secure, upgraded = false) {
		let controller;
		const readable = new ReadableStream({ start(c) { controller = c; } });
		const send = (text) => controller.enqueue(encoder.encode(text));
		let buffer = "";
		const handle = (line) => {
			if (state.dataLines) {
				if (line === ".") {
					log.push(`DATA(${state.dataLines.length} lines)`);
					const body = state.dataLines.join("\r\n");
					state.dataLines = null;
					state.body = body;
					send(replies.DATAEND ?? "250 queued as ABC123\r\n");
				} else state.dataLines.push(line);
				return;
			}
			if (state.authStep) {
				log.push(`${state.authStep}:<redacted>`);
				if (state.authStep === "user") { state.authStep = "pass"; send("334 UGFzc3dvcmQ6\r\n"); } else { state.authStep = null; send(replies.AUTH_LOGIN_PASSWORD ?? "235 ok\r\n"); }
				return;
			}
			log.push(line);
			const command = line.split(" ")[0].toUpperCase();
			const override = Object.entries(replies).find(([prefix]) => line.toUpperCase().startsWith(prefix));
			if (override) { send(override[1]); return; }
			if (command === "EHLO") send(`${ehlo.join("\r\n")}\r\n`);
			else if (command === "STARTTLS") send("220 go ahead\r\n");
			else if (line.toUpperCase().startsWith("AUTH LOGIN")) { state.authStep = "user"; send("334 VXNlcm5hbWU6\r\n"); }
			else if (line.toUpperCase().startsWith("AUTH PLAIN")) send("235 ok\r\n");
			else if (command === "DATA") { state.dataLines = []; send("354 go\r\n"); }
			else if (command === "QUIT") send("221 bye\r\n");
			else send("250 ok\r\n");
		};
		const writable = new WritableStream({
			write(chunk) {
				buffer += decoder.decode(chunk);
				let newline;
				while ((newline = buffer.indexOf("\r\n")) >= 0) {
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 2);
					handle(line);
				}
			},
		});
		const socket = {
			readable,
			writable,
			secure,
			closed: false,
			startTls() { log.push("<TLS upgrade>"); return makeSocket(true, true); },
			async close() { socket.closed = true; },
		};
		connections.push(socket);
		if (!upgraded) controller.enqueue(encoder.encode(replies.GREETING ?? "220 fake ESMTP ready\r\n"));
		return socket;
	}

	const targets = [];
	return {
		log,
		connections,
		state,
		targets,
		connect: async (target) => { targets.push(target); return makeSocket(target.secure); },
	};
}

const smtpConfig = { host: "smtp.example.net", port: 587, security: "starttls", username: "user", password: "pa ss" };
const smtpMessage = { from: '"Tarle Mail" <hello@example.com>', to: ["ann@example.net"], cc: ["cc@example.net"], bcc: ["bcc@example.net"], subject: "Dot test", text: ".leading dot\nsecond line", headers: { "Message-ID": "<fixed@example.com>" } };

test("SMTP runs the STARTTLS dialog, authenticates with PLAIN and stuffs leading dots", async () => {
	const server = fakeSmtpServer();
	const result = await smtp.sendWithSmtp(smtpConfig, smtpMessage, server.connect);
	assert.equal(result.messageId, "<fixed@example.com>");
	assert.deepEqual(server.targets, [{ hostname: "smtp.example.net", port: 587, secure: false }]);
	assert.deepEqual(server.log.slice(0, 5), ["EHLO example.com", "STARTTLS", "<TLS upgrade>", "EHLO example.com", `AUTH PLAIN ${Buffer.from("\0user\0pa ss").toString("base64")}`]);
	assert.deepEqual(server.log.slice(5, 9), ["MAIL FROM:<hello@example.com>", "RCPT TO:<ann@example.net>", "RCPT TO:<cc@example.net>", "RCPT TO:<bcc@example.net>"]);
	assert.equal(server.log[9], "DATA");
	assert.equal(server.log.at(-1), "QUIT");
	assert.ok(server.connections.at(-1).closed, "the upgraded socket is closed");
	// The body holds the message without Bcc; the dot-stuffing keeps the message intact for the server.
	assert.match(server.state.body, /^From: "Tarle Mail" <hello@example\.com>\r\nTo: ann@example\.net\r\nCc: cc@example\.net\r\n/);
	assert.ok(!/bcc@example\.net/.test(server.state.body));
	assert.match(server.state.body, /Message-ID: <fixed@example\.com>/);
});

test("SMTP over implicit TLS skips STARTTLS and falls back to AUTH LOGIN when PLAIN is not offered", async () => {
	const server = fakeSmtpServer({ ehlo: ["250-fake.example", "250 AUTH LOGIN"] });
	await smtp.sendWithSmtp({ ...smtpConfig, port: 465, security: "tls" }, smtpMessage, server.connect);
	assert.deepEqual(server.targets, [{ hostname: "smtp.example.net", port: 465, secure: true }]);
	assert.ok(!server.log.includes("STARTTLS"));
	assert.deepEqual(server.log.slice(0, 4), ["EHLO example.com", "AUTH LOGIN", "user:<redacted>", "pass:<redacted>"]);
});

test("SMTP dot-stuffing doubles a leading dot and normalises line endings", () => {
	assert.equal(smtp.dotStuff("a\n.b\r\n..c"), "a\r\n..b\r\n...c");
});

test("SMTP dot-stuffing treats a lone CR as a line break, so a smuggled end-of-data is stuffed", () => {
	assert.equal(smtp.dotStuff("a\r.\r\nMAIL FROM:<x@y>"), "a\r\n..\r\nMAIL FROM:<x@y>");
});

test("a rejected AUTH LOGIN never puts the encoded username or password into the error", async () => {
	const server = fakeSmtpServer({ ehlo: ["250-fake.example", "250 AUTH LOGIN"], replies: { AUTH_LOGIN_PASSWORD: "535 bad credentials\r\n" } });
	const failure = await smtp.checkSmtp({ ...smtpConfig, port: 465, security: "tls" }, server.connect).catch((error) => error);
	assert.ok(failure instanceof Error);
	assert.match(failure.message, /AUTH LOGIN password: 535/);
	for (const secret of [smtpConfig.password, smtpConfig.username]) {
		assert.ok(!failure.message.includes(Buffer.from(secret).toString("base64")), "no base64 credential in the error");
	}
});

test("MIME part headers drop CR and LF from a client-supplied attachment type and Content-ID", () => {
	const raw = mime.buildMime({ from: "a@example.com", to: ["b@example.net"], subject: "Hi", text: "x", html: "<img src=cid:x>", attachments: [
		{ filename: "a.txt", type: "text/plain\r\nX-Injected: 1", content: new Uint8Array([65]), disposition: "attachment" },
		{ filename: "i.png", type: "image/png", content: new Uint8Array([1]), disposition: "inline", contentId: "x\r\nX-Injected: 2" },
	] }, "<id@example.com>");
	assert.ok(!/\r\nX-Injected:/.test(raw));
});

test("SMTP refuses port 25 and unsafe addresses before connecting", async () => {
	const server = fakeSmtpServer();
	const port = await smtp.sendWithSmtp({ ...smtpConfig, port: 25 }, smtpMessage, server.connect).catch((failure) => failure);
	assert.match(port.message, /port 25/);
	assert.equal(port.fallback, false);
	const unsafe = await smtp.sendWithSmtp(smtpConfig, { ...smtpMessage, to: ["x@example.net>\r\nRCPT TO:<evil@example.net"] }, server.connect).catch((failure) => failure);
	assert.match(unsafe.message, /cannot carry/);
	assert.equal(server.targets.length, 0);
});

test("SMTP classifies replies: 4xx and dropped connections fall back, 5xx and a missing STARTTLS do not", async () => {
	const transient = await smtp.sendWithSmtp(smtpConfig, smtpMessage, fakeSmtpServer({ replies: { "RCPT TO:<ANN": "451 try again later\r\n" } }).connect).catch((failure) => failure);
	assert.equal(transient.fallback, true);
	assert.equal(transient.status, 451);
	assert.match(transient.message, /RCPT TO/);

	const permanent = await smtp.sendWithSmtp(smtpConfig, smtpMessage, fakeSmtpServer({ replies: { "RCPT TO:<ANN": "550 no such user\r\n" } }).connect).catch((failure) => failure);
	assert.equal(permanent.fallback, false);
	assert.equal(permanent.status, 550);

	const badLogin = await smtp.sendWithSmtp(smtpConfig, smtpMessage, fakeSmtpServer({ replies: { "AUTH PLAIN": "535 bad credentials\r\n" } }).connect).catch((failure) => failure);
	assert.equal(badLogin.fallback, false);
	assert.ok(!badLogin.message.includes("pa ss") && !badLogin.message.includes(Buffer.from("\0user\0pa ss").toString("base64")), "the password is never echoed");

	const noTls = await smtp.sendWithSmtp(smtpConfig, smtpMessage, fakeSmtpServer({ ehlo: ["250 fake.example"] }).connect).catch((failure) => failure);
	assert.match(noTls.message, /does not offer STARTTLS/);
	assert.equal(noTls.fallback, false);

	const refused = await smtp.sendWithSmtp(smtpConfig, smtpMessage, async () => { throw new Error("connection refused"); }).catch((failure) => failure);
	assert.equal(refused.fallback, true);

	const greeting = await smtp.sendWithSmtp(smtpConfig, smtpMessage, fakeSmtpServer({ replies: { GREETING: "421 busy\r\n" } }).connect).catch((failure) => failure);
	assert.equal(greeting.fallback, true);
});

test("SMTP connection check authenticates without sending", async () => {
	const server = fakeSmtpServer();
	const result = await smtp.checkSmtp(smtpConfig, server.connect);
	assert.deepEqual(result, { account: "user@smtp.example.net:587" });
	assert.ok(!server.log.some((line) => line.startsWith("MAIL FROM")));
});

const names = (chain) => chain.map((config) => config.provider);

function fallbackDeps({ failures = {}, noRoom = [] } = {}) {
	const sentThrough = [];
	const recorded = [];
	return {
		sentThrough,
		recorded,
		deps: {
			async send(config) {
				const failure = failures[config.provider];
				if (failure) throw failure;
				sentThrough.push(config.provider);
				return { messageId: `<${config.provider}@example.com>` };
			},
			async hasRoom(provider) { return !noRoom.includes(provider); },
			async record(provider) { recorded.push(provider); },
		},
	};
}

const brevoConfig = { provider: "brevo", apiKey: "k" };
const mailjetConfig = { provider: "mailjet", apiKey: "a", apiSecret: "b" };
const smtpChainConfig = { provider: "smtp", config: smtpConfig };

test("the first provider with room sends and is the one recorded", async () => {
	const { deps, sentThrough, recorded } = fallbackDeps();
	const result = await fallback.sendWithFallback([brevoConfig, mailjetConfig], deps);
	assert.equal(result.provider, "brevo");
	assert.equal(result.messageId, "<brevo@example.com>");
	assert.deepEqual(sentThrough, ["brevo"]);
	assert.deepEqual(recorded, ["brevo"]);
});

test("a provider over its quota is skipped, in chain order", async () => {
	const { deps, sentThrough, recorded } = fallbackDeps({ noRoom: ["brevo"] });
	const result = await fallback.sendWithFallback([brevoConfig, mailjetConfig, smtpChainConfig], deps);
	assert.equal(result.provider, "mailjet");
	assert.deepEqual(sentThrough, ["mailjet"]);
	assert.deepEqual(recorded, ["mailjet"]);
	assert.deepEqual(result.attempts.map((attempt) => [attempt.provider, attempt.outcome]), [["brevo", "skipped"], ["mailjet", "sent"]]);
});

test("429, 5xx and network errors move on to the next provider", async () => {
	for (const failure of [
		new errors.ProviderSendError("Brevo: slow down", true, 429),
		new errors.ProviderSendError("Brevo: down", true, 503),
		new TypeError("fetch failed"),
		Object.assign(new Error("SES throttled"), { status: 429 }),
	]) {
		const { deps, sentThrough } = fallbackDeps({ failures: { brevo: failure } });
		const result = await fallback.sendWithFallback([brevoConfig, smtpChainConfig], deps);
		assert.equal(result.provider, "smtp", failure.message);
		assert.deepEqual(sentThrough, ["smtp"]);
		assert.equal(result.attempts[0].outcome, "failed");
	}
});

test("a 4xx validation error does not fall back and keeps its own error", async () => {
	const rejection = new errors.ProviderSendError("Brevo: Invalid sender", false, 400);
	const { deps, sentThrough, recorded } = fallbackDeps({ failures: { brevo: rejection } });
	await assert.rejects(fallback.sendWithFallback([brevoConfig, smtpChainConfig], deps), (error) => error === rejection);
	assert.deepEqual(sentThrough, []);
	assert.deepEqual(recorded, []);

	const sesStyle = Object.assign(new Error("MessageRejected"), { status: 400 });
	await assert.rejects(fallback.sendWithFallback([brevoConfig, smtpChainConfig], fallbackDeps({ failures: { brevo: sesStyle } }).deps), (error) => error === sesStyle);
});

test("a rejection after a fallback reports the whole trail", async () => {
	const { deps } = fallbackDeps({ failures: { brevo: new errors.ProviderSendError("Brevo: down", true, 503), mailjet: new errors.ProviderSendError("Mailjet: bad address", false, 400) } });
	await assert.rejects(fallback.sendWithFallback([brevoConfig, mailjetConfig, smtpChainConfig], deps), /brevo: Brevo: down; mailjet: Mailjet: bad address/);
});

test("when every provider fails or is over its limit the send fails with the reasons", async () => {
	const down = new errors.ProviderSendError("Brevo: down", true, 503);
	await assert.rejects(fallback.sendWithFallback([brevoConfig, mailjetConfig], fallbackDeps({ failures: { brevo: down }, noRoom: ["mailjet"] }).deps), /brevo: Brevo: down; mailjet: sending limit reached/);
	await assert.rejects(fallback.sendWithFallback([brevoConfig, mailjetConfig], fallbackDeps({ noRoom: ["brevo", "mailjet"] }).deps), /Sending limit reached for every provider/);
});

test("a usage counter that cannot be written does not fail a delivered message", async () => {
	const { deps } = fallbackDeps();
	const result = await fallback.sendWithFallback([brevoConfig], { ...deps, record: async () => { throw new Error("db down"); } });
	assert.equal(result.provider, "brevo");
});

test("quota arithmetic takes the tighter of the daily and monthly cap", () => {
	assert.equal(utils.remainingQuota(undefined, { today: 5, month: 50 }), null);
	assert.equal(utils.remainingQuota({ daily: null, monthly: null }, { today: 5, month: 50 }), null);
	assert.equal(utils.remainingQuota({ daily: 10, monthly: null }, { today: 4, month: 50 }), 6);
	assert.equal(utils.remainingQuota({ daily: 10, monthly: 52 }, { today: 4, month: 50 }), 2);
	assert.equal(utils.remainingQuota({ daily: 10, monthly: 100 }, { today: 12, month: 50 }), 0);
	assert.deepEqual(utils.parseLimits('{"brevo":{"daily":300,"monthly":"x"},"nope":{"daily":1}}'), { brevo: { daily: 300, monthly: null } });
});

test("fallback lists keep order, drop duplicates, unknown names and the primary", () => {
	assert.deepEqual(utils.parseFallbackList('["smtp","brevo","smtp","bogus","resend"]', "resend"), ["smtp", "brevo"]);
	assert.deepEqual(utils.parseFallbackList("not json"), []);
	assert.deepEqual(utils.parseFallbackList(null), []);
});

test("credential forms are validated and secrets are masked", () => {
	assert.deepEqual(utils.parseCredentials("brevo", { apiKey: "  xkeysib-1  " }), { apiKey: "xkeysib-1" });
	assert.throws(() => utils.parseCredentials("brevo", {}), /Brevo API key/);
	assert.throws(() => utils.parseCredentials("mailjet", { apiKey: "a" }), /secret key/);
	assert.deepEqual(utils.parseCredentials("smtp", { host: "smtp.example.net", port: "465", username: "u", password: "p" }), { host: "smtp.example.net", port: 465, security: "tls", username: "u", password: "p" });
	assert.equal(utils.parseCredentials("smtp", { host: "smtp.example.net", port: 587 }).security, "starttls");
	assert.throws(() => utils.parseCredentials("smtp", { host: "smtp.example.net", port: 25 }), /Port 25/);
	assert.throws(() => utils.parseCredentials("smtp", { host: "smtp.example.net", port: 587, username: "u" }), /password/);
	assert.throws(() => utils.parseCredentials("smtp", { host: "smtp://evil", port: 587 }), /host name/);
	const summary = utils.summarizeCredentials("brevo", { apiKey: "xkeysib-1234567890abcdef" });
	assert.equal(summary, "xkey••••cdef");
	assert.ok(!utils.summarizeCredentials("smtp", { host: "h", port: 587, security: "starttls", username: "u", password: "hunter2hunter2" }).includes("hunter2"));
	assert.equal(utils.maskSecret("short"), "••••");
});
