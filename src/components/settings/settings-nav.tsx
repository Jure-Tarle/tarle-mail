"use client";

import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { NavItem } from "../components-nav";
import { NavSearchInput, NavSearchResults } from "../nav-search";
import { SidebarFooter } from "../sidebar-footer";
import { SidebarHeader } from "../sidebar-header";
import { SidebarScaffold } from "../sidebar-scaffold";
import { useSidebar } from "../sidebar-state";
import { normalizeSearchText, settingsNavSections } from "./settings-nav-utils";

/**
 * The user settings sidebar: the same app sidebar as mail and admin, listing the settings pages
 * with a search that also finds a page by the section titles on it.
 */
export function SettingsNav({ className }: { className?: string }) {
	const { t } = useLanguage();
	const { minimal } = useSidebar();
	const user = useCurrentUser();
	const [query, setQuery] = useState("");
	const canManageMailboxes = user?.canManageMailboxes === true;
	const sections = settingsNavSections.map((section) => ({
		...section,
		items: section.items.filter((item) => !item.requiresMailboxAccess || canManageMailboxes),
	}));

	const needle = normalizeSearchText(query);
	const results = needle
		? sections.flatMap((section) => section.items.flatMap((item) => {
			const label = t(item.labelKey);
			if (normalizeSearchText(label).includes(needle)) return [{ item, label, match: null as string | null }];
			const match = (item.searchKeys ?? []).map((key) => t(key)).find((text) => normalizeSearchText(text).includes(needle));
			return match ? [{ item, label, match }] : [];
		}))
		: [];

	return (
		<SidebarScaffold className={className} header={<SidebarHeader href="/inbox" label={t("account.settings")} />} footer={<SidebarFooter />}>
			{!minimal && <NavSearchInput value={query} onChange={setQuery} placeholder={t("settings.search.placeholder")} clearLabel={t("settings.search.clear")} />}
			{needle && !minimal ? (
				<NavSearchResults
					label={t("settings.search.results")}
					empty={t("settings.search.empty")}
					results={results.map(({ item, label, match }) => ({ href: item.href, label, match, icon: item.icon }))}
					onNavigate={() => setQuery("")}
				/>
			) : (
				<div className={cn("space-y-4", minimal && "space-y-2 pl-1")}>
					{sections.map((section, index) => section.items.length > 0 && (
						<section key={section.labelKey}>
							{minimal && index > 0 && <hr className="mx-6 mb-3 border-neutral-200/70" />}
							{!minimal && <h2 className="mb-1 ml-6 mt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 max-md:text-sm">{t(section.labelKey)}</h2>}
							<nav aria-label={t(section.labelKey)} className="space-y-px">
								{section.items.map((item) => (
									<NavItem key={item.href} link={{ href: item.href, label: t(item.labelKey), icon: item.icon }} />
								))}
							</nav>
						</section>
					))}
				</div>
			)}
		</SidebarScaffold>
	);
}
