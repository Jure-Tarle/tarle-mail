# Agent notes

## Secrets

Keys live in the macOS Keychain and reach commands only through
`agent-secret run` (see the global `agent-secrets` skill). Agents never read
`.dev.vars`, `.env*`, `.cloudflare-token` or Keychain values. `.dev.vars.example`
and `docs/` stay the reference for names; CI and other contributors keep using
real `.dev.vars` / `.env.docker` files unchanged.

| Namespace | Variable | Kind | Used by |
| --- | --- | --- | --- |
| `tarle-mail` | `CLOUDFLARE_TOKEN` | secret (app runtime token, not the deploy token) | dev Worker, Node runtime, `scripts/setup-access.mjs` |
| | `CF_EMAIL`, `CF_API_KEY` | plain, secret; legacy alternative to `CLOUDFLARE_TOKEN` | dev Worker, Node runtime |
| | `CF_ACCOUNT_ID` | plain | Node runtime mailer, `scripts/setup-access.mjs` |
| | `CF_ACCESS_API_TOKEN` | secret, optional | `scripts/setup-access.mjs` |
| | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | plain, optional | Cloudflare Access check |
| | `TURNSTILE_SECRET_KEY` | secret, optional | login challenge |
| | `RESEND_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `B2_APPLICATION_KEY`, `S3_SECRET_ACCESS_KEY` | secret, optional | mail and storage providers |
| | `AWS_ACCESS_KEY_ID`, `AWS_REGION`, `B2_KEY_ID`, `B2_BUCKET`, `B2_ENDPOINT`, `S3_*` (non-secret), `AI_MODEL`, `APP_URL` | plain, optional | mail, storage, AI |
| | `DATABASE_URL` | secret (contains the DB password), optional | external DB, `scripts/passkey-recovery-link.ts` |
| | `TARLE_MAIL_TOKEN` / `TARLE_MAIL_PASSWORD`, `TARLE_MAIL_URL` | secret, plain | `scripts/import-gmail-takeout.mjs` |
| `tarle-mail-deploy` | `CLOUDFLARE_API_TOKEN` | secret (Wrangler deploy token) | `wrangler deploy`, `wrangler d1 … --remote` |
| | `CLOUDFLARE_ACCOUNT_ID` | plain | Wrangler |

The deploy token sits in its own namespace so it never becomes a binding of
the local dev Worker.

Commands that need keys (each `run` shows one Keychain dialog per secret
variable; tell the owner which command it is for):

```bash
# Local Worker dev: Wrangler takes bindings from the environment only when
# there is no .dev.vars file and CLOUDFLARE_INCLUDE_PROCESS_ENV=true.
CLOUDFLARE_INCLUDE_PROCESS_ENV=true agent-secret run tarle-mail -- npm run dev
agent-secret run tarle-mail -- npm run dev:node            # Node runtime reads process.env
agent-secret run tarle-mail -- node scripts/setup-access.mjs
agent-secret run tarle-mail -- npm run auth:recovery-link
agent-secret run tarle-mail-deploy -- npm run deploy        # also upload, db:migrate:remote
```

Self-hosted Docker: `docker compose up` reads `.env.docker` itself (the
container needs it), so it runs without `agent-secret`; agents still never
read that file.

`npm run lint`, `npm run build` and `npm run db:migrate:local` need no keys.

Owner setup, once, in a terminal:

```bash
agent-secret import tarle-mail .dev.vars
agent-secret set tarle-mail-deploy CLOUDFLARE_API_TOKEN
agent-secret set tarle-mail-deploy CLOUDFLARE_ACCOUNT_ID --plain
# or per variable: agent-secret set <ns> <VAR> [--plain]
```

Then rename `.dev.vars` (for example to `.dev.vars.bak`) so Wrangler falls
back to the environment; ask the owner before deleting it.
