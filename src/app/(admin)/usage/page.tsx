"use client";

import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/components/language-provider";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { UsageResponse } from "./types";
import { fetchUsage, flowStatusClass, formatBytes, formatCount, formatDayLabel, formatFlowDate, usageBar } from "./utils";

function Bar({ used, limit }: { used: number; limit: number | null }) {
	const bar = usageBar(used, limit);
	if (!bar) return null;
	return (
		<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100" role="presentation">
			<div className={`h-full rounded-full ${bar.className}`} style={{ width: `${bar.percent}%` }} />
		</div>
	);
}

function Tile({ label, value }: { label: string; value: string }) {
	return (
		<section className="rounded-2xl bg-white p-5">
			<p className="text-sm text-neutral-500">{label}</p>
			<p className="mt-2 text-2xl font-semibold text-neutral-900">{value}</p>
		</section>
	);
}

function MailChart({ daily, timeZone }: Pick<UsageResponse, "daily" | "timeZone">) {
	const { t } = useLanguage();
	const max = Math.max(1, ...daily.map((day) => day.received + day.spam + day.sent + day.failed));
	return (
		<section className="rounded-2xl bg-white p-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-base font-semibold text-neutral-900">{t("usage.byDay")}</h2>
					<p className="mt-1 text-xs text-neutral-500">{t("usage.chartHint", { zone: timeZone })}</p>
				</div>
				<div className="flex items-center gap-4 text-xs text-neutral-600">
					<span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" /> {t("usage.legendReceived")}</span>
					<span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> {t("usage.legendSent")}</span>
					<span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> {t("usage.legendSpam")}</span>
					<span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> {t("usage.legendFailed")}</span>
				</div>
			</div>
			<div className="mt-5 flex gap-3" role="img" aria-label={t("usage.chartLabel")}>
				<div className="flex h-48 flex-col justify-between pb-5 text-right text-[10px] text-neutral-500"><span>{formatCount(max)}</span><span>0</span></div>
				<div className="flex min-w-0 flex-1 items-end gap-1 border-b border-neutral-200">
					{daily.map((day, index) => {
						const total = day.received + day.spam + day.sent + day.failed;
						const segments = [["bg-blue-600", day.received], ["bg-amber-400", day.spam], ["bg-emerald-500", day.sent], ["bg-red-500", day.failed]] as const;
						return (
							<div key={day.date} className="flex h-48 min-w-0 flex-1 flex-col items-center" title={t("usage.barTitle", { day: formatDayLabel(day.date), received: formatCount(day.received), sent: formatCount(day.sent), spam: formatCount(day.spam), failed: formatCount(day.failed) })}>
								<div className="flex h-[172px] w-full items-end justify-center">
									<div className="flex w-full max-w-5 flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${total ? Math.max(2, (total / max) * 100) : 0}%` }}>
										{segments.map(([className, count]) => count > 0 && <div key={className} className={className} style={{ height: `${(count / total) * 100}%` }} />)}
									</div>
								</div>
								<span className="h-5 whitespace-nowrap pt-1 text-[9px] text-neutral-500">{index % 5 === 0 || index === daily.length - 1 ? formatDayLabel(day.date) : ""}</span>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}

export default function UsagePage() {
	const { t } = useLanguage();
	const usage = useQuery({ queryKey: ["usage"], queryFn: fetchUsage });
	const data = usage.data;

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl md:text-3xl font-medium text-neutral-900">{t("usage.title")}</h1>
				<p className="mt-2 text-sm text-neutral-500">{t("usage.description")}</p>
			</div>
			{usage.error && <p role="alert" className="text-sm text-red-700">{usage.error instanceof Error ? usage.error.message : t("usage.loadFailed")}</p>}
			{usage.isLoading && <Skeleton className="h-48 w-full rounded-2xl" />}
			{data && (
				<>
					<div className="grid gap-4 sm:grid-cols-4">
						<Tile label={t("usage.received")} value={formatCount(data.totals.received)} />
						<Tile label={t("usage.sent")} value={formatCount(data.totals.sent)} />
						<Tile label={t("usage.spam")} value={formatCount(data.totals.spam)} />
						<Tile label={t("usage.failed")} value={formatCount(data.totals.failed)} />
					</div>
					<MailChart daily={data.daily} timeZone={data.timeZone} />

					<section className="rounded-2xl bg-white p-5">
						<h2 className="text-base font-semibold text-neutral-900">{t("usage.providers")}</h2>
						<p className="mt-1 text-xs text-neutral-500">{t("usage.providersHint")}</p>
						{data.providers.length === 0 && <p className="mt-3 text-sm text-neutral-500">{t("usage.noProviders")}</p>}
						<ul className="mt-3 divide-y divide-neutral-100">
							{data.providers.map((provider) => (
								<li key={provider.provider} className="grid gap-3 py-3 sm:grid-cols-2">
									<div className="min-w-0">
										<p className="font-medium text-neutral-900">{provider.label}</p>
										{provider.hosts.length > 0 && <p className="break-words text-xs text-neutral-500">{provider.hosts.join(", ")}</p>}
									</div>
									<div className="grid gap-2 text-sm">
										<div>
											<p className="flex justify-between"><span className="text-neutral-500">{t("usage.today")}</span><span className="tabular-nums">{formatCount(provider.today)}{provider.limits.perDay ? ` / ${formatCount(provider.limits.perDay)}` : ""}</span></p>
											<Bar used={provider.today} limit={provider.limits.perDay} />
										</div>
										<div>
											<p className="flex justify-between"><span className="text-neutral-500">{t("usage.thisMonth")}</span><span className="tabular-nums">{formatCount(provider.month)}{provider.limits.perMonth ? ` / ${formatCount(provider.limits.perMonth)}` : ""}</span></p>
											<Bar used={provider.month} limit={provider.limits.perMonth} />
										</div>
										{!provider.limits.perDay && !provider.limits.perMonth && <p className="text-xs text-neutral-500">{t("usage.noLimit")}</p>}
									</div>
								</li>
							))}
						</ul>
					</section>

					<section className="rounded-2xl bg-white p-5">
						<h2 className="text-base font-semibold text-neutral-900">{t("usage.resources")}</h2>
						<dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
							<div>
								<dt className="text-neutral-500">{t("usage.database")}</dt>
								{data.database.available ? (
									<dd>
										<span className="text-lg font-semibold text-neutral-900">{formatBytes(data.database.value.bytes)}</span>
										<Bar used={data.database.value.bytes} limit={data.database.value.freeLimitBytes} />
										<span className="mt-1 block text-xs text-neutral-500">{t("usage.databaseLimit", { limit: formatBytes(data.database.value.freeLimitBytes) })}</span>
									</dd>
								) : <dd className="text-xs text-neutral-500">{t("usage.unavailable", { reason: data.database.reason })}</dd>}
							</div>
							<div>
								<dt className="text-neutral-500">{t("usage.storage")}</dt>
								<dd>
									<span className="text-lg font-semibold text-neutral-900">{formatBytes(data.storage.attachmentBytes + data.storage.driveBytes)}</span>
									<span className="mt-1 block text-xs text-neutral-500">{t("usage.storageSplit", { attachments: formatBytes(data.storage.attachmentBytes), drive: formatBytes(data.storage.driveBytes) })}</span>
								</dd>
							</div>
							<div>
								<dt className="text-neutral-500">{t("usage.worker")}</dt>
								{data.worker.available ? (
									<dd>
										<span className="text-lg font-semibold text-neutral-900">{formatCount(data.worker.value.requests)}</span>
										<span className="mt-1 block text-xs text-neutral-500">{t("usage.workerErrors", { errors: formatCount(data.worker.value.errors) })}</span>
									</dd>
								) : <dd className="text-xs text-neutral-500">{t("usage.unavailable", { reason: data.worker.reason })}</dd>}
							</div>
						</dl>
					</section>

					<section role="region" tabIndex={0} aria-label={t("usage.flow")} className="overflow-x-auto rounded-2xl bg-white">
						<div className="px-5 pt-5"><h2 className="text-base font-semibold text-neutral-900">{t("usage.flow")}</h2><p className="mt-1 text-xs text-neutral-500">{t("usage.flowHint")}</p></div>
						<table className="mt-3 w-full min-w-[760px] text-left text-sm">
							<thead className="border-y border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
								<tr>
									<th scope="col" className="px-4 py-3">{t("usage.col.time")}</th>
									<th scope="col" className="px-4 py-3">{t("usage.col.direction")}</th>
									<th scope="col" className="px-4 py-3">{t("usage.col.from")}</th>
									<th scope="col" className="px-4 py-3">{t("usage.col.to")}</th>
									<th scope="col" className="px-4 py-3">{t("usage.col.status")}</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-neutral-100">
								{data.flow.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-500">{t("usage.flowNone")}</td></tr>}
								{data.flow.map((event) => (
									<tr key={event.id} className="align-top">
										<td className="whitespace-nowrap px-4 py-3 text-neutral-600">{formatFlowDate(event.createdAt)}</td>
										<td className="px-4 py-3">{t(event.direction === "inbound" ? "usage.inbound" : "usage.outbound")}</td>
										<td className="max-w-48 break-all px-4 py-3">{event.from}</td>
										<td className="max-w-48 break-all px-4 py-3">{event.to}</td>
										<td className="px-4 py-3">
											<Badge className={flowStatusClass[event.status]}>{t(`usage.status.${event.status}`)}</Badge>
											{event.detail && <p className="mt-1 max-w-64 break-words text-xs text-neutral-500">{event.detail}</p>}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>
					<p className="text-xs text-neutral-500">{t("usage.note")}</p>
				</>
			)}
		</div>
	);
}
