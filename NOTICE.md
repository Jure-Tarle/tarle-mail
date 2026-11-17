# Notice

Tarle Mail is a modified version of **Mailflare** by Hieu Nguyen
(https://github.com/hieunc229/mailflare, imported at commit 5330fa4, version 0.5.5),
licensed under the GNU Affero General Public License v3.0 (see [LICENSE](LICENSE)).
This fork is distributed under the same license.

## Changes in this fork

- Renamed the product to "Tarle Mail" throughout (deployment `tarle-mail`, code
  identifiers, environment variables, storage keys, headers, documentation) and
  replaced the logo and landing page. Kept on purpose: database trigger and
  migration-ledger names (`mailflare_*`) used by applied migrations, the
  upstream push-relay protocol (`ios-relay.mailflare.co`, `mailflare-push-v1`),
  and references to the upstream project.
- Removed the Paymug license check and activation flow; every installation runs with
  the full Team feature set (`src/lib/licenses/service.ts`).
- Disabled upstream's one-click update, which replaced the repository with upstream's
  tree; upstream releases are merged by hand.
- Added features ported from OpenInbox (see below) and Cloudflare Access protection.

The git history of this repository records every change in detail.

## Third-party code

Parts of the sending providers, BIMI, domain health, usage and command palette features
are adapted from **OpenInbox** (https://github.com/sums001/OpenInbox), used under the
MIT License:

> MIT License
>
> Copyright (c) 2026 OpenInbox contributors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
> OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## AGPL §13

If you let other people use a deployed instance over a network, you must offer them the
corresponding source code of the version you run, for example with a link to a public
repository.
