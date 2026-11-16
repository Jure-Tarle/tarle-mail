import { settingsNavSections } from "@/components/settings/settings-nav-utils";
import type { CommandItem } from "@/components/shortcuts/types";
import type { CurrentUser } from "@/hooks/use-current-user";
import type { TranslationKey } from "@/lib/i18n/types";
import type { Translator } from "@/lib/i18n/utils";

export type PaletteIconName =
	| "compose"
	| "inbox"
	| "starred"
	| "snoozed"
	| "sent"
	| "drafts"
	| "archived"
	| "spam"
	| "trash"
	| "folder"
	| "mailbox"
	| "calendar"
	| "booking"
	| "drive"
	| "settings"
	| "admin"
	| "theme"
	| "help";

export type PaletteAction =
	| { type: "compose" }
	| { type: "navigate"; href: string }
	| { type: "mailbox"; mailboxId: string }
	| { type: "theme" }
	| { type: "help" };

/** A palette row before it is wired to the router, composer and theme: icon and action are plain data. */
export type PaletteEntry = Omit<CommandItem, "icon" | "perform"> & {
	icon: PaletteIconName;
	action: PaletteAction;
};

export type PaletteUser = Pick<
	CurrentUser,
	"role" | "isPrimaryAdmin" | "canManageDomains" | "canManageUsers" | "canManageMailboxes" | "calendarEnabled" | "driveEnabled"
>;

type SystemFolder = { href: string; titleKey: TranslationKey; icon: PaletteIconName; shortcut: string };

const systemFolders: SystemFolder[] = [
	{ href: "/inbox", titleKey: "shortcut.goInbox", icon: "inbox", shortcut: "g i" },
	{ href: "/starred", titleKey: "shortcut.goStarred", icon: "starred", shortcut: "g s" },
	{ href: "/snoozed", titleKey: "shortcut.goSnoozed", icon: "snoozed", shortcut: "g z" },
	{ href: "/sent", titleKey: "shortcut.goSent", icon: "sent", shortcut: "g t" },
	{ href: "/drafts", titleKey: "shortcut.goDrafts", icon: "drafts", shortcut: "g d" },
	{ href: "/archived", titleKey: "shortcut.goArchived", icon: "archived", shortcut: "g a" },
	{ href: "/spam", titleKey: "shortcut.goSpam", icon: "spam", shortcut: "g !" },
	{ href: "/trash", titleKey: "shortcut.goTrash", icon: "trash", shortcut: "g x" },
];

export type AdminLinkPermission = "primary" | "domains" | "users";

// Mirrors the links and permissions in src/components/admin-nav.tsx; tests/command-palette.test.mjs
// fails when the two drift apart.
export const adminPaletteLinks: { href: string; labelKey: TranslationKey; permission?: AdminLinkPermission }[] = [
	{ href: "/admin", labelKey: "admin.nav.overview" },
	{ href: "/mailboxes", labelKey: "admin.nav.mailboxes" },
	{ href: "/domains", labelKey: "admin.nav.domains", permission: "domains" },
	{ href: "/routing", labelKey: "admin.nav.routing", permission: "domains" },
	{ href: "/webhooks", labelKey: "admin.nav.webhooks", permission: "primary" },
	{ href: "/spam-filter", labelKey: "admin.nav.spamFilter", permission: "primary" },
	{ href: "/api-keys", labelKey: "admin.nav.apiKeys", permission: "primary" },
	{ href: "/general", labelKey: "admin.nav.general", permission: "primary" },
	{ href: "/agent", labelKey: "admin.nav.agent", permission: "primary" },
	{ href: "/accounts", labelKey: "admin.nav.accounts" },
	{ href: "/activity", labelKey: "admin.nav.activity", permission: "primary" },
	{ href: "/backups", labelKey: "admin.nav.backups", permission: "primary" },
	{ href: "/branding", labelKey: "admin.nav.branding", permission: "primary" },
];

export function canSeeAdminLink(user: PaletteUser, permission?: AdminLinkPermission): boolean {
	if (!permission) return true;
	if (permission === "primary") return user.isPrimaryAdmin;
	if (permission === "domains") return user.isPrimaryAdmin || user.canManageDomains;
	return user.isPrimaryAdmin || user.canManageUsers;
}

