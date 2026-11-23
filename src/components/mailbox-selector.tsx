"use client";
import { alertDialog, confirmDestructive } from "@/components/ui/confirm-dialog";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, LogOut, Mail, Settings, ShieldCheck, UserPlus, UserRound } from "@/components/icons";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useDismissible } from "@/components/use-dismissible";
import { AppsMenu } from "@/components/apps-menu";
import { useModeHref } from "@/components/mode-switch";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { ProgressiveAvatarImage } from "@/components/progressive-avatar-image";
import { clearCurrentUserCache, fetchCurrentUser } from "@/hooks/use-current-user";
import { getAvatarColorStyle } from "@/lib/avatar-colors";
import { logoutClientSession } from "@/lib/auth/logout";
import { fetchBrowserAccounts, switchBrowserAccount, signOutBrowserAccount, type BrowserAccount } from "@/lib/auth/accounts-client";
import {
	PROFILE_AVATAR_CHANGED_EVENT,
	getProfileAvatarUrl,
} from "@/lib/profile/avatar-client";
import { PROFILE_NAME_CHANGED_EVENT } from "@/lib/profile/name-client";
import type { ProfileAvatarChangedDetail, ProfileNameChangedDetail } from "@/lib/profile/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import type {
	AccountAvatarProps,
	MailboxSelectorUser,
	MailboxSelectorProps,
} from "./mailbox-selector-types";
import {
	getAccountInitial,
	isAdminPath,
} from "./mailbox-selector-utils";

// A server-rendered trigger has no click handler until hydration. Keep it a
// real link for that window so the first click is never lost.
const subscribeNothing = () => () => {};
const hydratedOnClient = () => true;
const hydratedOnServer = () => false;

function AccountAvatar({
	name,
	colorSeed = name,
	hasAvatar = false,
	avatarUrl = "/api/profile/avatar",
	size = "small",
	placeholder = false,
	onAvatarError,
}: AccountAvatarProps) {
	const { t } = useLanguage();
	const sizeClass = size === "large" ? "h-16 w-16 text-xl" : "h-10 w-10 text-sm";
	const iconClass = size === "large" ? "h-7 w-7" : "h-5 w-5";
	const [imageFailed, setImageFailed] = useState(false);
	const [prevImage, setPrevImage] = useState({ avatarUrl, hasAvatar });
	if (avatarUrl !== prevImage.avatarUrl || hasAvatar !== prevImage.hasAvatar) {
		setPrevImage({ avatarUrl, hasAvatar });
		setImageFailed(false);
	}

	if (hasAvatar && !imageFailed) {
		return (
			<ProgressiveAvatarImage
				src={avatarUrl}
				alt={t("account.profilePicture", { name })}
				className={`${sizeClass} shrink-0 rounded-full border border-neutral-200 object-cover`}
				skipPreview={size === "small"}
				onError={() => {
					setImageFailed(true);
					onAvatarError?.();
				}}
			/>
		);
	}

	// The account name is not the mailbox identity; showing its initial first
	// makes the chip flip (D -> S). Until the mailbox loads, use a neutral icon.
	if (placeholder) {
		return (
			<div
				className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-500`}
				aria-hidden="true"
			>
				<UserRound className={iconClass} />
			</div>
		);
	}

	return (
		<div
			className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold text-white`}
			style={getAvatarColorStyle(colorSeed)}
			aria-hidden="true"
		>
			{getAccountInitial(name)}
		</div>
	);
}

