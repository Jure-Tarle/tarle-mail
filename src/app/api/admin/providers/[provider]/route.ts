import { z } from "zod";
import { authorizeProviderAdmin, noStore } from "@/lib/providers/access";
import { isOutboundProvider, isStoredProvider, parseCredentials, ProviderConfigError } from "@/lib/providers/config-utils";
import { clearCredentials, getStoredCredentials, saveCredentials } from "@/lib/providers/credentials";
import { ProviderSendError } from "@/lib/providers/errors";
import { setProviderLimit } from "@/lib/providers/quota";
import { checkProviderConnection, getProviderStatuses } from "@/lib/providers/status";

type Params = { params: Promise<{ provider: string }> };

const schema = z.object({
	credentials: z.record(z.string(), z.unknown()).optional(),
	limit: z.object({ daily: z.number().int().positive().nullable(), monthly: z.number().int().positive().nullable() }).optional(),
});

/** A failed connection test as a response: the provider refusing the credentials is the caller's input (400), anything else is an outage (502). */
function connectionFailure(error: unknown): Response {
	if (error instanceof ProviderSendError && !error.fallback) return Response.json({ error: error.message }, { status: 400 });
	return Response.json({ error: error instanceof Error ? error.message : "Could not reach the provider" }, { status: 502 });
}

async function statusOf(env: CloudflareEnv, provider: string) {
	return (await getProviderStatuses(env)).find((status) => status.provider === provider);
}

/**
 * Saves a provider's credentials (after proving them with the provider) and/or its sending caps.
 * Secrets go in and never come back: the answer is the masked status.
 */
export async function PUT(request: Request, { params }: Params) {
	const { provider } = await params;
	const access = await authorizeProviderAdmin(request, true);
	if (access.error) return access.error;
	if (!isOutboundProvider(provider)) return Response.json({ error: "Unknown provider" }, { status: 404 });
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success || (!parsed.data.credentials && !parsed.data.limit)) return Response.json({ error: "Nothing to save" }, { status: 400 });

	if (parsed.data.credentials) {
		if (!isStoredProvider(provider)) return Response.json({ error: "This provider's credentials are managed elsewhere" }, { status: 400 });
		try {
			const credentials = parseCredentials(provider, parsed.data.credentials);
			await checkProviderConnection(access.env, provider, credentials);
			await saveCredentials(access.env, provider, credentials);
		} catch (error) {
			if (error instanceof ProviderConfigError) return Response.json({ error: error.message }, { status: 400 });
			return connectionFailure(error);
		}
	}
	if (parsed.data.limit) await setProviderLimit(access.env, provider, parsed.data.limit);
	return Response.json({ status: await statusOf(access.env, provider) }, { headers: noStore });
}

/** Re-checks the saved credentials against the provider. */
export async function POST(request: Request, { params }: Params) {
	const { provider } = await params;
	const access = await authorizeProviderAdmin(request, true);
	if (access.error) return access.error;
	if (!isStoredProvider(provider)) return Response.json({ error: "Unknown provider" }, { status: 404 });
	const credentials = await getStoredCredentials(access.env, provider);
	if (!credentials) return Response.json({ error: "No credentials are saved for this provider" }, { status: 400 });
	try {
		return Response.json({ ok: true, ...await checkProviderConnection(access.env, provider, credentials) }, { headers: noStore });
	} catch (error) {
		return connectionFailure(error);
	}
}

export async function DELETE(request: Request, { params }: Params) {
	const { provider } = await params;
	const access = await authorizeProviderAdmin(request, true);
	if (access.error) return access.error;
	if (!isStoredProvider(provider)) return Response.json({ error: "Unknown provider" }, { status: 404 });
	await clearCredentials(access.env, provider);
	return Response.json({ status: await statusOf(access.env, provider) }, { headers: noStore });
}
