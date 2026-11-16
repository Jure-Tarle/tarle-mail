import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { requestJson } from "./api";
import { ROW_GRID, StatusBadge } from "./status-row";
import type { DomainHealth, HealthStatus, RepairResult } from "./types";

const rowClass: Record<HealthStatus, string> = {
	ok: "bg-green-50 text-green-800",
	missing: "bg-red-50 text-red-800",
	wrong: "bg-red-50 text-red-800",
	unknown: "bg-neutral-100 text-neutral-600",
	skipped: "bg-neutral-50 text-neutral-500",
};

/** On-demand comparison of a domain's DNS and routing with what its providers need, with a confirmed one-click repair. */
export default function DomainHealthSection({ domainId, onRepaired }: { domainId: string; onRepaired?: () => void }) {
	const { t } = useLanguage();
	const [health, setHealth] = useState<DomainHealth | null>(null);
	const [busy, setBusy] = useState<"check" | "repair" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [results, setResults] = useState<RepairResult[]>([]);

	const url = `/api/domains/${domainId}/health`;

	async function check() {
		setBusy("check");
		setError(null);
		setResults([]);
		try {
			setHealth((await requestJson<{ health: DomainHealth }>(url, "GET")).health);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t("domains.health.failed"));
		} finally {
			setBusy(null);
		}
	}

	async function repair() {
		if (!health || health.plan.length === 0) return;
		const changes = health.plan.map((item) => `• ${item.summary}`).join("\n");
		const confirmed = await confirmDialog({
			title: t("domains.health.repairTitle"),
			message: t("domains.health.repairConfirm", { changes }),
			confirmLabel: t("domains.health.repairConfirmLabel"),
		});
		if (!confirmed) return;
		setBusy("repair");
		setError(null);
		try {
			const response = await requestJson<{ results: RepairResult[]; health: DomainHealth }>(url, "POST", { keys: health.plan.map((item) => item.key) });
			setResults(response.results);
			setHealth(response.health);
			onRepaired?.();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t("domains.health.failed"));
		} finally {
			setBusy(null);
		}
	}

	const failed = results.filter((result) => !result.ok);

	return (
		<section className="mt-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="text-base font-semibold text-neutral-900">{t("domains.health.title")}</h2>
					<p className="mt-0.5 text-sm text-neutral-500">{t("domains.health.description")}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="outline" size="sm" className="bg-white" disabled={busy !== null} onClick={() => void check()}>
						{busy === "check" ? t("domains.health.running") : health ? t("domains.health.recheck") : t("domains.health.run")}
					</Button>
					{health && health.plan.length > 0 && (
						<Button size="sm" disabled={busy !== null} onClick={() => void repair()}>
							{busy === "repair" ? t("domains.health.repairing") : t("domains.health.repair", { count: health.plan.length })}
						</Button>
					)}
				</div>
			</div>
			{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
			{health?.manual && <p className="mt-3 text-sm text-neutral-500">{t("domains.health.manual")}</p>}
			{health && !health.manual && (
				<ul className="mt-3 space-y-2">
					{health.checks.map((check) => (
						<li key={check.id} className={`${ROW_GRID} ${rowClass[check.status]}`}>
							<StatusBadge ok={check.status === "ok"} tone={check.status === "missing" || check.status === "wrong" ? "red" : "neutral"} />
							<span className="min-w-0">
								<span className="block font-medium text-neutral-900">{t(`domains.health.check.${check.id}`)}</span>
								<span className="block text-xs uppercase tracking-wide text-neutral-500">{t(`domains.health.status.${check.status}`)}</span>
							</span>
							<span className="min-w-0 break-words">
								<span className="block">{check.message}</span>
								{check.status !== "ok" && check.status !== "skipped" && check.found.length > 0 && (
									<span className="mt-1 block break-all text-xs text-neutral-500">{t("domains.health.found")}: {check.found.join(" | ")}</span>
								)}
								{check.status !== "ok" && check.status !== "skipped" && check.expected.length > 0 && (
									<span className="mt-1 block break-all text-xs text-neutral-500">{t("domains.health.expected")}: {check.expected.join(" | ")}</span>
								)}
							</span>
						</li>
					))}
				</ul>
			)}
			{health && !health.manual && health.plan.length === 0 && !health.checks.some((check) => check.status === "missing" || check.status === "wrong") && (
				<p className="mt-2 text-sm text-green-700">{t("domains.health.allGood")}</p>
			)}
			{results.length > 0 && (
				<div role="status" className="mt-3 space-y-1 text-xs">
					<p className="font-medium text-neutral-900">{t("domains.health.repairDone", { ok: results.length - failed.length, failed: failed.length })}</p>
					{failed.map((result) => (
						<p key={result.key} className="break-words text-red-600">{result.summary}: {result.error}</p>
					))}
				</div>
			)}
		</section>
	);
}
