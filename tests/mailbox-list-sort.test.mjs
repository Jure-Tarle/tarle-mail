import assert from "node:assert/strict";
import test from "node:test";
import { sortMailboxes } from "../src/app/(admin)/mailboxes/utils.ts";

const labels = { personal: "Personal inbox", shared: "Shared inbox" };
const box = (localPart, extra = {}) => ({ localPart, hostname: "tarle.de", displayName: null, type: "personal", status: "active", lastSignInAt: null, ...extra });
const names = (list) => list.map((item) => item.localPart);

test("sorts by name in both directions, case-insensitively and with numbers in order", () => {
	const list = [box("support"), box("Ai"), box("kontakt"), box("dev10"), box("dev2")];
	assert.deepEqual(names(sortMailboxes(list, { key: "name", dir: "asc" }, labels)), ["Ai", "dev2", "dev10", "kontakt", "support"]);
	assert.deepEqual(names(sortMailboxes(list, { key: "name", dir: "desc" }, labels)), ["support", "kontakt", "dev10", "dev2", "Ai"]);
});

test("sorts by type and status, then by name", () => {
	const list = [box("b", { type: "shared" }), box("c"), box("a", { type: "shared", status: "disabled" }), box("d", { status: "pendingDeletion" })];
	assert.deepEqual(names(sortMailboxes(list, { key: "type", dir: "asc" }, labels)), ["c", "d", "a", "b"]);
	assert.deepEqual(names(sortMailboxes(list, { key: "status", dir: "asc" }, labels)), ["b", "c", "a", "d"]);
});

test("last sign-in keeps mailboxes without one at the end in both directions", () => {
	const list = [
		box("old", { lastSignInAt: "2026-11-01T10:00:00Z" }),
		box("never"),
		box("team", { type: "shared", lastSignInAt: "2026-11-20T10:00:00Z" }),
		box("new", { lastSignInAt: "2026-11-23T10:00:00Z" }),
	];
	assert.deepEqual(names(sortMailboxes(list, { key: "lastSignIn", dir: "desc" }, labels)), ["new", "old", "never", "team"]);
	assert.deepEqual(names(sortMailboxes(list, { key: "lastSignIn", dir: "asc" }, labels)), ["old", "new", "never", "team"]);
});
