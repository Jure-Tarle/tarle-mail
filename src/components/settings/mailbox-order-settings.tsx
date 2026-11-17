"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { getMailboxColors } from "@/components/mailbox-colors";
import { useSelectedMailbox } from "@/components/mailbox-provider";

/** Moves a mailbox up or down; the order applies to the mailbox switcher on every device. */
export function MailboxOrderSettings() {
	const { t } = useLanguage();
	const { mailboxes, reorderMailboxes } = useSelectedMailbox();
	const [error, setError] = useState<string | null>(null);
	const [moving, setMoving] = useState(false);
	const colors = getMailboxColors(mailboxes);

	if (mailboxes.length < 2) return <p className="text-sm text-neutral-500">{t("settings.mailboxOrder.single")}</p>;

	const move = (index: number, offset: -1 | 1) => {
		const ids = mailboxes.map((mailbox) => mailbox.id);
		const target = index + offset;
		if (target < 0 || target >= ids.length) return;
		[ids[index], ids[target]] = [ids[target], ids[index]];
		setError(null);
		setMoving(true);
		reorderMailboxes(ids)
			.catch(() => setError(t("settings.mailboxOrder.failed")))
			.finally(() => setMoving(false));
	};

	return (
		<div>
			<ol className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
				{mailboxes.map((mailbox, index) => {
					const address = `${mailbox.localPart}@${mailbox.hostname}`;
					const name = mailbox.displayName?.trim() || address;
					return (
						<li key={mailbox.id} className="flex min-h-14 items-center gap-3 py-2 pl-4 pr-2">
							<span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors.get(mailbox.id) }} />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium text-neutral-900">{name}</span>
								{name !== address && <span className="block truncate text-xs text-neutral-500">{address}</span>}
							</span>
							<button
								type="button"
								onClick={() => move(index, -1)}
								disabled={moving || index === 0}
								aria-label={t("settings.mailboxOrder.up", { mailbox: name })}
								className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
							>
								<ArrowUp className="h-4 w-4" />
							</button>
							<button
								type="button"
								onClick={() => move(index, 1)}
								disabled={moving || index === mailboxes.length - 1}
								aria-label={t("settings.mailboxOrder.down", { mailbox: name })}
								className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
							>
								<ArrowDown className="h-4 w-4" />
							</button>
						</li>
					);
				})}
			</ol>
			{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
		</div>
	);
}
