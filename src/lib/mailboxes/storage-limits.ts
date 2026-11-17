/** Pure rules for per-mailbox storage and daily sending limits; the database side lives in storage-usage.ts. */

export const MAILBOX_FULL_REJECTION = "552 5.2.2 Mailbox full";
/** Mail and settings show a warning from this share of the storage limit. */
export const STORAGE_WARNING_RATIO = 0.9;
const BYTES_PER_GB = 1024 ** 3;

export type MailboxLimits = {
	/** Bytes the mailbox may hold, or null for unlimited. */
	storageBytes: number | null;
	/** Messages the mailbox may send per UTC day, or null for unlimited. */
	dailySend: number | null;
};

export type MailboxLimitSettings = {
	storageLimitBytes: number | null;
	dailySendLimit: number | null;
};

function positiveOrNull(value: number | null | undefined): number | null {
	return typeof value === "number" && value > 0 ? value : null;
}

/**
 * A mailbox's own value wins; null falls back to the admin default. A stored 0 is an explicit
 * "unlimited" that overrides a default. A default of null (or 0) means unlimited.
 */
export function resolveMailboxLimits(own: MailboxLimitSettings, defaults: MailboxLimits): MailboxLimits {
	const resolve = (value: number | null, fallback: number | null) => (value === null ? positiveOrNull(fallback) : positiveOrNull(value));
	return {
		storageBytes: resolve(own.storageLimitBytes, defaults.storageBytes),
		dailySend: resolve(own.dailySendLimit, defaults.dailySend),
	};
}

export function isStorageFull(usedBytes: number, limitBytes: number | null): boolean {
	return limitBytes !== null && usedBytes >= limitBytes;
}

export function isDailySendLimitReached(sentToday: number, limit: number | null): boolean {
	return limit !== null && sentToday >= limit;
}

/** Share of the limit in use, 0 when unlimited. Can exceed 1 when a limit was lowered below the current usage. */
export function storageUsageRatio(usedBytes: number, limitBytes: number | null): number {
	return limitBytes ? usedBytes / limitBytes : 0;
}

export function isStorageNearLimit(usedBytes: number, limitBytes: number | null): boolean {
	return limitBytes !== null && storageUsageRatio(usedBytes, limitBytes) >= STORAGE_WARNING_RATIO;
}

export function startOfUtcDay(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function gigabytesToBytes(gigabytes: number): number {
	return Math.round(gigabytes * BYTES_PER_GB);
}

export function bytesToGigabytes(bytes: number): number {
	return Math.round((bytes / BYTES_PER_GB) * 1000) / 1000;
}

/** Attachments grow by a third once base64-encoded into the MIME. */
const BASE64_OVERHEAD = 4 / 3;

/**
 * Stand-in for the raw MIME size when the raw message is not available (sent copies and rows
 * from before sizes were recorded): the text parts, subject and base64-encoded attachments.
 */
export function estimateMessageSize(parts: { subject?: string | null; text?: string | null; html?: string | null; attachmentBytes?: number }): number {
	const encoder = new TextEncoder();
	const textBytes = [parts.subject, parts.text, parts.html].reduce((total, value) => total + (value ? encoder.encode(value).byteLength : 0), 0);
	return textBytes + Math.ceil((parts.attachmentBytes ?? 0) * BASE64_OVERHEAD);
}
