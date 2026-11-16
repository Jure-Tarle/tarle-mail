"use client";

import { Keyboard } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useShortcuts } from "@/components/shortcuts";
import { cn } from "@/lib/utils";

/** Header button that opens the command palette; hidden while keyboard shortcuts are off, as the palette is. */
export function CommandPaletteButton({ className }: { className?: string }) {
	const { t } = useLanguage();
	const { openCommandPalette, shortcutsEnabled, shortcutsPreferenceLoading } = useShortcuts();
	if (!shortcutsEnabled || shortcutsPreferenceLoading) return null;

	return (
		<button
			type="button"
			onClick={openCommandPalette}
			aria-haspopup="dialog"
			aria-label={t("search.openPalette")}
			title={t("search.openPalette")}
			className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-200", className)}
		>
			<Keyboard className="h-5 w-5" />
		</button>
	);
}
