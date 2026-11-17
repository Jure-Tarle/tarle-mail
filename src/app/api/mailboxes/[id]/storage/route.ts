import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMailboxSettingsAccess } from "@/lib/mailboxes/settings-access";
import { getMailboxStorageSummary } from "@/lib/mailboxes/storage-usage";
import type { MailboxRouteParams } from "../types";

export async function GET(request: Request, { params }: MailboxRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const access = await getMailboxSettingsAccess(env, user, id);
	if (!access?.canRead) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	const summary = await getMailboxStorageSummary(env, id, { detail: new URL(request.url).searchParams.get("detail") === "1" });
	if (!summary) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	return NextResponse.json({ storage: { ...summary, canEditLimits: user.role === "admin" && access.canManage } }, { headers: { "Cache-Control": "no-store" } });
}
