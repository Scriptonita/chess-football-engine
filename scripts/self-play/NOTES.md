# AI self-play — iteration notes

Goal: make the AI rivals harder. Prototype `strong-ai.ts` here, validate with the
harness, then port the winner into `@scriptonita/chess-football-engine`.

Run: `npx tsx scripts/self-play/benchmark.ts` (strong vs the 4 engine scripts,
home+away, 8 games) and `npx tsx scripts/self-play/tournament.ts` (baseline).

## Baseline (engine scripts, round-robin)
- All 4 scripts are **deterministic** greedy 1-ply if/else → "siempre los mismos
  movimientos". 2/12 games are infinite stalemate loops (claude-tactico on defense).
- chatgpt-tactico emits ~38 illegal actions/game; claude-tactico hoards the ball
  with its king 22×/game; over-cautious passing (lostToInterception≈0) → low scoring.
- Strength order: claude-fable > chatgpt-tactico ≈ gemini-tikitaka > claude-tactico.
- **claude-fable** is the bar to beat: simulates multi-AP combos (move-then-shoot,
  pass-move-shoot), blocks shot lanes, dodges the king, handles offside/danger.

## Iter 1 — greedy search + 1-ply opponent reply + eval + hash tie-break
Record: **5W 0D 3L** of 8. Beats claude-tactico & chatgpt-tactico both colors.
Loses to claude-fable (0-3 both ways) and gemini (black).

Trace findings (strong W vs fable B):
- **Wastes AP** shuffling rooks to corners (A1/I1) — eval can't tell a useful move
  from a useless one, so the hash tie-break picks garbage among "equal" moves.
- **Ignores the loose ball** — when the ball is loose it repositions randomly
  instead of recovering it; fable eventually grabs it and scores.
- Allows pointless moves while holding the ball (the "don't burn AP" guard only
  fired when NOT holding the ball).

## Iter 2 — richer eval + "don't shuffle" greedy
Record: **4W 0D 4L** (worse). Quick 0-3 losses: the MIN_GAIN cutoff made it END TURN
in defense doing nothing → opponent scored freely. 1-ply reply made it passive.

## Iter 3 — reply as blunder-filter only (not main signal)
Record: **4W 1D 3L**. Stopped hanging goals but greedy per-AP is too myopic to break
a packed defense → 800-turn stalemates reappear.

## Iter 4 — BEAM SEARCH over the whole turn (key architecture change)
Beam over up to 5 AP, keep best complete sequence; finds multi-step combos.
- **Bug found:** forgot to import `applyEndTurn` → `terminalScore` threw → caught →
  AI ended turn every time → 0W-7L. Fixed import.
- **Perf:** recomputing terminalScore inside the sort comparator hung on long games
  (84s/game). Fixed by memoizing each node's score once. Also replaced the
  "expand every opponent action" blunder check with a focused
  `opponentThreatAfterOneMove` (only the holder's carry-then-shoot + tackles on our
  holder). → 21s for 8 games.
- Record: **0W 6D 2L** — rock-solid defense (lots of 0-0) but no offense: the beam
  PRUNES setup moves (a move that opens a shot doesn't raise eval on its own, so
  topCandidates drops it before the combo is found).

## Iter 5 — explicit `findScoringCombo` (like fable)
Search move-then-shoot (2 AP) and pass-then-shoot directly, return a forced goal.
Record: **4W 2D 2L** — now it scores.

## Iter 6 — tackle-exposure penalty
Trace showed it ending turns with the ball-holder sitting where the opponent can
just tackle it (lose possession → they work it to a goal). Penalize ending the turn
with our holder tackle-able (`opponentCanTackleOurHolder`, -230).
Record: **6W 1D 1L**. Fixed the gemini losses.

## Iter 7 — loose-ball defense + stay-home-when-defending
Trace (fable W vs strong B): with the ball loose, STRONG wandered rooks to the far
rank while fable's queen grabbed the loose ball, reached our king's rank and shot.
- Stronger loose-ball recovery (converge on it; danger term if it's loose near our
  king); extend `opponentThreatAfterOneMove` to the loose-ball pickup-then-shoot;
  penalize our pieces parked in the attacking third when we DON'T hold the ball.
- Record: **7W 0D 1L  [12.6s]**. Beats all 4 engine scripts; only "loss" is strong-B
  vs fable-W **1-0** (fable nicks one early kickoff goal, then locked out 200 turns).

strong-v1 (now the EXPERT tier) clearly surpasses every engine script. Per-turn cost
~20–40ms (fine in-game). The core was generalised into `ai-engine.ts` (strong-ai.ts
removed). `benchmark.ts` now runs the expert tier.

## Iter 8 — configurable engine, difficulty tiers, non-determinism
`ai-engine.ts`: one search+eval core → `createAI(config, seed)` with knobs
**beamWidth · depth · combos · defense(0/1/2) · temperature · mistakeProb**.
- **Non-determinism**: plans chosen by SOFTMAX over scores (seeded mulberry32 RNG =
  hash(board) ^ instanceSeed ^ moveCounter). Verified: same board, different seeds →
  different plans; fixed seed → reproducible. `mistakeProb` adds human-like errors.
- **Tiers** (beginner/intermediate/advanced/expert) — see `ladder.ts`.
- **Ladder result (8 games/pairing): monotonic.** expert beats advanced 100%,
  advanced beats intermediate/beginner 100%, intermediate beats beginner 100%. vs
  engine scripts: beginner ~0–25%, expert 88–100% except claude-fable (~13%, the
  remaining boss). 0 illegal actions across all tiers.
- Master context doc written: `AI_AUTHORING_PROMPT.md` (full rules + strategy +
  architecture + persona design — a single prompt to author/train an AI).

## Status / next
**Port `ai-engine.ts` into the engine repo (rama+PR)**; replace the 4 hand-written
scripts with 4 tier presets (beginner→expert), keeping the persona names/avatars;
wire the championship bracket to ascend the tiers. Still open: close fable's single
early-kickoff goal (deeper opponent-turn search); add light per-persona eval biases
(§9 of the prompt) so styles read differently.
