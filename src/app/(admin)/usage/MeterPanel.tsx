"use client";

import { useLanguage } from "@/components/language-provider";
import { GB, PRICING, type Allowance } from "@/lib/usage/pricing";
import { CostChart } from "./charts";
import type { Meter, UsageResponse } from "./types";
import { formatBytes, formatDayLabel, formatDecimal, formatMeterCount, formatMeterValue, formatUsd, groupKeys, levelColor, meterLabel, periodDayKey } from "./utils";

/** What each billed metric costs beyond its allowance, per the unit the price is quoted in. */
const priceNotes: Record<string, { allowance: Allowance; unit: "gb" | "million" | "thousand" }> = {
	d1Storage: { allowance: PRICING.d1.storageGb, unit: "gb" },
	d1Read: { allowance: PRICING.d1.rowsRead, unit: "million" },
	d1Write: { allowance: PRICING.d1.rowsWritten, unit: "million" },
	r2Storage: { allowance: PRICING.r2.storageGb, unit: "gb" },
	r2ClassA: { allowance: PRICING.r2.classA, unit: "million" },
	r2ClassB: { allowance: PRICING.r2.classB, unit: "million" },
	emailSending: { allowance: PRICING.emailSending, unit: "thousand" },
	requests: { allowance: PRICING.workerRequests, unit: "million" },
};
const unitKeys = { gb: "usage.unit.gb", million: "usage.unit.million", thousand: "usage.unit.thousand" } as const;
const unitSize = { gb: 1, million: 1_000_000, thousand: 1_000 };

