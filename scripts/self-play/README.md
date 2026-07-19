# Self-play bot training subsystem

A headless self-play lab for **training and tuning** the Chess.Football bot engine.
It plays full bot-vs-bot games using only the engine's pure functions, measures the
blunders and good plays each entry makes, and provides the **configurable search+eval
bot** (`bot-engine.ts` re-export) with real difficulty tiers used as sparring
partners / reference points.

> This is a **dev/training tool**, not shipped in the published package. The shipped
> runtime opponents are the difficulty tiers and `CHAMPIONSHIP_ROSTER` exported by
> `src/bot-engine.ts`; the tools here import the engine source directly.
>
> Calibration is **tier-vs-tier**: the `engine-*` entries in `scripts/registry.ts`
> reproduce each championship rung with fixed seeds so runs stay regression-comparable.
> (The legacy hand-written baseline scripts were removed in the bot-identity purge;
> their historical role was to seed the strength floor of the ladder.)

## Files

- `bot-engine.ts` — re-export of `src/bot-engine.ts`: `createBot(config, seed)`,
  `TIERS`, `CHAMPIONSHIP_ROSTER`. Beam search over the whole turn, explicit
  goal-combo finder, blunder filter, and **softmax non-determinism** (seeded RNG, so
  it explores sensible options and never replays the identical turn — e.g. it won't
  make the same kickoff moves after every goal — yet stays reproducible under a fixed
  seed).
- `../registry.ts` — dev-only registry of `engine-*` entries (tiers + championship
  rungs) consumed by every runner below.
- `harness.ts` — `runMatch(white, black, opts)` plays a full game and records
  per-side metrics (missed shots, open shots conceded, possessions lost, tackles won,
  hung balls, wasted AP, illegal actions, possession %). Accepts a registered script
  id or an inline bot `{ id, play }`.
- `tournament.ts` — round-robin of the championship rungs + blunder report.
- `ladder.ts` — tiers vs tiers and vs the championship rungs; verifies a monotonic
  difficulty ladder (each tier beats the one below, loses to the one above).
- `benchmark.ts` — the expert tier vs the championship rungs (home + away).

## Run

```bash
npm run selfplay:bench           # expert tier vs the championship rungs
npm run selfplay:ladder          # full difficulty ladder (add -- --games 12)
npm run selfplay:tournament      # championship rungs round-robin + blunders
```

## The training loop

Run a benchmark → read the blunder metrics → trace one lost game move by move to see
the concrete failure (`scripts/trace.ts`) → add/adjust an eval term or filter →
re-measure. This loop took the reference bot from losing 0–3 to sweeping the legacy
baseline and forming a clean difficulty ladder.
