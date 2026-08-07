# Casus Strategies

Casus Strategies is a free, AI-native prediction-market research fund. It studies a small daily
set across weather, economics, public policy, legal and regulatory events, and corporate events.
Every possible order is checked against live PredArena books and portfolio-wide scenario risk.

The system starts in shadow mode. Shadow mode collects data and previews paper orders, but it
does not submit them. Paper execution must be enabled manually after seven clean days.

## Repository map

- `apps/web` is the static public React site.
- `apps/worker` is the private Cloudflare scheduler, research engine, and webhook receiver.
- `packages/core` contains shared data shapes and deterministic probability and risk math.

## Local setup

Requirements: Node.js 20 or newer and npm 10 or newer.

```bash
npm install
make check
npm run dev
```

The website runs without secrets because its monthly report data is compiled into the static
bundle. The worker uses mocked services in tests and remains in shadow mode by default.

## Safety boundaries

- PredArena is the only broker and all of its balances are simulated.
- Kalshi and Polymarket adapters are read-only and never receive trading credentials.
- Models return structured research. They cannot call the broker or create positions.
- Unknown responses, stale evidence, malformed model output, or exhausted quotas mean no trade.
- Only deterministically verified two-market relationships can produce a paired hedge.
- Paid models, paid replay, paid infrastructure, and automatic paid fallbacks are not supported.

## Deployment overview

The public site deploys to Cloudflare Pages. The worker uses Workers Free, one Durable Object,
and D1. Follow `docs/DEPLOYMENT.md` after the local checks pass. Do not reuse any credential
that has appeared in chat or source control.

For the component map, scheduling flow, and safety boundaries, read `docs/ARCHITECTURE.md`.
For a plain-language walkthrough of how a simulated trade moves through the system, read
`docs/PAPER_TRADING.md`.
