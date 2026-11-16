import { authorizeProviderAdmin, noStore } from "@/lib/providers/access";
import { getProviderStatuses } from "@/lib/providers/status";

/** Every sending provider's state: set up or not, a masked summary, its caps and what it has sent. No secrets. */
export async function GET(request: Request) {
	const access = await authorizeProviderAdmin(request, false);
	if (access.error) return access.error;
	return Response.json({ providers: await getProviderStatuses(access.env) }, { headers: noStore });
}
