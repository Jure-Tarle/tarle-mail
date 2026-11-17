"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Mail, PenLine, Send, Wrench } from "@/components/icons";
import { fetchCachedMessageDetail } from "@/lib/messages/detail-cache";
import { useLanguage } from "@/components/language-provider";
import type { AgentDraftAction, AgentEmailReference, AgentMessage, AgentTurnProps } from "./types";
import { agentActionProposal, agentToolLabel, draftFromToolContent, parseAgentToolContent } from "./utils";
import { AgentEmailLink } from "./email-link";

function emailReferences(value: Record<string, unknown>): AgentEmailReference[] {
	if (Array.isArray(value.emails)) return value.emails.filter((item): item is AgentEmailReference => !!item && typeof item === "object" && typeof item.id === "string");
	if (typeof value.id === "string" && typeof value.subject === "string") return [value as AgentEmailReference];
	return [];
}

export function AgentToolActivity({ item, forceOpen }: { item: AgentMessage; forceOpen: boolean }) {
	const { t } = useLanguage();
	const [open, setOpen] = useState(forceOpen);
	const [prevForceOpen, setPrevForceOpen] = useState(forceOpen);
	if (forceOpen !== prevForceOpen) {
		setPrevForceOpen(forceOpen);
		setOpen(forceOpen);
	}
	const display = agentToolLabel(item.toolName, item.toolState, item.content, t);
	const result = parseAgentToolContent(item.content);
	const emails = result ? emailReferences(result) : [];
	return <details className="group/tool text-xs text-neutral-600" open={forceOpen || open} onToggle={(event) => { if (!forceOpen) setOpen(event.currentTarget.open); }}>
		<summary className="flex w-full max-w-full cursor-pointer list-none items-center gap-1.5 text-sm text-neutral-500 [&::-webkit-details-marker]:hidden">
			<Wrench size={13} className="shrink-0 text-neutral-400" aria-hidden="true" />
			<span className="truncate flex-1 min-w-0">{display.label}</span>
			<ChevronLeft size={13} className="shrink-0 text-neutral-400 transition-transform group-open/tool:-rotate-90" aria-hidden="true" />
		</summary>
		<div className="mt-1.5 space-y-2 pl-[18px] text-neutral-600">
			<p>{display.description}</p>
			{emails.length > 0 && <ul className="space-y-1.5">{emails.map((email) => <li key={email.id} className="break-words"><AgentEmailLink email={email} className="font-medium text-blue-700 hover:underline" />{email.from && <span className="text-neutral-500"> · {email.from}</span>}{email.snippet && <p className="line-clamp-2 text-neutral-500">{email.snippet}</p>}</li>)}</ul>}
			{result && Object.entries(result).filter(([key, value]) => !["emails", "text", "attachments", "result", "id", "subject", "from", "snippet", "url", "reviewUrl", "action", "status"].includes(key) && value !== null && typeof value !== "object").map(([key, value]) => <p key={key} className="break-words"><span className="text-neutral-500">{key.replace(/([A-Z])/g, " $1")}: </span>{String(value)}</p>)}
			{typeof result?.text === "string" && <p className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words">{result.text}</p>}
			{Array.isArray(result?.attachments) && result.attachments.length > 0 && <p>{t("agent.activity.attachments", { list: result.attachments.map((file: { filename?: string }) => file.filename || t("agent.activity.attachment")).join(", ") })}</p>}
			{!result && item.content && <p className="whitespace-pre-wrap break-words">{item.content}</p>}
		</div>
	</details>;
}

/**
 * A draft the assistant wrote, shown as a card: who it goes to, the subject and the first lines, with
 * editing and the send review as clear buttons. The card reads the draft itself, so the model's tool
 * results stay small, and reloads it whenever the assistant saves a new revision.
 */
export function AgentDraftActions({ action, onOpenDraft, onApproveDraft, approvingId }: { action: AgentDraftAction } & Pick<AgentTurnProps, "onOpenDraft" | "onApproveDraft" | "approvingId">) {
	const { t } = useLanguage();
	const [detail, setDetail] = useState<{ key: string; to: string; subject: string; preview: string } | null>(null);
	const key = `${action.draftId}:${action.revision}`;
	useEffect(() => {
		let active = true;
		void fetchCachedMessageDetail(action.draftId, true).then(({ message, body }) => {
			if (!active || !message) return;
			const text = (body?.textBody ?? message.snippet ?? "").replace(/\s+\n/g, "\n").trim();
			setDetail({ key, // toAddr may already carry display names ("Name" <a@b>); only add the contact name to a bare address.
			to: (message.toContactName && !message.toAddr.includes("<") ? `${message.toContactName} <${message.toAddr}>` : message.toAddr).replace(/"/g, ""), subject: message.subject ?? "", preview: text });
		}).catch(() => {});
		return () => { active = false; };
	}, [action.draftId, key]);
	const shown = detail?.key === key ? detail : null;
	return <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
		<header className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2.5">
			<span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-700"><Mail size={15} /></span>
			<span className="text-sm font-semibold text-neutral-900">{t("agent.draftCard.title")}</span>
			{action.scheduledAt && <span className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{t("agent.draftCard.scheduled", { time: new Date(action.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) })}</span>}
		</header>
		<div className="space-y-1 px-4 py-3 text-sm">
			{shown ? <>
				<p className="truncate"><span className="text-neutral-500">{t("agent.draftCard.to")} </span><span className="text-neutral-900">{shown.to}</span></p>
				{shown.subject && <p className="truncate font-medium text-neutral-900">{shown.subject}</p>}
				{shown.preview && <p className="line-clamp-4 whitespace-pre-line pt-1 text-neutral-600">{shown.preview}</p>}
			</> : <div className="space-y-2" aria-hidden="true"><div className="h-3 w-2/3 rounded bg-neutral-100" /><div className="h-3 w-1/2 rounded bg-neutral-100" /><div className="h-3 w-full rounded bg-neutral-100" /></div>}
		</div>
		<footer className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-4 py-2.5">
			<button type="button" onClick={() => onOpenDraft(action.draftId)} className="flex min-h-9 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100"><PenLine size={14} />{t("agent.activity.editDraft")}</button>
			<button type="button" className="flex min-h-9 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" disabled={approvingId === action.draftId} onClick={() => onApproveDraft(action.draftId, action.revision)}><Send size={14} />{action.scheduledAt ? t("agent.activity.schedule") : t("agent.activity.approveSend")}</button>
		</footer>
	</article>;
}

export function AgentPendingActions({ item, onApproveAction, approvingId }: Pick<AgentTurnProps, "onApproveAction" | "approvingId"> & { item: AgentMessage }) {
	const { t } = useLanguage();
	const proposal = agentActionProposal(item.content);
	if (proposal?.status !== "pending_approval" || draftFromToolContent(item.content)) return null;
	return <div className="space-y-2 text-xs">
		{proposal.emails && <ul className="space-y-1">{proposal.emails.map((email) => <li key={email.id}><AgentEmailLink email={email} className="text-blue-700 hover:underline" /></li>)}</ul>}
		<div className="flex flex-wrap items-center justify-end gap-3">
			<button type="button" className="rounded-lg bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-50" disabled={!item.recordId || approvingId === item.id} onClick={() => onApproveAction(item)}>{approvingId === item.id ? t("agent.activity.approving") : proposal.action === "discard_draft" ? t("agent.activity.approveDiscard") : proposal.action === "mark_email_read" ? t("agent.activity.approveStatus") : t("agent.activity.approveMove", { destination: proposal.destination })}</button>
		</div>
	</div>;
}
