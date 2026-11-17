import { getServerTranslator } from "@/lib/i18n/server";
import { SettingsPanel } from "@/components/ui/settings-panel";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { InboxThreadingSettings } from "@/components/settings/inbox-threading-settings";
import { RemoteContentSettings } from "@/components/settings/remote-content-settings";
import { MailboxOrderSettings } from "@/components/settings/mailbox-order-settings";
import { RecipientAddressSettings } from "@/components/settings/recipient-address-settings";
import { ComposeDefaultsSettings } from "@/components/settings/compose-defaults-settings";
import { InboxReadingLayoutSettings } from "@/components/settings/inbox-reading-layout-settings";
import { InboxShortcutsSettings } from "@/components/settings/inbox-shortcuts-settings";
import { MailboxAutoReplyForm } from "@/components/settings/mailbox-auto-reply-form";
import { SpamFilterSettings } from "@/components/settings/spam-filter-settings";
import { TrashRetentionSettings } from "@/components/settings/trash-retention-settings";
import { PushNotificationSettings } from "@/components/settings/push-notification-settings";
import { BrowserNotificationSettings } from "@/components/settings/browser-notification-settings";

export default async function SettingsInboxPage() {
	const t = await getServerTranslator();
	return (
		<div className="space-y-8 py-4">
			<h1 className="sr-only">{t("settings.nav.inbox")}</h1>
			<section className="space-y-4">
				<div>
					<h2 className="text-xl font-semibold text-neutral-900">{t("settingsPage.inbox.experience")}</h2>
					<p className="mt-1 text-sm text-neutral-500">{t("settingsPage.inbox.experienceDescription")}</p>
				</div>
				<div className="space-y-6">
					<SettingsPanel id="mailbox-order" title={t("settings.mailboxOrder.title")} description={t("settings.mailboxOrder.description")}>
						<MailboxOrderSettings />
					</SettingsPanel>
					<SettingsPanel title={t("settingsPage.inbox.appearance")} description={t("settingsPage.inbox.appearanceDescription")}>
						<AppearanceSettings />
					</SettingsPanel>
					<SettingsPanel title={t("settingsPage.inbox.readingLayout")} description={t("settingsPage.inbox.readingLayoutDescription")}>
						<InboxReadingLayoutSettings />
					</SettingsPanel>
					<SettingsPanel title={t("settingsPage.inbox.threading")} description={t("settingsPage.inbox.threadingDescription")}>
						<InboxThreadingSettings />
					</SettingsPanel>
					<SettingsPanel title={t("settingsPage.inbox.addresses")} description={t("settingsPage.inbox.addressesDescription")}>
						<RecipientAddressSettings />
					</SettingsPanel>
					<SettingsPanel title={t("settingsPage.inbox.compose")} description={t("settingsPage.inbox.composeDescription")}>
						<ComposeDefaultsSettings />
					</SettingsPanel>
					<SettingsPanel title={t("settingsPage.inbox.shortcuts")} description={t("settingsPage.inbox.shortcutsDescription")}>
						<InboxShortcutsSettings />
					</SettingsPanel>
					<SettingsPanel title={t("settingsPage.inbox.notifications")} description={t("settingsPage.inbox.notificationsDescription")}>
						<BrowserNotificationSettings />
						<PushNotificationSettings />
					</SettingsPanel>
				</div>
			</section>
			<section className="space-y-4">
				<div>
					<h2 className="text-xl font-semibold text-neutral-900">{t("settingsPage.inbox.handling")}</h2>
					<p className="mt-1 text-sm text-neutral-500">{t("settingsPage.inbox.handlingDescription")}</p>
				</div>
				<div className="space-y-6">
					<SettingsPanel title={t("settingsPage.inbox.spamProtection")} description={t("settingsPage.inbox.spamProtectionDescription")}>
						<SpamFilterSettings />
					</SettingsPanel>
					<SettingsPanel title={t("settingsPage.inbox.remoteContent")} description={t("settingsPage.inbox.remoteContentDescription")}>
						<RemoteContentSettings />
					</SettingsPanel>
					<SettingsPanel title={t("settingsPage.inbox.cleanup")} description={t("settingsPage.inbox.cleanupDescription")}>
						<TrashRetentionSettings />
					</SettingsPanel>
					<MailboxAutoReplyForm />
				</div>
			</section>
		</div>
	);
}
