"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsFieldGrid, SettingsPanel } from "@/components/ui/settings-panel";
import { Switch } from "@/components/ui/switch";
import ProviderLimitsCard from "./ProviderLimitsCard";
import { loadGeneralSettings, saveGeneralSettings } from "./utils";

export default function GeneralSettingsPage() {
	const { t } = useLanguage();
	const [maxMb, setMaxMb] = useState(25);
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState("");
	const [unlimited, setUnlimited] = useState(true);
	const [limitGb, setLimitGb] = useState(10);
	const [driveSaving, setDriveSaving] = useState(false);
	const [driveStatus, setDriveStatus] = useState("");
	const [mailboxStorageGb, setMailboxStorageGb] = useState("");
	const [mailboxDailySend, setMailboxDailySend] = useState("");
	const [mailboxSaving, setMailboxSaving] = useState(false);
	const [mailboxStatus, setMailboxStatus] = useState("");

	useEffect(() => {
		let active = true;
		void loadGeneralSettings().then((settings) => {
			if (active) { setMaxMb(settings.outboundAttachmentMaxMb); setUnlimited(settings.driveStorageLimitGb === null); if (settings.driveStorageLimitGb !== null) setLimitGb(settings.driveStorageLimitGb); setMailboxStorageGb(settings.defaultMailboxStorageLimitGb === null ? "" : String(settings.defaultMailboxStorageLimitGb)); setMailboxDailySend(settings.defaultMailboxDailySendLimit === null ? "" : String(settings.defaultMailboxDailySendLimit)); setLoaded(true); }
		}).catch((error) => { if (active) setStatus(error instanceof Error ? error.message : t("general.loadFailed")); });
		return () => { active = false; };
	}, [t]);

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setStatus("");
		try {
			const settings = await saveGeneralSettings({ outboundAttachmentMaxMb: maxMb });
			setMaxMb(settings.outboundAttachmentMaxMb);
			setStatus(t("general.saved"));
		} catch (error) {
			setStatus(error instanceof Error ? error.message : t("general.saveFailed"));
		} finally { setSaving(false); }
	}

	async function saveDrive(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setDriveSaving(true);
		setDriveStatus("");
		try {
			const settings = await saveGeneralSettings({ driveStorageLimitGb: unlimited ? null : limitGb });
			setUnlimited(settings.driveStorageLimitGb === null);
			if (settings.driveStorageLimitGb !== null) setLimitGb(settings.driveStorageLimitGb);
			setDriveStatus(t("general.driveSaved"));
		} catch (error) {
			setDriveStatus(error instanceof Error ? error.message : t("general.saveFailed"));
		} finally { setDriveSaving(false); }
	}

	// An empty field means unlimited (null).
	const mailboxStorageValue = mailboxStorageGb.trim() === "" ? null : Number(mailboxStorageGb);
	const mailboxDailyValue = mailboxDailySend.trim() === "" ? null : Number(mailboxDailySend);
	const mailboxLimitsValid = (mailboxStorageValue === null || (Number.isFinite(mailboxStorageValue) && mailboxStorageValue > 0)) && (mailboxDailyValue === null || (Number.isInteger(mailboxDailyValue) && mailboxDailyValue > 0));

	async function saveMailboxLimits(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setMailboxSaving(true);
		setMailboxStatus("");
		try {
			const settings = await saveGeneralSettings({ defaultMailboxStorageLimitGb: mailboxStorageValue, defaultMailboxDailySendLimit: mailboxDailyValue });
			setMailboxStorageGb(settings.defaultMailboxStorageLimitGb === null ? "" : String(settings.defaultMailboxStorageLimitGb));
			setMailboxDailySend(settings.defaultMailboxDailySendLimit === null ? "" : String(settings.defaultMailboxDailySendLimit));
			setMailboxStatus(t("general.mailboxLimitsSaved"));
		} catch (error) {
			setMailboxStatus(error instanceof Error ? error.message : t("general.saveFailed"));
		} finally { setMailboxSaving(false); }
	}

	return <div className="space-y-6">
		<div><h1 className="text-2xl md:text-3xl font-medium text-neutral-900">{t("general.title")}</h1><p className="mt-2 text-sm text-neutral-500">{t("general.description")}</p></div>
		<SettingsPanel
			title={t("general.attachments")}
			description={t("general.appliesTo")}
			onSubmit={save}
			status={status}
			action={<Button type="submit" disabled={!loaded || saving || !Number.isInteger(maxMb) || maxMb < 1 || maxMb > 25}>{saving ? t("common.saving") : t("general.save")}</Button>}
		>
			<div className="space-y-2"><Label htmlFor="attachment-limit">{t("general.maxAttachments")}</Label><Input id="attachment-limit" type="number" min="1" max="25" step="1" value={maxMb} onChange={(event) => setMaxMb(Number(event.target.value))} disabled={!loaded || saving} className="sm:max-w-xs" required /></div>
			<div className="space-y-2 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700"><p>{t("general.cloudflareLimit")}</p><p>{t("general.largeFiles")}</p></div>
		</SettingsPanel>
		<SettingsPanel
			title={t("general.drive")}
			description={t("general.driveHint")}
			onSubmit={saveDrive}
			status={driveStatus}
			action={<Button type="submit" disabled={!loaded || driveSaving || (!unlimited && !(limitGb > 0))}>{driveSaving ? t("common.saving") : t("general.save")}</Button>}
		>
			<SettingsFieldGrid className="items-end">
				<div className="flex min-h-10 items-center gap-3"><Switch id="drive-unlimited" checked={unlimited} onCheckedChange={setUnlimited} disabled={!loaded || driveSaving} /><Label htmlFor="drive-unlimited">{t("general.driveUnlimited")}</Label></div>
				{!unlimited && <div className="space-y-2"><Label htmlFor="drive-limit">{t("general.driveLimit")}</Label><Input id="drive-limit" type="number" min="0.01" max="1000000" step="any" value={limitGb} onChange={(event) => setLimitGb(Number(event.target.value))} disabled={!loaded || driveSaving} required /></div>}
			</SettingsFieldGrid>
		</SettingsPanel>
		<SettingsPanel
			title={t("general.mailboxLimits")}
			description={t("general.mailboxLimitsHint")}
			onSubmit={saveMailboxLimits}
			status={mailboxStatus}
			action={<Button type="submit" disabled={!loaded || mailboxSaving || !mailboxLimitsValid}>{mailboxSaving ? t("common.saving") : t("general.save")}</Button>}
		>
			<SettingsFieldGrid>
				<div className="space-y-2"><Label htmlFor="mailbox-storage-limit">{t("general.mailboxStorageLimit")}</Label><Input id="mailbox-storage-limit" type="number" min="0.01" max="1000000" step="any" value={mailboxStorageGb} onChange={(event) => setMailboxStorageGb(event.target.value)} placeholder={t("general.mailboxUnlimited")} disabled={!loaded || mailboxSaving} /></div>
				<div className="space-y-2"><Label htmlFor="mailbox-daily-limit">{t("general.mailboxDailyLimit")}</Label><Input id="mailbox-daily-limit" type="number" min="1" step="1" value={mailboxDailySend} onChange={(event) => setMailboxDailySend(event.target.value)} placeholder={t("general.mailboxUnlimited")} disabled={!loaded || mailboxSaving} /></div>
			</SettingsFieldGrid>
		</SettingsPanel>
		<ProviderLimitsCard />
	</div>;
}
