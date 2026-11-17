"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { usePathname, useRouter } from "next/navigation";
import { AtSign, Check, ChevronDown, Inbox } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import type { MailboxOption } from "@/components/mailbox-provider";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { cn } from "@/lib/utils";

/** A message detail route such as /inbox/msg_… or /folders/<id>/msg_…; switching mailboxes leaves it for its list. */
const MESSAGE_DETAIL_SUFFIX = /\/msg_[^/]+$/;

const mailboxAddress = (mailbox: MailboxOption) => `${mailbox.localPart}@${mailbox.hostname}`;
const mailboxName = (mailbox: MailboxOption) => mailbox.displayName?.trim() || mailboxAddress(mailbox);
const formatCount = (count: number) => (count > 99 ? "99+" : String(count));

/**
 * Mailbox switcher at the top of the mail sidebar. A user owns one account but can have several
 * mailboxes; this picks the mailbox (or all of them) and the folders below belong to that choice.
 * The account itself lives in the avatar menu at the top right.
 */
export function MailboxesNavSection() {
	const { t } = useLanguage();
	const pathname = usePathname();
	const router = useRouter();
	const { mailboxes, selectedMailbox, setSelectedMailbox, showAllMailboxes, setShowAllMailboxes, isLoading } = useSelectedMailbox();
	const multiple = mailboxes.length > 1;
	const { counts } = useMessageCounts(null, multiple && !isLoading);
	if (!selectedMailbox) return null;

	const unreadByMailbox = new Map(counts.mailboxes.map((item) => [item.mailboxId, item.inboxUnread ?? 0]));
	const totalUnread = counts.mailboxes.reduce((sum, item) => sum + (item.inboxUnread ?? 0), 0);
	const currentTitle = showAllMailboxes ? t("navigation.allMailboxes") : mailboxName(selectedMailbox);
	const currentSubtitle = showAllMailboxes
		? t("navigation.mailboxCount", { count: mailboxes.length })
		: mailboxAddress(selectedMailbox);

	const summary = (
		<>
			<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
				{showAllMailboxes ? <Inbox size={16} strokeWidth={2} /> : <AtSign size={16} strokeWidth={2} />}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-semibold text-neutral-900">{currentTitle}</span>
				<span className="block truncate text-xs text-neutral-500">{currentSubtitle}</span>
			</span>
		</>
	);

	// One mailbox: show which one this is, with nothing to switch.
	if (!multiple) {
		return <div className="mx-3 mb-2 flex items-center gap-3 rounded-2xl px-3 py-2">{summary}</div>;
	}

	function leaveMessageDetail() {
		if (MESSAGE_DETAIL_SUFFIX.test(pathname)) router.push(pathname.replace(MESSAGE_DETAIL_SUFFIX, ""));
	}

	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<button
					type="button"
					aria-label={t("navigation.switchMailbox", { mailbox: currentTitle })}
					className="mx-3 mb-2 flex min-h-12 items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-neutral-200/60 focus-visible:outline-2 focus-visible:outline-blue-600 data-[state=open]:bg-neutral-200/60"
				>
					{summary}
					<ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
				</button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="start"
					sideOffset={6}
					className="z-[120] max-h-[70vh] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-1.5 text-sm shadow-xl"
				>
					<DropdownMenu.Label className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
						{t("navigation.mailboxes")}
					</DropdownMenu.Label>
					<MailboxMenuItem
						active={showAllMailboxes}
						icon={<Inbox size={16} strokeWidth={2} />}
						title={t("navigation.allMailboxes")}
						count={totalUnread}
						onSelect={() => { setShowAllMailboxes(true); leaveMessageDetail(); }}
					/>
					<DropdownMenu.Separator className="my-1 h-px bg-neutral-100" />
					{mailboxes.map((mailbox) => (
						<MailboxMenuItem
							key={mailbox.id}
							active={!showAllMailboxes && selectedMailbox.id === mailbox.id}
							icon={<AtSign size={16} strokeWidth={2} />}
							title={mailboxName(mailbox)}
							subtitle={mailboxAddress(mailbox)}
							count={unreadByMailbox.get(mailbox.id) ?? 0}
							onSelect={() => { setSelectedMailbox(mailbox); leaveMessageDetail(); }}
						/>
					))}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

function MailboxMenuItem({ active, icon, title, subtitle, count, onSelect }: {
	active: boolean;
	icon: React.ReactNode;
	title: string;
	subtitle?: string;
	count: number;
	onSelect: () => void;
}) {
	return (
		<DropdownMenu.Item
			onSelect={onSelect}
			className={cn(
				"flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 outline-none data-[highlighted]:bg-blue-50",
				active && "bg-blue-50",
			)}
		>
			<span className="shrink-0 text-neutral-600">{icon}</span>
			<span className="min-w-0 flex-1">
				<span className={cn("block truncate text-neutral-900", (active || count > 0) && "font-semibold")}>{title}</span>
				{subtitle && <span className="block truncate text-xs text-neutral-500">{subtitle}</span>}
			</span>
			{count > 0 && <span className="shrink-0 text-xs font-semibold text-neutral-700">{formatCount(count)}</span>}
			{active && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
		</DropdownMenu.Item>
	);
}
