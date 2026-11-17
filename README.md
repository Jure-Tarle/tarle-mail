# Tarle Mail

Self-hosted email, calendar, booking and drive for your own domains, running entirely in your
Cloudflare account on Workers, D1, R2 and Queues.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Jure-Tarle/tarle-mail)

Tarle Mail is a fork of [Mailflare](https://github.com/hieunc229/mailflare) (AGPL-3.0) with every
Team feature included and no license server, plus features adapted from
[OpenInbox](https://github.com/sums001/OpenInbox) (MIT). See [NOTICE.md](NOTICE.md).

## Features

**Mail**
- Mailboxes on any number of your domains, personal and shared inboxes with per-user access, aliases, `+tag` addressing and catch-all.
- Routing rules, labels and filters, snooze, scheduled and undo send, templates, follow-ups, auto-reply and forwarding.
- Sending through Cloudflare Email Sending, Resend, Amazon SES, Brevo, Mailjet or any SMTP server, with an ordered fallback chain per domain and daily/monthly limits per provider.
- Spam filtering with SPF, DKIM and DMARC checks; remote images blocked until allowed; HTML mail sanitized.
- BIMI: publish a sender logo per domain, and see senders' logos for mail that passes DMARC (fetched by the server, so senders can't tell when you read).
- Command palette (⌘K / Ctrl+K), keyboard shortcuts, dark mode, mobile layout, 34 languages.

**Beyond mail**
- Calendar with invitations and time zones, public booking pages, drive with sharing.
- AI agents that search mail, draft replies and manage events; MCP for other AI tools.

**Admin**
- Unlimited accounts, custom branding (name and icon), API keys, webhooks, audit logs, backups.
- Domain health check with one-click repair (MX, SPF, DKIM, DMARC, Email Routing), never touching unrelated records.
- Usage dashboard: mail per day, sending per provider against its limits, database and storage size, Worker requests, mail-flow log.
- Import from IMAP, Gmail Takeout, `.eml` and `.mbox`.

**Access**
- Optional Cloudflare Access (Zero Trust) login in front of the app; the Worker verifies the Access token itself.
- Passkeys and two-factor sign-in.
- Mail apps and scripts connect over JMAP, the REST API or MCP with API keys; these stay reachable outside Cloudflare Access.

## Cost

Receiving through Cloudflare Email Routing is free. The app uses Queues and can send through Cloudflare Email Sending, both of which need the Workers Paid plan ($5/month). Resend, Brevo and Mailjet have free sending tiers. Cloudflare Access is free for up to 50 users.

## Deploy

### With the button

1. Click **Deploy to Cloudflare** above. Keep the Worker name `tarle-mail`; Email Routing rules point to it by that name. Cloudflare creates the D1 database, the R2 bucket and the queues.
2. When asked for secrets, set **`CLOUDFLARE_TOKEN`**: a Cloudflare API token the app uses to set up Email Routing, DNS and sending for your domains. Create it under **My Profile → API Tokens → Create Custom Token** with:
   - Zone: Zone Read, DNS Edit, Zone Settings Edit, Email Routing Rules Edit
   - Account: Email Routing Addresses Edit, Email Sending Edit, Account Analytics Read (usage page)
3. Before you open the app, decide whether it should sit behind Cloudflare Access (recommended, see below). The first visitor of `/setup` becomes the admin.
4. Open the Worker's address at `/setup`, create the admin account and connect your domain. Connecting a domain enables Email Routing and replaces its MX records and routing rules after you confirm.

### From the command line, on your own domain, behind Cloudflare Access

```sh
git clone https://github.com/Jure-Tarle/tarle-mail && cd tarle-mail
npm ci
npx wrangler login
npx wrangler d1 create tarle-mail
npx wrangler r2 bucket create tarle-mail-raw
npx wrangler queues create tarle-mail-inbound
npx wrangler queues create tarle-mail-outbound
npx wrangler queues create tarle-mail-agent
```

Set up Cloudflare Access first, so the app is never reachable without it. One script creates the Zero Trust team, the email one-time-PIN login, the login application for your domain and the public exceptions, then prints the two values the Worker needs ([details](docs/access.md)):

```sh
export CF_ACCOUNT_ID=<account id>
export CLOUDFLARE_TOKEN=<token, plus the Access permissions from docs/access.md>
node scripts/setup-access.mjs --domain mail.example.com --email you@example.com --team yourteam
```

Deploy on the custom domain with the Access values, set the token as a Worker secret, then open `https://mail.example.com/setup`:

```sh
npm run deploy:domain -- mail.example.com --var CF_ACCESS_TEAM_DOMAIN:yourteam.cloudflareaccess.com --var CF_ACCESS_AUD:<aud>
npx wrangler secret put CLOUDFLARE_TOKEN
```

Later updates: `npm run deploy` (variables and the custom domain are kept).

### Docker

Runs as one container with SQLite (or Postgres/MySQL) and local files, see [self-hosting](docs/self-hosting.md).

## Mail apps

The app speaks **JMAP** (RFC 8620/8621) at `/.well-known/jmap`, with an app password from **Settings → Account → App passwords**, plus a REST API and MCP ([API](docs/api.md)). It does not run an IMAP or SMTP-submission server: Cloudflare Workers accept only HTTP, not the raw TCP connections those protocols need.

## Architecture

One Worker serves the web app and API, receives mail from Cloudflare Email Routing and runs the queue consumers and cron jobs. D1 stores the data, R2 keeps raw mail, attachments, drive files and logos, three queues decouple inbound, outbound and agent work, and a Durable Object pushes live updates to open tabs.

## Local development

```sh
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run dev            # http://localhost:3000
npm run db:seed        # optional demo data
```

Checks: `npm run db:bundle && npm run lint && npx tsc --noEmit && node --test tests/*.test.mjs && npm run build`.

## Documentation

[Deployment](docs/deployment.md) · [Cloudflare Access](docs/access.md) · [Sending providers](docs/providers.md) ·
[Databases](docs/databases.md) · [API, JMAP and webhooks](docs/api.md) · [Assistant and MCP](docs/email-assistant-and-mcp.md) ·
[Self-hosting](docs/self-hosting.md) · [Upstream sync](docs/upstream-sync.md) · [Troubleshooting](docs/troubleshooting.md)

## License

AGPL-3.0, see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). If others use your instance over a network, offer them the source of the version you run.
