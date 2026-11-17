import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The runtime Cloudflare token is documented as CLOUDFLARE_TOKEN; CF_TOKEN (upstream's name) must keep
 * working. The setup check once read CF_TOKEN directly and reported a configured token as missing.
 */
const directory = mkdtempSync(join(root, "node_modules", "tarle-mail-token-name-"));
after(() => rmSync(directory, { recursive: true, force: true }));

await build({
	stdin: {
		contents: `
			export { getSetupRequirementChecks } from "./src/lib/setup/configuration.ts";
			export { getCloudflareAuth } from "./src/lib/cloudflare-api-utils.ts";
			export { getCloudflareToken, hasCloudflareCredentials } from "./src/lib/runtime.ts";
		`,
		resolveDir: root,
		sourcefile: "token-name-entry.ts",
	},
	outfile: join(directory, "entry.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	tsconfig: join(root, "tsconfig.json"),
	packages: "external",
	alias: { "next/headers": "next/headers.js", "next/server": "next/server.js", "cloudflare:workers": "./server/runtime/cloudflare-workers.ts" },
	logLevel: "silent",
});

const { getSetupRequirementChecks, getCloudflareAuth, getCloudflareToken, hasCloudflareCredentials } = await import(pathToFileURL(join(directory, "entry.mjs")).href);

const credentialsCheck = (env) => getSetupRequirementChecks({ DB: {}, ...env }).find((check) => check.key === "Cloudflare API credentials");

test("setup accepts CLOUDFLARE_TOKEN and still accepts CF_TOKEN", () => {
	assert.equal(credentialsCheck({ CLOUDFLARE_TOKEN: "new-name" }).configured, true);
	assert.equal(credentialsCheck({ CF_TOKEN: "old-name" }).configured, true);
	assert.equal(credentialsCheck({}).configured, false);
	assert.match(credentialsCheck({}).message, /CLOUDFLARE_TOKEN/);
});

test("CLOUDFLARE_TOKEN wins over CF_TOKEN everywhere the token is read", () => {
	assert.equal(getCloudflareToken({ CLOUDFLARE_TOKEN: " new ", CF_TOKEN: "old" }), "new");
	assert.equal(getCloudflareToken({ CF_TOKEN: "old" }), "old");
	assert.equal(getCloudflareToken({ CLOUDFLARE_TOKEN: "  " }), undefined);
	assert.equal(hasCloudflareCredentials({ CLOUDFLARE_TOKEN: "new" }), true);
	assert.deepEqual(getCloudflareAuth({ CLOUDFLARE_TOKEN: "new" }), { kind: "token", token: "new" });
});
