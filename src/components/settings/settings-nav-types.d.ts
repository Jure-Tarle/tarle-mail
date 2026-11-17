import type { LucideIcon } from "@/components/icons";
import type { TranslationKey } from "@/lib/i18n/types";

export type SettingsNavItem = {
	href: string;
	labelKey: TranslationKey;
	icon: LucideIcon;
	/** Section titles on the page, so the settings search finds the page by what is on it. */
	searchKeys?: TranslationKey[];
	requiresMailboxAccess?: boolean;
};

export type SettingsNavSection = {
	labelKey: TranslationKey;
	items: SettingsNavItem[];
};
