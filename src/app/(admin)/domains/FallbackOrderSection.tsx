"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Trash2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { OutboundProviderName, ProviderCredentialStatus } from "@/lib/email/outbound-provider-types";
import type { TranslationKey } from "@/lib/i18n/types";
import { requestJson } from "./api";
import type { Domain } from "./types";

export const PROVIDER_NAME_KEYS: Record<OutboundProviderName, TranslationKey> = {
	cloudflare: "providers.name.cloudflare",
	resend: "providers.name.resend",
	ses: "providers.name.ses",
	brevo: "providers.name.brevo",
	mailjet: "providers.name.mailjet",
	smtp: "providers.name.smtp",
};

const ALL_PROVIDERS = Object.keys(PROVIDER_NAME_KEYS) as OutboundProviderName[];

/**
 * The ordered list of providers tried after the domain's own one is over its cap, rate limited or
 * unavailable. Every change is saved straight away; the server drops the domain's own provider from it.
 */
export default function FallbackOrderSection({ domain }: { domain: Domain }) {
	const { t } = useLanguage();
	const [fallback, setFallback] = useState<OutboundProviderName[]>([]);
	const [configured, setConfigured] = useState<Partial<Record<OutboundProviderName, boolean>>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let active = true;
		requestJson<{ fallback: OutboundProviderName[] }>(`/api/domains/${domain.id}/fallback`, "GET")
			.then((data) => { if (active) setFallback(data.fallback); })
			.catch((err) => { if (active) setError(err instanceof Error ? err.message : t("providers.fallback.saveFailed")); });
		// The status list is for the primary administrator; for anyone else every entry just shows no warning.
		requestJson<{ providers: ProviderCredentialStatus[] }>("/api/admin/providers", "GET")
			.then((data) => { if (active) setConfigured(Object.fromEntries(data.providers.map((entry) => [entry.provider, entry.configured]))); })
			.catch(() => undefined);
		return () => { active = false; };
	}, [domain.id, domain.sendingProvider, t]);

	async function save(next: OutboundProviderName[]) {
		setBusy(true);
		setError("");
		try {
			const data = await requestJson<{ fallback: OutboundProviderName[] }>(`/api/domains/${domain.id}/fallback`, "PUT", { fallback: next });
			setFallback(data.fallback);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("providers.fallback.saveFailed"));
		} finally { setBusy(false); }
	}

	const move = (index: number, by: -1 | 1) => {
		const next = [...fallback];
		[next[index], next[index + by]] = [next[index + by], next[index]];
		void save(next);
	};
	const available = ALL_PROVIDERS.filter((provider) => provider !== domain.sendingProvider && !fallback.includes(provider));

	return (
		<section className="mt-4 rounded-xl bg-neutral-50 px-4 py-3 text-sm">
			<h3 className="font-medium text-neutral-900">{t("providers.fallback.title")}</h3>
			<p className="mt-0.5 text-xs text-neutral-500">{t("providers.fallback.hint")}</p>
			{fallback.length === 0 ? (
				<p className="mt-2 text-xs text-neutral-500">{t("providers.fallback.empty")}</p>
			) : (
				<ol className="mt-2 space-y-1">
					{fallback.map((provider, index) => {
						const name = t(PROVIDER_NAME_KEYS[provider]);
						return (
							<li key={provider} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5">
								<span className="w-5 text-xs text-neutral-400">{index + 1}</span>
								<span className="min-w-0 flex-1 truncate text-neutral-900">{name}</span>
								{configured[provider] === false && <span className="text-xs text-amber-600">{t("providers.fallback.notSetUp")}</span>}
								<Button size="sm" variant="ghost" aria-label={t("providers.fallback.moveUp", { provider: name })} disabled={busy || index === 0} onClick={() => move(index, -1)}><ChevronDown className="h-4 w-4 rotate-180" /></Button>
								<Button size="sm" variant="ghost" aria-label={t("providers.fallback.moveDown", { provider: name })} disabled={busy || index === fallback.length - 1} onClick={() => move(index, 1)}><ChevronDown className="h-4 w-4" /></Button>
								<Button size="sm" variant="ghost" aria-label={t("providers.fallback.remove", { provider: name })} disabled={busy} onClick={() => void save(fallback.filter((entry) => entry !== provider))}><Trash2 className="h-4 w-4" /></Button>
							</li>
						);
					})}
				</ol>
			)}
			{available.length > 0 && (
				<Select
					aria-label={t("providers.fallback.add")}
					value=""
					placeholder={t("providers.fallback.add")}
					disabled={busy}
					onChange={(event) => { if (event.target.value) void save([...fallback, event.target.value as OutboundProviderName]); }}
					containerClassName="mt-2 h-9 max-w-xs rounded-md bg-white px-0"
					className="px-3 text-sm"
				>
					{available.map((provider) => <option key={provider} value={provider}>{t(PROVIDER_NAME_KEYS[provider])}</option>)}
				</Select>
			)}
			{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
		</section>
	);
}
