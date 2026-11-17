import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { listAccessibleMailboxes } from "@/lib/mailboxes/access";
import { saveMailboxOrder } from "@/lib/mailboxes/order";

const orderSchema = z.object({ mailboxIds: z.array(z.string().min(1).max(64)).max(500) });

/** Saves the order the user wants their mailboxes in. Only mailboxes they can access are kept. */
export async function PUT(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const parsed = orderSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

	const db = getDb(env);
	const accessible = new Set((await listAccessibleMailboxes(db, user)).map((mailbox) => mailbox.id));
	const mailboxIds = [...new Set(parsed.data.mailboxIds)].filter((id) => accessible.has(id));
	await saveMailboxOrder(db, user.id, mailboxIds);
	return NextResponse.json({ mailboxIds });
}
