// Validates the EXPERT tier against the four engine scripts, home + away.
//   npx tsx scripts/self-play/benchmark.ts
import { runMatch, ALL_SCRIPTS } from './harness.ts'
import { makeTier } from './bot-engine.ts'

const strongAI = makeTier('expert', 0) // fixed seed → reproducible benchmark
const maxGoals = 3, maxAP = 5, turnCap = 200
let w = 0, d = 0, l = 0
const t0 = Date.now()
console.log(`\n  EXPERT tier  vs  engine scripts   (first to ${maxGoals}, ${maxAP} AP, cap ${turnCap}t)\n`)
for (const opp of ALL_SCRIPTS) {
  // Expert as white
  const a = runMatch(strongAI, opp, { maxGoals, maxAP, turnCap })
  const aw = a.winner === 'white'
  const ad = a.winner === 'draw'
  // Expert as black
  const b = runMatch(opp, strongAI, { maxGoals, maxAP, turnCap })
  const bw = b.winner === 'black'
  const bd = b.winner === 'draw'
  for (const win of [aw, bw]) if (win) w++
  for (const dr of [ad, bd]) if (dr) d++
  l += (!aw && !ad ? 1 : 0) + (!bw && !bd ? 1 : 0)
  console.log(
    `  vs ${opp.padEnd(18)}  ` +
    `white: ${a.score.white}-${a.score.black} ${(a.turns + 't').padStart(5)} ${aw ? 'W' : ad ? 'D' : 'L'}   ` +
    `black: ${b.score.white}-${b.score.black} ${(b.turns + 't').padStart(5)} ${bw ? 'W' : bd ? 'D' : 'L'}`)
}
console.log(`\n  Strong-v1 record:  ${w}W  ${d}D  ${l}L   (of 8 games)   [${((Date.now() - t0) / 1000).toFixed(1)}s]\n`)
