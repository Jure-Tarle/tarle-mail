import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-mailbox-storage-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

const shared = { bundle: true, platform: "node", format: "esm", target: "node22", tsconfig: join(root, "tsconfig.json"), external: ["better-sqlite3", "drizzle-orm", "drizzle-orm/*"], logLevel: "silent" };
await build({
	...shared,
	stdin: {
		contents: `
			export * from "./src/lib/mailboxes/storage-limits";
			export * from "./src/lib/mailboxes/storage-usage";
			export { getDb } from "./src/db";
			export { getSendErrorStatus } from "./src/app/api/send/error-utils";
		`,
		resolveDir: root,
		loader: "ts",
	},
	outfile: join(outDir, "limits.mjs"),
});
await build({
	...shared,
	entryPoints: { database: join(root, "server/runtime/sqlite-database.ts"), migrate: join(root, "server/runtime/migrate.ts") },
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
});
const load = (name) => import(pathToFileURL(join(outDir, `${name}.mjs`)).href);
const limits = await load("limits");
const { SqliteDatabase } = await load("database");
const { applyMigrations } = await load("migrate");

const GB = 1024 ** 3;
const seconds = (date) => Math.floor(date.getTime() / 1000);

async function createFixture(t, { objects = {} } = {}) {
	const database = new SqliteDatabase(join(outDir, `${crypto.randomUUID()}.sqlite`));
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	const now = seconds(new Date());
	const run = (sql, ...params) => database.db.prepare(sql).run(...params);
	const get = (sql, ...params) => database.db.prepare(sql).get(...params);
	for (const id of ["alice", "bob"]) run("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, 'x', ?)", id, `${id}@example.com`, id, now);
	run("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'alice', 'example.com', 'zone', ?)", now);
	const addMailbox = (id, userId, storageLimit = null, dailyLimit = null) => run(
		"INSERT INTO mailboxes (id, user_id, domain_id, local_part, storage_limit_bytes, daily_send_limit, created_at) VALUES (?, ?, 'd1', ?, ?, ?, ?)",
		id, userId, id, storageLimit, dailyLimit, now,
	);
	const addMessage = (id, mailboxId, { size = null, direction = "inbound", status = "received", createdAt = now, rawR2Key = null, text = null } = {}) => run(
		"INSERT INTO messages (id, mailbox_id, user_id, direction, from_addr, to_addr, subject, text_body, raw_r2_key, size_bytes, status, created_at) VALUES (?, ?, 'alice', ?, 'a@b.test', 'c@d.test', 'Hi', ?, ?, ?, ?, ?)",
		id, mailboxId, direction, text, rawR2Key, size, status, createdAt,
	);
	const setDefaults = (storage, dailySend) => run(
		"INSERT INTO app_settings (id, default_mailbox_storage_limit_bytes, default_mailbox_daily_send_limit, updated_at) VALUES ('default', ?, ?, unixepoch()) ON CONFLICT (id) DO UPDATE SET default_mailbox_storage_limit_bytes = excluded.default_mailbox_storage_limit_bytes, default_mailbox_daily_send_limit = excluded.default_mailbox_daily_send_limit",
		storage, dailySend,
	);
	const heads = [];
	const env = {
		DB: database,
		BUCKET: { head: async (key) => { heads.push(key); if (key === "broken") throw new Error("R2 unavailable"); return key in objects ? { size: objects[key] } : null; } },
	};
	return { env, run, get, addMailbox, addMessage, setDefaults, heads };
}

test("a mailbox's own limit overrides the default and null falls back to it", () => {
	const defaults = { storageBytes: 5 * GB, dailySend: 100 };
	assert.deepEqual(limits.resolveMailboxLimits({ storageLimitBytes: null, dailySendLimit: null }, defaults), { storageBytes: 5 * GB, dailySend: 100 });
	assert.deepEqual(limits.resolveMailboxLimits({ storageLimitBytes: 2 * GB, dailySendLimit: 10 }, defaults), { storageBytes: 2 * GB, dailySend: 10 });
	assert.deepEqual(limits.resolveMailboxLimits({ storageLimitBytes: 0, dailySendLimit: 0 }, defaults), { storageBytes: null, dailySend: null }, "0 is an explicit unlimited");
});

test("no own limit and no default means unlimited", () => {
	const unlimited = { storageBytes: null, dailySend: null };
	assert.deepEqual(limits.resolveMailboxLimits({ storageLimitBytes: null, dailySendLimit: null }, unlimited), unlimited);
	assert.equal(limits.isStorageFull(Number.MAX_SAFE_INTEGER, null), false);
	assert.equal(limits.isDailySendLimitReached(1_000_000, null), false);
});

