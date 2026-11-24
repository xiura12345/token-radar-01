# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xiura12345/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xiura12345/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Launch Radar** — a token launch radar for the make.fun bounty “Build the best token launch radar”. It reads one sealed DefiLlama snapshot (758 protocols, fetched once), finds the protocols that record no token yet, and ranks them by an implied value: what a token launch would plausibly be worth if the protocol’s record stayed as it is. Every row carries a concrete farm plan — the steps to position for a possible launch, with what each step costs and how long it takes.

The value model is a comparable-multiple model measured from the snapshot itself, never from a list of names:

```
implied value = TVL × category multiple × growth × maturity × reach
```

- **Category multiple** — among the snapshot’s live-token protocols, the median market cap per TVL dollar, per category (winsorised, with the whole-market median as fallback for thin categories). It is what the market demonstrably pays for a token of this kind of protocol.
- **Growth** — the 7-day TVL change, tanh-squashed so a single wild week cannot dominate.
- **Maturity** — a log curve over the years the protocol has run with no token.
- **Reach** — a small premium per chain past the first.

The board covers all 40 watchlist protocols and adds every other genuine pre-token candidate the same screen admits — no exchanges, no bridges or wrapped/staked products of a token that already trades, no versioned pools — including the early finds below the $50M watchlist floor. Protocols whose token already trades are never ranked; the dashboard shows them apart, at the market’s own market caps, as the comparison set the multiples are measured from.

The dashboard (`dashboard/`) is a static page with no network and no framework: a sortable, filterable board (search, category, chain, minimum TVL, watchlist-only), a detail view per protocol showing its own model arithmetic and its farm plan, and an “Already trading” view. Three renders of it live in `screenshots/`.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, after validating the board against the gate’s rules. To view the dashboard, serve or open the output folder so that `dashboard/index.html` can read the `data.js` written beside it.

## Layout

- `main.ts` — the entry program: snapshot in, deliverables out.
- `lib/model.ts` — the radar itself: the multiple measurement, the implied-value model, the candidate screen and the farm-plan generator.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the page the judge reads.
- `screenshots/` — the board, a protocol detail view and a filtered view, rendered from this dashboard.
- `vendor/makefun-board.ts` — make.fun’s dossier library, vendored.

---
<sub>Entered on [make.fun](https://make.fun/?ref=ken87834&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
