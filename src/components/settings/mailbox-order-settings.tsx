"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { MAILBOX_PALETTE, getMailboxColors } from "@/components/mailbox-colors";
import { useSelectedMailbox } from "@/components/mailbox-provider";

/** Moves a mailbox up or down and sets its colour; both apply on every device. */
export function MailboxOrderSettings() {
	const { t } = useLanguage();
	const { mailboxes, reorderMailboxes, setMailboxColor } = useSelectedMailbox();
	const [error, setError] = useState<string | null>(null);
	const [moving, setMoving] = useState(false);
	const colors = getMailboxColors(mailboxes);

	if (mailboxes.length < 2) return <p className="text-sm text-neutral-500">{t("settings.mailboxOrder.single")}</p>;

	const move = (index: number, offset: -1 | 1) => {
		const ids = mailboxes.map((mailbox) => mailbox.id);
		const target = index + offset;
		if (target < 0 || target >= ids.length) return;
		[ids[index], ids[target]] = [ids[target], ids[index]];
		setError(null);
		setMoving(true);
		reorderMailboxes(ids)
			.catch(() => setError(t("settings.mailboxOrder.failed")))
			.finally(() => setMoving(false));
	};

	return (
		<div>
			<ol className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
				{mailboxes.map((mailbox, index) => {
					const address = `${mailbox.localPart}@${mailbox.hostname}`;
					const name = mailbox.displayName?.trim() || address;
					return (
						<li key={mailbox.id} className="flex min-h-14 items-center gap-3 py-2 pl-4 pr-2">
							<MailboxColorPicker
								name={name}
								color={colors.get(mailbox.id) ?? MAILBOX_PALETTE[0]}
								custom={!!mailbox.color}
								onChange={(color) => {
									setError(null);
									setMailboxColor(mailbox.id, color).catch(() => setError(t("settings.mailboxOrder.colorFailed")));
								}}
							/>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium text-neutral-900">{name}</span>
								{name !== address && <span className="block truncate text-xs text-neutral-500">{address}</span>}
							</span>
							<button
								type="button"
								onClick={() => move(index, -1)}
								disabled={moving || index === 0}
								aria-label={t("settings.mailboxOrder.up", { mailbox: name })}
								className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
							>
								<ArrowUp className="h-4 w-4" />
							</button>
							<button
								type="button"
								onClick={() => move(index, 1)}
								disabled={moving || index === mailboxes.length - 1}
								aria-label={t("settings.mailboxOrder.down", { mailbox: name })}
								className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
							>
								<ArrowDown className="h-4 w-4" />
							</button>
						</li>
					);
				})}
			</ol>
			{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
		</div>
	);
}

/** The mailbox's colour dot as a button: eight colours, the system colour picker, or back to automatic. */
function MailboxColorPicker({ name, color, custom, onChange }: { name: string; color: string; custom: boolean; onChange: (color: string | null) => void }) {
	const { t } = useLanguage();
	const input = useRef<HTMLInputElement>(null);
	// React's onChange fires on every drag step; the native change event fires once the picker closes.
	const onChangeRef = useRef(onChange);
	useEffect(() => { onChangeRef.current = onChange; });
	useEffect(() => {
		const element = input.current;
		if (!element) return;
		const commit = () => onChangeRef.current(element.value.toLowerCase());
		element.addEventListener("change", commit);
		return () => element.removeEventListener("change", commit);
	}, []);
	return (
		<>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild>
					<button type="button" aria-label={t("settings.mailboxOrder.color", { mailbox: name })} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-neutral-100">
						<span className="h-4 w-4 rounded-full ring-2 ring-white" style={{ backgroundColor: color, boxShadow: `0 0 0 3px ${color}33` }} />
					</button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content align="start" sideOffset={6} className="z-[120] w-56 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl">
						<div className="grid grid-cols-4 gap-1.5 p-1">
							{MAILBOX_PALETTE.map((swatch) => (
								<DropdownMenu.Item
									key={swatch}
									onSelect={() => onChange(swatch)}
									aria-label={swatch}
									className="flex h-11 cursor-pointer items-center justify-center rounded-xl outline-none data-[highlighted]:bg-neutral-100"
								>
									<span className="flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ backgroundColor: swatch }}>
										{custom && swatch === color && <Check className="h-4 w-4" />}
									</span>
								</DropdownMenu.Item>
							))}
						</div>
						<DropdownMenu.Separator className="my-1 h-px bg-neutral-100" />
						<DropdownMenu.Item onSelect={() => input.current?.click()} className="flex min-h-10 cursor-pointer items-center rounded-xl px-3 text-sm text-neutral-800 outline-none data-[highlighted]:bg-neutral-100">
							{t("settings.mailboxOrder.customColor")}
						</DropdownMenu.Item>
						<DropdownMenu.Item disabled={!custom} onSelect={() => onChange(null)} className="flex min-h-10 cursor-pointer items-center justify-between rounded-xl px-3 text-sm text-neutral-800 outline-none data-[disabled]:cursor-default data-[disabled]:text-neutral-400 data-[highlighted]:bg-neutral-100">
							{t("settings.mailboxOrder.autoColor")}
							{!custom && <Check className="h-4 w-4 text-blue-600" />}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
			{/* The native picker opens from the menu item; its value is saved once the user closes it. */}
			<input ref={input} type="color" tabIndex={-1} aria-hidden="true" className="sr-only" defaultValue={color} />
		</>
	);
}
