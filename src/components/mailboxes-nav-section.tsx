"use client";

import { usePathname, useRouter } from "next/navigation";
import { AtSign, Inbox } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import type { MailboxOption } from "@/components/mailbox-provider";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { cn } from "@/lib/utils";
import { NavSectionHeader, useSectionOpen } from "./nav-section-header";

/** A message detail route such as /inbox/msg_… or /folders/<id>/msg_…; switching mailboxes leaves it for its list. */
const MESSAGE_DETAIL_SUFFIX = /\/msg_[^/]+$/;

/**
 * Mailbox switcher in the mail sidebar, in the spirit of Outlook's folder pane: "All mailboxes"
 * combines every accessible mailbox in one list, and each mailbox shows its unread inbox count.
 * Hidden when the account has only one mailbox.
 */
export function MailboxesNavSection() {
	const { t } = useLanguage();
	const pathname = usePathname();
	const router = useRouter();
	const { mailboxes, selectedMailbox, setSelectedMailbox, showAllMailboxes, setShowAllMailboxes, isLoading } = useSelectedMailbox();
	const [open, toggle] = useSectionOpen("tarle-mail:nav:mailboxes-section-open");
	const multiple = mailboxes.length > 1;
	const { counts } = useMessageCounts(null, multiple && !isLoading);
	if (!multiple) return null;

	const unreadByMailbox = new Map(counts.mailboxes.map((item) => [item.mailboxId, item.inboxUnread ?? 0]));
	const totalUnread = counts.mailboxes.reduce((sum, item) => sum + (item.inboxUnread ?? 0), 0);

	function leaveMessageDetail() {
		if (MESSAGE_DETAIL_SUFFIX.test(pathname)) router.push(pathname.replace(MESSAGE_DETAIL_SUFFIX, ""));
	}

	function chooseAll() {
		setShowAllMailboxes(true);
		leaveMessageDetail();
	}

	function chooseMailbox(mailbox: MailboxOption) {
		setSelectedMailbox(mailbox);
		leaveMessageDetail();
	}

	return (
		<>
			<NavSectionHeader label={t("navigation.mailboxes")} open={open} onToggle={toggle} />
			{open && (
				<ul className="flex flex-col">
					<li>
						<MailboxNavButton
							active={showAllMailboxes}
							icon={<Inbox size={16} strokeWidth={2} className="max-md:h-5 max-md:w-5" />}
							label={t("navigation.allMailboxes")}
							count={totalUnread}
							onClick={chooseAll}
						/>
					</li>
					{mailboxes.map((mailbox) => {
						const address = `${mailbox.localPart}@${mailbox.hostname}`;
						return (
							<li key={mailbox.id}>
								<MailboxNavButton
									active={!showAllMailboxes && selectedMailbox?.id === mailbox.id}
									icon={<AtSign size={16} strokeWidth={2} className="max-md:h-5 max-md:w-5" />}
									label={mailbox.displayName?.trim() || address}
									title={address}
									count={unreadByMailbox.get(mailbox.id) ?? 0}
									onClick={() => chooseMailbox(mailbox)}
								/>
							</li>
						);
					})}
				</ul>
			)}
		</>
	);
}

function MailboxNavButton({ active, icon, label, title, count, onClick }: {
	active: boolean;
	icon: React.ReactNode;
	label: string;
	title?: string;
	count: number;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-pressed={active}
			className={cn(
				"flex h-9 w-full items-center gap-3 rounded-r-full pl-6 text-left text-sm text-neutral-700 transition-colors max-md:min-h-11 max-md:text-base",
				active ? "bg-blue-100 font-semibold text-blue-900" : "hover:bg-neutral-200/60",
			)}
		>
			{icon}
			<span className={cn("min-w-0 flex-1 truncate", count > 0 && "font-semibold")}>{label}</span>
			{count > 0 && (
				<span className="mr-3 shrink-0 rounded-full px-2 py-0.5 text-sm font-semibold text-neutral-700">
					{count > 99 ? "99+" : count}
				</span>
			)}
		</button>
	);
}
