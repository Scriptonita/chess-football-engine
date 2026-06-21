# Self-play AI training subsystem

A headless self-play lab for **training and tuning** Chess.Football AIs. It plays
full AI-vs-AI games using only the engine's pure functions, measures the blunders
and good plays each script makes, and provides a **configurable search+eval AI**
(`ai-engine.ts`) with real difficulty tiers used as a sparring partner / reference.

> This is a **dev/training tool**, not shipped in the published package. Unlike the
> sandboxed persona scripts in `src/ai-players/` (self-contained, no imports), the
> tools here import the engine source directly. The shipped runtime opponents remain
> the persona scripts; this engine trains them.
>
> Relationship to the existing `scripts/simulate.ts` / `scripts/train.ts`: those run
> the four hand-written persona scripts and produce failure/diagnosis reports. This
> subsystem adds the configurable reference AI, difficulty tiers, non-determinism,
> and a monotonic-ladder benchmark. They share the same turn-execution semantics.

## Files

- `ai-engine.ts` — one search+eval core → `createAI(config, seed)` and `TIERS`
  (beginner/intermediate/advanced/expert). Beam search over the whole turn, explicit
  goal-combo finder, blunder filter, and **softmax non-determinism** (seeded RNG, so
  it explores sensible options and never replays the identical turn — e.g. it won't
  make the same kickoff moves after every goal — yet stays reproducible under a fixed
  seed).
- `harness.ts` — `runMatch(white, black, opts)` plays a full game and records
  per-side metrics (missed shots, open shots conceded, possessions lost, tackles won,
  hung balls, wasted AP, illegal actions, possession %). Accepts a registered script
  id or an inline AI `{ id, play }`.
- `tournament.ts` — round-robin of the registered persona scripts + blunder report.
- `ladder.ts` — tiers vs tiers and vs the persona scripts; verifies a monotonic
  difficulty ladder (each tier beats the one below, loses to the one above).
- `benchmark.ts` — the expert tier vs the four persona scripts (home + away).
- `AI_AUTHORING_PROMPT.md` — the master context/prompt for authoring or regenerating
  a strong, characterful, non-deterministic persona script. Align the canonical docs
  (`futbolajedrez/docs/AI_GAME_RULES.md`, `AI_PLAYER_PROMPT.md`) with it.
- `NOTES.md` — the iteration log (what failed, the fix, the new record) from building
  the reference AI.

## Run

```bash
npm run selfplay:bench           # expert tier vs the four persona scripts
npm run selfplay:ladder          # full difficulty ladder (add -- --games 12)
npm run selfplay:tournament      # persona scripts round-robin + blunders
```

## The training loop

Run a benchmark → read the blunder metrics → trace one lost game move by move to see
the concrete failure → add/adjust an eval term or filter → re-measure. Log each
iteration in `NOTES.md`. This is how the reference AI went from losing 0–3 to beating
every persona script and forming a clean difficulty ladder.
