# How paper trading works

## Where the trade exists

Casus never places an order on a Kalshi or Polymarket account. It reads their live markets through
PredArena, then sends a simulated order to the PredArena paper portfolio. PredArena walks the live
public order book, applies its modeled venue fee, and changes only the fake $1,000 portfolio.

Think of this as a flight simulator. The prices and available contracts come from the real world,
but the cash and positions exist only inside the simulator.

## The order path

1. The Worker records the exact contract rules, current book, and official source timestamps.
2. Independent research roles produce structured facts and probability inputs. They cannot call
   PredArena or construct an executable API request.
3. Ordinary TypeScript combines the inputs and makes a conservative probability range.
4. The risk gate checks ambiguity, evidence age, entry and exit depth, time to close, daily limits,
   market loss, cluster loss, sector loss, gross deployment, and worst-case scenario loss.
5. PredArena previews the order without changing the portfolio. Casus recalculates the edge using
   the preview's volume-weighted price, fee, and required cash.
6. Shadow mode stops here. Paper mode first writes an `execution_pending` order to D1, then sends
   the FOK order with the same deterministic client order ID every time.
7. A position exists only after PredArena returns or reconciles a confirmed order. A timeout or
   disagreement freezes new orders instead of guessing.

## Why a trade happened

The private database keeps an inspectable decision trail: source IDs and observation times,
contract version, forecast range, market prior, likelihood ratios, chosen side, requested size,
preview price and fees, conservative edge, risk reason codes, and final PredArena order and fills.
This is the useful explanation for a trade. It records the inputs and calculations without asking a
model to write an unverifiable story after the fact.

The same preview records whether the trade would pass 4%, 6%, 8%, and 10% edge thresholds. Only 8%
can submit a paper order. The other thresholds are private research and cost no extra API calls.

## Hedging and related markets

Verified contract relationships form one risk cluster, so related contracts are not mistaken for
independent bets. The model may propose a relationship, but only deterministic code can mark it
verified. Automatic relationship trading is limited to two-leg structures whose valid outcomes,
visible depth, preview prices, fees, and orphan-leg loss all pass ordinary TypeScript checks. If the
second FOK leg fails, the cluster freezes while the confirmed first leg is reconciled and an unwind
is attempted within two ticks. An unconfirmed unwind freezes every new order.

## Performance records

PredArena NAV is the official paper result. Internally, Casus also records what the signal would have
earned at the observed quote and a harsher result using the confirmed fill, one and three extra
ticks, quotes one and five seconds later, and no maker-fill assumption. The public website receives
approved historical monthly returns, completed live month-end NAV, and aggregate sector weights.
Live records replace matching historical tiles, while NAV and total return use live values only.
