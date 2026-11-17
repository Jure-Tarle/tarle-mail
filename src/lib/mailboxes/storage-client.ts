import { authFetch } from "@/lib/auth/client";

export type MailboxStorage = {
	usedBytes: number;
	/** Effective limits; null means unlimited. */
	limitBytes: number | null;
	dailySendLimit: number | null;
	sentToday: number;
	/** The mailbox's own limits (null = follows the default) and the admin defaults. */
	own: { storageLimitBytes: number | null; dailySendLimit: number | null };
	defaults: { storageBytes: number | null; dailySend: number | null };
	canEditLimits: boolean;
};

/** `detail` measures usage even without a limit (settings card); the banner leaves it off to stay cheap. */
export async function fetchMailboxStorage(mailboxId: string, options: { detail?: boolean } = {}): Promise<MailboxStorage> {
	const response = await authFetch(`/api/mailboxes/${mailboxId}/storage${options.detail ? "?detail=1" : ""}`, { cache: "no-store" });
	const json = (await response.json()) as { storage?: MailboxStorage; error?: string };
	if (!response.ok || !json.storage) throw new Error(json.error ?? "Failed to load storage usage");
	return json.storage;
}

/** Administrators only. A null limit follows the default from General settings; 0 means unlimited. */
export async function updateMailboxLimits(mailboxId: string, limits: { storageLimitGb: number | null; dailySendLimit: number | null }): Promise<void> {
	const response = await authFetch(`/api/mailboxes/${mailboxId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(limits),
	});
	if (!response.ok) {
		const json = (await response.json().catch(() => ({}))) as { error?: unknown };
		throw new Error(typeof json.error === "string" ? json.error : "Failed to update mailbox limits");
	}
}
