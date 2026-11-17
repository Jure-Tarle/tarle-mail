"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { agentVisualProblem, agentVisualSchema, type AgentVisual } from "@/lib/agent/visual-schema";
import { parseAgentToolContent } from "./utils";

const HEIGHT = 180;
const PAD = { top: 10, right: 8, bottom: 26, left: 36 };
const SERIES_COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"];

/** The visual a show_visual tool result carries, or null when it is missing or malformed. */
export function agentVisualFromToolContent(content: string): AgentVisual | null {
	const result = parseAgentToolContent(content);
	if (result?.status !== "shown") return null;
	const parsed = agentVisualSchema.safeParse(result.visual);
	return parsed.success && !agentVisualProblem(parsed.data) ? parsed.data : null;
}

function niceMax(value: number): number {
	if (value <= 0) return 1;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	const step = [1, 2, 2.5, 4, 5, 6, 8, 10].find((factor) => factor * magnitude >= value)!;
	return step * magnitude;
}

/** A bar whose data end has 4px rounded corners and whose baseline end stays square. */
function barPath(x: number, base: number, end: number, width: number): string {
	const radius = Math.min(4, width / 2, Math.abs(base - end));
	const up = end <= base;
	const corner = up ? end + radius : end - radius;
	const sweep = up ? 1 : 0;
	return `M${x},${base}V${corner}A${radius},${radius} 0 0 ${sweep} ${x + radius},${end}H${x + width - radius}A${radius},${radius} 0 0 ${sweep} ${x + width},${corner}V${base}Z`;
}

function useWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return [ref, width] as const;
}

function Chart({ visual, format }: { visual: AgentVisual; format: (value: number) => string }) {
	const [ref, width] = useWidth<HTMLDivElement>();
	const [hover, setHover] = useState<number | null>(null);
	const labels = visual.labels ?? [];
	const series = visual.series ?? [];
	const values = series.flatMap((item) => item.values);
	const max = niceMax(Math.max(0, ...values));
	const min = Math.min(0, ...values) < 0 ? -niceMax(-Math.min(...values)) : 0;
	const plotWidth = Math.max(0, width - PAD.left - PAD.right);
	const plotHeight = HEIGHT - PAD.top - PAD.bottom;
	const y = (value: number) => PAD.top + plotHeight * (1 - (value - min) / (max - min));
	const slot = labels.length ? plotWidth / labels.length : 0;
	const centre = (index: number) => PAD.left + slot * (index + 0.5);
	const ticks = [0, 1, 2, 3, 4].map((step) => min + ((max - min) * step) / 4);
	const labelEvery = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(plotWidth / 56))));
	const barWidth = Math.max(2, Math.min(28, (slot * 0.72 - 2 * (series.length - 1)) / Math.max(1, series.length)));
	const groupWidth = barWidth * series.length + 2 * (series.length - 1);
	// The tooltip sits beside the hovered column, never on top of it.
	const tooltipOnLeft = hover !== null && centre(hover) > width / 2;
	const tooltipLeft = hover === null ? 0 : tooltipOnLeft ? centre(hover) - Math.max(slot / 2, 6) - 4 : centre(hover) + Math.max(slot / 2, 6) + 4;
	const short = (text: string) => text.length > 10 ? `${text.slice(0, 9)}…` : text;

	return <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
		{width > 0 && <svg width={width} height={HEIGHT} role="img" aria-label={visual.title} className="block overflow-visible">
			{ticks.map((tick) => <g key={tick}>
				<line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--viz-grid)" strokeWidth={tick === 0 ? 1 : 0.5} />
				<text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-neutral-500 text-[10px] tabular-nums">{format(tick)}</text>
			</g>)}
			{labels.map((label, index) => index % labelEvery === 0 && <text key={index} x={centre(index)} y={HEIGHT - 8} textAnchor="middle" className="fill-neutral-500 text-[10px]">{short(label)}</text>)}
			{hover !== null && visual.kind === "line" && <line x1={centre(hover)} x2={centre(hover)} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--viz-grid)" strokeWidth={1} />}
			{visual.kind === "bar" && series.map((item, seriesIndex) => item.values.map((value, index) => {
				const x = centre(index) - groupWidth / 2 + seriesIndex * (barWidth + 2);
				return <path key={`${seriesIndex}:${index}`} d={barPath(x, y(0), y(value), barWidth)} fill={SERIES_COLORS[seriesIndex]} opacity={hover === null || hover === index ? 1 : 0.45} />;
			}))}
			{visual.kind === "line" && series.map((item, seriesIndex) => <g key={seriesIndex}>
				<polyline points={item.values.map((value, index) => `${centre(index)},${y(value)}`).join(" ")} fill="none" stroke={SERIES_COLORS[seriesIndex]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
				{(labels.length <= 14 || hover !== null) && item.values.map((value, index) => (labels.length <= 14 || hover === index) && <circle key={index} cx={centre(index)} cy={y(value)} r={4} fill={SERIES_COLORS[seriesIndex]} stroke="var(--viz-surface)" strokeWidth={2} />)}
			</g>)}
			{labels.map((_, index) => <rect key={index} x={PAD.left + slot * index} y={PAD.top} width={slot} height={plotHeight + PAD.bottom} fill="transparent" onPointerEnter={() => setHover(index)} onPointerDown={() => setHover(index)} />)}
		</svg>}
		{hover !== null && <div role="status" className={`pointer-events-none absolute top-0 z-10 w-max max-w-56 ${tooltipOnLeft ? "-translate-x-full" : ""} rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-sm`} style={{ left: tooltipLeft }}>
			<p className="font-medium text-neutral-900">{labels[hover]}</p>
			{series.map((item, seriesIndex) => <p key={seriesIndex} className="flex items-center gap-1.5 text-neutral-700">
				{series.length > 1 && <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SERIES_COLORS[seriesIndex] }} aria-hidden="true" />}
				{series.length > 1 && <span className="min-w-0 flex-1 truncate pr-2">{item.name}</span>}
				<span className="ml-auto tabular-nums">{format(item.values[hover])}{visual.unit ? ` ${visual.unit}` : ""}</span>
			</p>)}
		</div>}
	</div>;
}

