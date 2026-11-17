import { getServerTranslator } from "@/lib/i18n/server";
import { SettingsPanel } from "@/components/ui/settings-panel";
import { PasswordSettings } from "@/components/settings/password-settings";
import { PasskeySettings } from "@/components/settings/passkey-settings";
import { TwoStepSettings } from "@/components/settings/two-step-settings";
import { DeviceSettings } from "@/components/settings/device-settings";

export default async function SecuritySettingsPage() {
	const t = await getServerTranslator();
	return <div className="space-y-8 py-4">
		<div>
			<h1 className="text-xl font-semibold text-neutral-900">{t("settingsPage.security.title")}</h1>
			<p className="mt-1 text-sm text-neutral-500">{t("settingsPage.security.description")}</p>
		</div>
		<section className="space-y-4">
			<div>
				<h2 className="text-lg font-semibold text-neutral-900">{t("signIn.methodsTitle")}</h2>
				<p className="mt-1 max-w-prose text-sm text-neutral-500">{t("signIn.methodsDescription")}</p>
			</div>
			<div className="space-y-6">
				<PasswordSettings />
				<SettingsPanel id="passkeys" className="scroll-mt-6" title={t("passkey.settingsTitle")} description={t("passkey.settingsDescription")}>
					<PasskeySettings />
				</SettingsPanel>
			</div>
		</section>
		<div className="space-y-6">
			<TwoStepSettings />
			<SettingsPanel title={t("settingsPage.security.devices")} description={t("settingsPage.security.devicesDescription")}>
				<DeviceSettings />
			</SettingsPanel>
		</div>
	</div>;
}
