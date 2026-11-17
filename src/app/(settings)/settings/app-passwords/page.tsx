import { getServerTranslator } from "@/lib/i18n/server";
import { EmailClientsSettings } from "@/components/settings/email-clients-settings";

export default async function EmailAppsSettingsPage() {
	const t = await getServerTranslator();
	return <div className="space-y-6 py-4">
		<div>
			<h1 className="text-xl font-semibold text-neutral-900">{t("settingsPage.appPasswords.title")}</h1>
			<p className="mt-1 max-w-prose text-sm text-neutral-500">{t("settingsPage.appPasswords.description")}</p>
		</div>
		<EmailClientsSettings />
	</div>;
}
