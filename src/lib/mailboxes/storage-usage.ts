import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, driveItems, mailboxes, messageAttachments, messages } from "@/db/schema";
import { createAuditLog } from "@/lib/mailboxes/audit";
import {
	estimateMessageSize,
	isDailySendLimitReached,
	isStorageFull,
	resolveMailboxLimits,
	startOfUtcDay,
	type MailboxLimitSettings,
	type MailboxLimits,
} from "@/lib/mailboxes/storage-limits";

/** Messages measured per scheduled run; each costs an R2 head request and a database write. */
export const SIZE_BACKFILL_BATCH = 200;

/** The admin's default limits for mailboxes without their own; null means unlimited. */
export async function getDefaultMailboxLimits(env: CloudflareEnv): Promise<MailboxLimits> {
	const [settings] = await getDb(env)
		.select({ storage: appSettings.defaultMailboxStorageLimitBytes, dailySend: appSettings.defaultMailboxDailySendLimit })
		.from(appSettings)
		.where(eq(appSettings.id, "default"))
		.limit(1);
	return { storageBytes: settings?.storage ?? null, dailySend: settings?.dailySend ?? null };
}

export async function getEffectiveMailboxLimits(env: CloudflareEnv, mailbox: MailboxLimitSettings): Promise<MailboxLimits> {
	return resolveMailboxLimits(mailbox, await getDefaultMailboxLimits(env));
}

/** Bytes of raw mail the mailbox holds. The raw MIME already contains its attachments, so only message sizes count; unmeasured rows count as 0. */
export async function getMailboxStorageUsed(env: CloudflareEnv, mailboxId: string): Promise<number> {
	const [usage] = await getDb(env)
		.select({ total: sql<number>`coalesce(sum(${messages.sizeBytes}), 0)` })
		.from(messages)
		.where(eq(messages.mailboxId, mailboxId));
	return Number(usage?.total ?? 0);
}

/** Looks up a mailbox's limits and, only when a storage limit applies, its usage. */
export async function getMailboxStorageStatus(env: CloudflareEnv, mailboxId: string): Promise<{ usedBytes: number; limitBytes: number | null; limits: MailboxLimits }> {
	const [mailbox] = await getDb(env)
		.select({ storageLimitBytes: mailboxes.storageLimitBytes, dailySendLimit: mailboxes.dailySendLimit })
		.from(mailboxes)
		.where(eq(mailboxes.id, mailboxId))
		.limit(1);
	const limits = await getEffectiveMailboxLimits(env, mailbox ?? { storageLimitBytes: null, dailySendLimit: null });
	const usedBytes = limits.storageBytes === null ? 0 : await getMailboxStorageUsed(env, mailboxId);
	return { usedBytes, limitBytes: limits.storageBytes, limits };
}

export type MailboxStorageSummary = {
	usedBytes: number;
	/** Effective limits after the admin default; null means unlimited. */
	limitBytes: number | null;
	dailySendLimit: number | null;
	sentToday: number;
	/** What is stored on the mailbox itself (null = follows the default), for the admin form. */
	own: MailboxLimitSettings;
	defaults: MailboxLimits;
};

/** Everything the storage bar, the limit form and the nearly-full banner show. */
export async function getMailboxStorageSummary(env: CloudflareEnv, mailboxId: string): Promise<MailboxStorageSummary | null> {
	const [own] = await getDb(env)
		.select({ storageLimitBytes: mailboxes.storageLimitBytes, dailySendLimit: mailboxes.dailySendLimit })
		.from(mailboxes)
		.where(eq(mailboxes.id, mailboxId))
		.limit(1);
	if (!own) return null;
	const defaults = await getDefaultMailboxLimits(env);
	const limits = resolveMailboxLimits(own, defaults);
	const [usedBytes, sentToday] = await Promise.all([getMailboxStorageUsed(env, mailboxId), countMessagesSentToday(env, mailboxId)]);
	return { usedBytes, limitBytes: limits.storageBytes, dailySendLimit: limits.dailySend, sentToday, own, defaults };
}

/**
 * True when inbound mail for the mailbox must be refused. A failing lookup (such as a database
 * that has not run the limits migration yet) accepts the mail: losing mail is worse than overshooting a quota.
 */
export async function isMailboxFull(env: CloudflareEnv, mailboxId: string): Promise<boolean> {
	try {
		const { usedBytes, limitBytes } = await getMailboxStorageStatus(env, mailboxId);
		return isStorageFull(usedBytes, limitBytes);
	} catch (error) {
		console.error(`Mailbox storage check failed for ${mailboxId}`, error);
		return false;
	}
}

