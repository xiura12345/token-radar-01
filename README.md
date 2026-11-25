# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xiura12345/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xiura12345/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Launch Radar v2** — a token launch radar that ranks **all 342 protocols in the sealed snapshot that record no token** (the 40-protocol house watchlist included and starred, never treated as a ceiling), each with an implied token value, risk flags and a concrete six-step farm plan. The 416 protocols whose token already trades are kept in a separate "Already trading" view: they are the yardstick, not the board.

**The model** — nothing is hardcoded; every figure is measured from the snapshot itself:

```
implied = TVL × category multiple × momentum × maturity × reach
```

- **Category multiple**: the median market-cap/TVL ratio of the snapshot's own token-bearing protocols in the same category, winsorised to [0.005, 10], shrunk toward the global median (prior weight 4) and clamped to [0.03, 4].
- **Momentum**: 1 + 0.35 · tanh(change_7d / 20) — seven-day TVL growth, ±35% at most; unreported is neutral.
- **Maturity**: 1 + 0.5 · (1 − e^(−age/540)) — how long DefiLlama has tracked the protocol with no token.
- **Reach**: 1 + 0.16 · ln(chains), capped at +45%.

**Risk flags** are earned from each protocol's own figures: a 7-day TVL fall of 15% or more, overheated momentum (+40% or more), single-chain exposure, a crowded category (25+ pre-token rivals), a young protocol (<180 days tracked), or data the snapshot does not report — summed into a Low / Medium / High label.

**Farm plans** are six steps per protocol, written from a playbook for its category and filled with its own chains: wallet setup and gas budget per chain class, a deposit sized to the protocol's TVL, expansion, a weekly working loop, eligibility tracking, and launch-day readiness — each step with its cost and time.

The dashboard (board / protocol detail / filtered views, methodology page with the measured multiples table, already-trading tab) is plain HTML, CSS and JavaScript with no network calls; `main.ts` regenerates `board.json`, `data.js`, the dashboard copy and `dossier.json` deterministically from the snapshot.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=ken87834&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
