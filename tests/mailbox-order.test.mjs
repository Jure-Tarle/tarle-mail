import assert from "node:assert/strict";
import test from "node:test";
import { parseMailboxOrder, sortByMailboxOrder } from "../src/lib/mailboxes/order-utils.ts";

const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

test("mailboxes follow the saved order, unknown ones keep their place after it", () => {
	assert.deepEqual(sortByMailboxOrder(rows, ["c", "a"]).map((row) => row.id), ["c", "a", "b", "d"]);
});

test("ids of deleted mailboxes in the saved order are ignored", () => {
	assert.deepEqual(sortByMailboxOrder(rows, ["x", "d", "b"]).map((row) => row.id), ["d", "b", "a", "c"]);
});

test("no saved order leaves the list unchanged", () => {
	assert.deepEqual(sortByMailboxOrder(rows, []).map((row) => row.id), ["a", "b", "c", "d"]);
});

test("a stored order that is not a list of strings counts as none", () => {
	assert.deepEqual(parseMailboxOrder('["a", 2, "b"]'), ["a", "b"]);
	assert.deepEqual(parseMailboxOrder("{}"), []);
	assert.deepEqual(parseMailboxOrder("not json"), []);
	assert.deepEqual(parseMailboxOrder(null), []);
});

test("stored mailbox colours keep only ids mapped to lowercase #rrggbb", async () => {
	const { parseMailboxColors, isMailboxColor } = await import("../src/lib/mailboxes/order-utils.ts");
	assert.deepEqual(parseMailboxColors('{"a":"#2563eb","b":"red","c":"#ABCDEF","d":7}'), { a: "#2563eb" });
	assert.deepEqual(parseMailboxColors("[]"), {});
	assert.deepEqual(parseMailboxColors("nope"), {});
	assert.equal(isMailboxColor("#00ff00"), true);
	assert.equal(isMailboxColor("#00FF00"), false);
});
