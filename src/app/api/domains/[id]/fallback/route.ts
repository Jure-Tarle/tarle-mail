import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { requireUser } from "@/lib/auth/cookies";
import { canManageDomains } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { getDomainForUser } from "@/lib/domains/service";
import { isOutboundProvider, MAX_FALLBACKS, parseFallbackList } from "@/lib/providers/config-utils";

type Params = { params: Promise<{ id: string }> };

const noStore = { "Cache-Control": "no-store" };
const schema = z.object({ fallback: z.array(z.string()).max(MAX_FALLBACKS) });

async function readFallback(env: CloudflareEnv, domainId: string, primary: string) {
	const [row] = await getDb(env).select({ fallback: domains.sendingFallback }).from(domains).where(eq(domains.id, domainId)).limit(1);
	return parseFallbackList(row?.fallback, primary);
}

/** The providers tried, in order, when this domain's sending provider is over its limit or unavailable. */
export async function GET(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const domain = await getDomainForUser(env, user.id, id);
	if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
	return NextResponse.json({ fallback: await readFallback(env, domain.id, domain.sendingProvider) }, { headers: noStore });
}

/** Replaces the ordered fallback list. The domain's own provider is not a fallback for itself. */
export async function PUT(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!canManageDomains(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	const domain = await getDomainForUser(env, user.id, id);
	if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success || !parsed.data.fallback.every(isOutboundProvider)) return NextResponse.json({ error: "Unknown sending provider" }, { status: 400 });
	const fallback = parseFallbackList(JSON.stringify(parsed.data.fallback), domain.sendingProvider);
	await getDb(env).update(domains).set({ sendingFallback: JSON.stringify(fallback) }).where(eq(domains.id, domain.id));
	return NextResponse.json({ fallback }, { headers: noStore });
}
