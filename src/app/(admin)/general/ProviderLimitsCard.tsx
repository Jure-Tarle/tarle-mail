"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { SettingsPanel } from "@/components/ui/settings-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProviderCredentialStatus } from "@/lib/email/outbound-provider-types";
import { requestJson } from "../domains/api";
import { PROVIDER_NAME_KEYS } from "../domains/FallbackOrderSection";
import ProviderCredentialsPanel from "../domains/ProviderCredentialsPanel";

const STORED = ["brevo", "mailjet", "smtp"] as const;

/** An empty field means no cap; anything else must be a whole number above zero. */
function parseCap(value: string): number | null | undefined {
	if (!value.trim()) return null;
	const cap = Number(value);
	return Number.isInteger(cap) && cap > 0 ? cap : undefined;
}

function ProviderRow({ status, onChanged }: { status: ProviderCredentialStatus; onChanged: () => void }) {
	const { t } = useLanguage();
	const [daily, setDaily] = useState(status.limit.daily?.toString() ?? "");
	const [monthly, setMonthly] = useState(status.limit.monthly?.toString() ?? "");
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("");
	const stored = (STORED as readonly string[]).includes(status.provider);

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const limit = { daily: parseCap(daily), monthly: parseCap(monthly) };
		if (limit.daily === undefined || limit.monthly === undefined) { setMessage(t("providers.limits.invalid")); return; }
		setSaving(true);
		setMessage("");
		try {
			await requestJson(`/api/admin/providers/${status.provider}`, "PUT", { limit });
			setMessage(t("providers.limits.saved"));
			onChanged();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : t("general.saveFailed"));
		} finally { setSaving(false); }
	}

	return (
		<li className="space-y-3 rounded-xl bg-neutral-50 p-4 text-sm">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-medium text-neutral-900">{t(PROVIDER_NAME_KEYS[status.provider])}</span>
				<span className={status.configured ? "text-xs text-green-700" : "text-xs text-amber-600"}>{status.configured ? t("providers.setUp") : t("providers.needsSetup")}</span>
			</div>
			<p className="text-xs text-neutral-500">{t("providers.limits.usage", { today: status.usage.today, month: status.usage.month })}</p>
			<form onSubmit={save} className="flex flex-wrap items-end gap-3">
				<div className="space-y-1"><Label htmlFor={`${status.provider}-daily`}>{t("providers.limits.daily")}</Label><Input id={`${status.provider}-daily`} type="number" min="1" step="1" value={daily} onChange={(event) => setDaily(event.target.value)} className="w-36 bg-white" /></div>
				<div className="space-y-1"><Label htmlFor={`${status.provider}-monthly`}>{t("providers.limits.monthly")}</Label><Input id={`${status.provider}-monthly`} type="number" min="1" step="1" value={monthly} onChange={(event) => setMonthly(event.target.value)} className="w-36 bg-white" /></div>
				<Button type="submit" size="sm" disabled={saving}>{saving ? t("common.saving") : t("providers.limits.save")}</Button>
			</form>
			{message && <p role="status" className="text-xs text-neutral-700">{message}</p>}
			{stored && (
				<details className="rounded-lg bg-white px-3 py-2">
					<summary className="cursor-pointer text-xs font-medium text-neutral-800">{t("providers.credentials")}</summary>
					<div className="mt-2"><ProviderCredentialsPanel provider={status.provider as (typeof STORED)[number]} onChanged={onChanged} /></div>
				</details>
			)}
		</li>
	);
}

/** Credentials and optional daily and monthly caps for every sending provider; a provider at its cap is skipped for the domain's fallback. */
export default function ProviderLimitsCard() {
	const { t } = useLanguage();
	const [providers, setProviders] = useState<ProviderCredentialStatus[] | null>(null);
	const [error, setError] = useState("");

	const load = useCallback(() => {
		requestJson<{ providers: ProviderCredentialStatus[] }>("/api/admin/providers", "GET")
			.then((data) => setProviders(data.providers))
			.catch((err) => setError(err instanceof Error ? err.message : t("providers.loadFailed")));
	}, [t]);
	useEffect(() => { load(); }, [load]);

	return (
		<SettingsPanel title={t("providers.title")} description={t("providers.description")}>
			{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
			{providers && <ul className="grid gap-3 2xl:grid-cols-2">{providers.map((status) => <ProviderRow key={`${status.provider}:${status.limit.daily}:${status.limit.monthly}`} status={status} onChanged={load} />)}</ul>}
		</SettingsPanel>
	);
}
