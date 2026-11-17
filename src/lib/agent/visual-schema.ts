import { z } from "zod";

/** What the assistant may draw in the chat. Small on purpose: an inline card, not a dashboard. */
export const MAX_POINTS = 31;
export const MAX_SERIES = 4;

const label = z.string().trim().min(1).max(60);
const cell = z.union([z.string().max(200), z.number().finite()]);

export const agentVisualSchema = z.object({
	kind: z.enum(["bar", "line", "table"]).describe("bar compares amounts per category, line shows change over time, table lists exact values"),
	title: z.string().trim().min(1).max(120),
	caption: z.string().trim().max(300).optional().describe("One short sentence on what the numbers are and where they come from"),
	unit: z.string().trim().max(20).optional().describe("Unit shown with values, e.g. emails"),
	labels: z.array(label).max(MAX_POINTS).optional().describe("bar/line: the categories or dates on the horizontal axis"),
	series: z.array(z.object({ name: label, values: z.array(z.number().finite()).max(MAX_POINTS) })).max(MAX_SERIES).optional().describe("bar/line: one entry per series, values in the same order as labels"),
	columns: z.array(label).max(6).optional().describe("table: column headings"),
	rows: z.array(z.array(cell).max(6)).max(30).optional().describe("table: one array per row, cells in column order"),
});

export type AgentVisual = z.infer<typeof agentVisualSchema>;

/** Checks the shape the schema cannot express; returns an error the model can act on, or null. */
export function agentVisualProblem(visual: AgentVisual): string | null {
	if (visual.kind === "table") {
		if (!visual.columns?.length || !visual.rows?.length) return "A table needs columns and at least one row.";
		const width = visual.columns.length;
		if (visual.rows.some((row) => row.length !== width)) return `Every table row needs exactly ${width} cells, one per column.`;
		return null;
	}
	if (!visual.labels?.length || !visual.series?.length) return "A chart needs labels and at least one series.";
	const count = visual.labels.length;
	if (visual.series.some((item) => item.values.length !== count)) return `Every series needs exactly ${count} values, one per label.`;
	if (visual.kind === "line" && count < 2) return "A line chart needs at least two labels; use a bar chart or a table instead.";
	return null;
}
