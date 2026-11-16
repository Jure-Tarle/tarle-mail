"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCompose } from "@/components/compose/compose-context";
import type { CustomFolder } from "@/components/dashboard-nav-types";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import type { CommandItem } from "@/components/shortcuts/types";
import { readThemePreference, resolveTheme, saveThemePreference, THEME_CHANGED_EVENT } from "@/components/theme-utils";
import { useCurrentUser } from "@/hooks/use-current-user";
import { getMailboxFolders } from "@/lib/folders/client";
import { requestMailSearch } from "./mail-search-request";
import { buildPaletteEntries, isMailFolderPath, nextTheme, type PaletteAction } from "./palette-entries-utils";
import { paletteIcons } from "./palette-icons";

const NO_FOLDERS: CustomFolder[] = [];

function subscribeTheme(onChange: () => void) {
	window.addEventListener(THEME_CHANGED_EVENT, onChange);
	return () => window.removeEventListener(THEME_CHANGED_EVENT, onChange);
}

/**
 * The palette's built-in commands for the signed-in user: folders, mailboxes, apps, settings, admin
 * pages (only for admins), theme and help, plus the handler for "search mail for ...".
 * Custom folders are fetched while the palette is open.
 */
export function usePaletteCommands({ open, showHelp }: { open: boolean; showHelp: () => void }) {
	const { t } = useLanguage();
	const router = useRouter();
	const pathname = usePathname();
	const { openComposer } = useCompose();
	const user = useCurrentUser();
	const { mailboxes, selectedMailbox, setSelectedMailbox } = useSelectedMailbox();
	const mailboxId = selectedMailbox?.id ?? null;
	const resolvedTheme = useSyncExternalStore(
		subscribeTheme,
		() => resolveTheme(readThemePreference()),
		() => "light" as const,
	);
	const [loadedFolders, setLoadedFolders] = useState<{ mailboxId: string; folders: CustomFolder[] } | null>(null);

	useEffect(() => {
		if (!open || !mailboxId) return;
		let cancelled = false;
		getMailboxFolders<{ folders?: CustomFolder[] }>(mailboxId)
			.then((data) => {
				if (!cancelled) setLoadedFolders({ mailboxId, folders: data.folders ?? [] });
			})
			.catch(() => {
				if (!cancelled) setLoadedFolders(null);
			});
		return () => {
			cancelled = true;
		};
	}, [open, mailboxId]);

	const folders = loadedFolders?.mailboxId === mailboxId ? loadedFolders.folders : NO_FOLDERS;

	const commands = useMemo<CommandItem[]>(() => {
		function perform(action: PaletteAction) {
			switch (action.type) {
				case "compose":
					return openComposer();
				case "navigate":
					return router.push(action.href);
				case "mailbox": {
					const mailbox = mailboxes.find((item) => item.id === action.mailboxId);
					if (!mailbox) return;
					setSelectedMailbox(mailbox);
					return router.push("/inbox");
				}
				case "theme":
					return saveThemePreference(nextTheme(resolveTheme(readThemePreference())));
				case "help":
					return showHelp();
			}
		}

		return buildPaletteEntries({
			t,
			user,
			mailboxes,
			selectedMailboxId: mailboxId,
			folders,
			themeTarget: nextTheme(resolvedTheme),
		}).map(({ icon, action, ...entry }) => ({ ...entry, icon: paletteIcons[icon], perform: () => perform(action) }));
	}, [t, user, mailboxes, mailboxId, folders, resolvedTheme, openComposer, router, setSelectedMailbox, showHelp]);

	function searchMail(query: string) {
		const onMailList = isMailFolderPath(pathname);
		requestMailSearch(query, { live: onMailList });
		if (!onMailList) router.push("/inbox");
	}

	return { commands, searchMail };
}
