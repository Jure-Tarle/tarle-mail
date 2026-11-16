#!/usr/bin/env node
// Creates or updates (idempotently) the Cloudflare Access applications that put a login in front of the app:
//   - one self-hosted application for the whole domain, with an Allow policy for one email (24 h session);
//   - one application per bypass group, with a Bypass (everyone) policy, for the paths that external services
//     and non-browser clients call (webhooks, public booking and share links, API-key clients, static assets).
// Usage: CF_ACCOUNT_ID=... CF_ACCESS_API_TOKEN=... node scripts/setup-access.mjs --domain mail.tarle.de --email you@example.com [--dry-run]
// The token needs "Access: Apps and Policies Edit". Reading the team domain also needs an Access organization read
// permission; without it the script still prints the AUD. The token is only sent to api.cloudflare.com and never printed.
import { pathToFileURL } from "node:url";

const API = "https://api.cloudflare.com/client/v4";
const SESSION_DURATION = "24h";

// Keep in sync with src/lib/security/access-bypass.ts; tests/access-bypass.test.mjs fails when they differ.
export const BYPASS_GROUPS = [
	{ id: "inbound-webhooks", rules: [{ match: "prefix", path: "/api/inbound" }] },
	{ id: "public-booking", rules: [{ match: "prefix", path: "/book" }, { match: "prefix", path: "/c" }, { match: "prefix", path: "/api/public/booking" }] },
	{ id: "public-links", rules: [{ match: "prefix", path: "/d" }, { match: "prefix", path: "/api/drive/public" }, { match: "prefix", path: "/api/shared-files" }] },
	{ id: "bimi-logos", rules: [{ match: "prefix", path: "/bimi" }] },
	{ id: "read-receipts", rules: [{ match: "prefix", path: "/api/i" }] },
	{ id: "calendar-feed", rules: [{ match: "exact", path: "/api/calendar/feed" }] },
	{
		id: "api-clients",
		rules: [
			{ match: "prefix", path: "/api/v1" },
			{ match: "prefix", path: "/api/calendar/events" },
			{ match: "prefix", path: "/mcp" },
			{ match: "prefix", path: "/jmap" },
			{ match: "exact", path: "/.well-known/jmap" },
			{ match: "prefix", path: "/api/mobile" },
			{ match: "exact", path: "/api/auth/device" },
		],
	},
	{
		id: "pwa-assets",
		rules: [
			{ match: "prefix", path: "/_next/static" },
			{ match: "prefix", path: "/locales" },
			{ match: "exact", path: "/manifest.webmanifest" },
			{ match: "exact", path: "/sw.js" },
			{ match: "exact", path: "/favicon.ico" },
			{ match: "exact", path: "/icon-48.png" },
			{ match: "exact", path: "/icon-96.png" },
			{ match: "exact", path: "/icon-192.png" },
			{ match: "exact", path: "/icon-512.png" },
			{ match: "exact", path: "/api/branding/icon" },
		],
	},
];

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Access matches a destination as host + path; a prefix rule needs the bare path and the `/*` form. */
export function destinationsFor(domain, rules) {
	return rules.flatMap((rule) => (rule.match === "prefix" ? [`${domain}${rule.path}`, `${domain}${rule.path}/*`] : [`${domain}${rule.path}`]));
}

function application(name, domain, destinations, policy) {
	return {
		name,
		type: "self_hosted",
		domain,
		destinations: destinations.map((uri) => ({ type: "public", uri })),
		session_duration: SESSION_DURATION,
		app_launcher_visible: false,
		policies: [policy],
	};
}

/** The applications this script manages, in creation order: the main one first, then one per bypass group. */
export function buildPlan({ domain, email }) {
	const main = application(`${domain} (login)`, domain, [domain], { name: "Owner", decision: "allow", include: [{ email: { email } }] });
	const bypass = BYPASS_GROUPS.map((group) => {
		const destinations = destinationsFor(domain, group.rules);
		return application(`${domain} (bypass: ${group.id})`, destinations[0], destinations, { name: "Bypass everyone", decision: "bypass", include: [{ everyone: {} }] });
	});
	return [main, ...bypass];
}

