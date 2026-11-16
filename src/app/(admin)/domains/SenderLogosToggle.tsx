"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { requestJson } from "./api";

/** Whether the reader shows the BIMI logo a sender's domain publishes, for mail that passed DMARC. */
export default function SenderLogosToggle() {
	const { t } = useLanguage();
	const [enabled, setEnabled] = useState<boolean | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let active = true;
		requestJson<{ senderLogos: boolean }>("/api/bimi/settings", "GET")
			.then((data) => { if (active) setEnabled(data.senderLogos); })
			.catch(() => undefined);
		return () => { active = false; };
	}, []);

	async function change(next: boolean) {
		setBusy(true);
		setError("");
		try {
			const data = await requestJson<{ senderLogos: boolean }>("/api/bimi/settings", "PUT", { senderLogos: next });
			setEnabled(data.senderLogos);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("domains.requestFailed"));
		} finally {
			setBusy(false);
		}
	}

	if (enabled === null) return null;
	return (
		<div className="rounded-xl bg-neutral-50 px-4 py-3">
			<div className="flex items-center justify-between gap-4">
				<div>
					<Label htmlFor="sender-logos">{t("domains.bimi.senderLogos")}</Label>
					<p className="mt-1 text-xs leading-5 text-neutral-500">{t("domains.bimi.senderLogosHint")}</p>
				</div>
				<Switch id="sender-logos" checked={enabled} disabled={busy} onCheckedChange={(next) => void change(next)} />
			</div>
			{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
		</div>
	);
}
