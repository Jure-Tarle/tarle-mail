"use client";

import { useRef, useState } from "react";
import { Check, ListFilter } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useDismissible } from "@/components/use-dismissible";

export type MailboxFilter = {
	domain: string;
	type: "" | "personal" | "shared";
	status: "" | "active" | "disabled" | "pendingDeletion";
};

type Option<T extends string> = { value: T; label: string; count: number };

/** Number of filters that narrow the list, for the badge on the button. */
export function activeMailboxFilterCount(filter: Pick<MailboxFilter, "type" | "status">): number {
	return [filter.type, filter.status].filter(Boolean).length;
}

function FilterGroup<T extends string>({ title, allLabel, total, value, options, onChange }: {
	title: string;
	allLabel: string;
	total: number;
	value: T | "";
	options: Option<T>[];
	onChange: (value: T | "") => void;
}) {
	const rows: Option<T | "">[] = [{ value: "", label: allLabel, count: total }, ...options];
	return (
		<div role="group" aria-label={title} className="py-1">
			<p className="px-4 pb-1 pt-2 text-xs font-medium uppercase text-neutral-500">{title}</p>
			{rows.map((option) => {
				const checked = option.value === value;
				return (
					<button
						key={option.value || "all"}
						type="button"
						role="menuitemradio"
						aria-checked={checked}
						onClick={() => onChange(option.value)}
						className={`flex min-h-10 w-full items-center gap-3 px-4 text-left text-sm hover:bg-neutral-100 ${checked ? "font-medium text-blue-700" : "text-neutral-800"}`}
					>
						<span className="min-w-0 flex-1 truncate">{option.label}</span>
						<span className="tabular-nums text-xs text-neutral-500">{option.count}</span>
						<Check className={`h-4 w-4 shrink-0 ${checked ? "text-blue-600" : "invisible"}`} aria-hidden="true" />
					</button>
				);
			})}
		</div>
	);
}

/** Filter button for the admin mailbox list: narrows it by type and status (the domain has its own chips). */
export function MailboxFilterMenu({ value, onChange, total, types, statuses }: {
	value: MailboxFilter;
	onChange: (next: MailboxFilter) => void;
	total: number;
	types: Option<"personal" | "shared">[];
	statuses: Option<"active" | "disabled" | "pendingDeletion">[];
}) {
	const { t } = useLanguage();
	const [open, setOpen] = useState(false);
	const container = useRef<HTMLDivElement>(null);
	useDismissible(open, () => setOpen(false), container);
	const active = activeMailboxFilterCount(value);

	return (
		<div ref={container} className="relative shrink-0">
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className={`flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors ${active ? "bg-blue-100 text-blue-700" : "bg-white text-neutral-700 hover:bg-neutral-100 max-md:bg-neutral-100"}`}
			>
				<ListFilter className="h-4 w-4" aria-hidden="true" />
				{t("mailboxes.filter.button")}
				{active > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs text-white">{active}</span>}
			</button>
			{open && (
				<div role="menu" aria-label={t("mailboxes.filter.button")} className="absolute right-0 z-30 mt-2 max-h-[70vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-neutral-200 bg-white py-1 shadow-lg max-md:left-0 max-md:right-auto">
					<FilterGroup title={t("mailboxes.type")} allLabel={t("mailboxes.filter.allTypes")} total={total} value={value.type} options={types} onChange={(type) => onChange({ ...value, type })} />
					{statuses.length > 1 && (
						<>
							<div className="border-t border-neutral-100" />
							<FilterGroup title={t("accounts.colStatus")} allLabel={t("mailboxes.filter.allStatuses")} total={total} value={value.status} options={statuses} onChange={(status) => onChange({ ...value, status })} />
						</>
					)}
					{active > 0 && (
						<div className="border-t border-neutral-100 px-2 pt-1">
							<button type="button" onClick={() => onChange({ ...value, type: "", status: "" })} className="w-full rounded-lg px-2 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50">
								{t("mailboxes.filter.reset")}
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
