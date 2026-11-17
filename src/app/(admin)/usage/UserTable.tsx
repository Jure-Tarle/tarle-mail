"use client";

import { useLanguage } from "@/components/language-provider";
import { WORKERS_PAID_BASE_USD } from "@/lib/usage/pricing";
import type { UsageResponse } from "./types";
import { formatBytes, formatCount, formatUsd } from "./utils";

const head = "px-4 py-2.5 text-xs font-medium text-neutral-500";
const cell = "px-4 py-3 tabular-nums";

/** Mail, storage and cost share per user over the last 30 days; the total row matches the tiles above. */
export function UserTable({ users }: Pick<UsageResponse, "users">) {
	const { t } = useLanguage();
	const sum = (pick: (user: UsageResponse["users"][number]) => number) => users.reduce((total, user) => total + pick(user), 0);
	const widest = Math.max(1, ...users.map((user) => user.received + user.sent));
	return (
		<section className="min-w-0 overflow-hidden rounded-2xl bg-white">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-5 md:px-6">
				<h2 className="text-lg font-semibold tracking-tight text-neutral-900">{t("usage.users.title")}</h2>
				<p className="text-xs text-neutral-500">{t("usage.users.hint")}</p>
			</div>
			<div role="region" tabIndex={0} aria-label={t("usage.users.title")} className="mt-3 overflow-x-auto">
				<table className="w-full min-w-[960px] text-left text-sm">
					<thead className="border-y border-[color:var(--u-line)]">
						<tr>
							<th scope="col" className={head}>{t("usage.users.col.user")}</th>
							<th scope="col" className={head}>{t("usage.users.col.mailboxes")}</th>
							<th scope="col" className={`${head} w-[20%]`}>{t("usage.users.col.mails")}</th>
							<th scope="col" className={`${head} text-right`}>{t("usage.legendReceived")}</th>
							<th scope="col" className={`${head} text-right`}>{t("usage.legendSent")}</th>
							<th scope="col" className={`${head} text-right`}>{t("usage.legendSpam")}</th>
							<th scope="col" className={`${head} text-right`}>{t("usage.legendFailed")}</th>
							<th scope="col" className={`${head} text-right`}>{t("usage.users.col.storage")}</th>
							<th scope="col" className={`${head} text-right`}>{t("usage.users.col.sendShare")}</th>
							<th scope="col" className={`${head} text-right`}>{t("usage.users.col.cost")}</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-[color:var(--u-line)]">
						{users.map((user) => (
							<tr key={user.id}>
								<td className="px-4 py-3">
									<div className="flex items-center gap-3">
										<span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[13px] font-semibold text-blue-800">{(user.name || user.email).charAt(0).toUpperCase()}</span>
										<div className="min-w-0">
											<div className="truncate font-medium text-neutral-900">{user.name || user.email}</div>
											<div className="truncate text-xs text-neutral-500">{user.email} · {t(user.role === "admin" ? "usage.users.role.admin" : "usage.users.role.user")}</div>
										</div>
									</div>
								</td>
								<td className={cell}>
									{user.mailboxes}
									{user.sharedMailboxes > 0 && <span className="block text-xs text-neutral-500">{t("usage.users.shared", { count: user.sharedMailboxes })}</span>}
								</td>
								<td className="px-4 py-3">
									<div className="flex h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--u-track)" }} role="img" aria-label={t("usage.users.mailsBar", { received: formatCount(user.received), sent: formatCount(user.sent) })}>
										<div className="bg-blue-600" style={{ width: `${(user.received / widest) * 100}%` }} />
										<div className="bg-emerald-500" style={{ width: `${(user.sent / widest) * 100}%` }} />
									</div>
								</td>
								<td className={`${cell} text-right`}>{formatCount(user.received)}</td>
								<td className={`${cell} text-right`}>{formatCount(user.sent)}</td>
								<td className={`${cell} text-right`}>{formatCount(user.spam)}</td>
								<td className={`${cell} text-right`} style={user.failed ? { color: "var(--u-red)" } : undefined}>{formatCount(user.failed)}</td>
								<td className={`${cell} text-right`}>{formatBytes(user.storageBytes)}</td>
								<td className={`${cell} text-right`}>{Math.round(user.sendShare * 100)} %</td>
								<td className={`${cell} text-right font-medium text-neutral-900`}>{formatUsd(user.cost)}</td>
							</tr>
						))}
					</tbody>
					<tfoot className="border-t border-[color:var(--u-line)]">
						<tr className="font-medium text-neutral-900">
							<td className="px-4 py-3">{t("usage.users.total")}</td>
							<td className={cell}>{sum((user) => user.mailboxes)}</td>
							<td />
							<td className={`${cell} text-right`}>{formatCount(sum((user) => user.received))}</td>
							<td className={`${cell} text-right`}>{formatCount(sum((user) => user.sent))}</td>
							<td className={`${cell} text-right`}>{formatCount(sum((user) => user.spam))}</td>
							<td className={`${cell} text-right`}>{formatCount(sum((user) => user.failed))}</td>
							<td className={`${cell} text-right`}>{formatBytes(sum((user) => user.storageBytes))}</td>
							<td className={`${cell} text-right`}>{Math.round(sum((user) => user.sendShare) * 100)} %</td>
							<td className={`${cell} text-right`}>{formatUsd(sum((user) => user.cost))}</td>
						</tr>
					</tfoot>
				</table>
			</div>
			<p className="pb-4 pt-2 text-xs md:px-6 text-neutral-500">{t("usage.users.note", { base: formatUsd(WORKERS_PAID_BASE_USD) })}</p>
		</section>
	);
}
