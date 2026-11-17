import { eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { userMailboxOrder } from "@/db/schema";
import { isMissingColumnError, isMissingTableError } from "@/lib/database-errors";
import { parseMailboxColors, parseMailboxOrder } from "./order-utils";

type Db = ReturnType<typeof getDb>;

export type MailboxPreferences = { order: string[]; colors: Record<string, string> };

/** The user's mailbox order and colours, or none before the migrations have run. */
export async function readMailboxPreferences(db: Db, userId: string): Promise<MailboxPreferences> {
	try {
		const [row] = await db
			.select({ mailboxIds: userMailboxOrder.mailboxIds, mailboxColors: userMailboxOrder.mailboxColors })
			.from(userMailboxOrder)
			.where(eq(userMailboxOrder.userId, userId))
			.limit(1);
		return { order: parseMailboxOrder(row?.mailboxIds), colors: parseMailboxColors(row?.mailboxColors) };
	} catch (error) {
		if (isMissingTableError(error)) return { order: [], colors: {} };
		if (!isMissingColumnError(error)) throw error;
		// The colours column comes from a later migration than the order.
		const [row] = await db.select({ mailboxIds: userMailboxOrder.mailboxIds }).from(userMailboxOrder).where(eq(userMailboxOrder.userId, userId)).limit(1);
		return { order: parseMailboxOrder(row?.mailboxIds), colors: {} };
	}
}

export async function saveMailboxOrder(db: Db, userId: string, mailboxIds: string[]): Promise<void> {
	const value = JSON.stringify(mailboxIds);
	await db
		.insert(userMailboxOrder)
		.values({ userId, mailboxIds: value, updatedAt: new Date() })
		.onConflictDoUpdate({ target: userMailboxOrder.userId, set: { mailboxIds: value, updatedAt: new Date() } });
}

export async function saveMailboxColors(db: Db, userId: string, colors: Record<string, string>): Promise<void> {
	const value = JSON.stringify(colors);
	await db
		.insert(userMailboxOrder)
		.values({ userId, mailboxIds: "[]", mailboxColors: value, updatedAt: new Date() })
		.onConflictDoUpdate({ target: userMailboxOrder.userId, set: { mailboxColors: value, updatedAt: new Date() } });
}
