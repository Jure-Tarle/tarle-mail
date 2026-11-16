"use client";

import { useEffect, useState } from "react";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ProviderCredentialStatus } from "@/lib/email/outbound-provider-types";
import type { TranslationKey } from "@/lib/i18n/types";
import { requestJson } from "./api";
import { StatusRow } from "./status-row";

export type StoredProvider = "brevo" | "mailjet" | "smtp";

type Field = { name: string; labelKey: TranslationKey; type: "text" | "password" | "number" };

const FIELDS: Record<StoredProvider, Field[]> = {
	brevo: [{ name: "apiKey", labelKey: "providers.apiKey", type: "password" }],
	mailjet: [
		{ name: "apiKey", labelKey: "providers.apiKey", type: "text" },
		{ name: "apiSecret", labelKey: "providers.apiSecret", type: "password" },
	],
	smtp: [
		{ name: "host", labelKey: "providers.smtp.host", type: "text" },
		{ name: "port", labelKey: "providers.smtp.port", type: "number" },
		{ name: "username", labelKey: "providers.smtp.username", type: "text" },
		{ name: "password", labelKey: "providers.smtp.password", type: "password" },
	],
};

const NAME_KEYS: Record<StoredProvider, TranslationKey> = { brevo: "providers.name.brevo", mailjet: "providers.name.mailjet", smtp: "providers.name.smtp" };

const emptyValues = (provider: StoredProvider): Record<string, string> => (provider === "smtp" ? { port: "587", security: "starttls" } : {});

type Props = {
	provider: StoredProvider;
	/** Called after credentials were saved or removed. */
	onChanged?: () => void;
};

/**
 * Credentials for one stored provider (Brevo, Mailjet or SMTP). The server proves them with the
 * provider before saving, and only ever answers with a masked summary, so nothing secret is shown.
 */
export default function ProviderCredentialsPanel({ provider, onChanged }: Props) {
	const { t } = useLanguage();
	const [status, setStatus] = useState<ProviderCredentialStatus | null>(null);
	const [editing, setEditing] = useState(false);
	const [values, setValues] = useState<Record<string, string>>(() => emptyValues(provider));
	const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	useEffect(() => {
		let active = true;
		requestJson<{ providers: ProviderCredentialStatus[] }>("/api/admin/providers", "GET")
			.then((data) => { if (active) setStatus(data.providers.find((entry) => entry.provider === provider) ?? null); })
			.catch((err) => {
				if (!active) return;
				setError(err instanceof Error ? err.message : t("providers.loadFailed"));
				setStatus((current) => current ?? { provider, configured: false, summary: null, limit: { daily: null, monthly: null }, usage: { today: 0, month: 0 } });
			});
		return () => { active = false; };
	}, [provider, t]);

	async function run(kind: "save" | "test" | "remove", action: () => Promise<void>) {
		setBusy(kind);
		setError("");
		setNotice("");
		try { await action(); } catch (err) { setError(err instanceof Error ? err.message : t("domains.requestFailed")); } finally { setBusy(null); }
	}

	const set = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }));
	const changeSecurity = (security: string) => setValues((current) => ({
		...current,
		security,
		// Follow the usual port for the chosen mode unless the admin typed another.
		port: current.port === "587" || current.port === "465" ? (security === "tls" ? "465" : "587") : current.port,
	}));

	const save = () => run("save", async () => {
		const data = await requestJson<{ status: ProviderCredentialStatus }>(`/api/admin/providers/${provider}`, "PUT", { credentials: values });
		setStatus(data.status);
		setValues(emptyValues(provider));
		setEditing(false);
		onChanged?.();
	});
	const test = () => run("test", async () => {
		const data = await requestJson<{ account: string | null }>(`/api/admin/providers/${provider}`, "POST", {});
		setNotice(data.account ? t("providers.testOkAccount", { account: data.account }) : t("providers.testOk"));
	});
	const remove = () => run("remove", async () => {
		if (!await confirmDestructive(t("providers.removeConfirm", { provider: t(NAME_KEYS[provider]) }))) return;
		const data = await requestJson<{ status: ProviderCredentialStatus }>(`/api/admin/providers/${provider}`, "DELETE", {});
		setStatus(data.status);
		onChanged?.();
	});

	const configured = !!status?.configured;
	const showForm = status !== null && (!configured || editing);
	const complete = FIELDS[provider].every((field) => field.name === "password" || field.name === "username" || (values[field.name] ?? "").trim());

	return (
		<div className="space-y-2">
			<ul className="space-y-2">
				<StatusRow
					ok={configured && !editing}
					title={t("providers.credentials")}
					hint={t("providers.credentialsHint")}
					action={configured && !editing ? (
						<>
							<Button size="sm" variant="outline" className="bg-white" disabled={busy !== null} onClick={() => void test()}>{busy === "test" ? t("providers.testing") : t("providers.test")}</Button>
							<Button size="sm" variant="outline" className="bg-white" disabled={busy !== null} onClick={() => { setEditing(true); setError(""); setNotice(""); }}>{t("providers.replace")}</Button>
							<Button size="sm" variant="outline" className="bg-white" disabled={busy !== null} onClick={() => void remove()}>{t("providers.remove")}</Button>
						</>
					) : undefined}
				>
					{showForm ? (
						<form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
							{FIELDS[provider].map((field) => (
								<Input
									key={field.name}
									type={field.type}
									autoComplete="off"
									aria-label={t(field.labelKey)}
									placeholder={t(field.labelKey)}
									value={values[field.name] ?? ""}
									onChange={(event) => set(field.name, event.target.value)}
									className="max-w-sm bg-white"
								/>
							))}
							{provider === "smtp" && (
								<Select aria-label={t("providers.smtp.security")} value={values.security} onChange={(event) => changeSecurity(event.target.value)} containerClassName="h-10 max-w-sm rounded-md bg-white px-0" className="px-3 text-sm">
									<option value="starttls">{t("providers.smtp.starttls")}</option>
									<option value="tls">{t("providers.smtp.tls")}</option>
								</Select>
							)}
							<span className="flex gap-2">
								<Button type="submit" size="sm" disabled={!complete || busy !== null}>{busy === "save" ? t("providers.testing") : t("providers.testSave")}</Button>
								{editing && <Button type="button" size="sm" variant="outline" className="bg-white" onClick={() => { setEditing(false); setValues(emptyValues(provider)); setError(""); }}>{t("common.cancel")}</Button>}
							</span>
						</form>
					) : configured ? t("providers.saved", { summary: status?.summary }) : t("domains.checking")}
				</StatusRow>
			</ul>
			{notice && <p role="status" className="text-xs text-green-700">{notice}</p>}
			{error && <p role="alert" className="text-xs text-red-600">{error}</p>}
		</div>
	);
}
