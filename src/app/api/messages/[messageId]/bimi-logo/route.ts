import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { getBimiSettings, getSenderLogo, messagePassedDmarc, senderDomain } from "@/lib/bimi/sender-logo";

const LOGO_HEADERS = {
	"Content-Type": "image/svg+xml; charset=utf-8",
	// The logo is the sender's file. Sandboxed, and only ever shown through <img>, never inlined.
	"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
	"Cross-Origin-Resource-Policy": "same-origin",
	"X-Content-Type-Options": "nosniff",
	"Cache-Control": "private, max-age=86400",
	Vary: "Cookie, Authorization",
};
const NO_LOGO = { "Cache-Control": "private, max-age=3600", Vary: "Cookie, Authorization" };

/**
 * The BIMI logo of a received message's sender, when the message passed DMARC and the sender's
 * domain publishes one. The server fetches it, so the sender never sees the reader's browser.
 */
export async function GET(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const { messageId } = await params;
	const db = getDb(env);
	const [message] = await db
		.select({
			mailboxId: messages.mailboxId,
			direction: messages.direction,
			fromAddr: messages.fromAddr,
			rawR2Key: messages.rawR2Key,
			spamSignals: messages.spamSignals,
		})
		.from(messages)
		.where(eq(messages.id, messageId))
		.limit(1);
	if (!message?.mailboxId) return NextResponse.json({ error: "Not found" }, { status: 404 });
	const access = await getMailboxAccessLevel(db, user, message.mailboxId);
	if (!access?.canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });

	const notFound = () => new Response(null, { status: 404, headers: NO_LOGO });
	const domain = senderDomain(message.fromAddr);
	if (message.direction !== "inbound" || !domain) return notFound();
	if (!(await getBimiSettings(env.BUCKET)).senderLogos) return notFound();
	if (!(await messagePassedDmarc(env.BUCKET, message))) return notFound();

	const svg = await getSenderLogo(env.BUCKET, domain);
	return svg ? new Response(svg, { headers: LOGO_HEADERS }) : notFound();
}
