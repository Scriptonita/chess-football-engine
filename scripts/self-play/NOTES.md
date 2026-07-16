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

## Iter 9 — ported to src/ + knight threats + 3-step combo + new legendary tier

**Port completed.** `src/ai-engine.ts` is now the production engine, exported from
the package public API (`src/index.ts`). `scripts/self-play/ai-engine.ts` is a thin
re-export. The engine also provides `createChampionAI`, `AIPersona`, `CHAMPIONSHIP_ROSTER`
for championship mode.

**New engine scripts added:** `claude-opus` (beam search, expert tier equivalent) and
`claude-tactico` updated to Sonnet 4.6 (beamWidth 12, +knight-threats, +3-step combo).
`ALL_SCRIPTS` in harness updated to include `claude-opus`.

### Changes to `src/ai-engine.ts`

1. **Knight threats in evaluation** — `knightThreats()` counts our knights at
   L-distance from the rival king (+220 each; uninterceptable shots). Opponent
   knights in the same position get -280 penalty. Reasoning: these shots can't be
   blocked and are far more dangerous than linear threats.

2. **3-step combo finder** — `findScoringCombo` extended from 2-step to 3-step:
   - `pass → new holder moves → shoot` (catches pass-to-knight → knight repositions
     → knight shoots, the canonical goal sequence the 2-step search missed).
   Removed the expensive "move non-holder → holder moves → shoot" variant (too slow).

3. **AP-usage bonus** — Each action in a plan gets +4 bonus points in `searchPlans`.
   Prevents the engine from preferring early end_turn when all positions score
   similarly. Validated at temperature=5: makes the engine use more AP per turn
   without sacrificing plan quality.

4. **Eval weight tuning:**
   - Ball advancement: 9 → 16 per rank (more aggressive advance toward rival goal)
   - Shooting threats (ours): 45 → 45+bias (kept; persona bias applied on top)
   - Shooting threats (theirs): 52 → 65 (more sensitive to rival shot lanes)
   - `opponentCanTackleOurHolder` blunder: -230 → -380 (stronger tackle avoidance)

5. **New tiers:**
   - `expert`: beamWidth 12 (was 10), temperature 5 (was 8)
   - `legendary` (new): beamWidth 20, depth 5, temperature 4, defense 2

6. **`legendary` becomes the boss.** CHAMPIONSHIP_ROSTER updated: Claude Fable
   uses `legendary` instead of `expert`.

### Results (vs engine scripts, 8-12 game series)

| Tier | vs chatgpt | vs gemini | vs claude-tactico | vs claude-fable | vs claude-opus |
|---|---|---|---|---|---|
| expert (old) | 100% | 100% | ~50% | 0% | ~50% |
| expert (iter 9) | 100% | 100% | ~50% | 0–13% | 88% |
| legendary (iter 9) | 100% | 100% | **50%** | **30%** | 100% |

**Benchmark record** (expert tier, 10 games each side): **7W 0D 3L** (was 6W 0D 4L).

**Ladder (consecutive tiers, 6 games):**
- beginner < intermediate < advanced < expert: all monotonic (100% win rate each step)
- expert vs legendary: legendary wins 67% (8W/4L in 12 games) ✓

### Key learnings

- **Temperature matters more than beam width.** Reducing temperature below 5 made
  the engine too deterministic and actually weaker (deterministic selection of the
  locally-highest plan, not the globally best sequence). The AP-usage bonus of +4/action
  already biases toward longer plans without sacrificing quality.
- **`ballDestinationUnsafe` filter on candidates()** was too aggressive — caused 0-0
  infinite stalemates against weak opponents. Reverted; the `-380` tackle-avoidance
  penalty in `candidateScore` already handles unsafe passes.
- **Direct-shot danger penalty** was redundant with `immediateGoal(board, you) - 650`
  and `candidateScore` -5000, and doubled the defensive panic. Reverted.
- Claude-fable remains the strongest opponent (explicit rule-based king-dodge +
  lane-block + pass-safety checks). The legendary closes the gap (30% win rate)
  but doesn't fully replicate fable's explicit defensive depth.

### Status / next
- Consider adding explicit king-dodge logic to the engine (move king away from
  incoming shot squares, directly rather than through eval signals only).
- Consider per-persona eval biases in CHAMPIONSHIP_ROSTER to make each character
  feel stylistically different (§9 of AI_AUTHORING_PROMPT).
- The `claude-fable` hand-written script still beats legendary 70% of the time;
  it remains a legitimate "final boss" in the championship bracket.

## Iter 10 — eval bug fixes + king-lane defense (the "rookie mistakes" pass)