test("storage is full at the limit, and the warning starts at 90%", () => {
	assert.equal(limits.isStorageFull(99, 100), false);
	assert.equal(limits.isStorageFull(100, 100), true);
	assert.equal(limits.isStorageNearLimit(89, 100), false);
	assert.equal(limits.isStorageNearLimit(90, 100), true);
	assert.equal(limits.isStorageNearLimit(500, null), false);
});

test("gigabytes convert to bytes and back", () => {
	assert.equal(limits.gigabytesToBytes(1.5), 1.5 * GB);
	assert.equal(limits.bytesToGigabytes(limits.gigabytesToBytes(0.25)), 0.25);
});

test("getEffectiveMailboxLimits reads the admin default from app settings", async (t) => {
	const { env, setDefaults } = await createFixture(t);
	assert.deepEqual(await limits.getEffectiveMailboxLimits(env, { storageLimitBytes: null, dailySendLimit: null }), { storageBytes: null, dailySend: null });
	setDefaults(3 * GB, 50);
	assert.deepEqual(await limits.getEffectiveMailboxLimits(env, { storageLimitBytes: null, dailySendLimit: null }), { storageBytes: 3 * GB, dailySend: 50 });
	assert.deepEqual(await limits.getEffectiveMailboxLimits(env, { storageLimitBytes: GB, dailySendLimit: null }), { storageBytes: GB, dailySend: 50 });
});

test("inbound mail is refused once the mailbox reaches its limit and never for an unlimited one", async (t) => {
	const { env, addMailbox, addMessage, setDefaults } = await createFixture(t);
	addMailbox("small", "alice", 1000);
	addMailbox("open", "alice");
	addMailbox("inherits", "alice");
	addMessage("m1", "small", { size: 600 });
	addMessage("m2", "small");
	addMessage("m3", "open", { size: 10 * GB });
	addMessage("m4", "inherits", { size: 500 });
	assert.equal(await limits.isMailboxFull(env, "small"), false, "unmeasured messages count as 0");
	addMessage("m5", "small", { size: 400 });
	assert.equal(await limits.getMailboxStorageUsed(env, "small"), 1000);
	assert.equal(await limits.isMailboxFull(env, "small"), true);
	assert.equal(await limits.isMailboxFull(env, "open"), false);
	assert.equal(await limits.isMailboxFull(env, "inherits"), false);
	setDefaults(500, null);
	assert.equal(await limits.isMailboxFull(env, "inherits"), true, "the default applies to mailboxes without their own limit");
	assert.equal(await limits.isMailboxFull(env, "open"), true);
});

test("the summary measures usage only when a limit applies or detail is asked for", async (t) => {
	const { env, addMailbox, addMessage } = await createFixture(t);
	addMailbox("open", "alice");
	addMailbox("capped", "alice", 5000);
	addMessage("o1", "open", { size: 700 });
	addMessage("c1", "capped", { size: 900 });
	assert.equal((await limits.getMailboxStorageSummary(env, "open")).usedBytes, 0, "no limit, no detail: the sum is skipped");
	assert.equal((await limits.getMailboxStorageSummary(env, "open", { detail: true })).usedBytes, 700);
	assert.equal((await limits.getMailboxStorageSummary(env, "capped")).usedBytes, 900, "a limit always measures");
});

test("a failing storage lookup accepts the mail", async (t) => {
	const { env } = await createFixture(t);
	const originalError = console.error;
	console.error = () => {};
	t.after(() => { console.error = originalError; });
	assert.equal(await limits.isMailboxFull({ ...env, DB: undefined }, "any"), false);
});

test("the daily send limit allows messages up to the limit and blocks the next one", async (t) => {
	const { env, addMailbox, addMessage } = await createFixture(t);
	addMailbox("sender", "alice", null, 2);
	const now = new Date();
	const startOfToday = seconds(limits.startOfUtcDay(now));
	addMessage("old", "sender", { direction: "outbound", status: "sent", createdAt: startOfToday - 1 });
	addMessage("failed", "sender", { direction: "outbound", status: "failed", createdAt: startOfToday + 1 });
	addMessage("draft", "sender", { direction: "outbound", status: "draft", createdAt: startOfToday + 1 });
	addMessage("received", "sender", { direction: "inbound", createdAt: startOfToday + 1 });
	await limits.assertDailySendAllowed(env, "sender", "sender@example.com");
	addMessage("first", "sender", { direction: "outbound", status: "sent", createdAt: startOfToday });
	assert.equal(await limits.countMessagesSentToday(env, "sender", now), 1);
	await limits.assertDailySendAllowed(env, "sender", "sender@example.com");
	addMessage("second", "sender", { direction: "outbound", status: "queued", createdAt: startOfToday + 5 });
	assert.equal(await limits.countMessagesSentToday(env, "sender", now), 2);
	await assert.rejects(
		limits.assertDailySendAllowed(env, "sender", "sender@example.com"),
		(error) => error instanceof limits.DailySendLimitError && error.message === "Daily sending limit reached for sender@example.com",
	);
});

