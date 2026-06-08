# @scriptonita/chess-football-engine

Canonical **code** implementation of the Chess.Football rules engine — pure and framework-agnostic (no DOM, no Node APIs, no state-management library).

> **Rules source of truth:** the human-readable spec lives at
> [github.com/Scriptonita/chess.football](https://github.com/Scriptonita/chess.football).
> This package implements that spec in code and is consumed by every game client
> (the web app `futbolajedrez` and the CrazyGames build). When the spec changes,
> update it here once, publish a new version, and bump the dependency in both games.

## Install

```bash
npm install @scriptonita/chess-football-engine
```

## What's included

- **Types** — `BoardState`, `Piece`, `Ball`, `Position`, `Side`, `PieceType`, `MoveHistoryEntry`, `AIAction`, `AIPlayerScript`, …
- **Rules / movement** — `getValidMoves`, `getValidPasses`, `checkGoal`, `isInOwnArea`, `isInEnemyArea`, `getAreaForSide`, `WHITE_AREA`, `BLACK_AREA`
- **Engine (state transitions)** — `applyMove`, `applyPass`, `applyEndTurn`, `getPath`, `MoveResult`, `PassResult`
- **Notation** — `squareName`, `FILE_LABELS`, `RANK_LABELS`, `SHORT_KEY`, `LONG_KEY`
- **AI opponents** — pure deterministic scripts via `getAIScript(scriptId)`

Not included (kept per-app on purpose): the zustand store / `getInitialBoardState` —
state orchestration lives in each game client.

## Usage

```ts
import { getValidMoves, applyMove, getAIScript } from '@scriptonita/chess-football-engine'

const ai = getAIScript('claude-tactico')
const actions = ai.play(boardState, 'black') // pure, synchronous, no network
```

## Scripts

```bash
npm run build      # tsup → ESM + CJS + .d.ts in dist/
npm run typecheck  # tsc --noEmit over src
npm test           # vitest (rules test suite)
```

## License

MIT
