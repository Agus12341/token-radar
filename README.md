[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Agus12341/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/Agus12341/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Launch Radar

An entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty.

The program reads the sealed DefiLlama snapshot of every protocol at or above $5M TVL, works out which ones still record no token and are not a wrapped, staked, bridged or versioned product of one that trades, and ranks them by what a token launch would be worth if the record stayed as it is. It writes a ranked board (`board.json`), the data file the dashboard renders (`data.js`), a static dashboard with a board, filters and a per-protocol detail view, and the dossier the judge reads.

## The model

implied value = TVL × category multiple × momentum × seasoning

- **Category multiple** — the median market-cap / TVL ratio of protocols in the same DefiLlama category whose token already trades, blended toward the global median when a category has few traded tokens, clamped to 0.03–3.
- **Momentum** — the protocol's 7-day TVL change, clamped to ±30%, worth at most ±15%.
- **Seasoning** — how long the protocol has run with no token recorded, on a five-year square-root curve worth 0.95×–1.30×.

Nothing is keyed to a protocol's name: run the program on a fresher snapshot and the board rebuilds itself. Every board row carries a concrete farm plan — a playbook per protocol family, parameterised with the protocol's cheapest chain, its size tier, and real costs and durations.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. The dashboard in `dashboard/` is plain HTML, CSS and JavaScript and renders with no network; open the generated `dashboard/index.html` from the output directory (it reads `../data.js`).

## Layout

- `main.ts` — the program: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the candidate rule, the value model, the farm plans, and a local copy of the gate's board checks.
- `dashboard/` — the page: board, filters, sorting, and a detail view per protocol.
- `screenshots/` — the board, a detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, as the kit ships it.
