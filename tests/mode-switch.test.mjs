import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(root, "node_modules", "tarle-mail-mode-switch-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	entryPoints: [join(root, "src/components/mode-switch-utils.ts")],
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	format: "esm",
	platform: "node",
	logLevel: "silent",
});
const { adminRoutePrefixes, defaultModePaths, getActiveMode, isAdminRoute, modeStorageKey, resolveModeHref } = await import(pathToFileURL(join(directory, "entry.mjs")).href);

test("every route directory of the admin layout group is an admin route", () => {
	const directories = readdirSync(join(root, "src/app/(admin)"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `/${entry.name}`);
	assert.deepEqual([...adminRoutePrefixes].sort(), directories.sort());
});

test("admin routes and their children are admin mode", () => {
	for (const path of ["/admin", "/mailboxes", "/mailboxes/abc", "/domains/example.com", "/usage", "/spam-filter", "/accounts/123"]) {
		assert.equal(getActiveMode(path), "admin", path);
	}
});

test("everything else is mail mode", () => {
	for (const path of ["/inbox", "/inbox/thread-1", "/settings/account", "/calendar", "/drive", "/contacts", "/administrator", "/usage-report", "/"]) {
		assert.equal(getActiveMode(path), "mail", path);
		assert.equal(isAdminRoute(path), false, path);
	}
});

test("a remembered path is used only for its own mode", () => {
	assert.equal(resolveModeHref("admin", "/domains/example.com"), "/domains/example.com");
	assert.equal(resolveModeHref("mail", "/settings/account"), "/settings/account");
	assert.equal(resolveModeHref("admin", "/inbox"), defaultModePaths.admin);
	assert.equal(resolveModeHref("mail", "/mailboxes"), defaultModePaths.mail);
});

test("missing or unsafe remembered paths fall back to the default", () => {
	for (const value of [null, undefined, "", "inbox", "//evil.example/inbox", "https://evil.example/inbox", "/\\evil.example"]) {
		assert.equal(resolveModeHref("mail", value), "/inbox", String(value));
	}
	assert.equal(resolveModeHref("admin", null), "/admin");
});

test("each mode has its own storage key", () => {
	assert.notEqual(modeStorageKey("mail"), modeStorageKey("admin"));
});
