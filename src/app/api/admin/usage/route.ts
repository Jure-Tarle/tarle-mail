import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { normalizeBillingDay } from "@/lib/usage/forecast";
import { getUsageOverview } from "@/lib/usage/service";
import { setUsageSettings } from "@/lib/usage/settings";
import { getRequestTimeZone } from "@/lib/time/utils";

export async function GET(request: Request) {
	const env = getEnv();
	const session = await requireSessionUser(env, request);
	if (session.error) return session.error;
	if (!isPrimaryAdmin(session.user)) return Response.json({ error: "Forbidden" }, { status: 403 });
	try {
		const overview = await getUsageOverview(env, getRequestTimeZone(request, session.user.timeZone));
		return Response.json(overview, { headers: { "Cache-Control": "private, max-age=60" } });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "Could not load usage" }, { status: 500 });
	}
}

/** Sets the day of the month the Cloudflare subscription renews, which starts each billing period. */
export async function PUT(request: Request) {
	const env = getEnv();
	const session = await requireSessionUser(env, request);
	if (session.error) return session.error;
	if (!isPrimaryAdmin(session.user)) return Response.json({ error: "Forbidden" }, { status: 403 });
	if (!hasValidSessionMutationOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
	const body = (await request.json().catch(() => null)) as { billingDay?: unknown } | null;
	const billingDay = body?.billingDay;
	if (typeof billingDay !== "number" || normalizeBillingDay(billingDay) !== billingDay) return Response.json({ error: "billingDay must be a whole number from 1 to 28" }, { status: 400 });
	await setUsageSettings(env.BUCKET, { billingDay });
	return Response.json({ billingDay }, { headers: { "Cache-Control": "no-store" } });
}
