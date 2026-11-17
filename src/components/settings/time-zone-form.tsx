"use client";

import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsPanel } from "@/components/ui/settings-panel";
import { saveUserTimeZonePreference } from "@/lib/time/client";
import { formatCurrentTimeInZone, listTimeZones, updateUserTimeZone } from "./time-zone-form-utils";
import type { TimeZoneFormProps } from "./time-zone-form-types";

export function TimeZoneForm({ userId, initialTimeZone }: TimeZoneFormProps) {
	const { t } = useLanguage();
	const [timeZone, setTimeZone] = useState(initialTimeZone ?? "");
	const [savedTimeZone, setSavedTimeZone] = useState(initialTimeZone ?? "");
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const currentZone = timeZone.trim() || deviceTimeZone;
	const validZone = (() => {
		try { return formatCurrentTimeInZone(currentZone); }
		catch { return null; }
	})();

	return <SettingsPanel
		title={t("settings.timeZone.title")}
		description={t("settings.timeZone.description", { zone: deviceTimeZone })}
		status={status}
		action={<Button type="submit" disabled={saving || timeZone.trim() === savedTimeZone || !validZone}>{saving ? t("common.saving") : t("settings.timeZone.save")}</Button>}
		onSubmit={(event) => {
			event.preventDefault();
			setSaving(true);
			setStatus(null);
			void updateUserTimeZone(timeZone).then((saved) => {
				setTimeZone(saved ?? "");
				setSavedTimeZone(saved ?? "");
				saveUserTimeZonePreference(userId, saved);
				setStatus(t("common.saved"));
			}).catch((error) => setStatus(error instanceof Error ? error.message : t("settings.timeZone.failed"))).finally(() => setSaving(false));
		}}
	>
		<div className="space-y-2">
			<Label htmlFor="account-time-zone">{t("settings.timeZone.title")}</Label>
			<Input id="account-time-zone" list="account-time-zone-options" value={timeZone} onChange={(event) => { setTimeZone(event.target.value); setStatus(null); }} placeholder={t("settings.timeZone.placeholder", { zone: deviceTimeZone })} autoComplete="off" className="sm:max-w-md" />
			<datalist id="account-time-zone-options">{listTimeZones(deviceTimeZone).map((zone) => <option key={zone} value={zone} />)}</datalist>
			{validZone && <p className="text-sm text-neutral-500">{t("settings.timeZone.current", { time: validZone })}</p>}
		</div>
	</SettingsPanel>;
}
