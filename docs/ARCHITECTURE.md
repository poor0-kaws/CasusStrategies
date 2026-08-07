# Casus Strategies architecture

Casus has two separate surfaces: a private research engine and a public static website. The
browser never connects to the research database and never receives trading or model secrets.

```mermaid
flowchart TD
    A["PredArena markets and books"] --> B["Point-in-time collector"]
    C["Approved official sources and venue rules"] --> B
    B --> D["Cloudflare D1 research database"]
    D --> E["Contract and relationship engine"]
    D --> F["Forecasting ensemble"]
    E --> G["Slow-value strategy"]
    E --> R["Verified two-leg hedge strategy"]
    F --> G
    G --> H["Risk and realism gate"]
    H --> I["PredArena dry-run"]
    I --> J{"8% conservative edge remains?"}
    J -->|"No"| K["Record rejection"]
    J -->|"Yes"| L["Paper order manager"]
    L --> M["PredArena paper API"]
    M --> N["Signed webhook and reconciliation"]
    N --> D
    D --> O["Evaluation and attribution"]
    O --> Q["Private daily metrics"]
    O --> P["Static monthly website"]
    O --> F
```

## Why there are two databases

D1 holds the research history: facts, snapshots, forecasts, and paper fills. A small SQLite-backed
Durable Object serializes scheduled runs and webhooks. Think of D1 as the filing cabinet and the
Durable Object as the one-person order desk. This prevents two jobs from acting at the same time.

An hourly cron wakes the Worker, but research cycles run only at 8 AM, noon, and 4 PM New York
time. The 8 AM cycle selects at most 15 total markets across all five sectors. Noon and 4 PM revisit
only that saved watchlist. The 8 PM cycle reconciles records without calling a model.

## Point-in-time rule

Every source has three clocks:

- `source_published_at`: when the publisher says it released the information.
- `observed_at`: when Casus first saw it.
- `stored_at`: when the database finished saving it.

A forecast may only use information whose `observed_at` is not later than the forecast. This
simple rule prevents a historical evaluation from accidentally using knowledge from the future.

## Trust boundaries

- Only `PredArenaAdapter` talks to PredArena.
- Venue adapters read rules and prices; they cannot trade.
- Model clients produce validated research objects; they cannot call the paper broker.
- Deterministic code calculates probabilities, scenario outcomes, risk limits, sizes, and order
  eligibility.
- PredArena confirms positions. Sending a request is never treated as a fill.
- The public site contains sanitized month-end values only.

## Cost boundaries

The four research roles share one Groq key but have separate configurable model names. Identical
validated inputs are cached. Every attempted request reserves its estimated input and maximum output
before the network call, including failed calls. Static limits stop at 80% of the published free
daily token allowance, and returned Groq headers enforce the same 20% reserve for request and
per-minute token limits. Missing headers make the run ineligible to trade.

PredArena traffic is limited to eight requests per minute. A D1 counter allows two directional
orders per New York day, plus at most two additional orders that strictly reduce scenario risk, and
800 total placements per UTC month. Unknown execution or reconciliation state is stored as a
trading freeze. A freeze is removed only by the recovery path that created it or by manual review.

## Portfolio boundaries

- Gross deployed capital cannot exceed 75% of NAV.
- Worst-case scenario loss cannot exceed 25% of NAV.
- A market can risk 2.5%, a verified relationship cluster 7.5%, and a sector 12.5%.
- Verified clusters enumerate every valid outcome for up to eight markets.
- Automatic hedge execution is limited to two legs. Larger complete sets remain research records.
- If a second FOK leg fails, the first leg is unwound within two ticks or all new orders remain
  frozen.
