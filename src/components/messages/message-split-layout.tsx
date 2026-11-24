"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { useSidebar } from "@/components/sidebar-state";
import { useAssistantOpen } from "@/components/agent/assistant-open-state";
import { useCompose } from "@/components/compose/compose-context";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { useIsDesktop, useIsWide } from "@/components/sidebar-mobile-utils";
import { readColumnWidth, readInitialColumnWidth, saveColumnWidth } from "@/components/column-width-preferences";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { BulkMessageActionBar } from "./bulk-message-action-bar";
import { CommandBarContext } from "./command-bar";
import { MessageFolderPage } from "./message-folder-page";
import { MessageDetailNavigationProvider } from "./message-detail-navigation";
import { MessageListStateContext } from "./message-list-state";
import { MessageListVisibilityContext } from "./message-list-visibility";
import { readInitialMessageListVisible, saveMessageListVisible } from "./message-list-visibility-utils";
import { useConversationView } from "./use-conversation-view";
import { useTwoColumnReading } from "./use-two-column-reading";
import type { MessageListStateControl, MessageSplitLayoutProps, SelectedMessage } from "./types";

export function MessageSplitLayout({
	children,
	config,
}: MessageSplitLayoutProps) {
	const pathname = usePathname();
	const { query } = useMailSearch();
	const { selectedMailbox } = useSelectedMailbox();
	const [conversationView] = useConversationView();
	const [selectedMessages, setSelectedMessages] = useState<SelectedMessage[]>([]);
	const [offset, setOffset] = useState(0);
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [listWidth, setListWidth] = useState(360);
	const [widthReady, setWidthReady] = useState(false);
	const [containerWidth, setContainerWidth] = useState(0);
	const [manualListVisible, setManualListVisible] = useState(true);
	const [twoColumnReading] = useTwoColumnReading();
	const containerRef = useRef<HTMLDivElement>(null);
	const [barTarget, setBarTarget] = useState<HTMLDivElement | null>(null);
	const startWidth = useRef(listWidth);
	const resizedWidth = useRef(listWidth);
	const { t } = useLanguage();
	const { userId, setForcedMinimal } = useSidebar();
	const isDesktop = useIsDesktop();
	const assistantOpen = useAssistantOpen();
	// A maximized composer docks beside the list (Outlook style), whatever the reading layout is.
	const { expanded: composeExpanded } = useCompose();
	const composeDocked = composeExpanded && isDesktop;
	const splitColumns = twoColumnReading || composeDocked;
	// Below 1280px a docked composer takes the whole content area, so it keeps room for its toolbar.
	const isWide = useIsWide();
	const listVisible = splitColumns && (composeDocked ? isWide : (!assistantOpen && manualListVisible));
	const detailPrefix = `${config.hrefPrefix}/`;
	const selectedMessageId = pathname.startsWith(detailPrefix)
		? pathname.slice(detailPrefix.length).split("/")[0]
		: undefined;
	const renderedListWidth = Math.max(250, Math.min(listWidth, (containerWidth || 1000) - 280));
	const grouped = conversationView && config.folder !== "drafts";
	const listState = useMemo<MessageListStateControl>(() => ({
		selectedMessages,
		setSelectedMessages,
		offset,
		setOffset,
		unreadOnly,
		setUnreadOnly,
	}), [selectedMessages, offset, unreadOnly]);
	// The layout outlives the page that renders the list, so a filter change
	// resets the shared list here instead of from the page that happens to be
	// mounted. Comparing keys keeps the initial mount from wiping a selection
	// that the split view is about to show.
	const viewKey = [query, selectedMailbox?.id ?? "", config.folder, config.folderId ?? "", grouped, unreadOnly].join("\u0000");
	const previousViewKey = useRef(viewKey);
	const folderKey = `${config.folder}\u0000${config.folderId ?? ""}`;
	const previousFolderKey = useRef(folderKey);
	const showBulkBar = selectedMessages.length > 0 && twoColumnReading && isDesktop;

	useEffect(() => {
		if (previousViewKey.current === viewKey) return;
		previousViewKey.current = viewKey;
		setOffset(0);
		setSelectedMessages([]);
	}, [viewKey]);

	useEffect(() => {
		if (previousFolderKey.current === folderKey) return;
		previousFolderKey.current = folderKey;
		setUnreadOnly(false);
	}, [folderKey]);

	useLayoutEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; restoring it in a lazy initialiser would mismatch the server-rendered markup.
		setListWidth(readInitialColumnWidth("message-list", 360, 250, 1200));
		setManualListVisible(readInitialMessageListVisible());
		const frame = requestAnimationFrame(() => setWidthReady(true));
		return () => cancelAnimationFrame(frame);
	}, []);

	useEffect(() => {
		if (!userId) return;
		const savedWidth = readColumnWidth(userId, "message-list", readInitialColumnWidth("message-list", 360, 250, 1200), 250, 1200);
		// eslint-disable-next-line react-hooks/set-state-in-effect -- the per-user width lives in localStorage and is only known once the user id resolves.
		setListWidth(savedWidth);
		saveColumnWidth(userId, "message-list", savedWidth);
	}, [userId]);

	useLayoutEffect(() => {
		if (!selectedMessageId && !composeDocked) {
			setForcedMinimal(false);
			return;
		}
		const container = containerRef.current;
		if (!container) return;
		setContainerWidth(container.clientWidth);
		const observer = new ResizeObserver(() => setContainerWidth(container.clientWidth));
		observer.observe(container);
		return () => observer.disconnect();
	}, [selectedMessageId, composeDocked, setForcedMinimal]);

	useEffect(() => () => setForcedMinimal(false), [setForcedMinimal]);

	if (!selectedMessageId && !composeDocked) {
		return (
			<MessageListStateContext.Provider value={listState}>
				{children}
			</MessageListStateContext.Provider>
		);
	}

	// On the desktop one command bar spans list and message (Outlook style): it holds the open
	// message's actions, or the bulk actions while list items are selected.
	const showCommandBar = isDesktop && !composeDocked;
	return (
		<MessageListStateContext.Provider value={listState}>
			<CommandBarContext.Provider value={showCommandBar ? { target: barTarget, suppressed: showBulkBar } : null}>
			<div className="flex h-full min-h-0 flex-col">
			{showCommandBar && (
				<div className="flex h-14 shrink-0 items-center gap-1 border-b border-neutral-200 bg-white px-3">
					{showBulkBar ? (
						<BulkMessageActionBar
							folder={config.folderId ? undefined : config.folder}
							selectedMessages={selectedMessages}
							onClearSelection={() => setSelectedMessages([])}
						/>
					) : (
						<div ref={setBarTarget} className="flex min-w-0 flex-1 items-center gap-1" />
					)}
				</div>
			)}
			<div ref={containerRef} className="min-h-0 flex-1 overflow-hidden lg:grid lg:transition-[grid-template-columns] lg:ease-in-out motion-reduce:transition-none" style={{ gridTemplateColumns: splitColumns ? `${listVisible ? renderedListWidth : 0}px minmax(0,1fr)` : "minmax(0,1fr)", transitionDuration: widthReady ? "300ms" : "0ms" }}>
				{splitColumns && (
				<aside className={`relative hidden min-h-0 min-w-0 overflow-hidden bg-white lg:block ${listVisible ? "border-r border-neutral-200" : "pointer-events-none"}`} aria-hidden={!listVisible} inert={!listVisible}>
					<div className={`h-full overflow-hidden transition-transform duration-300 ease-in-out motion-reduce:transition-none ${listVisible ? "translate-x-0" : "-translate-x-full"}`} style={{ width: renderedListWidth }}>
					<MessageFolderPage
						config={config}
						compact
						selectedMessageId={selectedMessageId}
					/>
					</div>
					<ResizeHandle
						label={t("list.resize")}
						onResizeStart={() => { startWidth.current = listWidth; resizedWidth.current = listWidth; }}
						onResize={(delta) => {
							const requestedWidth = startWidth.current + delta;
							setForcedMinimal(requestedWidth < 250);
							resizedWidth.current = Math.max(250, Math.min(requestedWidth, Math.max(250, (containerRef.current?.clientWidth ?? 1000) - 280)));
							setListWidth(resizedWidth.current);
						}}
						onResizeEnd={() => saveColumnWidth(userId, "message-list", resizedWidth.current)}
					/>
				</aside>
				)}
				<MessageListVisibilityContext.Provider value={{ visible: listVisible, showList: () => { if (manualListVisible) return; setManualListVisible(true); saveMessageListVisible(true); }, singleColumn: !twoColumnReading || !isDesktop, backHref: config.hrefPrefix, backLabel: config.titleKey ? t(config.titleKey) : config.title }}>
				<MessageDetailNavigationProvider config={config} currentMessageId={selectedMessageId}>
				<section className="min-h-0 min-w-0 overflow-hidden bg-white flex flex-col h-full">
					{composeDocked ? <div data-compose-dock className="min-h-0 flex-1" aria-hidden="true" /> : children}
				</section>
				</MessageDetailNavigationProvider>
				</MessageListVisibilityContext.Provider>
			</div>
			</div>
			</CommandBarContext.Provider>
		</MessageListStateContext.Provider>
	);
}
