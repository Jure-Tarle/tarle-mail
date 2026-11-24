"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useDismissible } from "@/components/use-dismissible";

type DomainOption = { hostname: string; count: number };

const GAP = 8;
const chipClass = "flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors";
const idleClass = "bg-white text-neutral-700 hover:bg-neutral-100 max-md:bg-neutral-100";

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick?: () => void }) {
	return (
		<button type="button" aria-pressed={active} onClick={onClick} className={`${chipClass} ${active ? "bg-blue-600 text-white" : idleClass}`} tabIndex={onClick ? undefined : -1}>
			{label}
			<span className={`tabular-nums ${active ? "opacity-80" : "text-neutral-500"}`}>{count}</span>
		</button>
	);
}

/**
 * One row of domain chips for the admin mailbox list. Every configured domain gets a chip, also one
 * without mailboxes. When the row runs out of width (many domains, a phone), the chips that do not fit
 * move into a "+N" menu at the end; the selected domain always stays visible as a chip.
 */
export function MailboxDomainChips({ domains, total, value, onChange }: {
	domains: DomainOption[];
	total: number;
	value: string;
	onChange: (hostname: string) => void;
}) {
	const { t } = useLanguage();
	const row = useRef<HTMLDivElement>(null);
	const measure = useRef<HTMLDivElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const [fitCount, setFitCount] = useState(domains.length);
	const [open, setOpen] = useState(false);
	useDismissible(open, () => setOpen(false), menu);

	// Measure every chip once in an invisible copy of the row, then fit as many as the row holds.
	const domainKey = domains.map((domain) => `${domain.hostname}:${domain.count}`).join(",");
	useLayoutEffect(() => {
		const rowElement = row.current;
		const measureElement = measure.current;
		if (!rowElement || !measureElement) return;
		const fit = () => {
			const widths = [...measureElement.children].map((child) => (child as HTMLElement).offsetWidth);
			const allWidth = widths[0] ?? 0;
			const moreWidth = widths[widths.length - 1] ?? 0;
			const domainWidths = widths.slice(1, -1);
			const available = rowElement.clientWidth;
			const full = domainWidths.reduce((sum, width) => sum + GAP + width, allWidth);
			if (full <= available) {
				setFitCount(domainWidths.length);
				return;
			}
			let used = allWidth + GAP + moreWidth;
			let count = 0;
			for (const width of domainWidths) {
				if (used + GAP + width > available) break;
				used += GAP + width;
				count += 1;
			}
			setFitCount(count);
		};
		const observer = new ResizeObserver(fit);
		observer.observe(rowElement);
		return () => observer.disconnect();
	}, [domainKey]);

	const overflow = fitCount < domains.length;
	let visible = domains.slice(0, fitCount);
	// A selected domain from the overflow takes the last visible place, so the choice stays on screen.
	const selected = domains.find((domain) => domain.hostname === value);
	if (overflow && selected && !visible.includes(selected)) visible = [...visible.slice(0, Math.max(0, fitCount - 1)), selected];
	const hidden = domains.filter((domain) => !visible.includes(domain));

	return (
		<div className="relative min-w-0 flex-1">
			<div aria-hidden="true" ref={measure} className="pointer-events-none invisible absolute left-0 top-0 flex gap-2">
				<Chip label={t("mailboxes.allDomains")} count={total} active={false} />
				{domains.map((domain) => <Chip key={domain.hostname} label={domain.hostname} count={domain.count} active={false} />)}
				<span className={`${chipClass} ${idleClass}`}>+{domains.length}<ChevronDown className="h-4 w-4" /></span>
			</div>
			<div ref={row} role="group" aria-label={t("mailboxes.filterByDomain")} className="flex min-w-0 gap-2 overflow-hidden">
				<Chip label={t("mailboxes.allDomains")} count={total} active={!value} onClick={() => onChange("")} />
				{visible.map((domain) => (
					<Chip key={domain.hostname} label={domain.hostname} count={domain.count} active={domain.hostname === value} onClick={() => onChange(domain.hostname)} />
				))}
				{hidden.length > 0 && (
					<div ref={menu} className="shrink-0">
						<button
							type="button"
							aria-haspopup="menu"
							aria-expanded={open}
							aria-label={t("mailboxes.moreDomains", { count: hidden.length })}
							onClick={() => setOpen((current) => !current)}
							className={`${chipClass} ${idleClass}`}
						>
							+{hidden.length}
							<ChevronDown className="h-4 w-4" aria-hidden="true" />
						</button>
						{open && (
							<div role="menu" aria-label={t("mailboxes.moreDomains", { count: hidden.length })} className="absolute z-30 mt-2 max-h-[60vh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-neutral-200 bg-white py-1 shadow-lg max-md:left-0">
								{hidden.map((domain) => (
									<button
										key={domain.hostname}
										type="button"
										role="menuitemradio"
										aria-checked={false}
										onClick={() => { onChange(domain.hostname); setOpen(false); }}
										className="flex min-h-10 w-full items-center gap-3 px-4 text-left text-sm text-neutral-800 hover:bg-neutral-100"
									>
										<span className="min-w-0 flex-1 truncate">{domain.hostname}</span>
										<span className="tabular-nums text-xs text-neutral-500">{domain.count}</span>
									</button>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
