"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "@/components/icons";
import { Search, X } from "@/components/icons";
import { cn } from "@/lib/utils";

/** The search field at the top of a sidebar (user settings, admin). Escape clears it. */
export function NavSearchInput({ value, onChange, placeholder, clearLabel }: { value: string; onChange: (value: string) => void; placeholder: string; clearLabel: string }) {
	return (
		<div className="relative mx-3 mb-3">
			<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
			<input
				type="search"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => { if (event.key === "Escape") onChange(""); }}
				placeholder={placeholder}
				aria-label={placeholder}
				className="h-10 w-full rounded-full border border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 max-md:h-11 max-md:text-base [&::-webkit-search-cancel-button]:hidden"
			/>
			{value && (
				<button type="button" onClick={() => onChange("")} aria-label={clearLabel} className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">
					<X className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}

export type NavSearchResult = { href: string; label: string; match: string | null; icon: LucideIcon };

/** Matching pages, each with the section title that matched when it was not the page name. */
export function NavSearchResults({ label, empty, results, onNavigate }: { label: string; empty: string; results: NavSearchResult[]; onNavigate: () => void }) {
	const pathname = usePathname();
	return (
		<div role="region" aria-live="polite" aria-label={label}>
			{results.length === 0 ? (
				<p className="px-6 py-2 text-sm text-neutral-500">{empty}</p>
			) : (
				<ul className="space-y-px">
					{results.map(({ href, label: name, match, icon: Icon }) => {
						const active = pathname === href || pathname.startsWith(`${href}/`);
						return (
							<li key={href}>
								<Link
									href={href}
									onClick={onNavigate}
									className={cn(
										"flex min-h-9 items-start gap-3 rounded-r-full py-2 pl-6 pr-3 text-sm text-neutral-700 transition-colors max-md:min-h-11 max-md:text-base",
										active ? "bg-blue-100 font-semibold text-blue-900" : "hover:bg-neutral-200/60",
									)}
								>
									<Icon size={16} strokeWidth={2} className="mt-0.5 shrink-0 max-md:h-5 max-md:w-5" />
									<span className="min-w-0">
										<span className="block truncate">{name}</span>
										{match && <span className="block truncate text-xs font-normal text-neutral-500">{match}</span>}
									</span>
								</Link>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
