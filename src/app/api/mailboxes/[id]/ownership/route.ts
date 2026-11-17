import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { mailboxAccess, mailboxes, messages, users } from "@/db/schema";
import { requireTeamSharingAdmin } from "@/app/api/accounts/utils";
import { newId } from "@/lib/ids";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { isPrimaryMailbox } from "@/lib/profile/identity-utils";
import type { MailboxRouteParams } from "../types";
import { selectMailboxById } from "../utils";

const ownershipSchema = z.discriminatedUnion("type", [
	/** A team mailbox: the admin making the change owns it and can share it; a previous personal owner keeps full access. */
	z.object({ type: z.literal("shared") }),
	/** One person's mailbox. Shared access to it ends. */
	z.object({ type: z.literal("personal"), ownerUserId: z.string().min(1).max(64) }),
]);

/** The accounts an admin may give a mailbox to: the same ones they may share with, plus themselves. */
function eligibleOwners(adminId: string) {
	return and(eq(users.disabled, false), isNull(users.deletedAt), or(eq(users.createdByUserId, adminId), eq(users.id, adminId)));
}

/** What the admin may do with this mailbox's type and owner, and who could own it. */
export async function GET(request: Request, { params }: MailboxRouteParams) {
	const access = await requireTeamSharingAdmin(request);
	if (access.error) return access.error;
	const admin = access.user!;
	const { id } = await params;
	const db = getDb(access.env);
	const [mailbox] = await selectMailboxById(db, id);
	if (!mailbox) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	const primary = mailbox.type === "personal" && isPrimaryMailbox(mailbox, mailbox.ownerEmail);
	const accounts = await db
		.select({ id: users.id, name: users.name, email: users.email })
		.from(users)
		.where(eligibleOwners(admin.id))
		.orderBy(asc(users.name));
	return NextResponse.json({
		type: mailbox.type,
		ownerUserId: mailbox.userId,
		ownerName: mailbox.ownerName,
		ownerEmail: mailbox.ownerEmail,
		isPrimary: primary,
		canChange: !primary && (mailbox.type === "personal" || mailbox.userId === admin.id),
		accounts,
	});
}

/**
 * Turns a personal mailbox into a shared one, or gives a mailbox to one person. The primary mailbox
 * of an account (the one at its sign-in address) is that account's identity and cannot be moved.
 */
export async function POST(request: Request, { params }: MailboxRouteParams) {
	const access = await requireTeamSharingAdmin(request);
	if (access.error) return access.error;
	const admin = access.user!;
	const parsed = ownershipSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return NextResponse.json({ error: "Choose a valid mailbox type" }, { status: 400 });

	const { id } = await params;
	const db = getDb(access.env);
	const [mailbox] = await selectMailboxById(db, id);
	if (!mailbox) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	if (mailbox.type === "personal" && isPrimaryMailbox(mailbox, mailbox.ownerEmail)) {
		return NextResponse.json({ error: "The primary mailbox of an account cannot be shared or moved" }, { status: 409 });
	}
	// A shared mailbox can only be changed by the admin who manages it, as with its sharing settings.
	if (mailbox.type === "shared" && mailbox.userId !== admin.id) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}

	const previousOwnerId = mailbox.userId;
	if (parsed.data.type === "shared") {
		if (mailbox.type === "shared") return NextResponse.json({ ok: true });
		await db.update(mailboxes).set({ type: "shared", userId: admin.id }).where(eq(mailboxes.id, id));
		if (previousOwnerId !== admin.id) {
			await db
				.insert(mailboxAccess)
				.values({ id: newId("mac"), mailboxId: id, userId: previousOwnerId, permission: "full_access", createdByUserId: admin.id })
				.onConflictDoUpdate({ target: [mailboxAccess.mailboxId, mailboxAccess.userId], set: { permission: "full_access", createdByUserId: admin.id } });
			// Received and sent mail now belongs to the team owner; the previous owner's own drafts stay theirs.
			await db.update(messages).set({ userId: admin.id }).where(and(eq(messages.mailboxId, id), ne(messages.status, "draft")));
		}
	} else {
		const ownerUserId = parsed.data.ownerUserId;
		const [owner] = await db
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.id, ownerUserId), eligibleOwners(admin.id)))
			.limit(1);
		if (!owner) return NextResponse.json({ error: "Account not found" }, { status: 404 });
		if (mailbox.type === "personal" && previousOwnerId === owner.id) return NextResponse.json({ ok: true });
		await db.update(mailboxes).set({ type: "personal", userId: owner.id }).where(eq(mailboxes.id, id));
		await db.delete(mailboxAccess).where(eq(mailboxAccess.mailboxId, id));
		// The new owner is the only one with access now, so every message moves with the mailbox.
		await db.update(messages).set({ userId: owner.id }).where(eq(messages.mailboxId, id));
	}

	await createAuditLog(access.env, {
		actorUserId: admin.id,
		targetUserId: parsed.data.type === "personal" ? parsed.data.ownerUserId : previousOwnerId,
		mailboxId: id,
		action: "mailbox.ownership_changed",
		metadata: { from: { type: mailbox.type, ownerUserId: previousOwnerId }, to: parsed.data },
	});
	return NextResponse.json({ ok: true });
}
