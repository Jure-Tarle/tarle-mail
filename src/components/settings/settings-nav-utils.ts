import { Download, Inbox, KeyRound, LockKeyhole, Mail, Route, Shield, Upload, UserRound } from "@/components/icons";
import type { SettingsNavSection } from "./settings-nav-types";

export const settingsNavSections: SettingsNavSection[] = [
	{
		labelKey: "settings.nav.personal",
		items: [
			{
				href: "/settings/account",
				labelKey: "settings.nav.account",
				icon: UserRound,
				searchKeys: ["settings.account.detailsTitle", "settings.account.signatureTitle", "settings.account.generalTitle", "language.label"],
			},
			{
				href: "/settings/inbox",
				labelKey: "settings.nav.inbox",
				icon: Inbox,
				searchKeys: ["settings.mailboxOrder.title", "settings.theme.label", "settingsPage.inbox.remoteContent", "settings.recipient.title", "settings.compose.trackOpensTitle"],
			},
			{
				href: "/settings/security",
				labelKey: "settings.nav.security",
				icon: Shield,
				searchKeys: ["twoStep.title", "twoStep.passkeyTitle", "twoStep.authenticatorTitle", "devices.push"],
			},
			{
				href: "/settings/api-keys",
				labelKey: "settings.nav.apiKeys",
				icon: KeyRound,
			},
			{
				href: "/settings/app-passwords",
				labelKey: "settings.nav.appPasswords",
				icon: LockKeyhole,
				searchKeys: ["emailClients.server"],
			},
			{
				href: "/settings/rules",
				labelKey: "settings.nav.rules",
				icon: Route,
				searchKeys: ["routing.title", "routing.catchAll", "routing.blockRules"],
			},
		],
	},
	{
		labelKey: "settings.nav.mailbox",
		items: [
			{
				href: "/settings/mailboxes",
				labelKey: "admin.nav.mailboxes",
				icon: Mail,
				requiresMailboxAccess: true,
			},
			{
				href: "/settings/import",
				labelKey: "settings.nav.import",
				icon: Upload,
			},
			{
				href: "/settings/export",
				labelKey: "settings.nav.export",
				icon: Download,
			},
		],
	},
];

export function isActiveSettingsPath(pathname: string, href: string): boolean {
	return pathname === href || pathname.startsWith(`${href}/`);
}

/** Lowercased and without accents, so "Signatur" and "signatur" or "Sécurité" and "securite" match. */
export function normalizeSearchText(value: string): string {
	return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
