"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Search, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { NavItem } from "../components-nav";
import { SidebarFooter } from "../sidebar-footer";
import { SidebarHeader } from "../sidebar-header";
import { SidebarScaffold } from "../sidebar-scaffold";
import { useSidebar } from "../sidebar-state";
import { isActiveSettingsPath, normalizeSearchText, settingsNavSections } from "./settings-nav-utils";

/**
 * The user settings sidebar: the same app sidebar as mail and admin, listing the settings pages
 * with a search that also finds a page by the section titles on it.
 */
export function SettingsNav({ className }: { className?: string }) {
	const { t } = useLanguage();
	const pathname = usePathname();
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
			{!minimal && (
				<div className="relative mx-3 mb-3">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
						placeholder={t("settings.search.placeholder")}
						aria-label={t("settings.search.placeholder")}
						className="h-10 w-full rounded-full border border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 max-md:h-11 max-md:text-base [&::-webkit-search-cancel-button]:hidden"
					/>
					{query && (
						<button type="button" onClick={() => setQuery("")} aria-label={t("settings.search.clear")} className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">
							<X className="h-4 w-4" />
						</button>
					)}
				</div>
			)}
			{needle && !minimal ? (
				<div role="region" aria-live="polite" aria-label={t("settings.search.results")}>
					{results.length === 0 ? (
						<p className="px-6 py-2 text-sm text-neutral-500">{t("settings.search.empty")}</p>
					) : (
						<ul className="space-y-px">
							{results.map(({ item, label, match }) => {
								const Icon = item.icon;
								const active = isActiveSettingsPath(pathname, item.href);
								return (
									<li key={item.href}>
										<Link
											href={item.href}
											onClick={() => setQuery("")}
											className={cn(
												"flex min-h-9 items-start gap-3 rounded-r-full py-2 pl-6 pr-3 text-sm text-neutral-700 transition-colors max-md:min-h-11 max-md:text-base",
												active ? "bg-blue-100 font-semibold text-blue-900" : "hover:bg-neutral-200/60",
											)}
										>
											<Icon size={16} strokeWidth={2} className="mt-0.5 shrink-0 max-md:h-5 max-md:w-5" />
											<span className="min-w-0">
												<span className="block truncate">{label}</span>
												{match && <span className="block truncate text-xs font-normal text-neutral-500">{match}</span>}
											</span>
										</Link>
									</li>
								);
							})}
						</ul>
					)}
				</div>
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
