import { eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { userMailboxOrder } from "@/db/schema";
import { isMissingTableError } from "@/lib/database-errors";
import { parseMailboxOrder } from "./order-utils";

type Db = ReturnType<typeof getDb>;

/** The user's mailbox order, or none before the migration has run. */
export async function readMailboxOrder(db: Db, userId: string): Promise<string[]> {
	try {
		const [row] = await db.select({ mailboxIds: userMailboxOrder.mailboxIds }).from(userMailboxOrder).where(eq(userMailboxOrder.userId, userId)).limit(1);
		return parseMailboxOrder(row?.mailboxIds);
	} catch (error) {
		if (isMissingTableError(error)) return [];
		throw error;
	}
}

export async function saveMailboxOrder(db: Db, userId: string, mailboxIds: string[]): Promise<void> {
	const value = JSON.stringify(mailboxIds);
	await db
		.insert(userMailboxOrder)
		.values({ userId, mailboxIds: value, updatedAt: new Date() })
		.onConflictDoUpdate({ target: userMailboxOrder.userId, set: { mailboxIds: value, updatedAt: new Date() } });
}
