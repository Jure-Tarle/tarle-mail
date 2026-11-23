"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { useLanguage } from "@/components/language-provider";
import { getActiveMode, modeStorageKey, resolveModeHref, type AppMode } from "@/components/mode-switch-utils";
import { useCurrentUser } from "@/hooks/use-current-user";

const modes: AppMode[] = ["mail", "admin"];
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	window.addEventListener("storage", listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", listener);
	};
}

function readRemembered(mode: AppMode): string | null {
	try {
		return localStorage.getItem(modeStorageKey(mode));
	} catch {
		return null;
	}
}

function remember(mode: AppMode, pathname: string) {
	if (readRemembered(mode) === pathname) return;
	try {
		localStorage.setItem(modeStorageKey(mode), pathname);
	} catch {
		return;
	}
	listeners.forEach((listener) => listener());
}

/** Where a mode opens: the last page visited in it, or its start page. */
export function useModeHref(mode: AppMode): string {
	const remembered = useSyncExternalStore(subscribe, () => readRemembered(mode), () => null);
	return resolveModeHref(mode, remembered);
}

function ModeLink({ mode, active, label }: { mode: AppMode; active: boolean; label: string }) {
	const href = useModeHref(mode);
	return (
		<Link
			href={href}
			aria-current={active ? "page" : undefined}
			className={clsx(
				"flex h-7 items-center rounded-full px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 motion-reduce:transition-none",
				active ? "bg-white text-neutral-900 shadow-sm shadow-neutral-900/10 dark:bg-neutral-300" : "text-neutral-600 hover:text-neutral-900",
			)}
		>
			{label}
		</Link>
	);
}

/** Mail | Admin switch for the top header. Admins only; each side opens the last page visited in that mode. */
export function ModeSwitch({ className }: { className?: string }) {
	const { t } = useLanguage();
	const pathname = usePathname();
	const isAdmin = useCurrentUser()?.role === "admin";
	const active = getActiveMode(pathname);

	useEffect(() => {
		if (isAdmin) remember(active, pathname);
	}, [isAdmin, active, pathname]);

	if (!isAdmin) return null;

	const labels: Record<AppMode, string> = { mail: t("navigation.modeMail"), admin: t("account.admin") };
	return (
		<nav aria-label={t("navigation.modeSwitch")} className={clsx("flex h-8 shrink-0 items-center rounded-full bg-[#eaf1fb] p-0.5", className)}>
			{modes.map((mode) => <ModeLink key={mode} mode={mode} active={mode === active} label={labels[mode]} />)}
		</nav>
	);
}