const mailFolderPrefixes = ["/inbox", "/starred", "/snoozed", "/sent", "/scheduled", "/drafts", "/archived", "/spam", "/trash", "/folders"];

/** Whether the page lists mail, so a search typed in the header filters what is on screen. */
export function isMailFolderPath(pathname: string): boolean {
	return mailFolderPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function nextTheme(current: "light" | "dark"): "light" | "dark" {
	return current === "dark" ? "light" : "dark";
}

type BuildInput = {
	t: Translator;
	user: PaletteUser | null;
	mailboxes: { id: string; localPart: string; hostname: string; displayName: string | null }[];
	selectedMailboxId: string | null;
	folders: { id: string; name: string }[];
	/** The theme the toggle switches to. */
	themeTarget: "light" | "dark";
};

export function buildPaletteEntries({ t, user, mailboxes, selectedMailboxId, folders, themeTarget }: BuildInput): PaletteEntry[] {
	const navigate = (id: string, title: string, href: string, icon: PaletteIconName, extra: Partial<PaletteEntry> = {}): PaletteEntry => ({
		id,
		title,
		category: "Navigation",
		icon,
		keywords: [href],
		action: { type: "navigate", href },
		...extra,
	});
	const categoryLabel = (category: string) => t(`shortcut.category.${category}` as TranslationKey);

	const entries: PaletteEntry[] = [
		{
			id: "compose",
			title: t("palette.composeTitle"),
			subtitle: t("palette.composeSubtitle"),
			category: "Actions",
			icon: "compose",
			shortcut: "c",
			action: { type: "compose" },
		},
		...systemFolders.map((folder) => navigate(`nav-${folder.href.slice(1)}`, t(folder.titleKey), folder.href, folder.icon, { shortcut: folder.shortcut })),
		...folders.map((folder) => navigate(`folder-${folder.id}`, folder.name, `/folders/${folder.id}`, "folder", { keywords: [t("navigation.folders")] })),
	];

	if (user?.calendarEnabled) {
		entries.push(navigate("nav-calendar", t("account.calendar"), "/calendar", "calendar"));
		entries.push(navigate("nav-booking", t("booking.title"), "/booking", "booking"));
	}
	if (user?.driveEnabled) entries.push(navigate("nav-drive", t("drive.title"), "/drive", "drive"));

	const otherMailboxes = mailboxes.filter((mailbox) => mailbox.id !== selectedMailboxId);
	for (const mailbox of otherMailboxes) {
		const address = `${mailbox.localPart}@${mailbox.hostname}`;
		entries.push({
			id: `mailbox-${mailbox.id}`,
			title: address,
			subtitle: mailbox.displayName ?? undefined,
			category: "Mailboxes",
			icon: "mailbox",
			keywords: [categoryLabel("Mailboxes")],
			action: { type: "mailbox", mailboxId: mailbox.id },
		});
	}

	for (const section of settingsNavSections) {
		for (const item of section.items) {
			if (item.requiresMailboxAccess && user?.canManageMailboxes !== true) continue;
			entries.push({
				id: `settings-${item.href}`,
				title: t(item.labelKey),
				subtitle: t(section.labelKey),
				category: "Settings",
				icon: "settings",
				keywords: [item.href],
				action: { type: "navigate", href: item.href },
			});
		}
	}

	if (user?.role === "admin") {
		for (const link of adminPaletteLinks) {
			if (!canSeeAdminLink(user, link.permission)) continue;
			entries.push({
				id: `admin-${link.href}`,
				title: t(link.labelKey),
				category: "Admin",
				icon: "admin",
				keywords: [link.href],
				action: { type: "navigate", href: link.href },
			});
		}
	}

	entries.push(
		{
			id: "toggle-theme",
			title: t("settings.theme.label"),
			subtitle: t(themeTarget === "dark" ? "settings.theme.dark" : "settings.theme.light"),
			category: "General",
			icon: "theme",
			keywords: [t("settings.theme.dark"), t("settings.theme.light"), "dark mode", "light mode"],
			action: { type: "theme" },
		},
		{
			id: "show-help",
			title: t("palette.helpTitle"),
			subtitle: t("palette.helpSubtitle"),
			category: "General",
			icon: "help",
			shortcut: "?",
			action: { type: "help" },
		},
	);

	return entries;
}
