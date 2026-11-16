# Merging upstream Mailflare releases

Tarle Mail is a fork of [Mailflare](https://github.com/hieunc229/mailflare). Upstream's
one-click update replaced the whole repository with upstream's tree, which would drop this
fork's changes, so it is disabled. Merge upstream releases by hand instead.

```sh
git remote add upstream https://github.com/hieunc229/mailflare.git   # once
git fetch upstream
git switch -c chore/upstream-sync
git merge upstream/main
```

Expect conflicts where this fork changed upstream files:

| Area | Files | Keep |
| --- | --- | --- |
| License gate | `src/lib/licenses/service.ts`, `src/lib/mailboxes/access-utils.ts` | Ours: always Team, no license server. Delete any new Paymug or license UI files upstream adds and grep for new `getLicenseEntitlements` checks. |
| Names | `wrangler.jsonc`, `package.json`, `src/lib/cloudflare-api-utils.ts` | Ours (`mail-tarle`). Take upstream's new bindings and settings. |
| Branding | `src/lib/branding/service.ts`, `src/lib/i18n/en.json`, `public/locales/*.json` | Both: take upstream's new keys, keep "Tarle Mail" in the text. |
| Update button | `src/app/api/admin/update/POST.ts`, `.github/workflows/deploy-update.yml` | Ours (disabled, workflow deleted). |
| Sending | `src/lib/email/outbound-provider*.ts`, `src/lib/email/send.ts` | Both: upstream changes plus the provider chain. |
| Schema | `src/db/schema/index.ts`, `drizzle/**` | Both. Renumber this fork's migrations after upstream's if numbers collide, then `npm run db:bundle`. |

Then run the checks and deploy:

```sh
npm ci
npm run db:bundle && npm run lint && npx tsc --noEmit && node --test tests/*.test.mjs && npm run build
npm run deploy
```

Apply database migrations afterwards from **Admin → General** (or `/api/setup/prepare`), as upstream does.
