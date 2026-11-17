import assert from "node:assert/strict";
import test from "node:test";
import { classifyProviderKeyFailure, orderAgentKeysForUse } from "../src/lib/agent/api-key-failover.ts";

test("rejected, unpaid and forbidden keys rest a day", () => {
	for (const status of [401, 402, 403]) assert.deepEqual(classifyProviderKeyFailure(status, null), { reason: "rejected", cooldownMs: 86_400_000 });
});

test("a rate limit rests the key for as long as the provider asks, capped at an hour", () => {
	assert.equal(classifyProviderKeyFailure(429, "12")?.cooldownMs, 12_000);
	assert.equal(classifyProviderKeyFailure(429, null)?.cooldownMs, 60_000);
	assert.equal(classifyProviderKeyFailure(429, "99999")?.cooldownMs, 3_600_000);
	const inTwoMinutes = new Date(Date.now() + 120_000).toUTCString();
	const fromDate = classifyProviderKeyFailure(429, inTwoMinutes)?.cooldownMs ?? 0;
	assert.ok(fromDate > 100_000 && fromDate <= 120_000);
});

test("overloads and outages rest the key briefly; other errors are no reason to switch", () => {
	for (const status of [500, 502, 503, 504, 529]) assert.equal(classifyProviderKeyFailure(status, null)?.reason, "unavailable");
	for (const status of [200, 400, 404, 413, 422]) assert.equal(classifyProviderKeyFailure(status, null), null);
});

test("keys are used in order, resting ones last, disabled ones never", () => {
	const now = Date.now();
	const keys = [
		{ id: "a", position: 0, disabled: false, cooldownUntil: new Date(now + 60_000) },
		{ id: "b", position: 1, disabled: true, cooldownUntil: null },
		{ id: "c", position: 2, disabled: false, cooldownUntil: null },
		{ id: "d", position: 3, disabled: false, cooldownUntil: new Date(now - 1) },
		{ id: "e", position: 4, disabled: false, cooldownUntil: new Date(now + 10_000) },
	];
	assert.deepEqual(orderAgentKeysForUse(keys, now).map((key) => key.id), ["c", "d", "e", "a"]);
});