Report: even at the `expert`/`legendary` tiers the engine made rookie mistakes (a
human playing it complained). Diagnosed by tracing single games (`scripts/trace.ts`,
new) and aggregate benchmarks (`scripts/bench.ts`, new; engine tiers registered as
`engine-beginner … engine-legendary` in the registry, with fixed seeds, so simulate/
train/bench can pit them against the hand-written rivals).

**Baseline (buggy):** `engine-expert` vs `claude-fable` = **0W 19L** (73–212 goals);
`engine-legendary` vs fable = 7W 12L. fable was unbeatable.

### Root causes found

1. **Centralisation sign bug (the big one).** `evaluate` had
   `score += (mine ? -1 : 1) * -Math.abs(p.x - cx)`. The extra `-` flipped the sign so
   our own pieces were **rewarded for drifting to the a/i-file edges**. The engine
   shoved bishops to x=0 and *passed the ball there*, where it was trivially tackled
   along the file. (The only rival without this term — `claude-fable` — is exactly the
   one that beat the engine. Tell-tale.) Fixed to `* Math.abs(...)`: penalise our
   pieces off-centre, mildly reward the rival pushed wide.

2. **Possession incentives inverted.** A tackle-able held ball scored `+140 − 380 =
   −240`, while abandoning a loose ball scored ~0 — so the engine *preferred giving up
   loose balls* to grabbing them into a contestable square. Rebalanced: tackle-exposure
   −380→−160, and added `opponentCanGrabLoose` (−150) so conceding a contested loose
   ball costs about the same as a tackle, but never more than the +140 for holding.

3. **No king-lane defense.** The engine scattered its pieces, leaving the back-rank
   cross-shot wide open — fable's main scoring route (walk the ball up an open flank as
   a loose ball, reach the back rank, shoot across the king's row). Added
   `kingExposure(board, side)`: for each of the king's 8 rays, an enemy aiming down it
   = +3, an open lane to the edge = +1, a friendly screen = 0. `−13×` ours, `+9×`
   theirs → the engine keeps the king screened and squeezes the rival king's lanes.

4. **AP-usage bonus too greedy.** `+4`/action made the engine spend AP shuffling
   pieces (incl. the king) into danger just to use them. Reduced to `+2`.

### Results (all fixes, fixed seed)

| `engine-expert` vs | record | goals |
|---|---|---|
| claude-fable (was 0–19!) | **20W 0D 0L** | 254–129 |
| claude-opus | 12W 0D 0L | 63–17 |
| gemini-tikitaka | 12W 0D 0L | 187–5 |
| claude-tactico | 15W 1D 0L | 140–99 |
| chatgpt-tactico | 15W 1D 0L | 111–0 |

`engine-legendary` vs fable = **20W 0D 0L** (279–154).

**AP adaptation** (`apBudget = min(actionPoints, depth)` + AP-scaled combos already
handles it): expert @3AP sweeps fable 12–0 (106–64) and gemini 12–0; @1AP the game is
inherently drawish (1 goal in 24 games for *either* side) but the engine never loses.

**Ladder still monotonic:** advanced > intermediate (10–0) > beginner (10–0);
expert > advanced (10–0) > intermediate (10–0) > beginner (10–0); legendary > expert
(6W 2D 2L, 70% — a real but narrow edge between the two top tiers). Eval fixes improved every tier's baseline
sanity without flattening the difficulty curve (weak tiers still blunder via
`defense=0`/`combos=off`/high `temperature`/`mistakeProb`).

## Iter 11 — raise the ceiling: deep-defence lookahead + tier re-spread

Request: the curve was too compressed at the top — what felt like `expert` should be
the *floor* of "hard", and `legendary` should be **near-impossible to beat**. Goal:
expert = a genuinely hard but beatable opponent; legendary = almost unbeatable.

### What did NOT work: offensive (negamax) lookahead

First attempt was the textbook move — turn-level negamax (look ahead at the opponent's
best full turn and our reply, selective deepening, alpha-beta-style cutoffs). It made
the engine **much weaker**: expert fell from 20–0 to **0–10 vs Fable**, legendary
**lost to expert 2–8**; both stopped scoring. Cause = **horizon-effect passivity**: the
static eval (Iter 10) is already well-tuned and rewards calculated aggression (advance
the carrier accepting a soft −700 tackle-risk that usually pays off). A shallow minimax
*discounts* any attack whose payoff is past the horizon and assumes the opponent always
parries, so the engine turns timid and stops attacking. Lesson: **with a strong static
eval, shallow adversarial search over that eval is worse than the eval alone.**

### What worked: lookahead as *additive deep DEFENCE* only

