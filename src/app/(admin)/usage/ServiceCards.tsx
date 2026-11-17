"use client";

import { useLanguage } from "@/components/language-provider";
import { MiniCostChart } from "./charts";
import type { ServiceForecastView, UsageResponse } from "./types";
import { formatDayLabel, formatUsd, groupKeys, meterLabel, periodDayKey } from "./utils";

function ServiceCard({ service, data }: { service: ServiceForecastView; data: UsageResponse }) {
	const { t } = useLanguage();
	const { billing } = data;
	const name = t(groupKeys[service.id]);
	const over = service.cost > 0;
	const status = service.status.kind === "within"
		? <span style={{ color: "var(--u-green-text)" }}>{t("usage.service.within")}</span>
		: <span style={{ color: "var(--u-red)" }}>{t(service.status.kind === "exceeded" ? "usage.service.exceeded" : "usage.service.expected", { date: formatDayLabel(periodDayKey(billing.start, service.status.day)) })}</span>;
	return (
		<section className="flex min-w-0 flex-col rounded-2xl bg-white p-5">
			<div className="flex items-start justify-between gap-3">
				<h3 className="font-medium text-neutral-900">{name}</h3>
				{service.available && (
					<div className="text-right tabular-nums">
						<p className="text-xl font-semibold tracking-tight text-neutral-900">{over ? `+${formatUsd(service.cost)}` : formatUsd(0)}</p>
						<p className="text-[11px] text-neutral-500">{t("usage.service.soFar", { amount: formatUsd(service.soFar) })}</p>
					</div>
				)}
			</div>
			{service.available ? (
				<>
					<div className="mt-3"><MiniCostChart curve={service.curve} days={billing.days} today={billing.elapsedDays} over={over} label={t("usage.service.chart", { service: name })} /></div>
					<p className="mt-2 text-[13px]">{status}</p>
					<dl className="mt-3 space-y-1.5 border-t border-[color:var(--u-line)] pt-3 text-[13px] tabular-nums">
						{service.items.map((item) => (
							<div key={item.id} className="flex items-center justify-between gap-3">
								<dt className="min-w-0 truncate text-neutral-500">{meterLabel(t, item)}</dt>
								<dd className="flex shrink-0 items-center gap-2">
									<span className="text-neutral-500">{Math.round(item.ratio * 100)} %</span>
									<span className="w-16 text-right" style={{ color: item.cost > 0 ? "var(--u-red)" : "var(--u-muted)" }}>{item.cost > 0 ? `+${formatUsd(item.cost)}` : formatUsd(0)}</span>
								</dd>
							</div>
						))}
					</dl>
				</>
			) : <p className="mt-3 text-sm text-neutral-500">{t("usage.service.unavailable")}</p>}
		</section>
	);
}

/** One card per billed service: expected overage, how it builds up over the period and which allowance runs out when. */
export function ServiceCards({ data }: { data: UsageResponse }) {
	const { t } = useLanguage();
	return (
		<section>
			<div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h2 className="text-lg font-semibold tracking-tight text-neutral-900">{t("usage.services.title")}</h2>
				<p className="text-xs text-neutral-500">{t("usage.services.hint")}</p>
			</div>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
				{data.services.map((service) => <ServiceCard key={service.id} service={service} data={data} />)}
			</div>
		</section>
	);
}
