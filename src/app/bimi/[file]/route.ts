import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { logoFileHostname } from "@/lib/bimi/record";
import { ownLogoKey } from "@/lib/bimi/own-logo";
import { getEnv } from "@/lib/cloudflare";

const NOT_FOUND_HEADERS = { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" };

/**
 * Public BIMI logo of one of this install's domains, at /bimi/<hostname>.svg. Mail apps fetch it
 * without a session, so it must stay reachable without login. The SVG is an admin's upload: it is
 * served with a CSP that sandboxes it and blocks everything it could load or run.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
	const hostname = logoFileHostname((await params).file);
	if (!hostname) return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
	const env = getEnv();
	const [domain] = await getDb(env).select({ id: domains.id }).from(domains).where(eq(domains.hostname, hostname)).limit(1);
	const object = domain ? await env.BUCKET.get(ownLogoKey(domain.id)) : null;
	if (!object) return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
	return new Response(object.body, {
		headers: {
			"Content-Type": "image/svg+xml; charset=utf-8",
			"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "public, max-age=3600",
			ETag: object.httpEtag,
		},
	});
}
