import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";

/** Provider credentials and caps are the primary administrator's, like the Resend key and AWS credentials. */
export async function authorizeProviderAdmin(request: Request, mutation: boolean) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return { env, error: auth.error };
	if (!isPrimaryAdmin(auth.user)) return { env, error: Response.json({ error: "Only the primary administrator can manage sending providers" }, { status: 403 }) };
	if (mutation && !hasValidSessionMutationOrigin(request)) return { env, error: Response.json({ error: "Invalid origin" }, { status: 403 }) };
	return { env, error: null };
}

export const noStore = { "Cache-Control": "no-store" };
