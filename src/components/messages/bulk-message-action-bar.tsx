"use client";

import { useState } from "react";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import { useLanguage } from "@/components/language-provider";
import { BulkMessageToolbar } from "./bulk-message-toolbar";
import type { BulkMessageActionBarProps } from "./types";
import { PartialDeleteError } from "@/lib/messages/permanent-delete-utils";
import { runBulkMessageAction } from "./utils";

/**
 * Bulk actions for a selection made in the split-view list. They fill the command bar above list
 * and message, in place of the open message's actions.
 */
export function BulkMessageActionBar({
	folder,
	selectedMessages,
	onClearSelection,
}: BulkMessageActionBarProps) {
	const { t } = useLanguage();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hasUnreadSelection = selectedMessages.some((message) => !message.read);

	async function runAction(action: BulkMessageAction, folderId?: string) {
		if (selectedMessages.length === 0) return;

		setPending(true);
		setError(null);
		try {
			await runBulkMessageAction(
				selectedMessages.map((message) => message.id),
				action,
				true,
				folderId,
			);
			onClearSelection();
		} catch (actionError) {
			setError(actionError instanceof PartialDeleteError ? t("actions.error.deleteSkipped") : t("actions.error.update"));
		} finally {
			setPending(false);
		}
	}

	return (
		<div
			role="region"
			aria-label={t("common.selectedCount", { count: selectedMessages.length })}
			className="flex min-w-0 flex-1 items-center gap-2"
		>
			<div className="flex min-w-0 flex-1">
				<BulkMessageToolbar
					labeled
					selectedCount={selectedMessages.length}
					hasUnreadSelection={hasUnreadSelection}
					onAction={runAction}
					onClearSelection={onClearSelection}
					pending={pending}
					folder={folder}
				/>
			</div>
			{error && <p role="alert" className="shrink-0 text-sm font-medium text-red-700">{error}</p>}
		</div>
	);
}