Keep offense 100 % static (proven). Use lookahead only to **veto** a top plan that hands
the opponent a *forced goal* the 1-move blunder filter can't see — a 2–3 AP
carry/pass/reposition-then-shoot (`attackerForcesGoal`, `turns=1` ≈ `findScoringCombo`
on the resulting state) or, for the boss, a **2-turn forced goal we can't defend**
(`turns=2`, an AND/OR search: opponent forces iff it has a turn after which *every* reply
of ours still loses). The veto subtracts `GOAL_VALUE`, demoting only genuine blunders;
since a plan where we keep the ball never lets the opponent's `findScoringCombo` fire,
offensive plans are never touched. Modelled with a cheap narrow sub-search
(`beamWidth 4`, `defense 0`). Knobs: `lookahead` (0/1/2 defensive turns), `lookaheadWidth`.

### Final tiers & results (fixed seed)

| Tier | beam | temp | lookahead | character |
|---|---|---|---|---|
| expert | 10 | 8 | 1 (veto 2–3 AP opp goals) | hard, beatable |
| legendary | 14 | 2 | 2 (veto 2-turn forced goals) | near-unbeatable |

- **legendary**: 92 % vs Fable (10W 2D 0L, **never loses**, 85–49), 83 % vs expert (10–2,
  84–38). The boss.
- **expert**: 100 % vs advanced (117–53) and gemini (191–8 → still scores ~16/game, not
  passive), 63 % vs Fable / 75 % vs opus — clearly above the mid tiers, roughly level with
  the strongest hand-written rivals = a real "difícil but beatable" tier.
- Ladder monotonic: legendary > expert > advanced > intermediate > beginner.
- Per-turn latency (fine for in-game): expert ~115 ms, legendary ~410 ms (worst ~1 s).
  Recursion uses the cheap sub-config; a full-width recursive search blew up to 15 s+/turn.

## Iter 12 — beam dedupe + graded defence veto + post-dedupe recalibration

Report: make the rivals more competitive vs a real player. Diagnosis started from the
goals legendary still CONCEDED (traces of fable-W vs legendary-B): nearly every
concession showed the `LEFT-RIVAL-MOVE+SHOOT` flag on the engine's own previous turn —
the engine scattered pieces offensively (even moving its KING into the shooter's lane,
twice in the same game with the identical pattern) instead of defending, plus one
abandoned centre loose ball.

### Root cause: the beam was full of PERMUTATIONS

Dumping the plan ranking at a conceded-goal position (`__internals` export + a replay
script) showed the entire top-12 was ONE 5-move set in different orders (identical
score), out of 799 "plans". Two consequences:

1. **Effective beam diversity ≈ 1** — beamWidth 14 explored orderings, not alternatives.
2. **The defensive veto was a no-op** — it examined the top 6 plans (all copies),
   vetoed them all, and selection fell through to plan #7: the SAME move-set, unexamined.
   When every top plan lost, unexamined arbitrary plans leapfrogged the graded ones.

### Fixes (src/ai-engine.ts)

1. **Beam dedupe** (`stateKey`): order-insensitive fingerprint (piece squares +
   hasMovedThisTurn + ball + AP + turn); frontier nodes and finished plans dedupe by
   resulting state, keeping the best-scored copy. Beam slots now hold genuinely
   different lines.
2. **Graded two-pass veto** (`searchPlansDefended`): cheap 1-turn check
   (`findScoringCombo`) over up to `lookaheadWidth*6` top plans, stopping once
   `lookaheadWidth` safe plans exist; the expensive 2-turn AND/OR search only runs on
   cheap-pass survivors (budget `lookaheadWidth*2`). Penalties are GRADED: conceding
   next turn −GOAL_VALUE, forced-in-2-turns −GOAL_VALUE/2. If NOTHING examined is safe,
   the unexamined remainder is demoted too, so the engine plays the most RESISTANT
   losing plan instead of an arbitrary unexamined one.

### What did NOT work (measured, do not repeat)

- **Full hard-veto coverage + selection capped to vetted plans**: expert collapsed to
  30–45 % vs Fable and conceded MORE (61–106 at worst). With every aggressive plan
  demoted the engine turtles; passivity hands the opponent free tempo to build the
  2-turn combos a lookahead-1 tier can't see. Same lesson as the Iter-11 negamax
  failure: in this game TEMPO > caution. The veto must stay leaky at the tail.
