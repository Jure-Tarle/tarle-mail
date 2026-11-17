"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { formatDriveSize } from "@/lib/drive/utils";
import { fetchMailboxStorage, type MailboxStorage } from "@/lib/mailboxes/storage-client";
import { isStorageFull, isStorageNearLimit, storageUsageRatio } from "@/lib/mailboxes/storage-limits";

const dismissKey = (mailboxId: string) => `tarle-mail:storage-banner-dismissed:${mailboxId}`;

/** Warns above the message list once the mailbox reaches 90% of its storage limit; dismissed per mailbox for the browser session. */
export function MailboxStorageBanner({ mailboxId }: { mailboxId?: string | null }) {
	const { t } = useLanguage();
	const [loaded, setLoaded] = useState<{ mailboxId: string; storage: MailboxStorage } | null>(null);
	const [dismissed, setDismissed] = useState<string | null>(null);

	useEffect(() => {
		if (!mailboxId) return;
		let active = true;
		// The banner is advisory; a failed read just hides it.
		void fetchMailboxStorage(mailboxId).then((storage) => { if (active) setLoaded({ mailboxId, storage }); }).catch(() => undefined);
		return () => { active = false; };
	}, [mailboxId]);

	if (!mailboxId || loaded?.mailboxId !== mailboxId) return null;
	const { usedBytes, limitBytes } = loaded.storage;
	if (!limitBytes || !isStorageNearLimit(usedBytes, limitBytes)) return null;
	if (dismissed === mailboxId || sessionStorage.getItem(dismissKey(mailboxId))) return null;

	const values = { percent: Math.min(100, Math.floor(storageUsageRatio(usedBytes, limitBytes) * 100)), used: formatDriveSize(usedBytes), total: formatDriveSize(limitBytes) };
	return (
		<div role="status" className="flex shrink-0 items-center gap-x-3 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
			<AlertTriangle className="h-4 w-4 shrink-0" />
			<p className="min-w-0 flex-1">{t(isStorageFull(usedBytes, limitBytes) ? "mailboxStorage.full" : "mailboxStorage.warning", values)}</p>
			<Link href={`/settings/mailboxes/${mailboxId}`} className="font-semibold underline underline-offset-2">{t("mailboxStorage.manage")}</Link>
			<button
				type="button"
				aria-label={t("mailboxStorage.dismiss")}
				className="rounded-md p-1 hover:bg-amber-100"
				onClick={() => { sessionStorage.setItem(dismissKey(mailboxId), "1"); setDismissed(mailboxId); }}
			>
				<X className="h-4 w-4" />
			</button>
		</div>
	);
}
