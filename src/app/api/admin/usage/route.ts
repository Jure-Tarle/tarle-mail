import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { getUsageOverview } from "@/lib/usage/service";
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
