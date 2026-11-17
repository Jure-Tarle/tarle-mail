"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0"><CardTitle>{t("general.attachments")}</CardTitle></CardHeader>
			<CardContent className="pt-6"><form onSubmit={save} className="space-y-4">
				<div className="space-y-2"><Label htmlFor="attachment-limit">{t("general.maxAttachments")}</Label><Input id="attachment-limit" type="number" min="1" max="25" step="1" value={maxMb} onChange={(event) => setMaxMb(Number(event.target.value))} disabled={!loaded || saving} className="max-w-40" required /><p className="text-sm text-neutral-500">{t("general.appliesTo")}</p></div>
				<div className="space-y-2 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700"><p>{t("general.cloudflareLimit")}</p><p>{t("general.largeFiles")}</p></div>
				{status && <p role="status" className="text-sm text-neutral-700">{status}</p>}
				<Button type="submit" disabled={!loaded || saving || !Number.isInteger(maxMb) || maxMb < 1 || maxMb > 25}>{saving ? t("common.saving") : t("general.save")}</Button>
			</form></CardContent>
		</Card>
		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0"><CardTitle>{t("general.drive")}</CardTitle></CardHeader>
			<CardContent className="pt-6"><form onSubmit={saveDrive} className="space-y-4">
				<div className="flex items-center gap-3"><Switch id="drive-unlimited" checked={unlimited} onCheckedChange={setUnlimited} disabled={!loaded || driveSaving} /><Label htmlFor="drive-unlimited">{t("general.driveUnlimited")}</Label></div>
				{!unlimited && <div className="space-y-2"><Label htmlFor="drive-limit">{t("general.driveLimit")}</Label><Input id="drive-limit" type="number" min="0.01" max="1000000" step="any" value={limitGb} onChange={(event) => setLimitGb(Number(event.target.value))} disabled={!loaded || driveSaving} className="max-w-40" required /></div>}
				<p className="text-sm text-neutral-500">{t("general.driveHint")}</p>
				{driveStatus && <p role="status" className="text-sm text-neutral-700">{driveStatus}</p>}
				<Button type="submit" disabled={!loaded || driveSaving || (!unlimited && !(limitGb > 0))}>{driveSaving ? t("common.saving") : t("general.save")}</Button>
			</form></CardContent>
		</Card>
		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0"><CardTitle>{t("general.mailboxLimits")}</CardTitle></CardHeader>
			<CardContent className="pt-6"><form onSubmit={saveMailboxLimits} className="space-y-4">
				<div className="space-y-2"><Label htmlFor="mailbox-storage-limit">{t("general.mailboxStorageLimit")}</Label><Input id="mailbox-storage-limit" type="number" min="0.01" max="1000000" step="any" value={mailboxStorageGb} onChange={(event) => setMailboxStorageGb(event.target.value)} placeholder={t("general.mailboxUnlimited")} disabled={!loaded || mailboxSaving} className="max-w-40" /></div>
				<div className="space-y-2"><Label htmlFor="mailbox-daily-limit">{t("general.mailboxDailyLimit")}</Label><Input id="mailbox-daily-limit" type="number" min="1" step="1" value={mailboxDailySend} onChange={(event) => setMailboxDailySend(event.target.value)} placeholder={t("general.mailboxUnlimited")} disabled={!loaded || mailboxSaving} className="max-w-40" /></div>
				<p className="text-sm text-neutral-500">{t("general.mailboxLimitsHint")}</p>
				{mailboxStatus && <p role="status" className="text-sm text-neutral-700">{mailboxStatus}</p>}
				<Button type="submit" disabled={!loaded || mailboxSaving || !mailboxLimitsValid}>{mailboxSaving ? t("common.saving") : t("general.save")}</Button>
			</form></CardContent>
		</Card>
		<ProviderLimitsCard />
	</div>;
}
