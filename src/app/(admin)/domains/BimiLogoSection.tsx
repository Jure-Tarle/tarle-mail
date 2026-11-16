"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import type { OwnLogoStatus } from "@/lib/bimi/own-logo";
import { requestJson } from "./api";
import { ROW_GRID, StatusBadge, StatusRow } from "./status-row";
import type { Domain } from "./types";

/** The domain's own BIMI logo: upload, the public address mail apps fetch it from, and what is still missing before they show it. */
export default function BimiLogoSection({ domain }: { domain: Domain }) {
	const { t } = useLanguage();
	const [status, setStatus] = useState<OwnLogoStatus | null>(null);
	const [version, setVersion] = useState(0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let active = true;
		requestJson<OwnLogoStatus>(`/api/domains/${domain.id}/bimi`, "GET")
			.then((data) => { if (active) setStatus(data); })
			.catch(() => undefined);
		return () => { active = false; };
	}, [domain.id]);

	async function change(request: () => Promise<OwnLogoStatus>) {
		setBusy(true);
		setError("");
		try {
			const next = await request();
			setStatus(next);
			setVersion(Date.now());
			if (next.dnsError) setError(t("domains.bimi.dnsFailed", { error: next.dnsError }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t("domains.requestFailed"));
		} finally {
			setBusy(false);
		}
	}

	async function upload(file: File | undefined) {
		if (input.current) input.current.value = "";
		if (!file) return;
		const svg = await file.text();
		await change(() => requestJson<OwnLogoStatus>(`/api/domains/${domain.id}/bimi`, "PUT", { svg }));
	}

	if (!status) return null;
	const { record } = status;
	const recordHint = record.state === "ok"
		? t("domains.bimi.recordOk", { name: record.name })
		: record.state === "different"
			? t("domains.bimi.recordDifferent", { name: record.name, current: record.current ?? "" })
			: record.state === "unchecked"
				? t("domains.bimi.recordUnchecked")
				: t("domains.bimi.recordMissing", { name: record.name });
	const dmarcHint = status.dmarc.enforced
		? t("domains.bimi.dmarcOk")
		: t("domains.bimi.dmarcNo", { record: status.dmarc.record ?? t("domains.bimi.dmarcNone") });

	return (
		<section className="mt-6">
			<h2 className="text-base font-semibold text-neutral-900">{t("domains.bimi.title")}</h2>
			<p className="mt-0.5 text-sm text-neutral-500">{t("domains.bimi.description")}</p>
			<ul className="mt-3 space-y-2">
				<li className={`${ROW_GRID} ${status.hasLogo ? "bg-green-50" : "bg-neutral-50"}`}>
					<StatusBadge ok={status.hasLogo} tone="neutral" />
					<span className="min-w-0">
						<span className="block font-medium text-neutral-900">{t("domains.bimi.logo")}</span>
						<span className="block text-xs text-neutral-500">{t("domains.bimi.logoHint")}</span>
					</span>
					<div className="min-w-0 space-y-2 break-words text-neutral-500">
						{status.hasLogo ? (
							<>
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src={`/bimi/${domain.hostname}.svg?v=${version}`} alt="" className="h-16 w-16 rounded-full bg-white object-contain ring-1 ring-neutral-200" />
								<p className="text-xs">{status.logoUrl}</p>
							</>
						) : (
							<p>{t("domains.bimi.logoNone")}</p>
						)}
						<div className="flex flex-wrap gap-2">
							<input ref={input} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
							<Button type="button" size="sm" disabled={busy} onClick={() => input.current?.click()}>
								{status.hasLogo ? t("domains.bimi.replace") : t("domains.bimi.upload")}
							</Button>
							{status.hasLogo && (
								<Button type="button" size="sm" variant="outline" className="bg-white" disabled={busy} onClick={() => void change(() => requestJson<OwnLogoStatus>(`/api/domains/${domain.id}/bimi`, "DELETE"))}>
									{t("domains.bimi.remove")}
								</Button>
							)}
						</div>
					</div>
				</li>
				{status.hasLogo && (
					<>
						<StatusRow ok={record.state === "ok"} title={t("domains.bimi.record")} hint={recordHint}>
							{!status.managed && record.state !== "ok" && <code className="block text-xs">{record.name} TXT {record.expected}</code>}
						</StatusRow>
						<StatusRow ok={status.https} title={t("domains.bimi.https")} hint={status.https ? t("domains.bimi.httpsOk") : t("domains.bimi.httpsNo")} />
					</>
				)}
				<StatusRow ok={status.dmarc.enforced} title={t("domains.bimi.dmarc")} hint={dmarcHint} />
			</ul>
			<p className="mt-2 text-xs text-neutral-500">{t("domains.bimi.certificate")}</p>
			{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
		</section>
	);
}
