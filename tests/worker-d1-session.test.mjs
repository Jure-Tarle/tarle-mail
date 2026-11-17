import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-worker-d1-session-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

await build({
	entryPoints: {
		utils: join(root, "worker-utils.ts"),
		context: join(root, "src/lib/d1-session-context.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});

const { runWithD1Session, getD1Session } = await import(pathToFileURL(join(outDir, "context.mjs")).href);
const { D1_SESSION_COOKIE, shouldUseD1Session, d1SessionBookmark, withD1ReadSession, withD1BookmarkCookie } = await import(
	pathToFileURL(join(outDir, "utils.mjs")).href
);

// getDatabaseConfig falls back to process.env; make sure a developer's DATABASE_URL cannot leak in.
const savedEnv = { DATABASE_URL: process.env.DATABASE_URL, DATABASE_DRIVER: process.env.DATABASE_DRIVER };
delete process.env.DATABASE_URL;
delete process.env.DATABASE_DRIVER;
after(() => {
	if (savedEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = savedEnv.DATABASE_URL;
	if (savedEnv.DATABASE_DRIVER === undefined) delete process.env.DATABASE_DRIVER;
	else process.env.DATABASE_DRIVER = savedEnv.DATABASE_DRIVER;
});

/** A minimal D1 binding stand-in recording withSession() calls. */
function fakeD1(bookmark = "bm-1") {
	const session = {
		bookmark,
		prepare() {},
		batch() {},
		getBookmark() {
			return this.bookmark;
		},
	};
	const db = {
		withSessionArgs: [],
		withSession(constraintOrBookmark) {
			this.withSessionArgs.push(constraintOrBookmark);
			return session;
		},
		prepare() {},
	};
	return { db, session };
}

const requestWithCookies = (cookie) => new Request("https://mail.example.com/", { headers: { cookie } });

test("d1SessionBookmark reads the bookmark cookie", () => {
	assert.equal(d1SessionBookmark(requestWithCookies(`a=1; ${D1_SESSION_COOKIE}=bm-abc; b=2`)), "bm-abc");
});

test("d1SessionBookmark decodes encoded bookmark values", () => {
	assert.equal(d1SessionBookmark(requestWithCookies(`${D1_SESSION_COOKIE}=${encodeURIComponent("bm:with/special+chars")}`)), "bm:with/special+chars");
});

test("d1SessionBookmark returns undefined without the cookie", () => {
	assert.equal(d1SessionBookmark(new Request("https://mail.example.com/")), undefined);
	assert.equal(d1SessionBookmark(requestWithCookies("a=1; b=2")), undefined);
	assert.equal(d1SessionBookmark(requestWithCookies(`${D1_SESSION_COOKIE}=`)), undefined);
});

test("withD1ReadSession anchors a session at first-unconstrained without a cookie", () => {
	const { db, session } = fakeD1();
	const env = { DB: db };
	const result = withD1ReadSession(env, new Request("https://mail.example.com/"));
	assert.ok(result);
	assert.deepEqual(db.withSessionArgs, ["first-unconstrained"]);
	assert.equal(result.session, session);
	assert.equal(result.env.DB, session);
	// The original env is untouched: the session is swapped through a proxy.
	assert.equal(env.DB, db);
});

test("withD1ReadSession resumes from the client's bookmark cookie", async () => {
	const { db } = fakeD1();
	const result = withD1ReadSession({ DB: db }, requestWithCookies(`${D1_SESSION_COOKIE}=bm-prev`));
	assert.deepEqual(db.withSessionArgs, ["bm-prev"]);
	assert.equal(result.env.DB, result.session);
	assert.equal(result.session.getBookmark(), "bm-1");
});

/** A D1 binding whose sessions run statements through `execute(constraint, sql, values)`. */
function scriptedD1(execute) {
	const db = {
		withSessionArgs: [],
		withSession(constraint) {
			this.withSessionArgs.push(constraint);
			const statement = (sql, values = []) => ({
				bind: (...next) => statement(sql, next),
				all: async () => execute(constraint, sql, values),
				first: async () => execute(constraint, sql, values),
				run: async () => execute(constraint, sql, values),
				raw: async () => execute(constraint, sql, values),
				sql,
				values,
			});
			return {
				prepare: (sql) => statement(sql),
				batch: async (statements) => Promise.all(statements.map((item) => execute(constraint, item.sql, item.values))),
				getBookmark: () => `after-${constraint}`,
			};
		},
	};
	return db;
}

const invalidBookmark = () => new Error("D1_ERROR: invalid commitToken bookmark provided: 00000077-00000000");

test("a bookmark from another database falls back to a fresh session and retries once", async () => {
	const db = scriptedD1((constraint, sql, values) => {
		if (constraint === "stale-bm") throw invalidBookmark();
		return { results: [{ sql, values }] };
	});
	const request = requestWithCookies(`${D1_SESSION_COOKIE}=stale-bm`);
	const { session } = withD1ReadSession({ DB: db }, request);
	const result = await session.prepare("select 1 where id = ?").bind(7).all();
	assert.deepEqual(result.results, [{ sql: "select 1 where id = ?", values: [7] }]);
	assert.deepEqual(db.withSessionArgs, ["stale-bm", "first-unconstrained"]);
	const batch = await session.batch([session.prepare("select 2").bind(1)]);
	assert.deepEqual(batch, [{ results: [{ sql: "select 2", values: [1] }] }]);
	const response = withD1BookmarkCookie(request, new Response("ok"), session);
	assert.match(response.headers.get("Set-Cookie"), new RegExp(`^${D1_SESSION_COOKIE}=after-first-unconstrained;`));
});

test("other database errors are not swallowed and keep the bookmark", async () => {
	const db = scriptedD1(() => {
		throw new Error("D1_ERROR: no such table: users");
	});
	const request = requestWithCookies(`${D1_SESSION_COOKIE}=bm-ok`);
	const { session } = withD1ReadSession({ DB: db }, request);
	await assert.rejects(session.prepare("select 1").all(), /no such table/);
	assert.deepEqual(db.withSessionArgs, ["bm-ok"]);
	const original = new Response("ok");
	assert.equal(withD1BookmarkCookie(request, original, session), original);
});

test("an invalid bookmark is retried only once", async () => {
	const db = scriptedD1(() => {
		throw invalidBookmark();
	});
	const { session } = withD1ReadSession({ DB: db }, requestWithCookies(`${D1_SESSION_COOKIE}=stale-bm`));
	await assert.rejects(session.prepare("select 1").all(), /invalid commitToken bookmark/);
	assert.deepEqual(db.withSessionArgs, ["stale-bm", "first-unconstrained"]);
});

test("withD1ReadSession skips non-D1 database configs", () => {
	const { db } = fakeD1();
	const result = withD1ReadSession(
		{ DB: db, DATABASE_URL: "postgres://user:pass@localhost/db" },
		new Request("https://mail.example.com/"),
	);
	assert.equal(result, null);
	assert.deepEqual(db.withSessionArgs, []);
});

test("withD1ReadSession skips bindings without withSession", () => {
	assert.equal(withD1ReadSession({ DB: { prepare() {} } }, new Request("https://mail.example.com/")), null);
	assert.equal(withD1ReadSession({}, new Request("https://mail.example.com/")), null);
});

test("withD1BookmarkCookie sets the newest bookmark on the response", () => {
	const { session } = fakeD1("bm-new");
	const response = withD1BookmarkCookie(req(), new Response("body", { status: 200 }), session);
	const setCookie = response.headers.get("set-cookie");
	assert.ok(setCookie);
	assert.match(setCookie, new RegExp(`^${D1_SESSION_COOKIE}=bm-new`));
	assert.match(setCookie, /HttpOnly/);
	assert.match(setCookie, /SameSite=Lax/);
	assert.match(setCookie, /Path=\//);
});

test("withD1BookmarkCookie encodes the bookmark value", () => {
	const { session } = fakeD1("bm:with/special");
	const response = withD1BookmarkCookie(req(), new Response("body"), session);
	assert.match(response.headers.get("set-cookie"), new RegExp(`${D1_SESSION_COOKIE}=${encodeURIComponent("bm:with/special")}`));
});

test("withD1BookmarkCookie returns the response untouched when there is no bookmark", () => {
	const { session } = fakeD1(null);
	const original = new Response("body");
	assert.equal(withD1BookmarkCookie(req(), original, session), original);
	assert.equal(withD1BookmarkCookie(req(), original, null), original);
	// Stand-in env.DB implementations may lack getBookmark entirely.
	assert.equal(withD1BookmarkCookie(req(), original, { prepare() {} }), original);
	assert.equal(original.headers.get("set-cookie"), null);
});

const req = (method = "GET", cookie) =>
	new Request("https://app.test/x", {
		method,
		headers: cookie ? { cookie: `${D1_SESSION_COOKIE}=${encodeURIComponent(cookie)}` } : {},
	});

test("DB_PRIMARY stays the raw binding while DB is the session", () => {
	const session = { getBookmark: () => "bm1" };
	const db = { withSession: () => session };
	const env = { DB: db };
	const result = withD1ReadSession(env, req());
	assert.equal(result.env.DB, session);
	assert.equal(result.env.DB_PRIMARY, db);
});

test("read-only responses cannot regress an existing bookmark cookie", () => {
	const session = { getBookmark: () => "older-bookmark" };
	const original = new Response("body");
	const response = withD1BookmarkCookie(req("GET", "newer-bookmark"), original, session);
	assert.equal(response, original);
});

test("mutation responses still store the newest bookmark", () => {
	const session = { getBookmark: () => "post-write-bm" };
	const response = withD1BookmarkCookie(req("POST", "old-bm"), new Response("body"), session);
	assert.match(response.headers.get("set-cookie"), /mf-d1-bm=post-write-bm/);
});

test("the cookie-less first visit stores the bookmark", () => {
	const session = { getBookmark: () => "first-bm" };
	const response = withD1BookmarkCookie(req("GET"), new Response("body"), session);
	assert.match(response.headers.get("set-cookie"), /mf-d1-bm=first-bm/);
});

test("a mutation without a bookmark starts the session on the primary", () => {
	const { db } = fakeD1();
	withD1ReadSession({ DB: db }, new Request("https://mail.example.com/api/send", { method: "POST" }));
	assert.deepEqual(db.withSessionArgs, ["first-primary"]);
});

test("sign-in, setup and public write endpoints never use a replica session", () => {
	for (const path of ["/api/auth/login", "/api/auth/password-reset", "/api/setup/prepare", "/api/inbound/resend", "/api/i/abc.gif"]) {
		assert.equal(shouldUseD1Session(new Request(`https://mail.example.com${path}`)), false, path);
		const { db } = fakeD1();
		assert.equal(withD1ReadSession({ DB: db }, new Request(`https://mail.example.com${path}`)), null);
		assert.deepEqual(db.withSessionArgs, []);
	}
	assert.equal(shouldUseD1Session(new Request("https://mail.example.com/api/messages")), true);
});

test("the request's session is visible to getEnv() through async context", async () => {
	const session = { getBookmark: () => "bm" };
	assert.equal(getD1Session(), undefined);
	const seen = await runWithD1Session(session, async () => {
		await Promise.resolve();
		return getD1Session();
	});
	assert.equal(seen, session);
	assert.equal(getD1Session(), undefined);
	assert.equal(runWithD1Session(null, () => getD1Session()), undefined);
});
