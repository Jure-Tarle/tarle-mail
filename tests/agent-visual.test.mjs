import assert from "node:assert/strict";
import test from "node:test";
import { agentVisualProblem, agentVisualSchema } from "../src/lib/agent/visual-schema.ts";

test("a chart's series must match its labels", () => {
	const ok = agentVisualSchema.parse({ kind: "bar", title: "Mails", labels: ["A", "B"], series: [{ name: "Inbox", values: [3, 4] }] });
	assert.equal(agentVisualProblem(ok), null);
	const bad = agentVisualSchema.parse({ kind: "bar", title: "Mails", labels: ["A", "B"], series: [{ name: "Inbox", values: [3] }] });
	assert.match(agentVisualProblem(bad), /exactly 2 values/);
});

test("tables need rows as wide as their columns, lines need two points", () => {
	assert.match(agentVisualProblem(agentVisualSchema.parse({ kind: "table", title: "T", columns: ["a", "b"], rows: [["x"]] })), /exactly 2 cells/);
	assert.match(agentVisualProblem(agentVisualSchema.parse({ kind: "line", title: "L", labels: ["Mon"], series: [{ name: "s", values: [1] }] })), /two labels/);
});

test("more than four series or thirty-one points are refused by the schema", () => {
	const series = Array.from({ length: 5 }, (_, index) => ({ name: `s${index}`, values: [1] }));
	assert.equal(agentVisualSchema.safeParse({ kind: "bar", title: "x", labels: ["a"], series }).success, false);
});
