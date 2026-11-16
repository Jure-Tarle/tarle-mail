/**
 * Paths that must stay reachable without a Cloudflare Access login, because the caller is an external
 * service, a non-browser client or a visitor who has no Access session. Everything else sits behind Access.
 *
 * Each of these has its own authentication (signature, token in the URL, API key, or none by design).
 * A rule is exact (`/sw.js`) or a prefix on a path-segment boundary: `/book` matches `/book` and
 * `/book/x/y`, never `/bookx`. `scripts/setup-access.mjs` carries a copy of this data to create the matching
 * Access bypass applications, and `tests/access-bypass.test.mjs` fails when the two differ.
 */
export type AccessBypassRule = { match: "exact" | "prefix"; path: string };

export type AccessBypassGroup = {
	/** Stable id, used as the Access application name suffix. */
	id: string;
	reason: string;
	rules: AccessBypassRule[];
};

const prefix = (path: string): AccessBypassRule => ({ match: "prefix", path });
const exact = (path: string): AccessBypassRule => ({ match: "exact", path });

export const ACCESS_BYPASS_GROUPS: AccessBypassGroup[] = [
	{
		id: "inbound-webhooks",
		reason: "Mail providers POST received mail here: the relay (HMAC), Resend (Svix signature) and SES (SNS certificate plus URL secret).",
		rules: [prefix("/api/inbound")],
	},
	{
		id: "public-booking",
		reason: "Guests book meetings without an account. /c/<username> is the vanity alias of /book/<userId>; the page reads /api/public/booking.",
		rules: [prefix("/book"), prefix("/c"), prefix("/api/public/booking")],
	},
	{
		id: "public-links",
		reason: "Shared Drive links (/d/<token> and its API) and shared attachment links in sent mail; the unguessable token is the credential.",
		rules: [prefix("/d"), prefix("/api/drive/public"), prefix("/api/shared-files")],
	},
	{
		id: "bimi-logos",
		reason: "BIMI sender logos (/bimi/<hostname>.svg) named in the default._bimi TXT record, fetched by receiving mail providers.",
		rules: [prefix("/bimi")],
	},
	{
		id: "read-receipts",
		reason: "Tracking pixel (/api/i/<token>.gif) fetched by the recipient's mail client.",
		rules: [prefix("/api/i")],
	},
	{
		id: "calendar-feed",
		reason: "iCalendar subscription polled by Google, Outlook or Apple Calendar with a calendar:read-only API key in the query string.",
		rules: [exact("/api/calendar/feed")],
	},
	{
		id: "api-clients",
		reason: "API-key clients that cannot do an Access login: REST API v1, calendar API, MCP, JMAP (+ autodiscovery), the mobile app (APNs registration, avatars) and its password sign-in that issues a device key.",
		rules: [prefix("/api/v1"), prefix("/api/calendar/events"), prefix("/mcp"), prefix("/jmap"), exact("/.well-known/jmap"), prefix("/api/mobile"), exact("/api/auth/device")],
	},
	{
		id: "pwa-assets",
		reason: "Static assets and the install manifest, fetched without credentials by browsers and the OS, and needed by the public pages above: build output, icons, service worker, translations, branding icon.",
		rules: [
			prefix("/_next/static"),
			prefix("/locales"),
			exact("/manifest.webmanifest"),
			exact("/sw.js"),
			exact("/favicon.ico"),
			exact("/icon-48.png"),
			exact("/icon-96.png"),
			exact("/icon-192.png"),
			exact("/icon-512.png"),
			exact("/api/branding/icon"),
		],
	},
];

export const ACCESS_BYPASS_RULES: AccessBypassRule[] = ACCESS_BYPASS_GROUPS.flatMap((group) => group.rules);

function ruleMatches(rule: AccessBypassRule, path: string): boolean {
	if (path === rule.path) return true;
	return rule.match === "prefix" && path.startsWith(`${rule.path}/`);
}

/**
 * True when the request path is one of the externally called paths that skip the Access check. The raw
 * (still percent-encoded) pathname is compared on purpose: an encoded variant just fails closed to the JWT check.
 */
export function isAccessBypassPath(pathname: string): boolean {
	return ACCESS_BYPASS_RULES.some((rule) => ruleMatches(rule, pathname));
}
