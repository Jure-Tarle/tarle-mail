"use client";

import { mobilePrimaryActionClass } from "@/components/page-header-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Copy, Plus, Search } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { List, ListRow } from "@/components/ui/list";
import { SectionRowSkeleton } from "@/components/page-skeletons";
import { clearMailboxesCache } from "@/components/mailbox-provider-utils";
import { ProgressiveAvatarImage } from "@/components/progressive-avatar-image";
import { authFetch } from "@/lib/auth/client";
import type { CurrentAccountResponse, Domain, MailboxOwner, MailboxesResponse } from "./types";
import { formatAccountDateTime } from "../accounts/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { getMailboxAddress, getMailboxesBase, getMailboxName, sortMailboxes, type MailboxSort, type MailboxSortKey } from "./utils";
import { MailboxFilterMenu, type MailboxFilter } from "./mailbox-filter-menu";
import { MailboxDomainChips } from "./mailbox-domain-chips";

const COLUMNS = "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";
const STATUS_STYLES = {
	active: "bg-green-600/10 text-green-800",
	disabled: "bg-neutral-100 text-neutral-600",
	pendingDeletion: "bg-red-100 text-red-700",
};

export default function MailboxesPage() {
	const { t } = useLanguage();
	const qc = useQueryClient();
	const router = useRouter();
	const pathname = usePathname();
	const base = getMailboxesBase(pathname);
	// Filters live in the URL, so they survive opening a mailbox and coming back.
	const searchParams = useSearchParams();
	const [query, setQuery] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [localPart, setLocalPart] = useState("");
	const [domainId, setDomainId] = useState("");
	const [ownerUserId, setOwnerUserId] = useState("");
	const [mailboxType, setMailboxType] = useState<"personal" | "shared">("personal");
	const [createOpen, setCreateOpen] = useState(false);

	const account = useQuery({
		queryKey: ["auth", "me"],
		queryFn: async () => {
			const res = await authFetch("/api/auth/me", { redirectOnUnauthorized: false });
			return (await res.json()) as CurrentAccountResponse;
		},
	});

	// Prefill empty create fields with the signed-in account when the dialog opens or the account loads.
	const accountUserId = account.data?.user?.id;
	const accountUserName = account.data?.user?.name;
	const [prefilledFor, setPrefilledFor] = useState({ accountUserId, accountUserName, createOpen });
	if (prefilledFor.accountUserId !== accountUserId || prefilledFor.accountUserName !== accountUserName || prefilledFor.createOpen !== createOpen) {
		setPrefilledFor({ accountUserId, accountUserName, createOpen });
		if (createOpen) {
			setDisplayName(displayName || accountUserName?.trim() || "");
			setOwnerUserId(ownerUserId || accountUserId || "");
		}
	}

	const accounts = useQuery({
		queryKey: ["accounts", "mailbox-owners"],
		queryFn: async () => {
			const res = await authFetch("/api/accounts");
			if (!res.ok) return { accounts: [] as MailboxOwner[] };
			return (await res.json()) as { accounts: MailboxOwner[] };
		},
		enabled: createOpen,
	});

	const domains = useQuery({
		queryKey: ["domains"],
		queryFn: async () => {
			const res = await authFetch("/api/domains");
			return (await res.json()) as { domains: Domain[] };
		},
	});

	const mailboxes = useQuery({
		queryKey: ["mailboxes"],
		queryFn: async () => {
			const res = await authFetch("/api/mailboxes");
			return (await res.json()) as MailboxesResponse;
		},
	});

	const create = useMutation({
		mutationFn: async () => {
			const res = await authFetch("/api/mailboxes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domainId,
					...(mailboxType === "personal" ? { ownerUserId } : {}),
					localPart,
					displayName: displayName.trim(),
					type: mailboxType,
				}),
			});
			const json = (await res.json()) as { id?: string; error?: string };
			if (!res.ok) throw new Error(json.error ?? t("mailboxes.failed"));
			setDisplayName("");
			setLocalPart("");
			setDomainId("");
			setOwnerUserId("");
			return json.id;
		},
		onSuccess: (mailboxId) => {
			clearMailboxesCache();
			setCreateOpen(false);
			qc.invalidateQueries({ queryKey: ["mailboxes"] });
			if (mailboxType === "shared" && mailboxId) router.push(`${base}/${mailboxId}`);
			setMailboxType("personal");
		},
	});

	const domainMap = new Map(
		(domains.data?.domains ?? []).map((d) => [d.id, d.hostname]),
	);
	const allMailboxes = (mailboxes.data?.mailboxes ?? []).map((mailbox) => ({
		...mailbox,
		hostname: mailbox.hostname ?? domainMap.get(mailbox.domainId) ?? "?",
	}));
	const countBy = (key: (mailbox: (typeof allMailboxes)[number]) => string) => {
		const counts = new Map<string, number>();
		for (const mailbox of allMailboxes) counts.set(key(mailbox), (counts.get(key(mailbox)) ?? 0) + 1);
		return counts;
	};
	const domainCounts = countBy((mailbox) => mailbox.hostname);
	const typeCounts = countBy((mailbox) => mailbox.type ?? "personal");
	const statusCounts = countBy((mailbox) => mailbox.status ?? "active");
	// Every configured domain is a choice, also one without mailboxes yet; the busiest come first so
	// they stay visible when the chips run out of width.
	const domainOptions = [...new Set([...(domains.data?.domains ?? []).map((domain) => domain.hostname), ...domainCounts.keys()])]
		.map((hostname) => ({ hostname, count: domainCounts.get(hostname) ?? 0 }))
		.sort((a, b) => b.count - a.count || a.hostname.localeCompare(b.hostname));
	const typeOptions = (["personal", "shared"] as const).map((value) => ({ value, label: t(value === "shared" ? "mailboxes.sharedInbox" : "mailboxes.personalInbox"), count: typeCounts.get(value) ?? 0 }));
	const statusOptions = (["active", "disabled", "pendingDeletion"] as const)
		.filter((value) => statusCounts.has(value))
		.map((value) => ({ value, label: t(`mailboxes.filter.status.${value}`), count: statusCounts.get(value) ?? 0 }));
	const requestedType = searchParams.get("type");
	const requestedStatus = searchParams.get("status");
	const filter: MailboxFilter = {
		domain: domainOptions.some((option) => option.hostname === searchParams.get("domain")) ? searchParams.get("domain")! : "",
		type: requestedType === "personal" || requestedType === "shared" ? requestedType : "",
		status: statusOptions.some((option) => option.value === requestedStatus) ? requestedStatus as MailboxFilter["status"] : "",
	};
	const needle = query.trim().toLowerCase();
	const visibleMailboxes = allMailboxes.filter((mailbox) =>
		(!filter.domain || mailbox.hostname === filter.domain)
		&& (!filter.type || (mailbox.type ?? "personal") === filter.type)
		&& (!filter.status || (mailbox.status ?? "active") === filter.status)
		&& (!needle || getMailboxName(mailbox).toLowerCase().includes(needle) || getMailboxAddress(mailbox).toLowerCase().includes(needle)));
	const updateParams = (changes: Record<string, string>) => {
		const params = new URLSearchParams(searchParams.toString());
		for (const [key, value] of Object.entries(changes)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		const queryString = params.toString();
		router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
	};
	const applyFilter = (next: MailboxFilter) => updateParams({ domain: next.domain, type: next.type, status: next.status });
	// Sorting lives in the URL as well; without it the list keeps the server's order.
	const SORT_KEYS: MailboxSortKey[] = ["name", "type", "status", "lastSignIn"];
	const requestedSort = searchParams.get("sort");
	const sort: MailboxSort | null = SORT_KEYS.includes(requestedSort as MailboxSortKey)
		? { key: requestedSort as MailboxSortKey, dir: searchParams.get("dir") === "desc" ? "desc" : "asc" }
		: null;
	const sortedMailboxes = sort
		? sortMailboxes(visibleMailboxes, sort, { personal: t("mailboxes.personalInbox"), shared: t("mailboxes.sharedInbox") })
		: visibleMailboxes;
	const toggleSort = (key: MailboxSortKey) => {
		const dir = sort?.key === key && sort.dir === "asc" ? "desc" : "asc";
		updateParams({ sort: key, dir: dir === "desc" ? "desc" : "" });
	};
	const [copiedId, setCopiedId] = useState<string | null>(null);
	useEffect(() => {
		if (!copiedId) return;
		const timer = setTimeout(() => setCopiedId(null), 1600);
		return () => clearTimeout(timer);
	}, [copiedId]);
	const copyAddress = (id: string, address: string) => {
		navigator.clipboard.writeText(address).then(() => setCopiedId(id)).catch(() => undefined);
	};
	const sortHeader = (key: MailboxSortKey, label: string, className = "") => {
		const active = sort?.key === key;
		const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
		return (
			<span className={className}>
				<button
					type="button"
					onClick={() => toggleSort(key)}
					className={`group/sort -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 uppercase hover:bg-neutral-100 hover:text-neutral-800 ${active ? "text-neutral-900" : ""}`}
				>
					{label}
					{active && <span className="sr-only">, {t(sort.dir === "asc" ? "mailboxes.sort.asc" : "mailboxes.sort.desc")}</span>}
					<Icon className={`h-3.5 w-3.5 shrink-0 ${active ? "" : "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60"}`} aria-hidden="true" />
				</button>
			</span>
		);
	};
	const mailboxOwners = [...(accounts.data?.accounts ?? [])];
	if (account.data?.user?.id && !mailboxOwners.some((owner) => owner.id === account.data?.user?.id)) {
		mailboxOwners.unshift({
			id: account.data.user.id,
			email: account.data.user.email ?? "",
			name: account.data.user.name ?? account.data.user.email ?? t("mailboxes.currentAccount"),
			role: "admin",
		});
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-4">
				<h1 className="text-2xl md:text-3xl font-medium">{t("mailboxes.title")}</h1>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button className={mobilePrimaryActionClass}>
							<Plus className="h-4 w-4" />
							{t("mailboxes.new")}
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("mailboxes.createTitle")}</DialogTitle>
							<DialogDescription>{t("mailboxes.createDescription")}</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							{mailboxes.data?.canCreateShared && (
								<div className="space-y-2">
									<Label htmlFor="mailbox-type">{t("mailboxes.type")}</Label>
									<Select
										id="mailbox-type"
										value={mailboxType}
										onChange={(event) => setMailboxType(event.target.value as "personal" | "shared")}
										containerClassName="flex w-full rounded-none border-0 p-0"
										className="h-10 rounded-md border border-neutral-200 bg-white px-3 text-sm shadow-sm shadow-neutral-200/50 focus-visible:border-blue-600"
									>
										<option value="personal">{t("mailboxes.personalInbox")}</option>
										<option value="shared">{t("mailboxes.sharedInbox")}</option>
									</Select>
								</div>
							)}
							{mailboxType === "personal" ? (
							<div className="space-y-2">
								<Label htmlFor="mailbox-owner">{t("mailboxes.account")}</Label>
								<Select
									id="mailbox-owner"
									value={ownerUserId}
									onChange={(event) => {
										const owner = mailboxOwners.find((item) => item.id === event.target.value);
										setOwnerUserId(event.target.value);
										if (owner) setDisplayName(owner.name);
									}}
									containerClassName="flex w-full rounded-none border-0 p-0"
										className="h-10 rounded-md border border-neutral-200 bg-white px-3 text-sm shadow-sm shadow-neutral-200/50 focus-visible:border-blue-600"
								>
									{mailboxOwners.map((owner) => (
										<option key={owner.id} value={owner.id}>
											{owner.name} ({owner.email})
										</option>
									))}
								</Select>
							</div>
							) : (
								<p className="rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
									{t("mailboxes.sharedHint")}
								</p>
							)}
							<div className="space-y-2">
								<Label htmlFor="mailbox-name">{t("common.name")}</Label>
								<Input
									id="mailbox-name"
									value={displayName}
									onChange={(event) => setDisplayName(event.target.value)}
									placeholder={t("mailboxes.namePlaceholder")}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="mailbox-username">{t("mailboxes.emailAddress")}</Label>
								<div className="flex h-10 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-sm shadow-neutral-200/50 focus-within:border-blue-600">
									<Input
										id="mailbox-username"
										value={localPart}
										onChange={(event) => setLocalPart(event.target.value)}
										placeholder={t("mailboxes.localPlaceholder")}
										className="min-w-0 flex-1 rounded-none border-0 shadow-none focus-visible:border-0"
									/>
									<span className="flex items-center text-sm text-neutral-500">@</span>
									<Select
										aria-label={t("accounts.domain")}
										containerClassName="max-w-[55%] rounded-none border-0 p-0"
						className="h-full rounded-none border-0 bg-transparent px-3 text-sm text-neutral-700 shadow-none"
										value={domainId}
										onChange={(event) => setDomainId(event.target.value)}
									>
										<option value="">{t("accounts.selectDomain")}</option>
										{(domains.data?.domains ?? []).map((domain) => (
											<option key={domain.id} value={domain.id}>
												{domain.hostname}
											</option>
										))}
									</Select>
								</div>
							</div>
							{create.isError && (
								<p role="alert" className="text-sm text-red-600">{(create.error as Error).message}</p>
							)}
							<Button
								onClick={() => create.mutate()}
								disabled={(mailboxType === "personal" && !ownerUserId) || !displayName.trim() || !domainId || !localPart || create.isPending}
							>
								{create.isPending ? t("accounts.creating") : t("mailboxes.createButton")}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
			<section className="space-y-3">
				{allMailboxes.length > 0 && (
					<div className="flex flex-col gap-3 xl:flex-row xl:items-center">
						{domainOptions.length > 0 && <MailboxDomainChips domains={domainOptions} total={allMailboxes.length} value={filter.domain} onChange={(domain) => applyFilter({ ...filter, domain })} />}
						<div className="flex min-w-0 items-center gap-2 xl:ml-auto xl:shrink-0">
							<MailboxFilterMenu
								value={filter}
								onChange={applyFilter}
								total={allMailboxes.length}
								types={typeOptions}
								statuses={statusOptions}
							/>
							<label className="flex h-9 w-full items-center gap-2 rounded-full bg-white px-3.5 text-sm max-md:bg-neutral-100 max-xl:min-w-0 max-xl:flex-1 xl:w-72">
								<Search className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
								<input
									type="search"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder={t("mailboxes.searchPlaceholder")}
									aria-label={t("mailboxes.searchPlaceholder")}
									className="min-w-0 flex-1 bg-transparent text-neutral-900 outline-none placeholder:text-neutral-500"
								/>
							</label>
						</div>
					</div>
				)}
				{/* <div className="flex items-center justify-between">
					<span className="text-sm text-neutral-500">
						{(mailboxes.data?.mailboxes ?? []).length} total
					</span>
				</div> */}
				{mailboxes.isLoading && (
					<SectionRowSkeleton />
				)}
				{!mailboxes.isLoading && (mailboxes.data?.mailboxes ?? []).length === 0 && (
					<p className="rounded-2xl bg-white px-5 py-4 text-sm text-neutral-500">
						{t("mailboxes.none")}
					</p>
				)}
				{allMailboxes.length > 0 && visibleMailboxes.length === 0 && (
					<p className="rounded-2xl bg-white px-5 py-4 text-sm text-neutral-500">
						{t("mailboxes.noMatch")}
					</p>
				)}
				{visibleMailboxes.length > 0 && <List>
					<div className={`${COLUMNS} bg-white px-5 py-2 text-xs font-medium uppercase text-neutral-500`}>
						<span className="w-10" />
						{sortHeader("name", t("common.name"))}
						{sortHeader("type", t("mailboxes.type"), "hidden md:block")}
						{sortHeader("status", t("accounts.colStatus"), "hidden md:block")}
						{sortHeader("lastSignIn", t("accounts.colLastSignIn"), "hidden md:block")}
					</div>
					{sortedMailboxes.map((mailboxWithHostname) => {
						const mailbox = mailboxWithHostname;

						return (
							<ListRow key={mailbox.id} className={`${COLUMNS} relative px-5 py-4 transition-colors hover:bg-blue-50/40`}>
								<span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
									{getMailboxName(mailboxWithHostname).trim().charAt(0).toUpperCase() || "?"}
									{mailbox.hasAvatar && (
										<ProgressiveAvatarImage
											src={`/api/mailboxes/${mailbox.id}/avatar`}
											alt={t("mailboxes.profileAlt", { name: getMailboxName(mailboxWithHostname) })}
											className="absolute inset-0 h-full w-full object-cover"
										/>
									)}
								</span>
								<span className="min-w-0">
									{/* The name link stretches over the whole row, so the row opens the mailbox; the copy
									    button sits above it and copies the address instead. */}
									<Link
										href={`${base}/${mailbox.id}`}
										className="block truncate text-sm font-semibold text-neutral-900 outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-blue-500/60"
									>
										{getMailboxName(mailboxWithHostname)}
									</Link>
									<span className="flex min-w-0 items-center gap-1">
										<span className="min-w-0 truncate no-font-mono text-sm text-neutral-500">
											{getMailboxAddress(mailboxWithHostname)}
										</span>
										<Tooltip label={copiedId === mailbox.id ? t("common.copied") : t("common.copy")} className="relative z-10 inline-flex shrink-0">
											<button
												type="button"
												onClick={() => copyAddress(mailbox.id, getMailboxAddress(mailboxWithHostname))}
												aria-label={copiedId === mailbox.id ? t("common.copied") : t("common.copyLabel", { label: getMailboxAddress(mailboxWithHostname) })}
												className="-my-1 flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 max-md:h-9 max-md:w-9"
											>
												{copiedId === mailbox.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
											</button>
										</Tooltip>
									</span>
								</span>
								<span className="hidden md:block">
									<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${mailbox.type === "shared" ? "bg-blue-50 text-blue-700" : "bg-neutral-100 text-neutral-600"}`}>
										{mailbox.type === "shared" ? t("mailboxes.sharedInbox") : t("mailboxes.personalInbox")}
									</span>
								</span>
								<span className="hidden md:block">
									<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[mailbox.status ?? "active"]}`}>
										{t(`accounts.status.${mailbox.status ?? "active"}`, { date: "" })}
									</span>
								</span>
								<span className="hidden text-sm text-neutral-500 md:block">
									{mailbox.type === "shared" ? "—" : mailbox.lastSignInAt ? formatAccountDateTime(mailbox.lastSignInAt) : t("accounts.neverSignedIn")}
								</span>
							</ListRow>
						);
					})}
				</List>}
			</section>
		</div>
	);
}
