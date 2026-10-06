# chess-football-engine — Motor de reglas y bots de Chess.Football

## PASO 0 (bloqueante): actualizar `agents/`

Antes de cualquier tarea, inicializa el submódulo de agentes y llévalo al último
commit remoto:

```bash
git submodule update --init --recursive
git submodule update --remote agents
```

Si falla, para y avisa: no trabajes con estándares desactualizados.

## Instrucciones de agentes

- Lee SIEMPRE `agents/ARCHITECTURE-INDEX.md` primero.
- Lee SIEMPRE las reglas de oro comunes (`agents/standards/01-golden-rules.md`) y
  las de tu lado (`01.x-golden-rules-*.md`) según el índice.
- Lee `agents/standards/00-writing-in-spanish.md` si vas a escribir en español.
- Lee SOLO lo que el índice indique para tu tarea. NUNCA leas todo `agents/`.

## PASO 0.1 (bloqueante): ¿queda la estructura anterior en este equipo?

Si este repo no está dentro de la carpeta raíz `chess-football-bmad/` junto a
`chess-football-docs/`, o quedan restos de la estructura anterior a 2026-10-06 (repo
`chess-football-bmad` con `_bmad/` dentro, memorias de Claude Code con rutas antiguas,
skills locales del proyecto), **para** y sigue con el usuario el apartado «Migrar un
equipo con la estructura anterior» de `chess-football-docs/GUIDE.md`. No borres nada sin
confirmación.

## Qué es este repo

Paquete npm **público** `@scriptonita/chess-football-engine`: tipos, lógica de partida,
motor de bots (`src/bot-engine.ts`) y notación. TypeScript puro, sin DOM ni APIs de
Node. Lado: **librería npm** (`agents/standards/01.1-golden-rules-npm-libraries.md`).

Vive como carpeta hermana dentro de la carpeta raíz `chess-football-bmad/`. Contexto del
proyecto en `chess-football-docs/docs/`: `technical/architecture.md`,
`technical/bot-engine.md` y `technical/conventions.md` (orden de publicación, naming de
bots).

## Comandos

- `npm test` (vitest), `npm run typecheck`, `npm run build` (tsup).
- `prepublishOnly` ejecuta tests y build.
- `scripts/self-play/` es un laboratorio de calibración dev-only: no se publica.

## Reglas propias

- Implementa la spec de `chess.football` (`rules/es.md`); no decide reglas nuevas.
- Es la única fuente de identidad de los bots (id, dificultad, estilo, avatar, badge).
  Terminología: «bot», nunca «IA» ni marcas comerciales.
- Siempre rama + PR; la versión se sube en la misma PR y se publica tras el merge.
