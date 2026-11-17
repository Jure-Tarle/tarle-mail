import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "tarle-mail-command-palette-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	stdin: {
		contents: `
			export { commandCategoryKey, filterCommands, flattenGroups, groupCommandsByCategory } from "./src/components/shortcuts/command-palette-utils.ts";
			export { adminPaletteLinks, buildPaletteEntries, isMailFolderPath, nextTheme } from "./src/components/command-palette/palette-entries-utils.ts";
		`,
		resolveDir: root,
		sourcefile: "command-palette-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	logLevel: "silent",
});
const { adminPaletteLinks, buildPaletteEntries, commandCategoryKey, filterCommands, flattenGroups, groupCommandsByCategory, isMailFolderPath, nextTheme } = await import(
	pathToFileURL(join(directory, "entry.mjs")).href
);

const en = JSON.parse(readFileSync(join(root, "src/lib/i18n/en.json"), "utf8"));
// Fails on a key the catalog lacks, so an entry can not ship with a missing label.
const t = (key, vars = {}) => {
	assert.ok(key in en, `${key} is in en.json`);
	return en[key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
};

const cmd = (id, title, extra = {}) => ({ id, title, category: "Navigation", perform: () => {}, ...extra });

test("an empty query keeps every command in order", () => {
	const commands = [cmd("b", "Beta"), cmd("a", "Alpha")];
	assert.deepEqual(filterCommands(commands, "  "), commands);
});

test("matches rank exact, prefix, word start, then substring", () => {
	const commands = [
		cmd("sub", "Decompose"),
		cmd("word", "Go to compose"),
		cmd("prefix", "Composer settings"),
		cmd("exact", "Compose"),
	];
	assert.deepEqual(filterCommands(commands, "compose").map((c) => c.id), ["exact", "prefix", "word", "sub"]);
});

test("letters in order still match when the query is not a substring", () => {
	assert.deepEqual(filterCommands([cmd("a", "Compose")], "cmp").map((c) => c.id), ["a"]);
	assert.deepEqual(filterCommands([cmd("a", "Compose")], "cpm"), []);
});

test("a title match outranks the same match in subtitle, keywords or category", () => {
	const commands = [
		cmd("keyword", "Open", { keywords: ["mailbox"] }),
		cmd("subtitle", "Open", { subtitle: "mailbox" }),
		cmd("category", "Open", { category: "Mailbox" }),
		cmd("title", "Mailbox"),
	];
	assert.deepEqual(filterCommands(commands, "mailbox").map((c) => c.id)[0], "title");
	assert.equal(filterCommands(commands, "mailbox").length, 4);
});

test("every word of the query has to match, in any order", () => {
	const commands = [cmd("a", "Go to Inbox"), cmd("b", "Go to Trash"), cmd("c", "Inbox rules")];
	assert.deepEqual(filterCommands(commands, "inbox go").map((c) => c.id), ["a"]);
	assert.deepEqual(filterCommands(commands, "inbox xyz"), []);
});

test("matching ignores case and accents, and drops letters scattered across a long text", () => {
	assert.deepEqual(filterCommands([cmd("a", "Postfächer")], "POSTFACHER").map((c) => c.id), ["a"]);
	assert.deepEqual(filterCommands([cmd("a", "Go to Starred")], "se"), []);
	assert.deepEqual(filterCommands([cmd("a", "Go to Starred")], "str").map((c) => c.id), ["a"]);
});

test("equal scores keep their original order", () => {
	const commands = [cmd("one", "Folder one"), cmd("two", "Folder two")];
	assert.deepEqual(filterCommands(commands, "folder").map((c) => c.id), ["one", "two"]);
});

test("the listed order is the grouped order, even when ranking interleaves categories", () => {
	const matches = [cmd("n1", "Inbox"), cmd("s1", "Inbox settings", { category: "Settings" }), cmd("n2", "Inbox rules")];
	const grouped = groupCommandsByCategory(matches);
	assert.deepEqual(Object.keys(grouped), ["Navigation", "Settings"]);
	assert.deepEqual(flattenGroups(grouped).map((c) => c.id), ["n1", "n2", "s1"]);
});

test("category headings use existing labels", () => {
	assert.equal(commandCategoryKey("Navigation"), "shortcut.category.Navigation");
	for (const category of ["Navigation", "Actions", "Settings", "Mailboxes", "General", "Admin", "Search"]) {
		assert.ok(commandCategoryKey(category) in en, category);
	}
});

const baseUser = {
	role: "user",
	isPrimaryAdmin: false,
	canManageDomains: false,
	canManageUsers: false,
	canManageMailboxes: false,
	calendarEnabled: false,
	driveEnabled: false,
};
const mailboxes = [
	{ id: "m1", localPart: "me", hostname: "example.com", displayName: "Me" },
	{ id: "m2", localPart: "support", hostname: "example.com", displayName: null },
];
const build_ = (overrides = {}) =>
	buildPaletteEntries({ t, user: baseUser, mailboxes, selectedMailboxId: "m1", folders: [], themeTarget: "dark", ...overrides });
const ids = (entries, prefix) => entries.filter((entry) => entry.id.startsWith(prefix)).map((entry) => entry.id);
const hrefs = (entries, category) => entries.filter((entry) => entry.category === category).map((entry) => entry.action.href);

test("every user gets compose, the system folders, settings, theme and shortcut help", () => {
	const entries = build_();
	assert.deepEqual(
		hrefs(entries, "Navigation"),
		["/inbox", "/starred", "/snoozed", "/sent", "/drafts", "/archived", "/spam", "/trash"],
	);
	assert.ok(entries.some((entry) => entry.action.type === "compose"));
	assert.ok(entries.some((entry) => entry.action.type === "theme"));
	assert.ok(entries.some((entry) => entry.action.type === "help"));
	assert.deepEqual(hrefs(entries, "Settings"), [
		"/settings/account",
		"/settings/inbox",
		"/settings/security",
		"/settings/api-keys",
		"/settings/app-passwords",
		"/settings/rules",
		"/settings/import",
		"/settings/export",
	]);
	assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length, "entry ids are unique");
});

