import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { canManageDomains } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { getBimiSettings, setBimiSettings } from "@/lib/bimi/sender-logo";

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	return NextResponse.json(await getBimiSettings(env.BUCKET), { headers: { "Cache-Control": "no-store" } });
}

/** Turns senders' BIMI logos on or off for everyone on this install. */
export async function PUT(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	if (!canManageDomains(auth.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	const body = (await request.json().catch(() => null)) as { senderLogos?: unknown } | null;
	if (typeof body?.senderLogos !== "boolean") return NextResponse.json({ error: "senderLogos must be a boolean" }, { status: 400 });
	await setBimiSettings(env.BUCKET, { senderLogos: body.senderLogos });
	return NextResponse.json({ senderLogos: body.senderLogos }, { headers: { "Cache-Control": "no-store" } });
}