export function MailboxSelector({ initialUser }: MailboxSelectorProps = {}) {
	const { t } = useLanguage();
	// This menu is the signed-in account only; mailboxes are switched in the mail sidebar.
	const { isLoading } = useSelectedMailbox();
	const pathname = usePathname();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const mailHref = useModeHref("mail");
	const [user, setUser] = useState<MailboxSelectorUser | null>(initialUser ?? null);
	const [hasAvatar, setHasAvatar] = useState(!!initialUser?.hasAvatar);
	const [avatarUrl, setAvatarUrl] = useState("/api/profile/avatar");
	const [browserAccounts, setBrowserAccounts] = useState<BrowserAccount[]>([]);
	const hydrated = useSyncExternalStore(subscribeNothing, hydratedOnClient, hydratedOnServer);

	useEffect(() => {
		if (!open) return;
		let active = true;
		void fetchBrowserAccounts().then((accounts) => {
			if (active) setBrowserAccounts(accounts);
		});
		return () => {
			active = false;
		};
	}, [open]);
	const otherAccounts = browserAccounts.filter((account) => !account.active && account.userId !== user?.id);
	const ref = useRef<HTMLDivElement>(null);

	useDismissible(open, () => setOpen(false), ref);

	useEffect(() => {
		// The landing page passes the account the server already resolved; fetching
		// it again here would duplicate the same /api/auth/me request.
		if (initialUser) return;
		let active = true;
		void fetchCurrentUser()
			.then((user) => {
				if (!active) return;
				setUser(user);
				setHasAvatar(!!user?.hasAvatar);
			})
			.catch(() => { if (active) setUser(null); });
		return () => { active = false; };
	}, [initialUser]);

	useEffect(() => {
		function onAvatarChanged(event: Event) {
			clearCurrentUserCache();
			const detail = (event as CustomEvent<ProfileAvatarChangedDetail>).detail;
			setAvatarUrl(detail?.url ?? getProfileAvatarUrl());
			setHasAvatar(true);
		}

		window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged);
		return () => window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged);
	}, []);

	useEffect(() => {
		function onNameChanged(event: Event) {
			clearCurrentUserCache();
			const { name } = (event as CustomEvent<ProfileNameChangedDetail>).detail;
			setUser((current) => current ? { ...current, name } : current);
		}

		window.addEventListener(PROFILE_NAME_CHANGED_EVENT, onNameChanged);
		return () => window.removeEventListener(PROFILE_NAME_CHANGED_EVENT, onNameChanged);
	}, []);

	if (isLoading && !initialUser) {
		return <Skeleton className="h-10 w-10 rounded-full" />;
	}

	const selectedName = user?.name ?? t("account.fallbackName");
	const selectedEmail = user?.email ?? "";
	const selectedHasAvatar = hasAvatar;
	const selectedAvatarUrl = avatarUrl;
	const identityPending = !user;
	const adminActive = isAdminPath(pathname);

	async function logout() {
		const switched = await logoutClientSession();
		setOpen(false);
		router.replace(switched ? "/inbox" : "/login");
		router.refresh();
	}

	async function signOutAccount(account: BrowserAccount) {
		if (!await confirmDestructive(t("account.signOutAccountConfirm", { name: account.name, email: account.email }))) return;
		const error = await signOutBrowserAccount(account.userId);
		if (error) {
			void alertDialog(error);
			return;
		}
		setBrowserAccounts((accounts) => accounts.filter((item) => item.userId !== account.userId));
	}

	async function switchAccount(userId: string) {
		const error = await switchBrowserAccount(userId);
		setOpen(false);
		if (error) {
			router.push("/login?add=1");
			return;
		}
		router.replace("/inbox");
		router.refresh();
	}

	const triggerAvatar = (
		<AccountAvatar
			name={selectedName}
			colorSeed={selectedEmail || selectedName}
			hasAvatar={selectedHasAvatar}
			avatarUrl={selectedAvatarUrl}
			placeholder={identityPending}
			onAvatarError={() => setHasAvatar(false)}
		/>
	);

	return (
		<div className="flex items-center gap-1">
		<AppsMenu user={user} />
		<div ref={ref} className="relative">
			{hydrated ? (
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					className="rounded-full p-1 transition-colors hover:bg-neutral-200"
					aria-label={t("account.openMenu")}
					aria-expanded={open}
				>
					{triggerAvatar}
				</button>
			) : (
				<Link
					href="/inbox"
					className="inline-flex rounded-full p-1 transition-colors hover:bg-neutral-200"
					aria-label={t("navigation.inbox")}
				>
					{triggerAvatar}
				</Link>
			)}

			{open && (
				<div className="absolute right-0 top-14 w-[360px] overflow-hidden rounded-[28px] border border-neutral-200 bg-[#eef3fb] p-3 shadow-2xl shadow-neutral-900/20 max-h-[82vh] overflow-y-auto z-90">
					<div className="rounded-[22px] bg-white px-2 py-2">
						<Link
							href="/inbox"
							onClick={() => setOpen(false)}
							className="flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-blue-50 active:bg-blue-50"
						>
							<AccountAvatar
								name={selectedName}
								colorSeed={selectedEmail || selectedName}
								hasAvatar={selectedHasAvatar}
								avatarUrl={selectedAvatarUrl}
								size="large"
								placeholder={identityPending}
								onAvatarError={() => setHasAvatar(false)}
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<p className="truncate text-lg font-semibold text-neutral-900">{selectedName}</p>
								</div>
								<p className="truncate text-sm text-neutral-500">
									{selectedEmail}
								</p>
							</div>
							<Check className="h-5 w-5 shrink-0 text-blue-600" />
						</Link>
					</div>

					<div className={`mt-2 rounded-[22px] ${otherAccounts.length > 0 ? "bg-white/55 p-1" : ""}`}>
						{otherAccounts.length > 0 && (
							<p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
								{t("account.otherAccounts")}
							</p>
						)}
						<div className="divide-y divide-neutral-100 overflow-hidden rounded-[18px] bg-white">
							{otherAccounts.map((account) => (
								<div
									key={account.userId}
									className="group flex items-center transition-colors hover:bg-blue-50 focus-within:bg-blue-50"
								>
									<button
										type="button"
										onClick={() => void switchAccount(account.userId)}
										className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
									>
										<AccountAvatar
											name={account.name}
											colorSeed={account.email}
											hasAvatar={account.hasAvatar}
											avatarUrl={`/api/auth/accounts/${account.userId}/avatar`}
										/>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold text-neutral-900">{account.name}</p>
											<p className="truncate text-xs text-neutral-500">{account.email}</p>
										</div>
									</button>
									<Tooltip label={t("account.signOut")}>
										<button
											type="button"
											onClick={() => void signOutAccount(account)}
											className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 opacity-0 transition-opacity hover:bg-white hover:text-neutral-900 focus-visible:opacity-100 group-hover:opacity-100"
											aria-label={t("account.signOut")}
										>
											<LogOut size={16} />
										</button>
									</Tooltip>
								</div>
							))}
							<Link
								href="/login?add=1"
								onClick={() => setOpen(false)}
								className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-neutral-800 transition-colors hover:bg-blue-50 active:bg-blue-50"
							>
								<UserPlus size={18} className="text-neutral-600" />
								{t("account.addAnother")}
							</Link>
						</div>
					</div>

					<div className="mt-2 overflow-hidden rounded-[22px] bg-white">
						<Link
							href="/settings/account"
							onClick={() => setOpen(false)}
							className="flex items-center gap-3 px-5 py-4 text-sm font-medium text-neutral-800 hover:bg-[#f2f6fc]"
						>
							<Settings size={18} className="text-neutral-600" />
							{t("account.settings")}
						</Link>
						{/* The phone header has no room for the Mail/Admin switch, so on phones both are plain rows here. */}
						{user?.role === "admin" && (
							<Link
								href={mailHref}
								onClick={() => setOpen(false)}
								className={`flex items-center gap-3 border-t border-neutral-100 px-5 py-4 text-sm font-medium text-neutral-800 hover:bg-[#f2f6fc] md:hidden ${adminActive ? "" : "bg-blue-50"}`}
							>
								<Mail size={18} className="text-neutral-600" />
								{t("navigation.modeMail")}
								{!adminActive && <Check className="ml-auto h-4 w-4 text-blue-600" />}
							</Link>
						)}
						{user?.role === "admin" && (
							<Link
								href="/admin"
								onClick={() => setOpen(false)}
								className={`flex items-center gap-3 border-t border-neutral-100 px-5 py-4 text-sm font-medium text-neutral-800 hover:bg-[#f2f6fc] ${adminActive ? "bg-blue-50" : ""}`}
							>
								<ShieldCheck size={18} className="text-neutral-600" />
								{t("account.admin")}
								{adminActive && <Check className="ml-auto h-4 w-4 text-blue-600" />}
							</Link>
						)}
						<button
							type="button"
							onClick={logout}
							className="flex w-full items-center gap-3 border-t border-neutral-100 px-5 py-4 text-left text-sm font-medium text-neutral-800 hover:bg-[#f2f6fc]"
						>
							<LogOut size={18} className="text-neutral-600" />
							{t("account.signOut")}
						</button>
					</div>
				</div>
			)}
		</div>
		</div>
	);
}
