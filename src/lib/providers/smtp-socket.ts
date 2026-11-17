import { isNodeRuntime } from "@/lib/runtime";

/**
 * The part of a TCP socket the SMTP client needs, the same shape on both runtimes: the Workers
 * socket (`cloudflare:sockets`) already has it, and the Node server gets an adapter over node:net
 * and node:tls.
 */
export type SmtpSocket = {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
	/** Upgrades the connection in place after the server accepted STARTTLS; the old streams are done. */
	startTls(): SmtpSocket;
	close(): Promise<void>;
};

/** `secure` connects with TLS from the first byte (port 465); otherwise the socket can be upgraded later. */
export type SmtpConnect = (target: { hostname: string; port: number; secure: boolean }) => Promise<SmtpSocket>;

type WorkersSocket = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; startTls(): WorkersSocket; close(): Promise<void> };
type WorkersConnect = (address: { hostname: string; port: number }, options: { secureTransport: "on" | "starttls"; allowHalfOpen: boolean }) => WorkersSocket;

// Module names live in variables so neither bundler tries to resolve a runtime-only module.
async function importRuntimeModule<T>(name: string): Promise<T> {
	return await import(/* webpackIgnore: true */ /* @vite-ignore */ name) as T;
}

async function connectWorkers({ hostname, port, secure }: { hostname: string; port: number; secure: boolean }): Promise<SmtpSocket> {
	let connect: WorkersConnect;
	try {
		connect = (await importRuntimeModule<{ connect: WorkersConnect }>("cloudflare:sockets")).connect;
	} catch {
		throw new Error("SMTP sending needs the Cloudflare Workers socket runtime or the Node server");
	}
	return connect({ hostname, port }, { secureTransport: secure ? "on" : "starttls", allowHalfOpen: false });
}

type NodeSocket = {
	on(event: string, listener: (...args: any[]) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
	removeAllListeners(event: string): unknown;
	write(chunk: Uint8Array, callback: (error?: Error | null) => void): unknown;
	end(): unknown;
	destroy(): unknown;
};
type NodeNet = { connect(options: { host: string; port: number }): NodeSocket };
type NodeTls = {
	connect(options: { host?: string; port?: number; servername: string; socket?: NodeSocket }): NodeSocket;
};

function wrapNodeSocket(raw: NodeSocket, tls: NodeTls, hostname: string): SmtpSocket {
	const readable = new ReadableStream<Uint8Array>({
		start(controller) {
			raw.on("data", (chunk: Uint8Array) => controller.enqueue(new Uint8Array(chunk)));
			raw.on("end", () => { try { controller.close(); } catch { /* already closed */ } });
			raw.on("error", (error: Error) => { try { controller.error(error); } catch { /* already closed */ } });
		},
		cancel() { raw.destroy(); },
	});
	const writable = new WritableStream<Uint8Array>({
		write: (chunk) => new Promise<void>((resolve, reject) => { raw.write(chunk, (error) => (error ? reject(error) : resolve())); }),
	});
	return {
		readable,
		writable,
		startTls() {
			raw.removeAllListeners("data");
			return wrapNodeSocket(tls.connect({ socket: raw, servername: hostname }), tls, hostname);
		},
		async close() { raw.destroy(); },
	};
}

async function connectNode({ hostname, port, secure }: { hostname: string; port: number; secure: boolean }): Promise<SmtpSocket> {
	const tls = await importRuntimeModule<NodeTls>("node:tls");
	if (secure) return wrapNodeSocket(tls.connect({ host: hostname, port, servername: hostname }), tls, hostname);
	const net = await importRuntimeModule<NodeNet>("node:net");
	return wrapNodeSocket(net.connect({ host: hostname, port }), tls, hostname);
}

/** The socket factory for the runtime the app is running on. */
export function getSmtpConnect(env: Pick<CloudflareEnv, "TARLE_MAIL_RUNTIME">): SmtpConnect {
	return isNodeRuntime(env) ? connectNode : connectWorkers;
}
