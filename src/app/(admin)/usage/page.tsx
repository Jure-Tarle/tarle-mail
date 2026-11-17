"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/components/language-provider";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ForecastPanel, MeterList } from "./MeterPanel";
import { ServiceCards } from "./ServiceCards";
import type { UsageResponse } from "./types";
import { UserTable } from "./UserTable";
import { fetchUsage, flowStatusClass, formatCount, formatDayLabel, formatDecimal, formatFlowDate, periodDayKey, saveBillingDay } from "./utils";
import "./usage.css";

function Tile({ label, value, average, dot }: { label: string; value: string; average: string; dot: string }) {
	return (
		<section className="rounded-2xl bg-white p-5">
			<p className="flex items-center gap-2 text-sm text-neutral-500"><span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />{label}</p>
			<p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-neutral-900">{value}</p>
			<p className="mt-1 text-xs tabular-nums text-neutral-500">{average}</p>
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
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
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

function BillingDay({ day }: { day: number }) {
	const { t } = useLanguage();
	const queryClient = useQueryClient();
	const save = useMutation({ mutationFn: saveBillingDay, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["usage"] }) });
	return (
		<div className="shrink-0">
			<label className="flex items-center gap-2 text-sm text-neutral-600" title={t("usage.billingDayHint")}>
				{t("usage.billingDay")}
				<select
					value={day}
					disabled={save.isPending}
					onChange={(event) => save.mutate(Number(event.target.value))}
					className="rounded-lg bg-neutral-100 px-2 py-1 text-sm tabular-nums text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-600"
				>
					{Array.from({ length: 28 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
				</select>
			</label>
			{save.error && <p role="alert" className="mt-1 text-xs text-red-700">{save.error instanceof Error ? save.error.message : t("usage.saveFailed")}</p>}
		</div>
	);
}

const tileDots = { received: "bg-blue-600", sent: "bg-emerald-500", spam: "bg-amber-400", failed: "bg-red-500" } as const;

export default function UsagePage() {
	const { t } = useLanguage();
	const usage = useQuery({ queryKey: ["usage"], queryFn: fetchUsage });
	const data = usage.data;

	return (
		<div className="usage-page space-y-6">
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="min-w-0">
					<h1 className="text-2xl md:text-3xl font-medium text-neutral-900">{t("usage.title")}</h1>
					<p className="mt-2 text-sm text-neutral-500">{t("usage.description")}</p>
					{data && (
						<p className="mt-1 text-sm tabular-nums text-neutral-500">
							{t("usage.period", { start: formatDayLabel(data.billing.start.slice(0, 10)), end: formatDayLabel(periodDayKey(data.billing.start, data.billing.days)), day: Math.ceil(data.billing.elapsedDays), days: data.billing.days })}
						</p>
					)}
				</div>
				{data && <BillingDay day={data.billing.day} />}
			</div>
			{usage.error && <p role="alert" className="text-sm text-red-700">{usage.error instanceof Error ? usage.error.message : t("usage.loadFailed")}</p>}
			{usage.isLoading && <Skeleton className="h-48 w-full rounded-2xl" />}
			{data && (
				<>
					<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
						{([["received", "usage.received"], ["sent", "usage.sent"], ["spam", "usage.spam"], ["failed", "usage.failed"]] as const).map(([key, label]) => (
							<Tile key={key} label={t(label)} value={formatCount(data.totals[key])} average={t("usage.perDay", { value: formatDecimal(data.totals[key] / data.daily.length) })} dot={tileDots[key]} />
						))}
					</div>

					<div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
						<MeterList meters={data.meters} />
						<ForecastPanel data={data} />
					</div>

					<ServiceCards data={data} />
					<MailChart daily={data.daily} timeZone={data.timeZone} />

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

					<UserTable users={data.users} />
					<p className="text-xs text-neutral-500">{t("usage.note")}</p>
				</>
			)}
		</div>
	);
}
