# Tarle Mail

Self-hosted email, calendar, booking and drive on Cloudflare Workers, for your own domains.

Tarle Mail is a fork of [Mailflare](https://github.com/hieunc229/mailflare) (AGPL-3.0) with
every Team feature enabled and no license server, plus features adapted from
[OpenInbox](https://github.com/sums001/OpenInbox) (MIT). See [NOTICE.md](NOTICE.md).

## Features

**From Mailflare, all tiers included**
- Custom-domain mailboxes, personal and shared inboxes with per-user access, aliases, `+tag` addressing, catch-all.
- Unlimited accounts, email forwarding, custom branding (name and icon).
- Routing rules, labels and filters, snooze, scheduled and undo send, templates, follow-ups, auto-reply.
- Spam filtering with SPF, DKIM and DMARC checks, remote images blocked until allowed.
- Calendar with invitations, public booking pages, drive with sharing.
- AI agents, MCP and JMAP, REST API keys, webhooks, audit logs, backups, IMAP/Gmail/mbox import.
- Passkeys, two-factor sign-in, 34 languages.

**Added in this fork**
- Sending through **Brevo, Mailjet and SMTP** besides Cloudflare, Resend and Amazon SES, with an ordered **fallback chain** per domain and daily/monthly limits per provider ([providers](docs/providers.md)).
- **BIMI**: upload a sender logo per domain (validated SVG Tiny PS, hosted at `/bimi/<domain>.svg`, `default._bimi` record written for you), and show senders' BIMI logos for mail that passes DMARC, fetched by the server so senders can't tell when you read.
- **Domain health check** with one-click repair (MX, SPF merge, DKIM, DMARC, Email Routing, catch-all), never deleting unrelated records.
- **Usage dashboard** (Admin → Usage): mail per day, sending per provider against its limits, D1 and storage size, Worker requests, mail-flow log.
- **Command palette** (⌘K / Ctrl+K) with fuzzy search over folders, mailboxes, settings and admin pages.
- **Cloudflare Access** in front of the app, with the Worker verifying the Access token itself ([access](docs/access.md)).

## Architecture

One Worker (`mail-tarle`) serves the web app and API, receives mail from Cloudflare Email
Routing, and runs queues and cron jobs. D1 (`mail-tarle`) stores the data, R2
(`mail-tarle-raw`) raw mail, attachments, drive files and logos, three queues
(`mail-tarle-inbound`, `-outbound`, `-agent`) decouple processing, and a Durable Object pushes
live updates. Docker with SQLite, Postgres or MySQL also works ([self-hosting](docs/self-hosting.md)).

## Deploy

Requires the Workers Paid plan (queues, Email Sending) and a domain on Cloudflare.

1. Log in: `npx wrangler login`.
2. Create the resources (names are fixed in `wrangler.jsonc`):
   ```sh
   npx wrangler d1 create mail-tarle
   npx wrangler r2 bucket create mail-tarle-raw
   npx wrangler queues create mail-tarle-inbound
   npx wrangler queues create mail-tarle-outbound
   npx wrangler queues create mail-tarle-agent
   ```
3. Set up Cloudflare Access for `mail.tarle.de` **before anything else is reachable** ([access](docs/access.md)).
4. Deploy: `npm ci && npm run deploy`. The Worker is served at `mail.tarle.de`; `workers.dev` is off.
5. Set the runtime Cloudflare token (permissions in [deployment](docs/deployment.md)) and the Access variables:
   ```sh
   npx wrangler secret put CF_TOKEN
   npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
   npx wrangler secret put CF_ACCESS_AUD
   ```
6. Open `https://mail.tarle.de/setup`, create the admin account and connect your domain.

## Local development

```sh
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run dev
```

Checks: `npm run db:bundle && npm run lint && npx tsc --noEmit && node --test tests/*.test.mjs && npm run build`.

## Documentation

[Deployment](docs/deployment.md) · [Cloudflare Access](docs/access.md) · [Providers](docs/providers.md) ·
[Databases](docs/databases.md) · [API](docs/api.md) · [Assistant and MCP](docs/email-assistant-and-mcp.md) ·
[Upstream sync](docs/upstream-sync.md) · [Troubleshooting](docs/troubleshooting.md)

## License

AGPL-3.0, see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). If others use your instance over a
network, offer them the source of the version you run.
