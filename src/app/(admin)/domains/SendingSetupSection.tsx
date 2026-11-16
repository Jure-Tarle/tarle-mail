"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import type { ProviderCredentialStatus } from "@/lib/email/outbound-provider-types";
import type { TranslationKey } from "@/lib/i18n/types";
import { requestJson } from "./api";
import FallbackOrderSection from "./FallbackOrderSection";
import ProviderCard from "./ProviderCard";
import ProviderCredentialsPanel from "./ProviderCredentialsPanel";
import ResendDomainSection from "./ResendDomainSection";
import SesSendingConfig from "./SesSendingConfig";
import type { Domain, SendingProvider } from "./types";

type Option = Exclude<SendingProvider, "none">;
type Present = Record<"cloudflare" | "resend" | "ses", boolean | null>;

const OPTIONS: { id: Option; titleKey: TranslationKey; descriptionKey: TranslationKey }[] = [
	{ id: "cloudflare", titleKey: "domains.opt.cfEmail", descriptionKey: "domains.opt.cfSendDesc" },
	{ id: "resend", titleKey: "domains.providerResend", descriptionKey: "domains.opt.resendSendDesc" },
	{ id: "ses", titleKey: "domains.providerSes", descriptionKey: "domains.opt.sesSendDesc" },
	{ id: "brevo", titleKey: "providers.name.brevo", descriptionKey: "providers.opt.brevoSendDesc" },
	{ id: "mailjet", titleKey: "providers.name.mailjet", descriptionKey: "providers.opt.mailjetSendDesc" },
	{ id: "smtp", titleKey: "providers.name.smtp", descriptionKey: "providers.opt.smtpSendDesc" },
];

/** Providers whose credentials are saved in the app settings and need no per-domain setup. */
const CREDENTIAL_ONLY = ["brevo", "mailjet", "smtp"] as const;
type CredentialOnly = (typeof CREDENTIAL_ONLY)[number];
const isCredentialOnly = (option: Option): option is CredentialOnly => (CREDENTIAL_ONLY as readonly string[]).includes(option);

type Props = {
	domain: Domain;
	onChange?: (provider: SendingProvider) => void;
	busy?: boolean;
	message?: string | null;
	/** Config UI for Cloudflare sending, rendered by the parent which owns the DNS audit. */
	cloudflareConfig: ReactNode;
	/** Whether Cloudflare sending is fully set up (subdomain enabled, DKIM present). */
	cloudflareOk: boolean;
};

type PresenceResponse = Partial<Present> & { resendStatus?: string | null; sesVerified?: boolean | null };

export default function SendingSetupSection({ domain, onChange, busy, message, cloudflareConfig, cloudflareOk }: Props) {
	const { t } = useLanguage();
	const [present, setPresent] = useState<Present>({ cloudflare: null, resend: null, ses: null });
	const [resendStatus, setResendStatus] = useState<string | null>(null);
	const [sesStatus, setSesStatus] = useState<string | null>(null);
	const [credentialsOk, setCredentialsOk] = useState<Record<CredentialOnly, boolean | null>>({ brevo: null, mailjet: null, smtp: null });
	const [reload, setReload] = useState(0);
	const [removing, setRemoving] = useState<Option | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		let active = true;
		requestJson<PresenceResponse>(`/api/domains/${domain.id}/sending`, "GET")
			.then((data) => {
				if (!active) return;
				setPresent({ cloudflare: data.cloudflare ?? null, resend: data.resend ?? null, ses: data.ses ?? null });
				setResendStatus(data.resendStatus ?? null);
				setSesStatus(data.sesVerified === null || data.sesVerified === undefined ? null : data.sesVerified ? "verified" : "pending");
			})
			.catch(() => { if (active) setPresent({ cloudflare: null, resend: null, ses: null }); });
		return () => { active = false; };
	}, [domain.id, domain.sendingProvider, reload]);

	// Only the primary administrator can read provider status; for anyone else the cards just show no check mark.
	const loadCredentials = useCallback(() => {
		requestJson<{ providers: ProviderCredentialStatus[] }>("/api/admin/providers", "GET")
			.then((data) => setCredentialsOk({ brevo: false, mailjet: false, smtp: false, ...Object.fromEntries(data.providers.filter((entry) => isCredentialOnly(entry.provider as Option)).map((entry) => [entry.provider, entry.configured])) }))
			.catch(() => undefined);
	}, []);
	useEffect(() => { loadCredentials(); }, [loadCredentials, domain.sendingProvider]);

	async function cleanUp(option: Option, title: string) {
		if (!await confirmDestructive(t("domains.removeSendingConfirm", { title, host: domain.hostname }))) return;
		setRemoving(option);
		setError("");
		try {
			await requestJson(`/api/domains/${domain.id}/sending`, "DELETE", { target: option });
			setReload((value) => value + 1);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("domains.removeConfigFailed"));
		} finally { setRemoving(null); }
	}

	// true/false when we know whether the option is set up, null when we cannot tell.
	const okFor = (option: Option): boolean | null =>
		option === "cloudflare" ? cloudflareOk
		: isCredentialOnly(option) ? credentialsOk[option]
		: option === "resend" ? (resendStatus === null ? null : resendStatus === "verified")
		: (sesStatus === null ? null : sesStatus === "verified");

	return (
		<section className="mt-6">
			<h2 className="text-base font-semibold text-neutral-900">{t("domains.setupSending")}</h2>
			<p className="mt-0.5 text-sm text-neutral-500">
				{domain.sendingProvider === "none" ? t("domains.sendingNone") : t("domains.sendingChoose")}
			</p>
			<ul className="mt-3 space-y-2">
				{OPTIONS.map((option) => {
					const selected = domain.sendingProvider === option.id;
					const id = option.id;
					const stored = isCredentialOnly(id);
					const remote = stored ? false : present[id];
					return (
						<ProviderCard
							key={option.id}
							title={t(option.titleKey)}
							description={t(option.descriptionKey)}
							ok={selected || remote ? okFor(id) : null}
							selected={selected}
							disabled={busy}
							onToggle={(on) => onChange?.(on ? option.id : "none")}
							cleanup={stored ? null : { present: !!remote, busy: removing === id, disabled: removing !== null, onClick: () => void cleanUp(id, t(option.titleKey)) }}
						>
							{id === "cloudflare" ? cloudflareConfig
								: stored ? <ProviderCredentialsPanel provider={id} onChanged={loadCredentials} />
								: id === "resend" ? <ResendDomainSection domainId={domain.id} onStatus={setResendStatus} />
								: <SesSendingConfig domainId={domain.id} onStatus={setSesStatus} />}
						</ProviderCard>
					);
				})}
			</ul>
			{domain.sendingProvider !== "none" && <FallbackOrderSection domain={domain} />}
			{message && <p role="alert" className="mt-2 text-xs text-red-600">{message}</p>}
			{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
		</section>
	);
}
