// Round-robin self-play tournament + blunder report.
//
//   npx tsx scripts/self-play/tournament.ts            # all 4 scripts, 3 goals
//   npx tsx scripts/self-play/tournament.ts --goals 5  # first to 5
//   npx tsx scripts/self-play/tournament.ts --ap 3
//
// Each ordered pair plays once as white and once as black (home/away) to cancel
// any first-move advantage. Prints a win matrix and a per-script blunder ranking —
// the numbers we use to decide what a stronger AI must fix.

import { runMatch, ALL_SCRIPTS, type SideMetrics, type MatchResult } from './harness.ts'

const argv = process.argv.slice(2)
const argNum = (flag: string, def: number) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def
}
const maxGoals = argNum('--goals', 3)
const maxAP = argNum('--ap', 5)

const scripts = [...ALL_SCRIPTS]
const shortName: Record<string, string> = {
  'engine-champ-r16': 'R16',
  'engine-champ-qf': 'QF',
  'engine-champ-sf': 'SF',
  'engine-champ-final': 'Final',
}

// Accumulators
const wins: Record<string, number> = {}
const draws: Record<string, number> = {}
const losses: Record<string, number> = {}
const agg: Record<string, SideMetrics & { games: number }> = {}
for (const s of scripts) {
  wins[s] = draws[s] = losses[s] = 0
  agg[s] = { games: 0, goals: 0, missedShots: 0, concededOpenShots: 0, lostToInterception: 0, interceptionsWon: 0, tackles: 0, wastedApTurns: 0, illegalActions: 0, kingForcedRelease: 0, turns: 0, possessionTurns: 0 }
}
const addMetrics = (id: string, m: SideMetrics) => {
  const a = agg[id]; a.games++
  a.goals += m.goals; a.missedShots += m.missedShots; a.concededOpenShots += m.concededOpenShots
  a.lostToInterception += m.lostToInterception; a.interceptionsWon += m.interceptionsWon
  a.tackles += m.tackles; a.wastedApTurns += m.wastedApTurns; a.illegalActions += m.illegalActions
  a.kingForcedRelease += m.kingForcedRelease; a.turns += m.turns; a.possessionTurns += m.possessionTurns
}

const results: MatchResult[] = []
for (const a of scripts) {
  for (const b of scripts) {
    if (a === b) continue
    const r = runMatch(a, b, { maxGoals, maxAP })
    results.push(r)
    addMetrics(a, r.metrics.white)
    addMetrics(b, r.metrics.black)
    const winnerId = r.winner === 'white' ? a : r.winner === 'black' ? b : null
    if (!winnerId) { draws[a]++; draws[b]++ }
    else { wins[winnerId]++; losses[winnerId === a ? b : a]++ }
  }
}

const pad = (s: string | number, n: number) => String(s).padStart(n)

console.log(`\n  CHESS.FOOTBALL — SELF-PLAY TOURNAMENT  (first to ${maxGoals}, ${maxAP} AP, home+away)\n`)

// ── Win matrix (row = white, col = black) ──
console.log('  Results  (row plays WHITE vs column BLACK)  →  white-black\n')
process.stdout.write('  ' + pad('', 10))
for (const b of scripts) process.stdout.write(pad(shortName[b], 12))
process.stdout.write('\n')
for (const a of scripts) {
  process.stdout.write('  ' + pad(shortName[a], 10))
  for (const b of scripts) {
    if (a === b) { process.stdout.write(pad('·', 12)); continue }
    const r = results.find((x) => x.white === a && x.black === b)!
    process.stdout.write(pad(`${r.score.white}-${r.score.black}`, 12))
  }
  process.stdout.write('\n')
}

// ── Standings ──
console.log('\n  Standings\n')
console.log('  ' + pad('AI', 10) + pad('W', 4) + pad('D', 4) + pad('L', 4) + pad('Pts', 6))
const standings = [...scripts].sort((x, y) => (wins[y] * 3 + draws[y]) - (wins[x] * 3 + draws[x]))
for (const s of standings) {
  console.log('  ' + pad(shortName[s], 10) + pad(wins[s], 4) + pad(draws[s], 4) + pad(losses[s], 4) + pad(wins[s] * 3 + draws[s], 6))
}

// ── Blunder report (per game, lower is better for blunders) ──
console.log('\n  Quality per game  (lower blunders = better play)\n')
const cols = ['miss', 'conced', 'lostInt', 'wasteAP', 'illegal', 'kingHld', 'tackle+', 'wonInt+', 'poss%']
console.log('  ' + pad('AI', 10) + cols.map((c) => pad(c, 9)).join(''))
for (const s of standings) {
  const a = agg[s]; const g = a.games || 1
  const per = (n: number) => (n / g).toFixed(2)
  console.log('  ' + pad(shortName[s], 10) +
    pad(per(a.missedShots), 9) +
    pad(per(a.concededOpenShots), 9) +
    pad(per(a.lostToInterception), 9) +
    pad(per(a.wastedApTurns), 9) +
    pad(per(a.illegalActions), 9) +
    pad(per(a.kingForcedRelease), 9) +
    pad(per(a.tackles), 9) +
    pad(per(a.interceptionsWon), 9) +
    pad(((a.possessionTurns / (a.turns || 1)) * 100).toFixed(0) + '%', 9))
}

console.log('\n  Legend: miss=scoring pass not taken · conced=left opponent an open shot')
console.log('          lostInt=own pass intercepted · wasteAP=passive turn (>=2 AP unused)')
console.log('          illegal=illegal action emitted · kingHld=king forced to release ball')
console.log('          tackle+/wonInt+ = good plays (higher is better) · poss%=possession\n')
