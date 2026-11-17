import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { listAccessibleMailboxes } from "@/lib/mailboxes/access";
import { readMailboxPreferences, saveMailboxColors } from "@/lib/mailboxes/order";

const colorSchema = z.object({
	mailboxId: z.string().min(1).max(64),
	/** "#rrggbb", or null to go back to the automatic colour. */
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
});

/** Sets or clears the user's own colour for one mailbox they can access. */
export async function PUT(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const parsed = colorSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

	const db = getDb(env);
	const accessible = new Set((await listAccessibleMailboxes(db, user)).map((mailbox) => mailbox.id));
	if (!accessible.has(parsed.data.mailboxId)) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });

	const { colors } = await readMailboxPreferences(db, user.id);
	// Drop colours of mailboxes the user can no longer reach, so the stored map does not grow forever.
	const next = Object.fromEntries(Object.entries(colors).filter(([id]) => accessible.has(id)));
	if (parsed.data.color) next[parsed.data.mailboxId] = parsed.data.color.toLowerCase();
	else delete next[parsed.data.mailboxId];
	await saveMailboxColors(db, user.id, next);
	return NextResponse.json({ colors: next });
}
