// Difficulty-ladder benchmark.
//   npx tsx scripts/self-play/ladder.ts            # tiers vs tiers + vs engine scripts
//   npx tsx scripts/self-play/ladder.ts --games 12
//
// AIs are now stochastic (softmax temperature + mistakes), so every pairing plays
// several games with different seeds, alternating colours, and we report win rates.

import { runMatch, ALL_SCRIPTS, type Player } from './harness.ts'
import { makeTier, TIERS } from './ai-engine.ts'

const argv = process.argv.slice(2)
const games = (() => { const i = argv.indexOf('--games'); return i >= 0 ? Number(argv[i + 1]) : 8 })()
const maxGoals = 3, maxAP = 5, turnCap = 200
const tiers = Object.keys(TIERS) as (keyof typeof TIERS)[]
const pad = (s: string | number, n: number) => String(s).padStart(n)

// Play `games` games between two factory-makers, alternating colours & seeds.
// A maker takes a seed and returns a Player (a stochastic tier, or a fixed engine id).
function series(makeA: (seed: number) => Player, makeB: (seed: number) => Player) {
  let w = 0, d = 0, l = 0, gd = 0
  for (let g = 0; g < games; g++) {
    const seedA = 1000 + g * 7, seedB = 5000 + g * 13
    const aWhite = g % 2 === 0
    const r = aWhite
      ? runMatch(makeA(seedA), makeB(seedB), { maxGoals, maxAP, turnCap })
      : runMatch(makeB(seedB), makeA(seedA), { maxGoals, maxAP, turnCap })
    const aScore = aWhite ? r.score.white : r.score.black
    const bScore = aWhite ? r.score.black : r.score.white
    gd += aScore - bScore
    if (aScore > bScore) w++; else if (aScore < bScore) l++; else d++
  }
  return { w, d, l, gd }
}

console.log(`\n  DIFFICULTY LADDER  (${games} games/pairing, first to ${maxGoals}, cap ${turnCap}t)\n`)

// ── Tiers vs tiers ──
console.log('  Tier vs tier  (row win% as the row tier)\n')
process.stdout.write('  ' + pad('', 13))
for (const b of tiers) process.stdout.write(pad(b, 14))
process.stdout.write('\n')
for (const a of tiers) {
  process.stdout.write('  ' + pad(a, 13))
  for (const b of tiers) {
    if (a === b) { process.stdout.write(pad('·', 14)); continue }
    const { w, d, l } = series((s) => makeTier(a, s), (s) => makeTier(b, s))
    process.stdout.write(pad(`${Math.round((w / games) * 100)}% (${w}/${d}/${l})`, 14))
  }
  process.stdout.write('\n')
}

// ── Tiers vs the existing engine scripts ──
console.log('\n  Tier vs engine scripts  (win% / draws / losses for the tier)\n')
process.stdout.write('  ' + pad('', 13))
for (const s of ALL_SCRIPTS) process.stdout.write(pad(s.replace('-tactico', '').replace('-tikitaka', ''), 13))
process.stdout.write('\n')
for (const a of tiers) {
  process.stdout.write('  ' + pad(a, 13))
  for (const opp of ALL_SCRIPTS) {
    const { w } = series((s) => makeTier(a, s), () => opp) // engine scripts are fixed ids
    process.stdout.write(pad(`${Math.round((w / games) * 100)}%`, 13))
  }
  process.stdout.write('\n')
}

console.log('\n  Legend: win% (W/D/L). A healthy ladder rises along each tier row vs lower\n  tiers and vs the engine scripts; expert should dominate, beginner should not.\n')