function DataTable({ columns, rows, format }: { columns: string[]; rows: (string | number)[][]; format: (value: number) => string }) {
	return <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200">
		<table className="w-full border-collapse text-xs">
			<thead className="sticky top-0 bg-neutral-50"><tr>{columns.map((column, index) => <th key={index} scope="col" className={`px-2.5 py-1.5 font-medium text-neutral-700 ${index > 0 && rows.every((row) => typeof row[index] === "number") ? "text-right" : "text-left"}`}>{column}</th>)}</tr></thead>
			<tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-neutral-100">{row.map((cell, index) => <td key={index} className={`px-2.5 py-1.5 text-neutral-800 ${typeof cell === "number" ? "text-right tabular-nums" : "break-words"}`}>{typeof cell === "number" ? format(cell) : cell}</td>)}</tr>)}</tbody>
		</table>
	</div>;
}

/** A chart or table the assistant drew, with a legend for several series and a switch to the exact values. */
export function AgentVisualCard({ visual }: { visual: AgentVisual }) {
	const { t, locale } = useLanguage();
	const [asTable, setAsTable] = useState(false);
	const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
	const format = (value: number) => numberFormat.format(value);
	const series = visual.series ?? [];
	const isChart = visual.kind !== "table";
	const tableColumns = isChart ? [t("agent.visual.category"), ...series.map((item) => item.name)] : visual.columns ?? [];
	const tableRows = isChart ? (visual.labels ?? []).map((label, index) => [label, ...series.map((item) => item.values[index])]) : visual.rows ?? [];

	return <figure className="agent-viz rounded-xl border border-neutral-200 bg-white p-3.5">
		<figcaption className="mb-2 flex items-start gap-3">
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium text-neutral-900">{visual.title}</span>
				{visual.caption && <span className="mt-0.5 block text-xs text-neutral-500">{visual.caption}</span>}
			</span>
			{isChart && <button type="button" onClick={() => setAsTable(!asTable)} aria-pressed={asTable} className="shrink-0 rounded-md px-2 py-1 text-xs text-blue-700 hover:bg-blue-50">
				{asTable ? t("agent.visual.showChart") : t("agent.visual.showTable")}
			</button>}
		</figcaption>
		{isChart && series.length > 1 && !asTable && <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-700">
			{series.map((item, index) => <li key={index} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLORS[index] }} aria-hidden="true" />{item.name}</li>)}
		</ul>}
		{isChart && !asTable ? <Chart visual={visual} format={format} /> : <DataTable columns={tableColumns} rows={tableRows} format={format} />}
	</figure>;
}
