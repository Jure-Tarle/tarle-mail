# Cloudflare Access in front of the app

Cloudflare Access puts a Cloudflare login (for example a one-time PIN sent to your email) in front of `https://mail.example.com`, before the app's own login page. The Worker also checks the Access token itself, so a mistake in the Access configuration does not leave the app open.

**Set up Access before you open `/setup`.** The first-run page creates the admin account for whoever reaches it first.

## 1. Create the token

Create one API token (My Profile > API Tokens > Create Custom Token). It can be the same token you set as the Worker secret `CLOUDFLARE_TOKEN`, if you add these permissions to it:

- **Account > Access: Apps and Policies > Edit**
- **Account > Access: Organizations, Identity Providers, and Groups > Edit** (creates the team and the email login)

After the setup you can remove the two Access permissions from the token again.

## 2. Create Zero Trust, the login and the applications

The domain needs one Access application with an Allow policy for you, plus a few Bypass applications for the paths that external services and non-browser clients call (list below). The script creates all of it and can be re-run safely (Node 18+, no dependencies):

```sh
export CF_ACCOUNT_ID=<account id>
export CLOUDFLARE_TOKEN=<token>
node scripts/setup-access.mjs --domain mail.example.com --email you@example.com --team yourteam --dry-run   # show the planned calls
node scripts/setup-access.mjs --domain mail.example.com --email you@example.com --team yourteam
```

`--team` creates the Zero Trust organization `yourteam.cloudflareaccess.com` when the account has none (Zero Trust Free covers up to 50 users). If the account has no login method yet, the script adds **One-time PIN**, so Access emails you a code at sign-in; an existing method (for example login with your Cloudflare account) is kept. If creating the organization fails because Zero Trust was never opened on the account, open **Zero Trust** in the dashboard once, pick the Free plan and the team name, then run the script again.

It creates or updates `mail.example.com (login)` (Allow your email, 24 h session) and one `mail.example.com (public paths)` application holding every bypassed path (Access allows up to 50 per application), then prints the two Worker variables. The token is never printed.

To do it by hand: create a **Self-hosted** application for `mail.example.com` with an Allow policy including your email and session duration 24 hours. Then create one self-hosted application with every path of every group below as a destination (for a prefix, both `mail.example.com/book` and `mail.example.com/book/*`) and a single policy with action **Bypass**, include **Everyone**. Access applies the most specific path, so these win over the domain-wide application.

## 3. Set the Worker variables

Copy the team domain and the **Application Audience (AUD) tag** of the `mail.example.com (login)` application (Zero Trust > Access > Applications > Edit > Overview) into the Worker `mail-tarle`: dashboard **Settings > Variables and Secrets**, or `npx wrangler secret put CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`. `wrangler.jsonc` has `keep_vars`, so dashboard values survive deploys.

| Variable | Example |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | the 64-character AUD tag |

Then deploy (`npm run deploy`). With both variables set, the Worker answers `403` (HTML for pages, JSON for `/api/`) to any request outside the bypass list that lacks a valid `Cf-Access-Jwt-Assertion` header: RS256 signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cached 10 minutes), `aud`, `iss`, `exp` and `nbf` (60 s clock skew). With neither variable set (local development, Docker) the check is off. Setting only one, or a team domain outside `cloudflareaccess.com`, fails closed with `503`.

To set the variables in the same step as the first deploy, so the app is never reachable without Access, pass them to Wrangler and attach the custom domain at once:

```sh
npm run deploy:domain -- mail.example.com --var CF_ACCESS_TEAM_DOMAIN:yourteam.cloudflareaccess.com --var CF_ACCESS_AUD:<aud>
```

The Worker checks the Access token on every hostname it answers, including `*.workers.dev`, so that address is protected too. The zone of the custom domain must be in the same Cloudflare account.

## 4. Verify

```sh
curl -sI https://mail.example.com/inbox | head -3                       # 302 to <team>.cloudflareaccess.com
curl -s -o /dev/null -w '%{http_code}\n' https://mail.example.com/api/messages   # 302 or 403, never app data
curl -sI https://mail.example.com/manifest.webmanifest | head -1        # 200 (bypass)
curl -s -o /dev/null -w '%{http_code}\n' https://mail.example.com/api/i/aaaaaaaaaaaaaaaaaaaaaaaa.gif   # 200 (bypass)
```

Then open `https://mail.example.com` in a browser: you should see the Access login first, then the app.

## What bypasses Access, and why

The list lives in [`src/lib/security/access-bypass.ts`](../src/lib/security/access-bypass.ts) and is mirrored in `scripts/setup-access.mjs`; a test fails if the two differ. A prefix matches on a path-segment boundary (`/book` covers `/book` and `/book/x`, not `/bookx`).

| Group | Paths | Why |
| --- | --- | --- |
| `inbound-webhooks` | `/api/inbound/*` | Relay (HMAC), Resend (Svix) and SES (SNS) deliver received mail; each request is signature-checked. |
| `public-booking` | `/book/*`, `/c/*`, `/api/public/booking/*` | Guests book meetings without an account. |
| `public-links` | `/d/*`, `/api/drive/public/*`, `/api/shared-files/*` | Shared Drive links and shared attachment links; the token is the credential. |
| `bimi-logos` | `/bimi/*` | BIMI sender logo named in the `default._bimi` TXT record, fetched by receiving mail providers. |
| `read-receipts` | `/api/i/*` | Tracking pixel loaded by the recipient's mail client. |
| `calendar-feed` | `/api/calendar/feed` | Calendar apps subscribe with a read-only API key in the URL. |
| `api-clients` | `/api/v1/*`, `/api/calendar/events/*`, `/mcp`, `/jmap/*`, `/.well-known/jmap`, `/api/mobile/*`, `/api/auth/device` | API-key clients (REST, MCP, JMAP, mobile app) cannot do a browser login. `/api/auth/device` is the mobile password sign-in; it is rate limited and supports MFA. |
| `pwa-assets` | `/_next/static/*`, `/locales/*`, `/manifest.webmanifest`, `/sw.js`, `/favicon.ico`, `/icon-*.png`, `/api/branding/icon` | Fetched without credentials by browsers and the OS, and needed by the public pages. |

If you use none of the API clients or the mobile app, delete the `api-clients` group from both lists (and its Access application) to keep the password sign-in endpoint behind Access as well.

Requests that reach the Worker through its own service binding carry no Access token; the app does not make any.

### The API is protected by its own login, not by Access

The `api-clients` group stays outside Access on purpose, so mail apps (JMAP), the mobile app, MCP clients and scripts keep working. These paths accept only API keys, app passwords or the mobile password sign-in (`/api/auth/device`, rate limited). Anyone who can reach the hostname can try those credentials, so turn on two-factor sign-in for every account and keep API keys scoped. If you use none of these clients, delete the `api-clients` group from `src/lib/security/access-bypass.ts` and `scripts/setup-access.mjs` and re-run the script.