function Bar({ meter, label }: { meter: Meter & { available: true }; label: string }) {
	const { t } = useLanguage();
	if (!meter.included) return <div className="h-3 w-full rounded-full" style={{ background: "var(--u-track)" }} aria-hidden="true" />;
	const color = levelColor[meter.level ?? "ok"];
	const used = Math.min(100, (meter.used / meter.included) * 100);
	const projected = Math.min(100, (meter.projected / meter.included) * 100);
	return (
		<div className="relative" role="img" aria-label={t("usage.meter.aria", { label, used: formatMeterValue(meter, meter.used), included: formatMeterValue(meter, meter.included), projected: formatMeterValue(meter, meter.projected) })}>
			<div className="relative h-3 w-full overflow-hidden rounded-full" style={{ background: "var(--u-track)" }}>
				<div className="absolute inset-y-0 left-0 rounded-full opacity-25" style={{ width: `${projected}%`, background: color }} />
				<div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${used}%`, background: color }} />
			</div>
			<div className="absolute -top-1 h-5 w-0.5 rounded bg-neutral-900 opacity-55" style={{ left: `calc(${projected}% - 1px)` }} />
		</div>
	);
}

function MeterRow({ meter }: { meter: Meter }) {
	const { t } = useLanguage();
	const label = meterLabel(t, meter.available ? meter : { id: meter.id });
	if (!meter.available) {
		return (
			<div className="grid gap-x-6 gap-y-1 py-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
				<div className="font-medium text-neutral-900">{label}</div>
				<p className="text-sm text-neutral-500" title={meter.reason}>{t("usage.meter.unavailable")}</p>
			</div>
		);
	}
	const price = priceNotes[meter.id];
	const note = meter.provider
		? meter.provider.perDay ? t("usage.meter.today", { used: formatMeterCount(meter.provider.today), limit: formatMeterCount(meter.provider.perDay) }) : null
		: price && t("usage.price.above", {
			price: formatUsd(price.allowance.perUnit * unitSize[price.unit], true),
			unit: t(unitKeys[price.unit]),
			included: meter.unit === "bytes" ? formatBytes(price.allowance.included * GB) : formatMeterCount(price.allowance.included),
		});
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 py-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)_150px_110px]">
			<div className="col-span-2 min-w-0 md:col-span-1">
				<div className="font-medium text-neutral-900">{label}</div>
				{note && <div className="text-xs text-neutral-500">{note}</div>}
			</div>
			<div className="col-span-2 md:col-span-1"><Bar meter={meter} label={label} /></div>
			<div className="text-sm tabular-nums">
				<span className="font-medium text-neutral-900">{formatMeterValue(meter, meter.used)}</span>
				{meter.included ? <span className="text-neutral-500"> / {formatMeterValue(meter, meter.included)}</span> : null}
			</div>
			<div className="text-right text-sm tabular-nums" style={{ color: meter.cost > 0 ? "var(--u-red)" : "var(--u-muted)" }}>
				{meter.cost > 0 ? `+${formatUsd(meter.cost)}` : meter.included ? t("usage.meter.included") : t("usage.meter.noLimit")}
			</div>
		</div>
	);
}

/** The meters grouped by service, each a bar of what is used so far, what is expected by the end of the period and the forecast tick. */
export function MeterList({ meters }: { meters: Meter[] }) {
	const { t } = useLanguage();
	const groups = [...new Set(meters.map((meter) => meter.group))];
	return (
		<section className="min-w-0 rounded-2xl bg-white p-6 pb-2">
			{groups.map((group, index) => (
				<div key={group} className={`pt-3 ${index ? "border-t border-[color:var(--u-line)]" : ""}`}>
					<h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t(groupKeys[group])}</h2>
					<div className="divide-y divide-[color:var(--u-line)]">
						{meters.filter((meter) => meter.group === group).map((meter) => <MeterRow key={meter.id} meter={meter} />)}
					</div>
				</div>
			))}
			<div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[color:var(--u-line)] py-3 text-xs text-neutral-500">
				<span className="flex items-center gap-2"><span className="inline-block h-2 w-5 rounded-full" style={{ background: "var(--u-blue)" }} />{t("usage.legend.used")}</span>
				<span className="flex items-center gap-2"><span className="inline-block h-2 w-5 rounded-full opacity-25" style={{ background: "var(--u-blue)" }} />{t("usage.legend.projected")}</span>
				<span className="flex items-center gap-2"><span className="inline-block h-3 w-0.5 bg-neutral-900 opacity-55" />{t("usage.legend.tick")}</span>
			</div>
		</section>
	);
}

/** The expected bill for the billing period: total, the overage curve, and what adds to it. */
export function ForecastPanel({ data }: { data: UsageResponse }) {
	const { t } = useLanguage();
	const { forecast, billing } = data;
	const lastDay = periodDayKey(billing.start, billing.days);
	return (
		<section className="min-w-0 rounded-2xl bg-white p-6">
			<h2 className="text-xs text-neutral-500">{t("usage.forecast.title")}</h2>
			<p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums text-neutral-900">{formatUsd(forecast.total)}</p>
			<div className="mt-4">
				<CostChart curve={forecast.curve} days={billing.days} today={billing.elapsedDays} label={t("usage.forecast.chart")} />
				<div className="mt-1 flex justify-between text-[11px] text-neutral-500"><span>{formatDayLabel(billing.start.slice(0, 10))}</span><span>{formatDayLabel(lastDay)}</span></div>
			</div>
			<dl className="mt-4 space-y-2 text-sm tabular-nums">
				<div className="flex justify-between gap-3"><dt className="text-neutral-500">{t("usage.forecast.base")}</dt><dd>{formatUsd(forecast.base)}</dd></div>
				{forecast.lines.map((line) => {
					const meter = data.meters.find((item) => item.id === line.id);
					return (
						<div key={line.id} className="flex justify-between gap-3">
							<dt className="text-neutral-500">{meter && meter.group !== "sending" ? `${t(groupKeys[meter.group])} ` : ""}{meter && meterLabel(t, meter.available ? meter : { id: meter.id })}</dt>
							<dd>+{formatUsd(line.cost)}</dd>
						</div>
					);
				})}
				<div className="flex justify-between gap-3 border-t border-[color:var(--u-line)] pt-2 font-medium text-neutral-900"><dt>{t("usage.forecast.total")}</dt><dd>{formatUsd(forecast.total)}</dd></div>
			</dl>
			<p className="mt-4 text-xs leading-5 text-neutral-500">{t("usage.forecast.method", { elapsed: formatDecimal(billing.elapsedDays), days: billing.days })}</p>
		</section>
	);
}
