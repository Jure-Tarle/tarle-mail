"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import {
	forgetRemoteContentSender,
	loadAllowedRemoteContentSenders,
	loadRemoteContentPolicy,
	updateRemoteContentMode,
	type RemoteContentMode,
} from "@/components/messages/use-remote-content-utils";

const OPTIONS = [
	{ mode: "ask", title: "settings.remoteContent.ask", description: "settings.remoteContent.askHint" },
	{ mode: "new_sender", title: "settings.remoteContent.newSender", description: "settings.remoteContent.newSenderHint" },
	{ mode: "allow", title: "settings.remoteContent.allow", description: "settings.remoteContent.allowHint" },
] as const;

export function RemoteContentSettings() {
	const { t } = useLanguage();
	const [mode, setMode] = useState<RemoteContentMode>("allow");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [senders, setSenders] = useState<string[] | null>(null);
	const [forgetting, setForgetting] = useState<string | null>(null);

	const loadSenders = useCallback(() => {
		loadAllowedRemoteContentSenders().then(setSenders).catch(() => setSenders([]));
	}, []);

	useEffect(() => {
		let cancelled = false;
		loadRemoteContentPolicy()
			.then((policy) => { if (!cancelled) setMode(policy.mode); })
			.catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("settings.remoteContent.failed")); })
			.finally(() => { if (!cancelled) setLoading(false); });
		loadSenders();
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const choose = (next: RemoteContentMode) => {
		const previous = mode;
		setMode(next);
		setSaving(true);
		setError(null);
		updateRemoteContentMode(next)
			.then(setMode)
			.catch((updateError) => {
				setMode(previous);
				setError(updateError instanceof Error ? updateError.message : t("settings.remoteContent.failed"));
			})
			.finally(() => setSaving(false));
	};

	const forget = (sender: string) => {
		setForgetting(sender);
		setError(null);
		forgetRemoteContentSender(sender)
			.then(() => setSenders((current) => current?.filter((item) => item !== sender) ?? null))
			.catch(() => setError(t("settings.remoteContent.forgetFailed")))
			.finally(() => setForgetting(null));
	};

	return (
		<div className="space-y-5">
			<div className="@container">
				<div role="radiogroup" aria-label={t("settingsPage.inbox.remoteContent")} className="grid gap-3 @2xl:grid-cols-3">
					{OPTIONS.map((option) => (
						<label key={option.mode} className="flex cursor-pointer items-start gap-3 rounded-xl bg-neutral-50 p-4 has-[:checked]:bg-blue-50 has-[:checked]:ring-1 has-[:checked]:ring-blue-200">
							<input
								type="radio"
								name="remote-content-mode"
								className="mt-1"
								checked={mode === option.mode}
								disabled={loading || saving}
								onChange={() => choose(option.mode)}
							/>
							<span className="flex-1">
								<span className="block text-sm font-medium text-neutral-900">{t(option.title)}</span>
								<span className="mt-1 block text-xs leading-5 text-neutral-500">{t(option.description)}</span>
							</span>
						</label>
					))}
				</div>
			</div>
			{mode === "new_sender" && (
				<div>
					<h3 className="text-sm font-medium text-neutral-900">{t("settings.remoteContent.sendersTitle")}</h3>
					{senders === null ? null : senders.length === 0 ? (
						<p className="mt-1 text-sm text-neutral-500">{t("settings.remoteContent.sendersEmpty")}</p>
					) : (
						<ul className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200">
							{senders.map((sender) => (
								<li key={sender} className="flex min-h-11 items-center justify-between gap-3 py-1.5 pl-4 pr-1.5 text-sm">
									<span className="min-w-0 truncate text-neutral-800">{sender}</span>
									<button
										type="button"
										onClick={() => forget(sender)}
										disabled={forgetting === sender}
										aria-label={t("settings.remoteContent.forget", { sender })}
										title={t("settings.remoteContent.forget", { sender })}
										className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
									>
										<X className="h-4 w-4" />
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
			{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
		</div>
	);
}