/** Leaves a trace of mail refused because the mailbox is full, for admins and the mailbox owner. */
export async function recordMailboxFullRejection(env: CloudflareEnv, mailbox: { mailboxId: string; userId: string }, mail: { from: string; to: string }): Promise<void> {
	await createAuditLog(env, { targetUserId: mailbox.userId, mailboxId: mailbox.mailboxId, action: "mailbox.full", metadata: mail })
		.catch((error) => console.error(`Audit entry for refused mail to ${mail.to} failed`, error));
}

/** Messages the mailbox queued or sent since 00:00 UTC. Failed sends and drafts do not count. */
export async function countMessagesSentToday(env: CloudflareEnv, mailboxId: string, now = new Date()): Promise<number> {
	const [row] = await getDb(env)
		.select({ count: sql<number>`count(*)` })
		.from(messages)
		.where(and(
			eq(messages.mailboxId, mailboxId),
			eq(messages.direction, "outbound"),
			inArray(messages.status, ["queued", "sent"]),
			gte(messages.createdAt, startOfUtcDay(now)),
		));
	return Number(row?.count ?? 0);
}

export class DailySendLimitError extends Error {
	constructor(address: string) {
		super(`Daily sending limit reached for ${address}`);
	}
}

/** Throws {@link DailySendLimitError} when the mailbox has used up today's sending allowance. */
export async function assertDailySendAllowed(env: CloudflareEnv, mailboxId: string, address: string): Promise<void> {
	let reached = false;
	try {
		const { limits } = await getMailboxStorageStatus(env, mailboxId);
		reached = isDailySendLimitReached(limits.dailySend === null ? 0 : await countMessagesSentToday(env, mailboxId), limits.dailySend);
	} catch (error) {
		// Same as inbound: a failing lookup must not stop mail from going out.
		console.error(`Daily send check failed for ${mailboxId}`, error);
	}
	if (reached) throw new DailySendLimitError(address);
}

/**
 * Mail and Drive bytes per user. Mail is summed over the mailboxes the user owns, so a shared
 * mailbox counts towards its owner.
 */
export async function getStorageUsageByUser(env: CloudflareEnv): Promise<Map<string, { mailBytes: number; driveBytes: number }>> {
	const db = getDb(env);
	const [mail, drive] = await Promise.all([
		db.select({ userId: mailboxes.userId, total: sql<number>`coalesce(sum(${messages.sizeBytes}), 0)` })
			.from(messages)
			.innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
			.groupBy(mailboxes.userId),
		db.select({ userId: driveItems.ownerId, total: sql<number>`coalesce(sum(${driveItems.size}), 0)` })
			.from(driveItems)
			.groupBy(driveItems.ownerId),
	]);
	const usage = new Map<string, { mailBytes: number; driveBytes: number }>();
	const entry = (userId: string) => {
		let current = usage.get(userId);
		if (!current) usage.set(userId, (current = { mailBytes: 0, driveBytes: 0 }));
		return current;
	};
	for (const row of mail) entry(row.userId).mailBytes = Number(row.total);
	for (const row of drive) entry(row.userId).driveBytes = Number(row.total);
	return usage;
}

/**
 * Records the size of messages stored before sizes were kept, one bounded batch at a time. The raw
 * object's size wins; without one (sent copies, imports) the size is estimated from the bodies and
 * attachments. A failed R2 lookup leaves the row unmeasured for the next run. Safe to run concurrently.
 */
export async function backfillMessageSizes(env: CloudflareEnv, batchSize = SIZE_BACKFILL_BATCH): Promise<number> {
	const db = getDb(env);
	const rows = await db
		.select({ id: messages.id, rawR2Key: messages.rawR2Key, subject: messages.subject, textBody: messages.textBody, htmlBody: messages.htmlBody })
		.from(messages)
		.where(isNull(messages.sizeBytes))
		.limit(batchSize);
	if (rows.length === 0) return 0;

	const attachmentBytes = new Map<string, number>();
	const ids = rows.map((row) => row.id);
	for (let index = 0; index < ids.length; index += 50) {
		const totals = await db
			.select({ messageId: messageAttachments.messageId, total: sql<number>`coalesce(sum(${messageAttachments.size}), 0)` })
			.from(messageAttachments)
			.where(inArray(messageAttachments.messageId, ids.slice(index, index + 50)))
			.groupBy(messageAttachments.messageId);
		for (const row of totals) attachmentBytes.set(row.messageId, Number(row.total));
	}

	let measured = 0;
	for (const row of rows) {
		let size: number;
		try {
			const object = row.rawR2Key ? await env.BUCKET.head(row.rawR2Key) : null;
			size = object ? object.size : estimateMessageSize({ subject: row.subject, text: row.textBody, html: row.htmlBody, attachmentBytes: attachmentBytes.get(row.id) });
		} catch (error) {
			console.error(`Size lookup failed for message ${row.id}`, error);
			continue;
		}
		await db.update(messages).set({ sizeBytes: size }).where(and(eq(messages.id, row.id), isNull(messages.sizeBytes)));
		measured += 1;
	}
	return measured;
}