export function parseArgs(argv) {
	const args = { dryRun: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const [flag, inline] = argv[i].split(/=(.*)/s);
		if (flag === "--dry-run") args.dryRun = true;
		else if (flag === "--help" || flag === "-h") args.help = true;
		else if (flag === "--domain" || flag === "--email") args[flag.slice(2)] = inline ?? argv[++i];
		else throw new Error(`Unknown argument: ${flag}`);
	}
	return args;
}

class ApiError extends Error {}

async function call(token, method, path, body) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await response.json().catch(() => null);
	if (!response.ok || !json?.success) {
		const detail = (json?.errors ?? []).map((error) => `${error.code}: ${error.message}`).join("; ") || "no error detail";
		throw new ApiError(`${method} ${path} failed (HTTP ${response.status}): ${detail}`);
	}
	return json;
}

async function listApps(token, accountId) {
	const apps = [];
	for (let page = 1; ; page++) {
		const json = await call(token, "GET", `/accounts/${accountId}/access/apps?per_page=100&page=${page}`);
		apps.push(...json.result);
		if (page >= (json.result_info?.total_pages ?? 1)) return apps;
	}
}

/** Reuses the ids of policies that already exist by name, so a re-run updates them instead of adding copies. */
function withExistingPolicyIds(payload, existing) {
	return { ...payload, policies: payload.policies.map((policy) => ({ ...policy, id: existing.policies?.find((candidate) => candidate.name === policy.name)?.id })) };
}

function printDryRun(accountId, plan) {
	console.log("Dry run: no API calls are made. The script would call, in order:");
	console.log(`GET /accounts/${accountId}/access/organizations   (team domain)`);
	console.log(`GET /accounts/${accountId}/access/apps            (find existing applications by name)`);
	for (const payload of plan) {
		console.log(`\n# ${payload.name}`);
		console.log(`POST /accounts/${accountId}/access/apps   (PUT /accounts/${accountId}/access/apps/<id> when the name already exists)`);
		console.log(`  body ${JSON.stringify(payload)}`);
	}
}

async function run(args) {
	if (!args.domain || !HOSTNAME.test(args.domain.toLowerCase())) throw new Error("--domain must be a hostname such as mail.tarle.de");
	if (!args.email || !EMAIL.test(args.email)) throw new Error("--email must be the email address that may sign in");
	const domain = args.domain.toLowerCase();
	const plan = buildPlan({ domain, email: args.email });
	const accountId = process.env.CF_ACCOUNT_ID?.trim();
	const token = process.env.CF_ACCESS_API_TOKEN?.trim();
	if (args.dryRun) return printDryRun(accountId || "<CF_ACCOUNT_ID>", plan);
	if (!accountId || !token) throw new Error("Set CF_ACCOUNT_ID and CF_ACCESS_API_TOKEN (permission: Access: Apps and Policies Edit)");

	const existing = await listApps(token, accountId);
	let mainAud = "";
	for (const payload of plan) {
		const current = existing.find((app) => app.name === payload.name);
		const result = current
			? await call(token, "PUT", `/accounts/${accountId}/access/apps/${current.id}`, withExistingPolicyIds(payload, current))
			: await call(token, "POST", `/accounts/${accountId}/access/apps`, payload);
		console.log(`${current ? "Updated" : "Created"}: ${payload.name}`);
		if (payload === plan[0]) mainAud = result.result.aud;
	}

	let teamDomain = "<your team>.cloudflareaccess.com";
	try {
		teamDomain = (await call(token, "GET", `/accounts/${accountId}/access/organizations`)).result.auth_domain;
	} catch {
		console.log("Could not read the team domain (the token lacks Access organization read); find it under Zero Trust > Settings.");
	}
	console.log("\nSet these on the Worker (dashboard variables, or `wrangler secret put`), then redeploy:");
	console.log(`  CF_ACCESS_TEAM_DOMAIN=${teamDomain}`);
	console.log(`  CF_ACCESS_AUD=${mainAud}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const args = parseArgs(process.argv.slice(2));
		if (args.help) {
			console.log("Usage: CF_ACCOUNT_ID=... CF_ACCESS_API_TOKEN=... node scripts/setup-access.mjs --domain mail.tarle.de --email you@example.com [--dry-run]");
		} else {
			await run(args);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