- **Old temperatures**: pre-dedupe, the top plan's permutation copies concentrated the
  softmax mass → play was near-argmax at ANY temperature. Post-dedupe temperature is a
  real knob: expert temp 8 → 38–45 % vs Fable; temp 3 → 50 %. Legendary's `temperature:
  5` roster override made the BOSS lose 4–6 to the SF tune; plain temp 2 restored it.
- **Eval biases**: shooting +15 / advancement ×1.2 on the floor persona dropped it from
  50 % to 21–31 % vs Fable — post-dedupe the beam follows the eval faithfully, so bias
  perturbations of the tuned weights are expensive. Floor and boss now run unbiased;
  mid rungs keep a small possession bias as flavour.
- **Wider deep-veto budget (`lookaheadWidth` 3–4)**: MORE caution = LESS strength. Boss
  candidates at lkw 3/4 scored 40–50 % vs the SF tune; lkw 2 scored 60 %. Legendary now
  ships lkw 2 (also faster). Same tempo-over-caution theme.
- **Narrowing SF's beam to separate the top rungs**: beam-10 lookahead-2 (temp 5) lost
  **0–10** to beam-12 lookahead-1 — post-dedupe, BEAM WIDTH is the dominant strength
  axis, above lookahead. Don't spread tiers by shrinking beams below 12 at the top.

### Results (fixed seed 0x1234)

| pairing | before | after |
|---|---|---|
| legendary vs fable (12×130 @5AP) | 10W 2D 0L, 85–49 | **12W 0D 0L, 95–47** |
| legendary vs opus | — | 12W 0D 0L, 64–14 |
| legendary vs expert | 83 % | **100 %** (8W 0D 0L, 76–24) |
| expert vs fable (20 g) | ~63 % (12 g) | 50 % (8W 4D 8L, 65–71) — the floor, aggressive |
| champ bracket | Final LOST to SF | R16 50 % floor < QF (90 % vs R16, 96 % vs fable) < SF (70 % vs QF) < Final (plain legendary, 60 % vs SF — two lookahead-2 tunes mirror each other and saturate ~55–60 %) |
| ladder | monotonic | monotonic (expert>adv 95 %, adv>int 100 %, int>beg 100 %) |
| latency | expert 115 ms / leg 410 ms | expert 93 ms (max 218) / leg 290 ms (max 611) |

Curiosity for future tuning: expert with beamWidth 12 (temp 3) beat Fable **20–0
(186–95)** — post-dedupe, beam width is real width and +2 crosses a qualitative
threshold. Kept the shipped expert at beam 10 on purpose (the tier must stay beatable);
the upper rungs already own the wider beams.

## Iter 13 — human feedback: threat COUNTING + goalside shape (defence pass 2)

Human playtest report (after Iter 12): attack is good, but "it's relatively easy to
trick the engine into conceding" — it must predict not just where a rival piece can
MOVE but where the ball can be THROWN once it lands there; king defence when the rival
holds the ball is weak; and it "sends pieces forward while I hold the ball", which is
pointless.

### Changes (src/ai-engine.ts)

1. **`countGoalThreats` replaces the boolean `opponentThreatAfterOneMove`.** Counts the
   opponent's distinct one-turn goal routes (capped at 3): carry→shoot, **pass→receiver-
   with-a-clean-shot (new — the "moved piece + throw reach" a human reads instantly)**,
   tackle-our-carrier→shoot, grab-loose-ball→shoot. Penalty is graded (−700 first route,
   −250 each extra), so defence finally has a GRADIENT: blocking one of two lanes,
   tackling the carrier, or stepping the king off a line improves a plan's score even
   when the position cannot be fully cleared. The old boolean gave identical −700 to
   every plan under any threat → the engine had no reason to prefer partial defence and
   spent those AP attacking instead (the exact behaviour the human exploited).
2. **`hasCleanShot` geometric prefilter**: exact pass-rules check (knight = exact L,
   uninterceptable; linear = directional ray with no DEFENDER strictly in between —
   the shooter's own pieces never block a pass). Gates the expensive simulations; net
   result is the whole threat check got CHEAPER than the old full-sim boolean.
3. **Goalside shape term in `evaluate`**: with enemy possession, each of our outfield
   pieces strictly AHEAD of the ball (nearer the enemy end than the ball is to ours)
   pays −5/rank. Football logic: a piece ahead of the ball can neither screen a lane
   nor tackle the carrier. This retracts the "attacks while defending" deployments.

### Results (fixed seed; same protocol as Iter 12)

| pairing | Iter 12 | Iter 13 |
|---|---|---|
| expert vs fable (20 g) | 50 %, goals 65–71 | 50 %, goals **67–55** (GA −23 %) |
| legendary vs fable | 12–0, 95–47 | 12–0, **84–38** (GA −19 %) |
| legendary vs opus | 12–0, 64–14 | 12–0, **68–9** (GA −36 %) |
| Final vs SF | 60 % | 65 % |
| expert vs advanced | 95 % | 100 % (103–37) |
| latency | expert 93 ms / leg 290 ms | expert 94 ms (max 160) / **leg 224 ms (max 437)** |

Win rates hold (no passivity regression — the graded penalty preserves tempo because
partially-defended aggressive plans keep most of their score), goals conceded drop
~20–35 % across the board, and legendary got 20 % faster.
