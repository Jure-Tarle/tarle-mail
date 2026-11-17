import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { requireSessionUser } from "@/lib/api/auth";
import { isPrimaryAdmin } from "@/lib/auth/admin";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";
import { addAgentKey, deleteAgentKey, hasAgentKey, listAgentKeys, reorderAgentKeys, updateAgentKey } from "@/lib/agent/api-keys";
import { getAgentProviderConfig } from "@/lib/agent/provider";
import { isSecretEncryptionEnabled } from "@/lib/crypto/secret-box";

const addSchema = z.object({ label: z.string().trim().min(1).max(80), key: z.string().trim().min(8).max(2_000) });
const updateSchema = z.object({ id: z.string().min(1).max(64), label: z.string().trim().min(1).max(80).optional(), disabled: z.boolean().optional(), key: z.string().trim().min(8).max(2_000).optional() });
const reorderSchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(50) });
const deleteSchema = z.object({ id: z.string().min(1).max(64) });

/** The AI provider keys of the configured endpoint; only the primary admin may see or change them. */
async function authorize(request: Request, mutation: boolean) {
	const env = getEnv();
	const session = await requireSessionUser(env, request);
	if (session.error) return { env, error: session.error, baseUrl: "" };
	if (!isPrimaryAdmin(session.user)) return { env, error: Response.json({ error: "Forbidden" }, { status: 403 }), baseUrl: "" };
	if (mutation && !hasValidSessionMutationOrigin(request)) return { env, error: Response.json({ error: "Invalid origin" }, { status: 403 }), baseUrl: "" };
	const config = await getAgentProviderConfig(env);
	if (config.provider !== "compatible" || !config.baseUrl) {
		return { env, error: Response.json({ error: "Choose and save an external AI provider first" }, { status: 409 }), baseUrl: "" };
	}
	return { env, error: null, baseUrl: config.baseUrl };
}

async function respond(env: CloudflareEnv, baseUrl: string) {
	return Response.json({ keys: await listAgentKeys(env, baseUrl), encryption: isSecretEncryptionEnabled(env) }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
	const access = await authorize(request, false);
	if (access.error) return access.error;
	return respond(access.env, access.baseUrl);
}

export async function POST(request: Request) {
	const access = await authorize(request, true);
	if (access.error) return access.error;
	const parsed = addSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: "Enter a name and a valid key" }, { status: 400 });
	if (await hasAgentKey(access.env, access.baseUrl, parsed.data.key)) return Response.json({ error: "This key is already in the list" }, { status: 409 });
	await addAgentKey(access.env, { baseUrl: access.baseUrl, label: parsed.data.label, secret: parsed.data.key });
	return respond(access.env, access.baseUrl);
}

export async function PATCH(request: Request) {
	const access = await authorize(request, true);
	if (access.error) return access.error;
	const body = await request.json().catch(() => null);
	const reorder = reorderSchema.safeParse(body);
	if (reorder.success) {
		await reorderAgentKeys(access.env, access.baseUrl, reorder.data.ids);
		return respond(access.env, access.baseUrl);
	}
	const parsed = updateSchema.safeParse(body);
	if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
	if (parsed.data.key && (await hasAgentKey(access.env, access.baseUrl, parsed.data.key))) return Response.json({ error: "This key is already in the list" }, { status: 409 });
	await updateAgentKey(access.env, parsed.data.id, { label: parsed.data.label, disabled: parsed.data.disabled, secret: parsed.data.key });
	return respond(access.env, access.baseUrl);
}

export async function DELETE(request: Request) {
	const access = await authorize(request, true);
	if (access.error) return access.error;
	const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: "Invalid key" }, { status: 400 });
	await deleteAgentKey(access.env, parsed.data.id);
	return respond(access.env, access.baseUrl);
}
