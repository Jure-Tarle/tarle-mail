"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, KeyRound, RotateCw, Trash2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsPanel } from "@/components/ui/settings-panel";
import { Switch } from "@/components/ui/switch";
import { authFetch } from "@/lib/auth/client";
import type { AgentKeySummary } from "@/lib/agent/api-keys";
import { StepBadge } from "./StepBadge";

type KeysResponse = { keys: AgentKeySummary[]; encryption: boolean; error?: string };

async function request(method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<KeysResponse> {
	const res = await authFetch("/api/admin/agent/keys", {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = (await res.json()) as KeysResponse;
	if (!res.ok) throw new Error(json.error ?? "Request failed");
	return json;
}

/**
 * The secrets Tarle Mail uses to call the AI provider. Several keys are tried in order: when one is
 * rejected, rate limited or the provider is overloaded, the next one takes over automatically.
 * Not to be confused with access keys, which let other programs reach Tarle Mail.
 */
export function AgentProviderKeys({ onCountChange }: { onCountChange: (count: number) => void }) {
	const { t } = useLanguage();
	const [data, setData] = useState<KeysResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [label, setLabel] = useState("");
	const [key, setKey] = useState("");
	const [replacing, setReplacing] = useState<{ id: string; value: string } | null>(null);

	const apply = useCallback((next: KeysResponse) => {
		setData(next);
		onCountChange(next.keys.filter((item) => !item.disabled).length);
	}, [onCountChange]);

	useEffect(() => {
		request("GET").then(apply).catch((loadError) => setError(loadError instanceof Error ? loadError.message : t("agentKeys.failed")));
	}, [apply, t]);

	const run = (method: "POST" | "PATCH" | "DELETE", body: unknown, after?: () => void) => {
		setBusy(true);
		setError(null);
		request(method, body).then((next) => { apply(next); after?.(); }).catch((runError) => setError(runError instanceof Error ? runError.message : t("agentKeys.failed"))).finally(() => setBusy(false));
	};

	const keys = data?.keys ?? [];
	const move = (index: number, offset: -1 | 1) => {
		const ids = keys.map((item) => item.id);
		const target = index + offset;
		if (target < 0 || target >= ids.length) return;
		[ids[index], ids[target]] = [ids[target], ids[index]];
		run("PATCH", { ids });
	};

	const statusOf = (item: AgentKeySummary) => {
		if (item.disabled) return { text: t("agentKeys.status.disabled"), tone: "text-neutral-500" };
		if (item.cooldownUntil) {
			const until = new Date(item.cooldownUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
			const rejected = item.lastError?.startsWith("rejected");
			return { text: rejected ? t("agentKeys.status.rejected", { time: until }) : t("agentKeys.status.resting", { time: until }), tone: rejected ? "text-red-600" : "text-amber-600" };
		}
		return { text: t("agentKeys.status.active"), tone: "text-green-700" };
	};

	return (
		<SettingsPanel
			id="agent-keys"
			className="scroll-mt-6"
			title={<span className="flex items-center gap-2"><StepBadge number={2} /><KeyRound className="h-5 w-5" />{t("agentKeys.title")}</span>}
			description={t("agentKeys.description")}
			status={error ? <span className="text-red-700">{error}</span> : undefined}
		>
			{data && !data.encryption && (
				<p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					{t("agentKeys.notEncrypted")}
				</p>
			)}
			{keys.length > 0 && (
				<ol className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
					{keys.map((item, index) => {
						const state = statusOf(item);
						return (
							<li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-4 pr-2">
								<span className="min-w-0 flex-1 basis-48">
									<span className="block truncate text-sm font-medium text-neutral-900">
										{index + 1}. {item.label} <span className="font-normal text-neutral-500">••••{item.hint}</span>
									</span>
									<span className={`block truncate text-xs ${state.tone}`}>
										{state.text}
										{item.lastUsedAt && <span className="text-neutral-500"> · {t("agentKeys.lastUsed", { time: new Date(item.lastUsedAt).toLocaleString() })}</span>}
									</span>
								</span>
								<span className="flex items-center gap-1">
									<Switch checked={!item.disabled} disabled={busy} onCheckedChange={(on) => run("PATCH", { id: item.id, disabled: !on })} aria-label={t("agentKeys.toggle", { label: item.label })} />
									<Button type="button" variant="ghost" size="icon" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={t("agentKeys.up", { label: item.label })}><ArrowUp className="h-4 w-4" /></Button>
									<Button type="button" variant="ghost" size="icon" disabled={busy || index === keys.length - 1} onClick={() => move(index, 1)} aria-label={t("agentKeys.down", { label: item.label })}><ArrowDown className="h-4 w-4" /></Button>
									<Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => setReplacing(replacing?.id === item.id ? null : { id: item.id, value: "" })} aria-label={t("agentKeys.replace", { label: item.label })} aria-expanded={replacing?.id === item.id}><RotateCw className="h-4 w-4" /></Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										disabled={busy}
										onClick={async () => { if (await confirmDestructive(t("agentKeys.deleteConfirm", { label: item.label }))) run("DELETE", { id: item.id }); }}
										aria-label={t("agentKeys.delete", { label: item.label })}
									>
										<Trash2 className="h-4 w-4 text-red-600" />
									</Button>
								</span>
								{replacing?.id === item.id && (
									<form
										className="flex w-full flex-col gap-2 pb-1 sm:flex-row"
										onSubmit={(event) => {
											event.preventDefault();
											run("PATCH", { id: item.id, key: replacing.value }, () => setReplacing(null));
										}}
									>
										<Input type="password" autoComplete="new-password" autoFocus value={replacing.value} onChange={(event) => setReplacing({ id: item.id, value: event.target.value })} placeholder={t("agentKeys.replacePlaceholder")} aria-label={t("agentKeys.replace", { label: item.label })} className="sm:flex-1" />
										<span className="flex gap-2">
											<Button type="submit" size="sm" disabled={busy || replacing.value.trim().length < 8}>{t("agentKeys.replaceSave")}</Button>
											<Button type="button" size="sm" variant="ghost" onClick={() => setReplacing(null)}>{t("common.cancel")}</Button>
										</span>
									</form>
								)}
							</li>
						);
					})}
				</ol>
			)}
			<form
				className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end"
				onSubmit={(event) => {
					event.preventDefault();
					run("POST", { label: label.trim() || t("agentKeys.defaultLabel", { number: keys.length + 1 }), key }, () => { setLabel(""); setKey(""); });
				}}
			>
				<div className="space-y-2"><Label htmlFor="agent-key-label">{t("agentKeys.name")}</Label><Input id="agent-key-label" value={label} maxLength={80} placeholder={t("agentKeys.defaultLabel", { number: keys.length + 1 })} onChange={(event) => setLabel(event.target.value)} /></div>
				<div className="space-y-2"><Label htmlFor="agent-key-secret">{t("agentKeys.key")}</Label><Input id="agent-key-secret" type="password" autoComplete="new-password" value={key} onChange={(event) => setKey(event.target.value)} /></div>
				<Button type="submit" disabled={busy || key.trim().length < 8}>{t("agentKeys.add")}</Button>
			</form>
		</SettingsPanel>
	);
}
