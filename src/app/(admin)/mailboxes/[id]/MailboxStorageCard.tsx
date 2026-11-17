"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { Save } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDriveSize } from "@/lib/drive/utils";
import { fetchMailboxStorage, updateMailboxLimits, type MailboxStorage } from "@/lib/mailboxes/storage-client";
import { bytesToGigabytes, isStorageNearLimit, storageUsageRatio } from "@/lib/mailboxes/storage-limits";

/** An empty field follows the default (null); a number is the mailbox's own limit, 0 meaning unlimited. */
function parseLimit(value: string): number | null {
	return value.trim() === "" ? null : Number(value);
}

export default function MailboxStorageCard({ mailboxId }: { mailboxId: string }) {
	const { t } = useLanguage();
	const qc = useQueryClient();
	const storage = useQuery({ queryKey: ["mailbox", mailboxId, "storage"], queryFn: () => fetchMailboxStorage(mailboxId), enabled: !!mailboxId });
	const [storageGb, setStorageGb] = useState("");
	const [dailySend, setDailySend] = useState("");

	// Copy each newly loaded value into the form fields.
	const [synced, setSynced] = useState<MailboxStorage | undefined>(undefined);
	if (storage.data !== synced) {
		setSynced(storage.data);
		if (storage.data) {
			setStorageGb(storage.data.own.storageLimitBytes === null ? "" : String(bytesToGigabytes(storage.data.own.storageLimitBytes)));
			setDailySend(storage.data.own.dailySendLimit === null ? "" : String(storage.data.own.dailySendLimit));
		}
	}

	const save = useMutation({
		mutationFn: () => updateMailboxLimits(mailboxId, { storageLimitGb: parseLimit(storageGb), dailySendLimit: parseLimit(dailySend) }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["mailbox", mailboxId, "storage"] }),
	});

	const data = storage.data;
	const percent = data?.limitBytes ? Math.min(100, Math.round(storageUsageRatio(data.usedBytes, data.limitBytes) * 100)) : 0;
	const unlimited = t("mailbox.limitUnlimited");
	const storageValid = parseLimit(storageGb) === null || (Number.isFinite(parseLimit(storageGb)) && Number(parseLimit(storageGb)) >= 0);
	const dailyValid = parseLimit(dailySend) === null || Number.isInteger(parseLimit(dailySend)) && Number(parseLimit(dailySend)) >= 0;

	return (
		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0">
				<CardTitle>{t("mailbox.storage")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4 pt-5">
				{storage.isLoading && <Skeleton className="h-12 w-full rounded-2xl" />}
				{storage.isError && (
					<p className="text-sm text-red-600">{storage.error instanceof Error ? storage.error.message : t("mailbox.storageLoadFailed")}</p>
				)}
				{data && (
					<div className="space-y-2">
						{data.limitBytes ? (
							<>
								<div role="progressbar" aria-label={t("mailbox.storageBar")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-neutral-200">
									<div className={clsx("h-full rounded-full transition-[width]", isStorageNearLimit(data.usedBytes, data.limitBytes) ? "bg-red-500" : "bg-blue-600")} style={{ width: `${percent}%` }} />
								</div>
								<p className="text-sm text-neutral-700">{t("mailbox.storageOf", { used: formatDriveSize(data.usedBytes), total: formatDriveSize(data.limitBytes) })}</p>
							</>
						) : (
							<p className="text-sm text-neutral-700">{t("mailbox.storageUnlimited", { used: formatDriveSize(data.usedBytes) })}</p>
						)}
						<p className="text-sm text-neutral-700">
							{data.dailySendLimit
								? t("mailbox.sentToday", { sent: data.sentToday, limit: data.dailySendLimit })
								: t("mailbox.sentTodayUnlimited", { sent: data.sentToday })}
						</p>
					</div>
				)}
				{data?.canEditLimits && (
					<>
						<div className="space-y-2">
							<Label htmlFor="storageLimitGb">{t("mailbox.storageLimitGb")}</Label>
							<Input id="storageLimitGb" type="number" min="0" step="any" value={storageGb} onChange={(event) => setStorageGb(event.target.value)} disabled={save.isPending} className="max-w-40" />
							<p className="text-sm text-neutral-500">{t("mailbox.storageLimitHint", { default: data.defaults.storageBytes ? `${bytesToGigabytes(data.defaults.storageBytes)} GB` : unlimited })}</p>
						</div>
						<div className="space-y-2">
							<Label htmlFor="dailySendLimit">{t("mailbox.dailySendLimit")}</Label>
							<Input id="dailySendLimit" type="number" min="0" step="1" value={dailySend} onChange={(event) => setDailySend(event.target.value)} disabled={save.isPending} className="max-w-40" />
							<p className="text-sm text-neutral-500">{t("mailbox.dailySendLimitHint", { default: data.defaults.dailySend ?? unlimited })}</p>
						</div>
						{save.isError && (
							<p className="text-sm text-red-600">{save.error instanceof Error ? save.error.message : t("mailbox.updateFailed")}</p>
						)}
						{save.isSuccess && <p className="text-sm text-green-700">{t("mailbox.saved")}</p>}
						<Button onClick={() => save.mutate()} disabled={save.isPending || !storageValid || !dailyValid}>
							<Save className="h-4 w-4" />
							{save.isPending ? t("common.saving") : t("settings.mailbox.saveChanges")}
						</Button>
					</>
				)}
			</CardContent>
		</Card>
	);
}
