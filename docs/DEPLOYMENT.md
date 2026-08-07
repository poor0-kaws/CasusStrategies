# Free deployment guide

Do these steps only after `make check` passes. Keep every service on its Free plan. The code
does not contain a paid fallback.

## 1. Revoke the exposed PredArena key

The PredArena key previously pasted into chat must be considered public. Revoke it in the
PredArena dashboard before deploying. Create a new portfolio-scoped key for the $1,000 paper
portfolio. Never paste the replacement into chat or a normal shell command.

## 2. Create the Cloudflare resources

```bash
npx wrangler login
npx wrangler d1 create casus-research
```

Copy the returned D1 database ID into the worker Wrangler configuration, then apply migrations:

```bash
npm run db:migrate:remote --workspace @casus/worker
```

Do not enable Workers Paid, R2, Queues, or another paid Cloudflare product.

Also replace `GITHUB_REPOSITORY` with the exact `owner/repository`. Leave `TRADING_MODE` as
`"shadow"` and leave the inception placeholder unchanged until the seven-day gate passes. The four
`GROQ_MODEL_*` values are ordinary configuration, so a role's model can change without changing its
instructions or API key.

## 3. Add secrets through hidden prompts

Run each command separately. Wrangler will ask for the value without putting it in source code.

```bash
npx wrangler secret put PREDARENA_API_KEY --config apps/worker/wrangler.toml
npx wrangler secret put PREDARENA_WEBHOOK_SECRET --config apps/worker/wrangler.toml
npx wrangler secret put GROQ_API_KEY --config apps/worker/wrangler.toml
npx wrangler secret put GITHUB_REPORTS_TOKEN --config apps/worker/wrangler.toml
npx wrangler secret list --config apps/worker/wrangler.toml
```

Only one Groq key is required for all configured models. The GitHub token must be fine-grained,
restricted to this one repository, and allowed to update only repository contents.

Each `secret put` command opens a hidden prompt. Paste the value into that prompt and press Return.
Do not add the value after the command, because that would put it in shell history.

## 4. Deploy in shadow mode

Confirm `TRADING_MODE` is `"shadow"`, then deploy:

```bash
npm run deploy --workspace @casus/worker
```

Create a PredArena webhook subscription whose URL is:

```text
https://<worker-name>.<account>.workers.dev/webhooks/predarena
```

Store the one-time webhook signing secret as `PREDARENA_WEBHOOK_SECRET`. The worker rejects
unsigned or old webhook requests.

Subscribe to `order.executed`, `resting_order.filled`, `resting_order.cancelled`, and
`trade.settled`. Version one submits FOK orders, but listening to every account-changing event makes
reconciliation safer.

## 5. Deploy the static website

Connect the repository to Cloudflare Pages with:

- Project name: `casusstrategies`
- Root directory: `/`
- Build command: `npm run build --workspace @casus/web`
- Output directory: `apps/web/dist`

The intended free address is `https://casusstrategies.pages.dev`. Availability is confirmed
only when Cloudflare creates the project.

## 6. Seven-day activation gate

Leave shadow mode running for seven full days. Before enabling paper orders, verify:

- No duplicate order intentions.
- No evidence used before its `observed_at` time.
- No quota crossed its internal 80% ceiling.
- No local position differs from PredArena.
- Every candidate received a dry-run and risk decision.
- No secret appears in logs, Git history, or the website bundle.

After manual approval, set `TRADING_MODE` to `"paper"`, set `FUND_INCEPTION_DATE` to that
activation date, and redeploy. This enables only
PredArena paper orders. The code has no real-money venue order integration.