test("a mailbox without a daily limit sends freely", async (t) => {
	const { env, addMailbox, addMessage } = await createFixture(t);
	addMailbox("free", "alice");
	for (let index = 0; index < 5; index += 1) addMessage(`s${index}`, "free", { direction: "outbound", status: "sent" });
	await limits.assertDailySendAllowed(env, "free", "free@example.com");
});

test("mail usage per user counts shared mailboxes for their owner, next to Drive", async (t) => {
	const { env, run, addMailbox, addMessage } = await createFixture(t);
	addMailbox("personal", "alice");
	addMailbox("team", "bob");
	addMessage("a", "personal", { size: 100 });
	addMessage("b", "team", { size: 300 });
	addMessage("c", "team", { size: 50 });
	addMessage("unmeasured", "team");
	run("INSERT INTO drive_items (id, owner_id, kind, name, size, created_at, updated_at) VALUES ('f1', 'alice', 'file', 'a.txt', 7, ?, ?)", seconds(new Date()), seconds(new Date()));
	const usage = await limits.getStorageUsageByUser(env);
	assert.deepEqual(usage.get("alice"), { mailBytes: 100, driveBytes: 7 });
	assert.deepEqual(usage.get("bob"), { mailBytes: 350, driveBytes: 0 });
});

test("the backfill measures only messages without a size, preferring the raw object", async (t) => {
	const { env, get, run, addMailbox, addMessage, heads } = await createFixture(t, { objects: { "raw/one": 4096 } });
	addMailbox("mbx", "alice");
	addMessage("measured", "mbx", { size: 7, rawR2Key: "raw/measured" });
	addMessage("raw", "mbx", { rawR2Key: "raw/one" });
	addMessage("gone", "mbx", { rawR2Key: "raw/missing", text: "hello" });
	addMessage("sent", "mbx", { direction: "outbound", status: "sent", text: "abcd" });
	run("INSERT INTO message_attachments (id, message_id, filename, content_type, size, r2_key, created_at) VALUES ('att', 'sent', 'f.bin', 'application/octet-stream', 300, 'att/1', ?)", seconds(new Date()));

	assert.equal(await limits.backfillMessageSizes(env), 3);
	const size = (id) => get("SELECT size_bytes AS size FROM messages WHERE id = ?", id).size;
	assert.equal(size("measured"), 7, "an existing size is never touched");
	assert.equal(size("raw"), 4096);
	assert.equal(size("gone"), "Hi".length + "hello".length, "a missing raw object falls back to the bodies");
	assert.equal(size("sent"), "Hi".length + "abcd".length + 400, "attachments count at their base64 size");
	assert.deepEqual(heads.sort(), ["raw/missing", "raw/one"]);
	assert.equal(await limits.backfillMessageSizes(env), 0, "a second run finds nothing to do");
});

test("the backfill works through a bounded batch per run", async (t) => {
	const { env, get, addMailbox, addMessage } = await createFixture(t);
	addMailbox("mbx", "alice");
	for (let index = 0; index < 5; index += 1) addMessage(`m${index}`, "mbx");
	assert.equal(await limits.backfillMessageSizes(env, 2), 2);
	assert.equal(get("SELECT count(*) AS n FROM messages WHERE size_bytes IS NULL").n, 3);
	assert.equal(await limits.backfillMessageSizes(env, 10), 3);
	assert.equal(get("SELECT count(*) AS n FROM messages WHERE size_bytes IS NULL").n, 0);
});

test("a failed raw lookup leaves the message for the next run", async (t) => {
	const { env, get, addMailbox, addMessage } = await createFixture(t);
	const originalError = console.error;
	console.error = () => {};
	t.after(() => { console.error = originalError; });
	addMailbox("mbx", "alice");
	addMessage("flaky", "mbx", { rawR2Key: "broken" });
	addMessage("fine", "mbx");
	assert.equal(await limits.backfillMessageSizes(env), 1);
	assert.equal(get("SELECT size_bytes AS size FROM messages WHERE id = 'flaky'").size, null);
});

test("the send API answers 429 when the daily limit is reached", async (t) => {
	const { env, addMailbox, addMessage } = await createFixture(t);
	addMailbox("sender", "alice", null, 1);
	addMessage("only", "sender", { direction: "outbound", status: "sent" });
	const error = await limits.assertDailySendAllowed(env, "sender", "sender@example.com").catch((caught) => caught);
	assert.equal(limits.getSendErrorStatus(error.message), 429);
	assert.equal(limits.getSendErrorStatus("Mailbox not found"), 403);
});
