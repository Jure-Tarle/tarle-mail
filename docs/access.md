# Cloudflare Access in front of the app

Cloudflare Access puts a Cloudflare login (for example a one-time PIN sent to your email) in front of `https://mail.tarle.de`, before the app's own login page. The Worker also checks the Access token itself, so a mistake in the Access configuration does not leave the app open.

**Set up Access before you open `/setup`.** The first-run page creates the admin account for whoever reaches it first.

## 1. Enable Zero Trust and choose a team name

1. In the Cloudflare dashboard open **Zero Trust**. The Free plan (up to 50 users) is enough.
2. Choose a team name when asked. It becomes `<team>.cloudflareaccess.com`, the value of `CF_ACCESS_TEAM_DOMAIN`.
3. Under **Settings > Authentication > Login methods**, add **One-time PIN**. Access then emails a code to the address you sign in with.

## 2. Create the applications

The domain needs one Access application with an Allow policy for you, plus a few Bypass applications for the paths that external services and non-browser clients call (list below). The script creates all of them and can be re-run safely.

1. Create an API token (My Profile > API Tokens > Create Custom Token) with the permission **Account > Access: Apps and Policies > Edit**. Adding **Access: Organizations, Identity Providers, and Groups > Read** lets the script print the team domain too.
2. Run it (Node 18+, no dependencies):

```sh
export CF_ACCOUNT_ID=<account id>
export CF_ACCESS_API_TOKEN=<token>
node scripts/setup-access.mjs --domain mail.tarle.de --email you@example.com --dry-run   # show the planned calls
node scripts/setup-access.mjs --domain mail.tarle.de --email you@example.com
```

It creates or updates `mail.tarle.de (login)` (Allow your email, 24 h session) and one `mail.tarle.de (bypass: <group>)` application per group, then prints the two Worker variables. The token is never printed.

To do it by hand: create a **Self-hosted** application for `mail.tarle.de` with an Allow policy including your email and session duration 24 hours. Then create one self-hosted application per group below, with every path as a destination (for a prefix, both `mail.tarle.de/book` and `mail.tarle.de/book/*`) and a single policy with action **Bypass**, include **Everyone**. Access applies the most specific path, so these win over the domain-wide application.

## 3. Set the Worker variables

Copy the team domain and the **Application Audience (AUD) tag** of the `mail.tarle.de (login)` application (Zero Trust > Access > Applications > Edit > Overview) into the Worker `mail-tarle`: dashboard **Settings > Variables and Secrets**, or `npx wrangler secret put CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`. `wrangler.jsonc` has `keep_vars`, so dashboard values survive deploys.

| Variable | Example |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | the 64-character AUD tag |

Then deploy (`npm run deploy`). With both variables set, the Worker answers `403` (HTML for pages, JSON for `/api/`) to any request outside the bypass list that lacks a valid `Cf-Access-Jwt-Assertion` header: RS256 signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cached 10 minutes), `aud`, `iss`, `exp` and `nbf` (60 s clock skew). With neither variable set (local development, Docker) the check is off. Setting only one, or a team domain outside `cloudflareaccess.com`, fails closed with `503`.

`wrangler.jsonc` also sets `"workers_dev": false` and routes the Worker to the custom domain `mail.tarle.de` only, so the unprotected `*.workers.dev` URL does not exist. The `tarle.de` zone must be in the same Cloudflare account.

## 4. Verify

```sh
curl -sI https://mail.tarle.de/inbox | head -3                       # 302 to <team>.cloudflareaccess.com
curl -s -o /dev/null -w '%{http_code}\n' https://mail.tarle.de/api/messages   # 302 or 403, never app data
curl -sI https://mail.tarle.de/manifest.webmanifest | head -1        # 200 (bypass)
curl -s -o /dev/null -w '%{http_code}\n' https://mail.tarle.de/api/i/aaaaaaaaaaaaaaaaaaaaaaaa.gif   # 200 (bypass)
```

Then open `https://mail.tarle.de` in a browser: you should see the Access login first, then the app.

## What bypasses Access, and why

The list lives in [`src/lib/security/access-bypass.ts`](../src/lib/security/access-bypass.ts) and is mirrored in `scripts/setup-access.mjs`; a test fails if the two differ. A prefix matches on a path-segment boundary (`/book` covers `/book` and `/book/x`, not `/bookx`).

| Group | Paths | Why |
| --- | --- | --- |
| `inbound-webhooks` | `/api/inbound/*` | Relay (HMAC), Resend (Svix) and SES (SNS) deliver received mail; each request is signature-checked. |
| `public-booking` | `/book/*`, `/c/*`, `/api/public/booking/*` | Guests book meetings without an account. |
| `public-links` | `/d/*`, `/api/drive/public/*`, `/api/shared-files/*` | Shared Drive links and shared attachment links; the token is the credential. |
| `read-receipts` | `/api/i/*` | Tracking pixel loaded by the recipient's mail client. |
| `calendar-feed` | `/api/calendar/feed` | Calendar apps subscribe with a read-only API key in the URL. |
| `api-clients` | `/api/v1/*`, `/api/calendar/events/*`, `/mcp`, `/jmap/*`, `/.well-known/jmap`, `/api/mobile/*`, `/api/auth/device` | API-key clients (REST, MCP, JMAP, mobile app) cannot do a browser login. `/api/auth/device` is the mobile password sign-in; it is rate limited and supports MFA. |
| `pwa-assets` | `/_next/static/*`, `/locales/*`, `/manifest.webmanifest`, `/sw.js`, `/favicon.ico`, `/icon-*.png`, `/api/branding/icon` | Fetched without credentials by browsers and the OS, and needed by the public pages. |

If you use none of the API clients or the mobile app, delete the `api-clients` group from both lists (and its Access application) to keep the password sign-in endpoint behind Access as well.

Requests that reach the Worker through its own service binding carry no Access token; the app does not make any.
