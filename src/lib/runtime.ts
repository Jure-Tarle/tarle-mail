/**
 * Where the app is running. On Cloudflare Workers the bindings come from
 * cloudflare:workers; the self-hosted Node server builds an equivalent env object and
 * publishes it on globalThis before Next starts, so route handlers reach it
 * the same way.
 */
declare global {
	var __mailflareNodeEnv: CloudflareEnv | undefined;
}

export function getNodeEnv(): CloudflareEnv | undefined {
	return globalThis.__mailflareNodeEnv;
}

export function isNodeRuntime(env?: Pick<CloudflareEnv, "MAILFLARE_RUNTIME">): boolean {
	return (env ?? getNodeEnv())?.MAILFLARE_RUNTIME === "node";
}

/**
 * The runtime Cloudflare API token. `CLOUDFLARE_TOKEN` is the documented name; `CF_TOKEN` (upstream
 * Mailflare's name) still works so existing installations keep running.
 */
export function getCloudflareToken(env: Pick<CloudflareEnv, "CLOUDFLARE_TOKEN" | "CF_TOKEN">): string | undefined {
	return env.CLOUDFLARE_TOKEN?.trim() || env.CF_TOKEN?.trim() || undefined;
}

/** True when the app can talk to the Cloudflare API to manage zones and routing. */
export function hasCloudflareCredentials(env: Pick<CloudflareEnv, "CLOUDFLARE_TOKEN" | "CF_TOKEN" | "CF_API_KEY" | "CF_EMAIL">): boolean {
	return !!getCloudflareToken(env) || (!!env.CF_API_KEY?.trim() && !!env.CF_EMAIL?.trim());
}
