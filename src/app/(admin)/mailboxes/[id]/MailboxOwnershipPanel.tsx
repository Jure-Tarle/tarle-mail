"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { clearMailboxesCache } from "@/components/mailbox-provider-utils";
import { Button } from "@/components/ui/button";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SettingsPanel } from "@/components/ui/settings-panel";
import { authFetch } from "@/lib/auth/client";

type Ownership = {
	type: "personal" | "shared";
	ownerUserId: string;
	ownerName: string;
	ownerEmail: string;
	isPrimary: boolean;
	canChange: boolean;
	accounts: { id: string; name: string; email: string }[];
	error?: string;
};

async function fetchOwnership(id: string): Promise<Ownership> {
	const res = await authFetch(`/api/mailboxes/${id}/ownership`);
	const json = (await res.json()) as Ownership;
	if (!res.ok) throw new Error(json.error ?? "Failed to load the mailbox owner");
	return json;
}

async function changeOwnership(id: string, body: { type: "shared" } | { type: "personal"; ownerUserId: string }): Promise<void> {
	const res = await authFetch(`/api/mailboxes/${id}/ownership`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await res.json()) as { error?: string };
	if (!res.ok) throw new Error(json.error ?? "Failed to change the mailbox");
	clearMailboxesCache();
}

/**
 * Type and owner of a mailbox: keep it with one person, give it to someone else, or make it a shared
 * team mailbox that several people can use. Admins only; hidden when the API refuses (not an admin).
 */
export default function MailboxOwnershipPanel({ mailboxId, address }: { mailboxId: string; address: string }) {
	const { t } = useLanguage();
	const qc = useQueryClient();
	const ownership = useQuery({ queryKey: ["mailbox", mailboxId, "ownership"], queryFn: () => fetchOwnership(mailboxId), retry: false });
	const [choice, setChoice] = useState<{ type: "personal" | "shared"; ownerUserId: string } | null>(null);

	const data = ownership.data;
	const current = data ? { type: data.type, ownerUserId: data.type === "personal" ? data.ownerUserId : "" } : null;
	const selected = choice ?? current;
	const changed = !!selected && !!current && (selected.type !== current.type || (selected.type === "personal" && selected.ownerUserId !== current.ownerUserId));

	const save = useMutation({
		mutationFn: async () => {
			if (!selected || !data) return;
			const owner = data.accounts.find((account) => account.id === selected.ownerUserId);
			const message = selected.type === "shared"
				? t("mailbox.ownership.confirmShared", { address, owner: data.ownerName })
				: t("mailbox.ownership.confirmPersonal", { address, owner: owner?.name ?? "" });
			if (!await confirmDestructive(message)) return;
			await changeOwnership(mailboxId, selected.type === "shared" ? { type: "shared" } : { type: "personal", ownerUserId: selected.ownerUserId });
			setChoice(null);
			await Promise.all([
				qc.invalidateQueries({ queryKey: ["mailbox", mailboxId] }),
				qc.invalidateQueries({ queryKey: ["mailboxes"] }),
			]);
		},
	});

	// Not an admin who may manage accounts: nothing to show.
	if (ownership.isError || (!ownership.isLoading && !data)) return null;

	return (
		<SettingsPanel
			title={t("mailbox.ownership.title")}
			description={t("mailbox.ownership.description")}
			status={save.isError ? <span className="text-red-700">{save.error instanceof Error ? save.error.message : t("mailbox.ownership.failed")}</span> : undefined}
			action={data?.canChange ? (
				<Button type="button" disabled={!changed || save.isPending || (selected?.type === "personal" && !selected.ownerUserId)} onClick={() => save.mutate()}>
					{save.isPending ? t("common.saving") : t("mailbox.ownership.apply")}
				</Button>
			) : undefined}
		>
			{data && (
				<p className="text-sm text-neutral-700">
					{data.type === "shared"
						? t("mailbox.ownership.currentShared")
						: t("mailbox.ownership.currentPersonal", { owner: `${data.ownerName} (${data.ownerEmail})` })}
				</p>
			)}
			{data?.isPrimary && <p className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">{t("mailbox.ownership.primary")}</p>}
			{data?.canChange && selected && (
				<>
					<div role="radiogroup" aria-label={t("mailbox.ownership.title")} className="grid gap-3 sm:grid-cols-2">
						{(["personal", "shared"] as const).map((type) => (
							<label key={type} className="flex cursor-pointer items-start gap-3 rounded-xl bg-neutral-50 p-4 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-200">
								<input
									type="radio"
									name={`mailbox-type-${mailboxId}`}
									className="mt-1"
									checked={selected.type === type}
									onChange={() => setChoice({ type, ownerUserId: type === "personal" ? (current?.type === "personal" ? current.ownerUserId : "") : "" })}
								/>
								<span>
									<span className="block text-sm font-medium text-neutral-900">{t(`mailbox.ownership.${type}`)}</span>
									<span className="mt-1 block text-xs leading-5 text-neutral-500">{t(`mailbox.ownership.${type}Hint`)}</span>
								</span>
							</label>
						))}
					</div>
					{selected.type === "personal" && (
						<div className="space-y-2">
							<Label htmlFor={`mailbox-owner-${mailboxId}`}>{t("mailbox.ownership.owner")}</Label>
							<Select
								id={`mailbox-owner-${mailboxId}`}
								value={selected.ownerUserId}
								onChange={(event) => setChoice({ type: "personal", ownerUserId: event.target.value })}
								containerClassName="sm:max-w-md"
								className="h-10 text-sm"
							>
								<option value="">{t("mailbox.chooseAccount")}</option>
								{data.accounts.map((account) => (
									<option key={account.id} value={account.id}>{account.name} ({account.email})</option>
								))}
							</Select>
						</div>
					)}
					{selected.type === "shared" && current?.type === "personal" && (
						<p className="text-sm text-neutral-500">{t("mailbox.ownership.sharedNext")}</p>
					)}
				</>
			)}
		</SettingsPanel>
	);
}
