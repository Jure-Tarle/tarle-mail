import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { canManageDomains } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { getDomainForUser } from "@/lib/domains/service";
import { BimiLogoError, getOwnLogoStatus, removeOwnLogo, saveOwnLogo } from "@/lib/bimi/own-logo";
import { BIMI_MAX_SVG_BYTES } from "@/lib/bimi/svg";

type Params = { params: Promise<{ id: string }> };

const originOf = (env: CloudflareEnv, request: Request) => env.APP_URL?.trim().replace(/\/+$/, "") || new URL(request.url).origin;

async function authorize(request: Request, id: string, mutation: boolean) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return { error: auth.error } as const;
	if (!canManageDomains(auth.user)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
	if (mutation && !hasValidSessionMutationOrigin(request)) return { error: NextResponse.json({ error: "Invalid origin" }, { status: 403 }) } as const;
	const domain = await getDomainForUser(env, auth.user.id, id);
	if (!domain) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
	return { env, domain, origin: originOf(env, request) } as const;
}

/** The domain's own BIMI logo and what its DNS needs for mail apps to show it. */
export async function GET(request: Request, { params }: Params) {
	const ctx = await authorize(request, (await params).id, false);
	if (ctx.error) return ctx.error;
	return NextResponse.json(await getOwnLogoStatus(ctx.env, ctx.domain, ctx.origin), { headers: { "Cache-Control": "no-store" } });
}

/** Stores a square SVG Tiny PS logo and points the domain's default._bimi record at it. */
export async function PUT(request: Request, { params }: Params) {
	const ctx = await authorize(request, (await params).id, true);
	if (ctx.error) return ctx.error;
	// A logo can only be valid within the limit, so a larger body is refused before it is read.
	if (Number(request.headers.get("content-length") ?? 0) > BIMI_MAX_SVG_BYTES * 2) {
		return NextResponse.json({ error: "The logo is larger than 32 KB, the size mail apps accept." }, { status: 413 });
	}
	const body = (await request.json().catch(() => null)) as { svg?: unknown } | null;
	if (typeof body?.svg !== "string" || !body.svg.trim()) return NextResponse.json({ error: "svg must be the text of an SVG file" }, { status: 400 });
	try {
		return NextResponse.json(await saveOwnLogo(ctx.env, ctx.domain, ctx.origin, body.svg), { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof BimiLogoError) return NextResponse.json({ error: error.message }, { status: 400 });
		throw error;
	}
}

export async function DELETE(request: Request, { params }: Params) {
	const ctx = await authorize(request, (await params).id, true);
	if (ctx.error) return ctx.error;
	try {
		return NextResponse.json(await removeOwnLogo(ctx.env, ctx.domain, ctx.origin), { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "The DNS record could not be removed" }, { status: 502 });
	}
}