test("calendar, booking and drive follow the account's feature flags", () => {
	assert.deepEqual(ids(build_(), "nav-c"), []);
	assert.deepEqual(ids(build_({ user: { ...baseUser, calendarEnabled: true } }), "nav-"), [
		"nav-inbox", "nav-starred", "nav-snoozed", "nav-sent", "nav-drafts", "nav-archived", "nav-spam", "nav-trash", "nav-calendar", "nav-booking",
	]);
	assert.deepEqual(hrefs(build_({ user: { ...baseUser, driveEnabled: true } }), "Navigation").slice(-1), ["/drive"]);
});

test("mailbox settings need mailbox access", () => {
	assert.ok(!hrefs(build_(), "Settings").includes("/settings/mailboxes"));
	assert.ok(!hrefs(build_({ user: null }), "Settings").includes("/settings/mailboxes"));
	assert.ok(hrefs(build_({ user: { ...baseUser, canManageMailboxes: true } }), "Settings").includes("/settings/mailboxes"));
});

test("other mailboxes can be switched to, the selected one is left out", () => {
	const entries = build_();
	assert.deepEqual(ids(entries, "mailbox-"), ["mailbox-m2"]);
	assert.deepEqual(entries.find((entry) => entry.id === "mailbox-m2").action, { type: "mailbox", mailboxId: "m2" });
	assert.equal(entries.find((entry) => entry.id === "mailbox-m2").title, "support@example.com");
	assert.deepEqual(ids(build_({ selectedMailboxId: null }), "mailbox-"), ["mailbox-m1", "mailbox-m2"]);
});

test("custom folders are listed after the system folders", () => {
	const entries = build_({ folders: [{ id: "f1", name: "Receipts" }] });
	const folder = entries.find((entry) => entry.id === "folder-f1");
	assert.equal(folder.title, "Receipts");
	assert.deepEqual(folder.action, { type: "navigate", href: "/folders/f1" });
	assert.ok(entries.indexOf(folder) > entries.findIndex((entry) => entry.id === "nav-trash"));
});

test("admin pages are for admins and follow the admin nav permissions", () => {
	const adminHrefs = (user) => hrefs(build_({ user }), "Admin");
	assert.deepEqual(adminHrefs(null), []);
	assert.deepEqual(adminHrefs(baseUser), []);
	// A non-admin never sees them, whatever the permission flags say.
	assert.deepEqual(adminHrefs({ ...baseUser, isPrimaryAdmin: true, canManageDomains: true, canManageUsers: true }), []);

	const admin = { ...baseUser, role: "admin" };
	assert.deepEqual(adminHrefs(admin), ["/admin", "/mailboxes", "/accounts"]);
	assert.deepEqual(adminHrefs({ ...admin, canManageDomains: true }), ["/admin", "/mailboxes", "/domains", "/routing", "/accounts"]);
	assert.deepEqual(adminHrefs({ ...admin, isPrimaryAdmin: true }), adminPaletteLinks.map((link) => link.href));
});

test("the admin links match src/components/admin-nav.tsx", () => {
	const source = readFileSync(join(root, "src/components/admin-nav.tsx"), "utf8");
	const fromNav = [...source.matchAll(/\{ href: "([^"]+)", labelKey: "([^"]+)", icon: \w+(?:, permission: "(\w+)")?(?:, searchKeys: \[[^\]]*\])? \}/g)].map(
		([, href, labelKey, permission]) => ({ href, labelKey, permission }),
	);
	assert.ok(fromNav.length > 0);
	const key = (link) => `${link.href} ${link.labelKey} ${link.permission ?? ""}`;
	assert.deepEqual(adminPaletteLinks.map(key).sort(), fromNav.map(key).sort());
});

test("the theme entry names the theme it switches to", () => {
	const subtitle = (themeTarget) => build_({ themeTarget }).find((entry) => entry.id === "toggle-theme").subtitle;
	assert.equal(subtitle("dark"), en["settings.theme.dark"]);
	assert.equal(subtitle("light"), en["settings.theme.light"]);
	assert.equal(nextTheme("light"), "dark");
	assert.equal(nextTheme("dark"), "light");
});

test("entries are found by their path and translated labels", () => {
	const entries = build_({ user: { ...baseUser, role: "admin", isPrimaryAdmin: true } }).map((entry) => ({ ...entry, perform: () => {} }));
	assert.equal(filterCommands(entries, "spam filter")[0].id, "admin-/spam-filter");
	assert.equal(filterCommands(entries, "dark mode")[0].id, "toggle-theme");
	assert.equal(filterCommands(entries, "security")[0].id, "settings-/settings/security");
});

test("search is handled on mail list pages only", () => {
	for (const path of ["/inbox", "/inbox/abc", "/starred", "/folders/f1", "/trash"]) assert.equal(isMailFolderPath(path), true, path);
	for (const path of ["/settings/inbox", "/inboxes", "/contacts", "/calendar", "/compose", "/"]) assert.equal(isMailFolderPath(path), false, path);
});
