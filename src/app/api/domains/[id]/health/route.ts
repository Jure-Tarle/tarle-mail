import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireUser } from "@/lib/auth/cookies";
import { canManageDomains } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { getDomainForUser } from "@/lib/domains/service";
import { checkDomainHealth, repairDomainHealth } from "@/lib/domains/health";

type Params = { params: Promise<{ id: string }> };

const noStore = { "Cache-Control": "no-store" };
const repairSchema = z.object({ keys: z.array(z.string().max(500)).min(1).max(50) });

/** Compares the domain's DNS and routing with what its providers need. Read-only. */
export async function GET(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!canManageDomains(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	const domain = await getDomainForUser(env, user.id, id);
	if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
	try {
		return NextResponse.json({ health: await checkDomainHealth(env, domain) }, { headers: noStore });
	} catch (err) {
		return NextResponse.json({ error: err instanceof Error ? err.message : "Health check failed" }, { status: 500 });
	}
}

/** Applies the repairs the admin confirmed, listed by the keys the health check returned. */
export async function POST(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!canManageDomains(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
	const domain = await getDomainForUser(env, user.id, id);
	if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
	const parsed = repairSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: "Choose at least one repair" }, { status: 400 });
	try {
		return NextResponse.json(await repairDomainHealth(env, domain, parsed.data.keys), { headers: noStore });
	} catch (err) {
		return NextResponse.json({ error: err instanceof Error ? err.message : "Repair failed" }, { status: 500 });
	}
}
