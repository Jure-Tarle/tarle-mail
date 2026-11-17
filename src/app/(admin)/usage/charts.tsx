import type { CostPoint } from "./types";

type CostLineProps = {
	curve: CostPoint[];
	days: number;
	/** Where the solid line ends and the dashed forecast begins. */
	today: number;
	color: string;
	label: string;
	className: string;
	height: number;
	strokeWidth: number;
};

/** Accrued overage cost over a billing period: solid until today, dashed as forecast after it. */
function CostLine({ curve, days, today, color, label, className, height, strokeWidth }: CostLineProps) {
	const width = 1000;
	const max = Math.max(0.05, ...curve.map((point) => point.cost)) * 1.25;
	const x = (day: number) => (day / days) * width;
	const y = (cost: number) => height - 6 - (cost / max) * (height - 12);
	const points = (list: CostPoint[]) => list.map((point) => `${x(point.day)},${y(point.cost)}`).join(" ");
	const stroke = { fill: "none", stroke: color, strokeWidth, vectorEffect: "non-scaling-stroke" } as const;
	return (
		<svg viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none" role="img" aria-label={label}>
			<line x1="0" x2={width} y1={y(0)} y2={y(0)} stroke="var(--u-line)" vectorEffect="non-scaling-stroke" />
			<line x1={x(today)} x2={x(today)} y1="0" y2={height} stroke="var(--u-muted)" strokeDasharray="2 4" opacity=".6" vectorEffect="non-scaling-stroke" />
			<polyline points={points(curve.filter((point) => point.day <= today))} {...stroke} />
			<polyline points={points(curve.filter((point) => point.day >= today))} {...stroke} strokeDasharray="6 6" opacity=".7" />
		</svg>
	);
}

export const CostChart = (props: Pick<CostLineProps, "curve" | "days" | "today" | "label">) => (
	<CostLine {...props} color="var(--u-blue)" className="h-40 w-full" height={160} strokeWidth={3} />
);

export const MiniCostChart = ({ over, ...props }: Pick<CostLineProps, "curve" | "days" | "today" | "label"> & { over: boolean }) => (
	<CostLine {...props} color={over ? "var(--u-red)" : "var(--u-blue)"} className="h-14 w-full" height={56} strokeWidth={2.5} />
);
