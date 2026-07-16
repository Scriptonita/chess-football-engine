Eres un diseñador de IA para juegos de estrategia por turnos. Tu tarea es crear un jugador IA para "FutbolAjedrez", un juego que combina piezas de ajedrez con mecánicas de fútbol. Dos equipos se enfrentan en un tablero 9×12 intentando chutar el balón contra el rey rival para marcar gol.

## Propósito: un rival virtual que un humano disfrute jugar

El script que generes da vida a un **jugador virtual** que se enfrenta a un **humano** en tiempo real. Puede usarse en distintas aplicaciones (la web Chess.Football y otras); **no asumas un contexto concreto**. Tu único objetivo es que la partida sea una **buena experiencia** para quien tienes enfrente:

- **No seas predecible.** Si en la misma posición haces siempre lo mismo, el humano memoriza una línea y te gana en bucle. Varía con criterio (sección 8b).
- **Juega bien de verdad.** Defiende con solidez, castiga balones colgados y errores, aprovecha tus ocasiones. El humano debe **respetar** al rival.
- **Juega a máxima fuerza.** Este jugador apunta a ser FUERTE: búsqueda profunda del turno completo, sin errores deliberados. La frescura y la justicia salen de **no ser predecible** (punto anterior), nunca de jugar peor a propósito.
- **Sorprende dentro de lo razonable**: cada partida debe sentirse nueva, para que el humano tenga que **entender el juego**, no descubrir un truco.

## La idea básica del juego: piensa como ajedrez, juega al fútbol

FutbolAjedrez es un **juego de equipo**. Imagina un partido de fútbol donde los jugadores son piezas de ajedrez que se mueven por el tablero:

- **Usa TODO tu equipo** para atacar y para defender. Una sola pieza persiguiendo el balón es tan mala idea aquí como un solo jugador persiguiendo el balón en fútbol: construye con pases, acompaña al portador, mantén piezas cubriendo a tu rey.
- **Mete goles y procura que no te los metan.** Cada AP debería acercarte a una de esas dos cosas.
- **Estratégicamente es ajedrez**: controla en todo momento dónde está cada pieza y **adónde puede llegar** — las tuyas Y las del rival. El tablero es información completa; nada debería pillarte por sorpresa.
- **Anticipa**: piensa en qué podría ocurrir en los próximos movimientos — adónde puede llevar el rival el balón, qué carriles de tiro se abren o se cierran con cada movimiento, cuál será la mejor respuesta del rival a tu jugada.

Este principio rector debe impregnar toda tu lógica: las secciones que siguen (pases seguros, amenazas, tackles, fuera de juego…) son las herramientas concretas para ejecutarlo.

A continuación te adjunto las reglas completas del juego. Léelas ENTERAS antes de escribir una sola línea de código. Si un detalle de las reglas contradice una suposición que hayas traído del ajedrez o del fútbol tradicional, gana el reglamento.

Leer el archivo AI_GAME_RULES.md

---

# Tu Tarea

Genera UN SOLO archivo TypeScript que exporte un objeto `aiPlayer` con la estructura `AIPlayerScript`. Ese objeto debe definir los metadatos del jugador y una función `play` que, dado el estado del tablero, devuelva la secuencia de acciones a ejecutar en el turno.

El archivo resultante se guardará tal cual en `src/ai-players/{slug}.ts` dentro del paquete del motor (`@scriptonita/chess-football-engine`) y se ejecutará en servidor. Si el archivo no compila, la función lanza una excepción, o devuelve acciones inválidas, tu IA queda descartada.

---

## Índice de secciones

1. Metadatos del jugador
2. Firma y contrato de la función `play`
2b. Simula tus propias acciones (SECCIÓN CRÍTICA)
3. Conocimiento mínimo que tu IA debe manejar
4. Cómo calcular movimientos válidos (algoritmo por pieza)
4b. Cómo calcular pases válidos — los compañeros SÍ son destino
5. Cómo verificar un pase seguro (SECCIÓN CRÍTICA)
5b. Protección del balón — seguridad del destino de pase
5c. Fuera de juego — nunca termines el turno con el balón en el área rival
6. Cómo detectar una oportunidad de gol
6b. Proteger al rey — detectar y bloquear líneas de tiro rivales
6c. Robar el balón — tackle prioritario
6d. Balón suelto — carrera por la posesión
7. Economía de Puntos de Acción — usa todos los AP
8. Estrategia recomendada
9. Robustez, pureza y manejo de errores
10. Formato de salida exigido
11. Checklist final antes de entregar el código

---

## 1. Metadatos del jugador

Define los siguientes campos en el objeto `aiPlayer`:

- `name`: tu nombre como jugador IA (ej: "Claude Sonnet", "GPT Strategist", "Gemini Flash").
- `description`: descripción en ESPAÑOL de tu estilo de juego y estrategia (1-2 frases).
- `avatar`: un emoji que te represente como jugador (ej: "🤖", "🧠", "⚡").
- `difficulty`: declara **`"expert"`**. Este prompt pide un único objetivo, **máxima fuerza**: evaluación heurística + búsqueda del turno completo (los 5 AP) + detección de combos de gol, sin errores deliberados (sección 8c). **No elijas nivel ni perfiles al humano** — es un juego nuevo, todos son nuevos: construye el rival más fuerte que puedas y haz que **no sea predecible** (sección 8b).
- `badgeName`: nombre del trofeo en ESPAÑOL que se lleva quien te derrote (ej: "Domador de Sonnet", "Verdugo de GPT").
- `badgeIcon`: nombre de un icono de la librería Lucide en minúsculas (ej: `"brain"`, `"zap"`, `"shield"`, `"target"`, `"flame"`, `"crown"`, `"swords"`).

> **Sin "personalidad".** `name`, `avatar`, `description` y los `badge*` son solo **etiqueta de presentación**: elige algo coherente y breve, no inviertas esfuerzo en tematizar un carácter. El valor del jugador está en **cómo juega** —fuerte y no predecible—, no en su personaje.

---

## 2. Firma y contrato de la función `play`

```typescript
play: (boardState: BoardState, aiSide: Side) => AIAction[]
```

### Entrada

- `boardState`: estado completo del tablero (piezas, balón, marcador, AP restantes, turno actual, último movimiento). Las interfaces exactas están en la sección 8 de `AI_GAME_RULES.md`.
- `aiSide`: `"white"` o `"black"`. **Éste es el dato más importante**: determina hacia dónde avanzas.
  - Si `aiSide === "white"`: atacas hacia `y=10` (rey negro en `{4,10}`), defiendes tu propia área `y ∈ [0..1]`.
  - Si `aiSide === "black"`: atacas hacia `y=1` (rey blanco en `{4,1}`), defiendes tu propia área `y ∈ [10..11]`.
  - **Confundir el sentido de ataque es un bug típico que hace que tu IA "juegue hacia atrás".** Parametriza siempre con `aiSide`.

### Salida

Un array `AIAction[]` con las acciones a ejecutar secuencialmente. El motor del juego:

1. Ejecuta las acciones en orden.
2. **Valida cada acción contra el estado YA EVOLUCIONADO por las acciones anteriores** (no contra el estado que recibió tu `play`). Una acción inválida se descarta **silenciosamente** y se continúa con la siguiente: no hay error, no se gasta AP, pero tu plan queda desincronizado y normalmente el resto del array también acaba descartado.
3. Corta la ejecución si se agotan los AP, si hay intercepción o si se marca gol.

### Contrato estricto

- Devuelve como máximo `boardState.actionPoints` acciones útiles (una por AP). El presupuesto es **configurable por partida (1–5)**: léelo siempre del estado, no asumas 5.
- Cada `move` o `pass` debe tener un `pieceId` válido y un `to` dentro del tablero.
- Una misma pieza NO puede aparecer dos veces como origen de un `move` en el mismo array (ver `hasMovedThisTurn` más abajo).
- Sí puede aparecer como origen de un `move` Y de un `pass`: mover + pasar con la misma pieza es legal y cuesta 2 AP.
- La función debe ser **pura** (sin efectos secundarios: no mutes `boardState`, no uses red ni IO). Pero **NO debe ser predecible** (ver sección 8b): un script que hace el movimiento idéntico en la posición idéntica —p. ej. el mismo saque tras cada gol— es memorizable y el humano lo gana en bucle. Introduce **variedad con criterio**: explora aleatoriamente entre las BUENAS opciones, usando un RNG sembrado desde el propio tablero (variado en juego, reproducible en tests).

---

## 2b. Simula tus propias acciones — SECCIÓN CRÍTICA

`play` se llama UNA vez por turno y devuelve todo el plan de golpe, pero el motor valida cada acción contra el estado resultante de las anteriores. **Si planificas todas las acciones mirando el estado inicial del turno, las acciones 2..N serán inválidas con frecuencia y se descartarán en silencio.** Éste es, medido en simulaciones reales, el fallo nº 1 de los scripts: cientos de acciones descartadas y turnos que se quedan en 1 acción efectiva.

### Regla de oro

Mantén un **estado simulado** y aplícale cada acción que añadas al array ANTES de decidir la siguiente. Tu simulación debe reproducir los efectos del motor:

**Al simular un `move`:**
- La pieza pasa a `to` y su `hasMovedThisTurn` pasa a `true`.
- Si era tackle: el balón pasa a la pieza (`holderId`), y el rival desplazado ya no está en `to` (a efectos prácticos puedes recolocarlo en cualquier ortogonal libre).
- Si la pieza llevaba el balón: el balón viaja con ella (conducción).
- Si el balón estaba suelto y la pieza es lineal y su trayectoria pasa por la casilla del balón: la pieza lo captura (el balón acaba en `to` con ella). Si es caballo, solo lo captura si aterriza exactamente encima.

**Al simular un `pass`:**
- Recorre la trayectoria: el primer RIVAL determina el resultado (rey → gol; otro → intercepción y fin de turno: NO planifiques nada después).
- Sin rivales en la trayectoria: si en `to` hay un compañero, ese compañero pasa a ser `holderId`; si está vacía, el balón queda suelto en `to`.
- Las piezas propias en la trayectoria NO afectan: el balón las sobrevuela.

**Después de cada acción simulada**, resta 1 AP. Cuando el presupuesto llegue a 0, para de planificar.

**Recalcula los destinos desde la posición SIMULADA, no desde la inicial.** Error medido y muy frecuente: mover una pieza y después generar su pase usando el patrón desde su casilla ANTIGUA (p. ej. un caballo que movió y luego "pasa" con destinos en L calculados desde donde ya no está → 182 pases inválidos en una sola serie de simulación). Todo `getValidMoves`/`getValidPasses` que llames para planificar la acción N debe ejecutarse sobre el estado simulado tras las acciones 1..N-1.

**Nunca reintentes una acción descartada.** Si una acción era ilegal este turno, será ilegal el siguiente salvo que el tablero cambie. Scripts observados repitieron el mismo move ilegal durante partidas enteras (su única "jugada" cada turno se descartaba y desperdiciaban los 5 AP). Tras planificar, valida cada acción contra tu estado simulado; si no pasa, NO la incluyas: busca alternativa.

Sin esta simulación incremental es imposible encadenar jugadas (pasar → mover el receptor → chutar), que es exactamente como se marca gol en este juego.

---

## 3. Conocimiento mínimo que tu IA debe manejar

Antes de decidir, tu IA debe calcular o conocer:

1. **De qué lado juego y hacia dónde ataco** (`aiSide`).
2. **Dónde están mis piezas vs las rivales** (filtrar `boardState.pieces` por `side`).
3. **Dónde está el balón y quién lo tiene**:
   - `boardState.ball.holderId === null` → balón suelto en `boardState.ball.pos`.
   - `holderId` pertenece a una pieza mía → tengo posesión.
   - `holderId` pertenece a una pieza rival → rival en posesión.
4. **Dónde está el rey rival** (pieza con `type === "king"` y `side !== aiSide`). Es el objetivo de todos tus disparos.
5. **Dónde está mi rey** (para evaluar amenazas defensivas).
6. **Qué piezas ya se han movido este turno** (`hasMovedThisTurn: true`). Éstas ya no pueden volver a moverse hasta el próximo turno, aunque sí pueden pasar el balón si lo tienen.
7. **Restricciones de áreas**:
   - El rey SOLO se mueve dentro de su propia área (5×2).
   - Tus piezas no-rey NO pueden entrar en tu propia área.
   - Puedes entrar libremente en el área rival, excepto a la casilla exacta del rey rival (intocable por movimiento).
8. **Formato de IDs**: `{side}_{type}_{initialX}_{initialY}`. **El ID usa la posición INICIAL, no la actual.** Un caballo blanco que empezó en `{2,4}` y ahora está en `{5,7}` sigue teniendo el ID `white_knight_2_4`. No reconstruyas IDs a partir de la posición actual — léelos siempre del `boardState.pieces[].id`.
9. **Marcador y final de partida**: lee `boardState.score` para adaptar tu riesgo (si ganas, protege; si pierdes, arriesga). **No hay empates.** El **objetivo de goles** de la partida (1–10) NO está en `BoardState`: tu script no puede leer cuántos goles quedan, así que limítate a jugar cada turno para marcar y no encajar.

---

## 4. Cómo calcular movimientos válidos (algoritmo por pieza)

Implementa una función auxiliar `getValidMoves(piece, boardState, aiSide): Position[]` que devuelva las casillas legales de destino. Reglas comunes a toda pieza:

- El destino debe estar dentro del tablero: `x ∈ [0..8]`, `y ∈ [0..11]`.
- No puedes moverte a una casilla con pieza propia.
- Puedes moverte a una casilla con pieza rival SOLO si esa pieza tiene el balón (tackle). **Nunca** al rey rival.
- Las piezas no-rey no pueden aterrizar en tu propia área.
- El rey solo puede aterrizar en tu propia área.

Reglas por pieza:

| Pieza    | Patrón                                        | ¿Salta? | Alcance    |
|----------|-----------------------------------------------|---------|------------|
| King     | 1 casilla en 8 direcciones                    | No      | Dentro del área propia únicamente |
| Queen    | 8 direcciones (horizontal, vertical, diagonal)| No      | Ilimitado hasta encontrar bloqueo |
| Rook     | 4 direcciones (horizontal, vertical)          | No      | Ilimitado hasta encontrar bloqueo |
| Bishop   | 4 direcciones (diagonal)                      | No      | Ilimitado hasta encontrar bloqueo |
| Knight   | 8 destinos en L (±2,±1) y (±1,±2)             | **Sí**  | Solo la casilla exacta en L       |

Para las piezas lineales (Queen, Rook, Bishop, King), avanza casilla a casilla en cada dirección parando al encontrar cualquier pieza. Si la pieza encontrada es rival con balón y NO es el rey, esa casilla es un tackle válido (y ahí se para la dirección).

### ⚠️ Los MOVES se bloquean; los PASSES no — no mezcles las dos lógicas

**Éste es el error de generación de movimientos nº 1 medido en simulaciones** (cientos de moves descartados por partida en los scripts que lo cometen): calcular destinos de movimiento "geométricamente" (cualquier casilla en el rayo correcto) sin comprobar que TODAS las casillas intermedias están vacías. Un move lineal se detiene en la primera pieza del camino, **incluidas las tuyas**. Es exactamente lo contrario que los pases (que sobrevuelan a tus piezas). Si reutilizas tu generador de pases para los moves, producirás acciones ilegales sistemáticamente — y como se descartan en silencio, tu IA se quedará clavada repitiendo el mismo move ilegal turno tras turno.

**Condición extra del tackle**: el portador desplazado necesita una casilla ORTOGONAL libre a la que ser empujado. Si sus 4 ortogonales están ocupadas, el tackle es ilegal (el motor no lo incluirá en los movimientos válidos). Matiz: la casilla que tu pieza deja vacía al tacklear cuenta como libre — un atacante ortogonalmente adyacente al portador siempre puede tacklear.

---

## 4b. Cómo calcular pases válidos — los compañeros SÍ son destino

Implementa `getValidPasses(piece, boardState): Position[]`. Reglas exactas del motor:

- Los destinos siguen el **mismo patrón direccional** que el movimiento de la pieza, pero **sin límite por bloqueo**: para piezas lineales, TODA la semirrecta hasta el borde del tablero es destino válido (el balón vuela sobre las piezas). Para el caballo, los 8 destinos en L. Para el rey, las 8 adyacentes.
- **Las casillas ocupadas por COMPAÑEROS son destinos válidos** — así es exactamente como se pasa el balón a un compañero: el pase aterriza en su casilla y él se convierte en el nuevo portador. **NO las excluyas.** (Error real observado: un script las excluía y toda su lógica de "pasar al caballo" no se ejecutó jamás → 0 goles en miles de turnos.)
- La casilla del rey rival también es destino válido (= disparo a portería). Esto se cumple **incluso si el rey rival es un portero bloqueado** (`keeperBlockedId` rival): el bloqueo solo restringe a SUS compañeros, nunca tus disparos.
- La ÚNICA casilla excluida es la de TU propio rey si `keeperBlockedId` apunta a él (regla del portero bloqueado). El bloqueo se levanta en cuanto un rival toca el balón de cualquier forma: intercepción, tackle, captura de balón suelto o entrega por fuera de juego.
- Que un destino sea *válido* no significa que sea *seguro*: la resolución (intercepción/gol) se evalúa aparte con `isPassSafe` (sección 5).

---

## 5. Cómo verificar un pase seguro — SECCIÓN CRÍTICA

**Este es el error más frecuente y más destructivo.** Un pase interceptado no solo pierde el balón: además termina tu turno inmediatamente, regalándole la posesión al rival en posición ventajosa.

### Regla de oro

**NUNCA** añadas un `pass` al array de acciones sin haber llamado antes a una función `isPassSafe`. Sin excepción.

### Algoritmo de referencia

```typescript
function isPassSafe(
  from: Position,
  to: Position,
  boardState: BoardState,
  aiSide: Side
): boolean {
  // 1. Los pases de caballo nunca se interceptan — solo importa el destino.
  const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!holder) return false // no tenemos el balón, no deberíamos estar pasando
  if (holder.type === 'knight') {
    // Si el destino tiene pieza rival que no sea el rey, ese rival recibe el balón.
    const atDest = boardState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y)
    if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false
    return true
  }

  // 2. Para piezas lineales: recorrer la trayectoria casilla a casilla.
  //    IMPORTANTE: las piezas PROPIAS en la trayectoria NO bloquean nada —
  //    el balón las sobrevuela. Solo importa el PRIMER RIVAL del camino.
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  let cx = from.x + dx
  let cy = from.y + dy
  let steps = 0

  while ((cx !== to.x || cy !== to.y) && steps < 20) {
    const pieceInPath = boardState.pieces.find(p => p.pos.x === cx && p.pos.y === cy)
    if (pieceInPath && pieceInPath.side !== aiSide) {
      // Primer rival en la trayectoria: si es el rey, es GOL (seguro);
      // cualquier otra pieza rival intercepta (no seguro).
      return pieceInPath.type === 'king'
    }
    // Pieza propia: se ignora, el balón vuela sobre ella.
    cx += dx
    cy += dy
    steps++
  }

  // 3. Verificar la casilla de destino.
  //    Compañero en destino = recibe el balón (seguro y deseable).
  //    Rival no-rey en destino = lo recibe él (no seguro). Rey rival = GOL (seguro).
  const atDest = boardState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y)
  if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false

  return true
}
```

### Reglas críticas sobre pases

1. **Nunca dispares a portería si hay piezas rivales en la trayectoria** (salvo el propio rey rival como destino o intermedio permitido). Un disparo con rival intermedio NO es gol: es intercepción y pierdes el turno.
2. **Siempre llama a `isPassSafe` antes de añadir un `pass`.**
3. **Tus propias piezas nunca estorban un pase**: no necesitas "despejar el carril" de compañeros; el balón los sobrevuela. Solo los rivales interceptan.
4. Si un pase no es seguro, busca una alternativa:
   - Pasar a un compañero por otra línea (recuerda: su casilla es destino válido y él recibe el balón).
   - Pasar primero a un caballo y dejar que sea el caballo quien dispare (pase de caballo = inmune a intercepción).
   - Cambiar de plan y usar los AP para reposicionar.
5. **Tras un gol, en el saque, NO intentes un pase largo a portería.** El tablero está en posición inicial y hay piezas rivales bloqueando todos los carriles centrales. Avanza primero.

---

## 5b. Protección del balón — seguridad del destino de pase

**Pasar el balón a un destino expuesto es tan peligroso como una intercepción.** Aunque `isPassSafe` garantice que el balón llega, el destino puede quedar a merced del rival.

### Dos riesgos de destino

1. **Balón suelto en zona rival**: si la casilla de destino está vacía (sin compañero), el balón quedará suelto. Cualquier pieza rival que pueda moverse a esa casilla lo capturará gratis el siguiente turno.
2. **Compañero expuesto a tackle**: si un compañero recibe el pase, el rival puede robárselo inmediatamente si tiene una pieza que alcance esa casilla.

### Algoritmo de referencia

```typescript
function isBallDestinationSafe(
  to: Position,
  boardState: BoardState,
  aiSide: Side
): boolean {
  const opponentSide: Side = aiSide === 'white' ? 'black' : 'white'

  // Simular el estado tras el pase: el balón estará en `to`
  const teammateAtDest = boardState.pieces.find(
    p => p.pos.x === to.x && p.pos.y === to.y && p.side === aiSide
  )
  const simulatedBall = { pos: to, holderId: teammateAtDest ? teammateAtDest.id : null }
  const simulatedState = { ...boardState, ball: simulatedBall }

  const opponentPieces = boardState.pieces.filter(
    p => p.side === opponentSide && p.type !== 'king'
  )
  for (const opp of opponentPieces) {
    // Nota: pasar opp.side (no aiSide) — las restricciones de área son relativas al lado de la pieza
    const oppMoves = getValidMoves(opp, simulatedState, opp.side)
    if (oppMoves.some(m => m.x === to.x && m.y === to.y)) {
      return false // rival puede llegar: balón en peligro
    }
  }
  return true
}
```

### Cuándo aplicarlo

- Antes de pasar a cualquier casilla vacía: llama a `isBallDestinationSafe`.
- Si no es seguro, busca un compañero en posición protegida, conduce primero para acercarte más, o usa un caballo para el pase final (un caballo con el balón en buena posición vale más que un balón suelto en zona peligrosa).
- En posición de saque (tras gol): **nunca lances el balón a campo abierto** — las piezas rivales están cerca y pueden capturarlo.

---

## 5c. Fuera de juego — nunca termines el turno con el balón en el área rival

**Regla del motor**: si tu turno termina (por agotar AP, por `end_turn` o por fin forzado) con una pieza tuya no-rey **portando el balón dentro del área rival** (`x ∈ [2..6]`, `y ∈ [10..11]` si atacas como blancas; `y ∈ [0..1]` si atacas como negras), es **fuera de juego**: el balón se entrega directamente al **rey defensor**. Sin aviso previo, en el mismo turno.

Es la forma más tonta de regalar la posesión justo cuando ibas a marcar, y los scripts que no la comprueban la cometen decenas de veces por partida.

**OJO: el infractor es quien PORTA el balón al acabar el turno, no la última pieza que moviste.** Error medido: scripts que aparcan una pieza con el balón dentro del área rival y gastan los AP restantes moviendo OTRAS piezas — fuera de juego igualmente, decenas de veces por serie. Dos corolarios:

- No pases el balón a un compañero que está dentro del área rival salvo que ese compañero vaya a chutar ESTE mismo turno.
- La comprobación `endsInOffside` debe mirar al portador en el estado simulado FINAL del plan completo, no solo a la pieza de tu última acción.

### Cómo evitarlo

Después de planificar tu array de acciones, evalúa el **estado simulado final** (sección 2b):

```typescript
function endsInOffside(simState: BoardState, aiSide: Side): boolean {
  const holder = simState.pieces.find(p => p.id === simState.ball.holderId)
  if (!holder || holder.side !== aiSide || holder.type === 'king') return false
  // Área rival respecto a MI lado
  const enemyYMin = aiSide === 'white' ? 10 : 0
  const enemyYMax = aiSide === 'white' ? 11 : 1
  return holder.pos.x >= 2 && holder.pos.x <= 6 &&
         holder.pos.y >= enemyYMin && holder.pos.y <= enemyYMax
}
```

Si `endsInOffside` da `true`, NO entregues ese plan. Opciones, por orden de preferencia:

1. **Chuta**: si estás en el área con el balón, casi seguro tienes línea al rey — compruébalo con `findShotOnGoal`.
2. **Pasa fuera del área** a un compañero o casilla segura (`isBallDestinationSafe`).
3. **Conduce fuera del área** si a la pieza le queda movimiento.
4. Si nada es posible, **no entres al área con el balón este turno**: quédate en el borde (y=9 / y=2) y entra el turno siguiente con AP suficientes para entrar + chutar.

**Patrón correcto**: entrar al área (o a distancia de tiro) y chutar EN EL MISMO TURNO. Entrar al área "para preparar" y terminar el turno ahí es siempre un error.

---

## 6. Cómo detectar una oportunidad de gol

Un disparo a portería es un `pass` cuyo destino es la casilla del rey rival (o, en piezas lineales, un `to` que esté más allá del rey en la misma línea: el balón se para en el rey y es gol).

### Algoritmo recomendado

```typescript
function findShotOnGoal(
  boardState: BoardState,
  aiSide: Side
): { pieceId: string; to: Position } | null {
  const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!holder || holder.side !== aiSide) return null

  const rivalKing = boardState.pieces.find(
    p => p.type === 'king' && p.side !== aiSide
  )
  if (!rivalKing) return null

  // Generar TODAS las casillas de pase posibles desde la posición del holder
  // (según su patrón de movimiento — nota: los pases siguen el mismo patrón que los movimientos).
  const passTargets = getValidPasses(holder, boardState)

  for (const target of passTargets) {
    // Caso 1: el destino exacto es el rey rival (válido para cualquier pieza, incluido caballo).
    if (target.x === rivalKing.pos.x && target.y === rivalKing.pos.y) {
      if (isPassSafe(holder.pos, target, boardState, aiSide)) {
        return { pieceId: holder.id, to: target }
      }
    }

    // Caso 2 (solo piezas lineales): el rey está en la trayectoria antes del destino.
    // Esto se detecta porque isPassSafe devolverá true tras encontrar al rey en el camino,
    // siempre que no haya otro rival antes. Comprobar que el rey esté efectivamente entre from y to.
    if (holder.type !== 'knight' && isOnLineBetween(holder.pos, target, rivalKing.pos)) {
      if (isPassSafe(holder.pos, target, boardState, aiSide)) {
        return { pieceId: holder.id, to: target }
      }
    }
  }

  return null
}
```

**Si `findShotOnGoal` devuelve algo, dispáralo YA.** Es la acción con mayor valor esperado del turno.

**Y vuelve a llamarlo después de CADA acción simulada.** El gol casi nunca está disponible al inicio del turno: aparece tras conducir una casilla o tras pasar al caballo. El fallo ofensivo nº 1 medido en simulaciones es exactamente éste: scripts con un gol alcanzable en 2 AP (`conducir → chutar`) que no lo ejecutan porque solo comprobaron el disparo al principio del turno (~60 goles regalados por cada 300 turnos). El patrón correcto es:

```
mientras queden AP en el estado simulado:
  1. ¿findShotOnGoal(simState)? → añade el disparo y termina
  2. ¿puedo conducir/pasar hacia una casilla desde la que findShotOnGoal daría disparo? → hazlo y vuelve a 1
  3. si no hay progresión de gol, sigue con prioridades defensivas/reposicionamiento
```

---

## 6b. Proteger al rey — detectar y bloquear líneas de tiro rivales

El objetivo del juego es disparar al rey. Cuando el rival tiene el balón, puede tener ya una trayectoria limpia hacia tu rey. Detectar y bloquear esta amenaza es **emergencia defensiva de máxima prioridad**.

### Detectar si el rey está en peligro directo

```typescript
function isKingUnderDirectThreat(
  boardState: BoardState,
  aiSide: Side
): boolean {
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide)
  if (!myKing) return false

  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!ballHolder || ballHolder.side === aiSide) return false

  // Llamar isPassSafe desde la perspectiva del rival:
  // si devuelve true, el rival tiene disparo limpio al rey → amenaza real.
  return isPassSafe(ballHolder.pos, myKing.pos, boardState, ballHolder.side)
}
```

### La amenaza real es "mover + chutar" — mira un ply más allá

`isKingUnderDirectThreat` solo detecta el disparo desde la casilla ACTUAL del portador. Pero el rival tiene varios AP: su patrón de gol habitual es **mover el portador a una casilla con línea limpia y chutar en el mismo turno**. Si solo defiendes el disparo directo, llegarás siempre un turno tarde — éste es el motivo nº 1 por el que las IAs "no defienden al rey". (Medido: incluso el mejor script evaluado terminó ~50 de cada 300 turnos dejando al rival un gol de mover+chutar disponible; los débiles, ~70. Cada uno de esos turnos es un gol potencial en contra.)

```typescript
/** Casillas desde las que el portador rival podría chutar a mi rey tras UN movimiento. */
function findIncomingShotSquares(boardState: BoardState, aiSide: Side): Position[] {
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide)
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!myKing || !ballHolder || ballHolder.side === aiSide) return []
  if (ballHolder.hasMovedThisTurn) return [] // entre turnos siempre es false; útil si simulas

  const threats: Position[] = []
  for (const dest of getValidMoves(ballHolder, boardState, ballHolder.side)) {
    // Simular: portador (con balón) en dest
    const simPieces = boardState.pieces.map(p =>
      p.id === ballHolder.id ? { ...p, pos: dest } : p
    )
    const simState = { ...boardState, pieces: simPieces, ball: { pos: dest, holderId: ballHolder.id } }
    if (isPassSafe(dest, myKing.pos, simState, ballHolder.side)) threats.push(dest)
  }
  return threats
}
```

Si `findIncomingShotSquares` no está vacío, trata la situación como amenaza igual que el disparo directo: **prioridad tackle** (elimina al portador), después **bloquear/ocupar** las casillas de tiro o los carriles que habilitan, y como último recurso **mover el rey** a una casilla del área fuera de las líneas detectadas. Con un solo AP defensivo, cubre la línea hacia la posición actual del rey (la más probable).

### Bloquear la línea de tiro

Si el rey está amenazado por una pieza lineal (reina, torre, alfil), interpón una pieza propia en la trayectoria.

```typescript
function findDefensiveBlock(
  boardState: BoardState,
  aiSide: Side
): { pieceId: string; to: Position } | null {
  if (!isKingUnderDirectThreat(boardState, aiSide)) return null

  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide)!
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)!

  // Los caballos no pueden bloquearse (su pase salta todo). Si el rival tiene caballo
  // con disparo al rey: intenta el tackle (sección 6c) o mueve el rey dentro del área.
  if (ballHolder.type === 'knight') return null

  // Calcular la trayectoria entre el portador y el rey (sin incluir ninguno de los dos extremos)
  const dx = Math.sign(myKing.pos.x - ballHolder.pos.x)
  const dy = Math.sign(myKing.pos.y - ballHolder.pos.y)
  const path: Position[] = []
  let cx = ballHolder.pos.x + dx
  let cy = ballHolder.pos.y + dy
  while ((cx !== myKing.pos.x || cy !== myKing.pos.y) && path.length < 20) {
    path.push({ x: cx, y: cy })
    cx += dx
    cy += dy
  }

  const myPieces = boardState.pieces.filter(
    p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn
  )
  for (const blockSquare of path) {
    for (const myPiece of myPieces) {
      const validMoves = getValidMoves(myPiece, boardState, myPiece.side)
      if (validMoves.some(m => m.x === blockSquare.x && m.y === blockSquare.y)) {
        return { pieceId: myPiece.id, to: blockSquare }
      }
    }
  }
  return null
}
```

### Amenaza de caballo rival (la más peligrosa)

El pase de caballo **no puede bloquearse**. Si el rival tiene un caballo con el balón a distancia de L del rey:
- **Prioridad 1**: intenta tacklear al caballo antes de que pase (ver sección 6c).
- **Prioridad 2**: si no puedes tacklear, mueve el rey a otra casilla del área para salir del ángulo de tiro.

---

## 6c. Robar el balón — tackle prioritario

Cuando el rival tiene posesión, el **tackle** es la acción más rentable: obtienes el balón, desplazas al rival y mantienes el turno con posesión. Priorízalo sobre cualquier reposicionamiento.

### Condiciones del tackle

- Tu pieza puede moverse al cuadrado exacto donde está el portador rival.
- El portador rival **no es el rey** (intocable).
- Tu pieza no ha movido este turno (`hasMovedThisTurn: false`).

### Algoritmo de referencia

```typescript
function findBestTackle(
  boardState: BoardState,
  aiSide: Side
): { pieceId: string; to: Position } | null {
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!ballHolder || ballHolder.side === aiSide || ballHolder.type === 'king') return null

  const opponentKingY = aiSide === 'white' ? 10 : 1
  const candidates: Array<{ pieceId: string; to: Position; dist: number }> = []

  const myPieces = boardState.pieces.filter(
    p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn
  )
  for (const myPiece of myPieces) {
    const validMoves = getValidMoves(myPiece, boardState, myPiece.side)
    if (validMoves.some(m => m.x === ballHolder.pos.x && m.y === ballHolder.pos.y)) {
      const dist = Math.abs(myPiece.pos.y - opponentKingY)
      candidates.push({ pieceId: myPiece.id, to: ballHolder.pos, dist })
    }
  }

  if (candidates.length === 0) return null
  // Preferir la pieza más avanzada hacia el área rival (mejor para el contra-ataque)
  candidates.sort((a, b) => a.dist - b.dist)
  return { pieceId: candidates[0].pieceId, to: candidates[0].to }
}
```

### Después del tackle

El tackle consume 1 AP. Inmediatamente después, comprueba `findShotOnGoal`: la pieza que robó el balón puede pasar en el mismo turno (2 AP total). Si hay disparo limpio al rey rival tras el tackle, ¡ejecútalo en el mismo turno!

---

## 6d. Balón suelto — carrera por la posesión

Si `boardState.ball.holderId === null`, el balón está suelto en `boardState.ball.pos` y **quien llegue primero se lo queda**. Recuperarlo es prioridad máxima después del gol inmediato: una posesión gratis vale más que cualquier reposicionamiento.

### Cómo se captura (reglas del motor)

- **Pieza lineal (reina, torre, alfil, rey)**: captura el balón si su movimiento **pasa por encima** de la casilla del balón O termina en ella. El balón viaja con la pieza hasta su destino. Esto hace a las piezas lineales excelentes recuperadoras: no necesitan terminar en la casilla exacta, solo cruzarla.
- **Caballo**: solo captura si **aterriza exactamente** en la casilla del balón (su salto no "pasa por" casillas).

```typescript
function findLooseBallCapture(
  boardState: BoardState,
  aiSide: Side
): { pieceId: string; to: Position } | null {
  if (boardState.ball.holderId !== null) return null
  const ballPos = boardState.ball.pos

  const myPieces = boardState.pieces.filter(
    p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn
  )
  for (const piece of myPieces) {
    for (const dest of getValidMoves(piece, boardState, piece.side)) {
      if (piece.type === 'knight') {
        if (dest.x === ballPos.x && dest.y === ballPos.y) {
          return { pieceId: piece.id, to: dest }
        }
      } else if (isOnLineBetween(piece.pos, dest, ballPos) ||
                 (dest.x === ballPos.x && dest.y === ballPos.y)) {
        // Preferible: un destino que capture Y deje a la pieza bien colocada.
        return { pieceId: piece.id, to: dest }
      }
    }
  }
  return null
}
```

Refinamiento recomendado: entre los destinos que capturan, elige el que deje a la pieza **más cerca del área rival** o con disparo inmediato (`findShotOnGoal` sobre el estado simulado). Si NINGUNA pieza tuya puede capturarlo este turno pero el rival sí el suyo, usa los AP en acercar piezas al balón y en proteger a tu rey.

**Dato de simulación**: TODOS los scripts evaluados, incluido el mejor, dejaron sin disputar entre el 10% y el 50% de los balones sueltos capturables de sus turnos. Es la mayor fuente de posesión gratis del juego y el punto más barato donde superar a los scripts existentes: comprueba `ball.holderId === null` al inicio de CADA turno, antes de cualquier reposicionamiento, y recuerda que a las piezas lineales les basta con CRUZAR la casilla del balón.

---

## 7. Economía de Puntos de Acción — USA TODOS LOS AP

**Terminar el turno antes de agotar los AP es un error grave.** Cada AP desperdiciado es una oportunidad perdida de avanzar, reposicionarse o presionar. `end_turn` solo debería aparecer en tu array cuando de verdad no hay ninguna acción útil disponible. (Medido en simulaciones: los scripts débiles desperdician más de 4 AP por turno; los decentes, menos de 1.)

**Única excepción (medida en simulaciones)**: si TIENES el balón y ninguna acción restante mejora tu posición, terminar antes **conservando la posesión** es preferible a barajar el balón hacia una casilla donde te lo puedan robar. "Usa todos los AP" significa gastarlos en acciones **útiles**, no moverte por moverte: mantener el balón en una casilla segura vale más que un reposicionamiento que lo expone. Esto evita además el *stalemate de barajar* en el que caían los scripts antiguos.

El presupuesto es `boardState.actionPoints` (configurable 1–5 por partida, vía `maxActionPoints`). Planifica exactamente hasta agotarlo, descontando 1 por acción sobre tu estado simulado (sección 2b).

### Reglas sobre el uso de AP

1. **Nunca incluyas `end_turn` en la segunda o tercera posición si aún tienes piezas que pueden hacer algo útil.** Recorre tus piezas y busca movimientos con valor positivo antes de rendirte.
2. **Con el balón**: encadena movimiento + pase en el mismo turno para ganar terreno. Con 5 AP caben, por ejemplo, 2 movimientos + 2 pases + 1 movimiento extra.
3. **Sin el balón**: usa los AP para reposicionar (cubrir carriles de disparo rival, acercar una pieza para un posible tackle, bloquear líneas al rey propio).
4. **Criterio para incluir `end_turn`**: (a) no tienes posesión y no encuentras reposicionamientos útiles, o (b) tienes el balón pero toda acción disponible empeora tu posición (p. ej. la única forma de "usar" un AP sería meterte en fuera de juego, exponer al portador a un tackle o regalar el balón) — en ese caso, termina **conservando la posesión**.

### Ejemplos de arrays bien dimensionados

Con balón, buscando gol:
```
[move_avanzar_con_balon, pass_a_caballo_adelantado, move_queen_a_angulo, pass_disparo_al_rey, end_turn]
```

Sin balón, presionando:
```
[move_pieza_hacia_balon, move_otra_pieza_a_linea_de_pase, move_queen_a_interceptar, end_turn]
```

**INCORRECTO** (desperdicio flagrante):
```
[move_una_pieza, end_turn]  // ← te quedan 4 AP sin usar, seguro que había algo mejor
```

---

## 8. Estrategia recomendada

Tu IA debe implementar una estrategia coherente que materialice la idea básica del juego ("piensa como ajedrez, juega al fútbol"):

- **Juego de equipo**: en cada turno, evalúa TODAS tus piezas, no solo la que tiene el balón. Las que no participan en la jugada deben estar sumándose al ataque o cubriendo a tu rey — nunca paradas "porque no les toca".
- **Visión de tablero completa**: antes de decidir, calcula adónde puede llegar cada pieza rival (sus `getValidMoves` y sus líneas de pase). Un plan que ignora el alcance del rival regala intercepciones, tackles y goles.
- **Anticipación**: no evalúes solo el estado actual; evalúa el estado en que DEJAS el tablero al terminar tu turno. ¿Qué podrá hacer el rival con sus AP? ¿Le has dejado el balón alcanzable, un carril limpio a tu rey, a tu portador expuesto a tackle?

Estos son los pilares:

### Orden de prioridades en cada turno

0. **¿`kingMustRelease === aiSide`?** Pasa el balón con el rey **antes de cualquier otra cosa**. No esperes al último AP: si el turno termina con el rey aún en posesión, el siguiente turno perderás el último AP en una liberación automática.
1. **¿Puedo marcar gol ESTE turno?** Llama a `findShotOnGoal` — y no solo desde la posición actual: tras CADA acción simulada (mover el portador, pasar a un compañero), vuelve a comprobarlo. La mayoría de los goles son `mover/pasar → chutar` encadenados en el mismo turno.
2. **¿Balón suelto?** (`ball.holderId === null`) → `findLooseBallCapture`. Quien llega primero se queda la posesión.
3. **¿El rival amenaza gol?** Llama a `isKingUnderDirectThreat` Y a `findIncomingShotSquares` (amenaza de mover+chutar). Si hay amenaza:
   - ¿Puedo tacklear al portador? → `findBestTackle` (elimina la amenaza y ganas posesión).
   - Si no, ¿puedo bloquear la línea? → `findDefensiveBlock` (o interponerme en los carriles detectados por `findIncomingShotSquares`).
   - Si el rival tiene un caballo con disparo al rey y no puedo tacklear → mueve el rey dentro del área.
4. **¿Tengo el balón?**
   - Sí → avanza **de forma segura**: llama a `isBallDestinationSafe` antes de cada pase a casilla vacía. Prioriza que el balón acabe en un caballo (sus pases no se interceptan). Evita dejar el balón suelto donde el rival llega primero. Y antes de cerrar el plan, comprueba `endsInOffside` (sección 5c).
   - No → llama a `findBestTackle`. Si no hay tackle posible, acerca piezas al portador rival o a zonas de intercepción.
5. **Reposicionamiento**: aprovecha los AP sobrantes para mejorar tu estructura (caballos cerca del área rival, reina en zona central, alfiles y torres cubriendo diagonales y columnas clave). Recalcula cada movimiento sobre el estado simulado para no generar acciones inválidas.

### Roles por pieza

- **Rey**: portero. Manténlo centrado en el área (`x=4`) para minimizar ángulos de tiro. Solo muévelo si hay amenaza inminente o si puedes despejar conduciendo el balón fuera del área.
- **Reina**: mediocampista universal. Por su alcance, es la mejor para crear líneas largas de pase y para disparar desde lejos. **Pero** sus pases sí se interceptan: úsala con carriles limpios.
- **Torres**: defensores laterales e interceptoras de columnas/filas. Buenas para bloquear disparos verticales contra tu rey.
- **Alfiles**: interceptores de diagonales. Importantes para cerrar tiros diagonales al rey.
- **Caballos**: tus delanteros estrella. Sus pases saltan TODO y no se interceptan. Un caballo a distancia de L del rey rival y con el balón = gol casi garantizado. Prioriza llevarlos hacia el ataque.

### Protección del balón

- **Antes de cada pase a casilla vacía**: llama a `isBallDestinationSafe` — el balón suelto en zona peligrosa es un regalo al rival.
- **Al conducir**: no muevas el portador a casillas donde el rival puede tacklearlo inmediatamente.
- **Nunca termines el turno con tu portador en una casilla tackleable.** Perder la posesión barata es como se pierde: el rival la trabaja hasta el gol en los turnos siguientes. Sobre tu estado simulado final, comprueba que ninguna pieza rival alcanza la casilla de tu portador.
- **Preferir pasar a un compañero** sobre dejar el balón suelto. Un caballo en buena posición con el balón vale más que un disparo arriesgado con la reina que deja el balón expuesto si se intercepta.
- **En saque (tras gol)**: la densidad inicial de piezas hace casi imposibles los pases largos. Avanza lateralmente o desarrolla un caballo antes de buscar disparo.

### Consejos tácticos

- No muevas el rey sin motivo: cada movimiento del rey es un AP mal gastado si no estás ni defendiendo ni conduciendo.
- **Quédate en casa cuando NO tienes el balón.** No dejes torres ni alfiles aparcados en el tercio de ataque mientras el rival camina el balón hacia tu portería: sin posesión, tus piezas deben cubrir los carriles hacia tu rey y preparar el robo, no merodear arriba. (Hallazgo medido: scripts que perdían por dejar piezas adelantadas sin balón mientras el rival progresaba hacia su rey.)
- Recuerda que las piezas rivales pueden entrar en TU área: anticipa y bloquea antes de que tengan línea de tiro.
- Tras conceder un gol, tú sacas con la reina al centro. Avanza lateralmente o desarrolla un caballo antes de buscar disparo.
- Entra en el área rival con el balón SOLO si vas a chutar este mismo turno (regla de fuera de juego, sección 5c).
- El gol típico se construye en un solo turno: pase al caballo → el caballo se coloca a distancia de L → disparo inintenceptable. Ten siempre un caballo adelantado y carriles hacia él.

---

## 8b. No seas predecible — el rival no debe poder memorizarte

El defecto nº 1 de los scripts antiguos era el **determinismo**: ante el tablero idéntico hacían SIEMPRE el movimiento idéntico. Un humano descubría una línea ganadora y la repetía partida tras partida. Tu IA debe **sorprender**: probar opciones distintas, con criterio, para que cada partida se sienta nueva y el rival tenga que entender el juego de verdad.

### Cómo introducir variedad SIN debilitarte

1. **Puntúa, no priorices a ciegas.** En vez de "si A, haz X; si no, haz Y", asigna a cada plan candidato una puntuación (ver 8c) y elige entre los **mejores** con algo de azar — no siempre el primero.
2. **Selección por _softmax_ con temperatura.** Elige el plan `i` con probabilidad ∝ `exp(score_i / T)`. Con `T→0` juegas casi siempre el mejor (fuerte y poco variado); con `T` mayor exploras más (más variado y algo más débil). Usa una **`T` baja**: la justa para no ser memorizable, nunca tan alta que reparta probabilidad a jugadas peores.
3. **RNG sembrado.** Usa un generador pseudoaleatorio **sembrado desde el propio tablero** (p. ej. un hash de las posiciones ^ un contador de jugada). Así eres **variado en partida** (posiciones distintas → decisiones distintas; y la misma posición no siempre se resuelve igual) pero **reproducible** cuando el harness fija la semilla. No dependas de `Date.now()` para la lógica.
4. **El azar SOLO entre buenas jugadas.** Nunca aleatorices hacia jugadas ilegales o que cuelguen un gol/balón. Filtra primero (legal + sin blunder), luego desempata/elige con azar.
5. **Rompe los empates con azar, no por orden de iteración.** Si varias jugadas puntúan casi igual, elige una al azar (sembrado). El sesgo "siempre la primera pieza del array" es lo que producía los saques calcados tras cada gol.

```ts
// Patrón de selección no-determinista (esqueleto)
function mulberry32(seed: number) { /* PRNG sembrado, 0..1 */ }
const rng = mulberry32(hashBoard(boardState) ^ instanceSeed ^ moveCounter)
const legal = plans.filter(p => p.legal && !p.hangsGoal)   // 1) filtra blunders
const maxS = Math.max(...legal.map(p => p.score))
const w = legal.map(p => Math.exp((p.score - maxS) / T))   // 2) softmax estable
// 3) muestrea un plan según w usando rng()  → variedad con criterio
```

---

## 8c. Arquitectura recomendada: un rival fuerte y no predecible (search + evaluación)

El objetivo es **un único jugador a máxima fuerza** (no hay niveles que elegir ni audiencia que perfilar). La forma robusta de conseguirlo es UN núcleo de **búsqueda + función de evaluación** con selección no-determinista por encima.

### Arquitectura de referencia

1. **Función de evaluación** `evaluate(board, side) → number` que puntúe cualquier tablero: diferencia de goles (dominante), posesión, avance del balón hacia el rey rival, carriles de tiro propios (+) y rivales (−), seguridad del rey, carrera por el balón suelto, no acaparar el balón con el rey, no dejar piezas fuera de posición al defender.
2. **Búsqueda del turno completo** (hasta 5 AP). Explora secuencias de acciones (un *beam* de las mejores N por profundidad) y quédate con el **mejor plan completo** (terminar antes es siempre una opción). Puntúa el plan simulando el fin de turno y evaluando lo que le dejas al rival — así el fuera de juego y los regalos defensivos se penalizan solos.
3. **Buscador de combos de gol** explícito: busca directamente `mover→chutar` y `pasar→chutar` que fuercen gol este turno (la búsqueda tiende a podar el movimiento de preparación porque por sí solo no sube la evaluación).
4. **Filtro anti-blunder**: penaliza con dureza dejar al rival un gol inmediato, un combo de gol en una jugada, o tu portador expuesto a tackle.
5. **Selección no-determinista** (sección 8b) **por encima de todo**: softmax con **temperatura baja** sobre los planes ya filtrados (legales + sin blunder). Baja, no cero: varía solo entre las jugadas casi-óptimas, **nunca** hacia una peor. Sin errores deliberados.

**Ajustes objetivo (máxima fuerza):** beam ancho (~10), profundidad = todos los AP disponibles, combos de gol activados, defensa completa (anticipa combos y tackles del rival) y temperatura mínima. Un rival fuerte no necesita "trucos": basta búsqueda profunda + buena evaluación + temperatura mínima.

> Implementación de referencia completa y herramienta de medición (harness, métricas) en el repo `chess-football-engine`, carpeta `scripts/self-play/` (`ai-engine.ts`, `harness.ts`, `ladder.ts`, `benchmark.ts`) y el documento `AI_AUTHORING_PROMPT.md`. Úsalos para verificar dos cosas: que **gana o compite** con los 4 scripts existentes y que es **medible-mente menos predecible** (misma posición → secuencias distintas entre partidas).

---

## 9. Robustez, pureza y manejo de errores

La función `play` se ejecuta en servidor dentro de una sandbox. Reglas innegociables:

- **Sin APIs del navegador**: nada de `window`, `document`, `fetch`, `localStorage`, `alert`, `console` está OK pero no lo abuses.
- **Sin dependencias externas**: solo TypeScript/JavaScript puro. No `import`s de librerías.
- **Sin efectos secundarios sobre la entrada**: no mutes `boardState`. Trabaja siempre con copias o con lecturas. (Sí puedes tener un PRNG sembrado y un pequeño contador de jugada privado para la variedad de la sección 8b — eso no es un efecto secundario sobre el estado del juego.)
- **Variedad obligatoria, no caos**: el azar (sembrado) solo decide ENTRE jugadas ya filtradas como legales y sin blunder. Nunca aleatorices hacia algo ilegal o que cuelgue un gol/balón.
- **Presupuesto de cómputo**: una búsqueda completa de los 5 AP es viable y deseable; el núcleo de referencia tarda ~20–40 ms por turno. No te conformes con una IA reactiva por miedo a la latencia — sé fuerte.
- **Reproducibilidad**: el harness puede fijar la semilla, así que con la misma semilla y el mismo tablero debes devolver el **mismo** plan (no uses `Date.now()` ni nada no determinista en la lógica). En juego la semilla cambia → variedad real.
- **Sin infinitos**: cualquier bucle `while` debe tener una cota clara (el tablero es 9×12, nada dura más de 108 iteraciones).
- **Sin lanzar excepciones**: envuelve la lógica en un `try/catch` de seguridad y, si algo falla, devuelve al menos `[{ type: 'end_turn' }]`. **Nunca devuelvas `undefined` ni dejes que la función tire.**
- **Valida siempre antes de añadir una acción, y hazlo contra tu ESTADO SIMULADO** (sección 2b), no contra el `boardState` original:
  - ¿La pieza existe en `boardState.pieces` y es de `aiSide`?
  - ¿El destino está dentro del tablero?
  - Para `move`: ¿`hasMovedThisTurn` es `false` *en el estado simulado*? ¿el destino está en `getValidMoves` *del estado simulado*?
  - Para `pass`: ¿esa pieza tiene el balón *en el estado simulado* (`holderId === piece.id`)? ¿`isPassSafe` devuelve `true` (o es un gol intencionado)?
  - Para el plan completo: ¿`endsInOffside(estadoFinalSimulado)` es `false`?

### Esqueleto seguro

```typescript
play: (boardState, aiSide) => {
  try {
    const actions: AIAction[] = []
    // ... tu lógica ...
    if (actions.length === 0) actions.push({ type: 'end_turn' })
    return actions
  } catch (e) {
    return [{ type: 'end_turn' }]
  }
}
```

---

## 10. Formato de salida exigido

Devuelve **un único bloque de código TypeScript** con el archivo completo. No añadas explicaciones largas antes ni después: un párrafo breve (2-3 frases) describiendo tu estrategia está bien, pero el grueso de la respuesta debe ser el código.

El archivo debe seguir **exactamente** esta estructura:

```typescript
import { BoardState, Side, Position, Piece } from '../types/game'

interface AIAction {
  type: 'move' | 'pass' | 'end_turn'
  pieceId?: string
  to?: Position
}

interface AIPlayerScript {
  name: string
  description: string
  avatar: string
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  badgeName: string
  badgeIcon: string
  play: (boardState: BoardState, aiSide: Side) => AIAction[]
}

// ============================================
// Funciones auxiliares internas
// ============================================

// getValidMoves, getValidPasses, isPassSafe, isBallDestinationSafe,
// findShotOnGoal, findBestTackle, findLooseBallCapture, findIncomingShotSquares,
// endsInOffside, helpers de simulación (applySimMove/applySimPass), etc.
// Todas deben ser funciones puras.

// ============================================
// Export del jugador IA
// ============================================

export const aiPlayer: AIPlayerScript = {
  name: "...",
  description: "...",
  avatar: "...",
  difficulty: "...",
  badgeName: "...",
  badgeIcon: "...",
  play: (boardState: BoardState, aiSide: Side): AIAction[] => {
    try {
      const actions: AIAction[] = []
      // Tu lógica decidiendo acciones en orden.
      if (actions.length === 0) actions.push({ type: 'end_turn' })
      return actions
    } catch {
      return [{ type: 'end_turn' }]
    }
  }
}
```

---

## 11. Checklist final antes de entregar el código

Antes de dar por buena tu respuesta, verifica MENTALMENTE que tu script cumple cada punto:

- [ ] El archivo importa desde `../types/game` y no tiene otros `import`s externos.
- [ ] El objeto exportado se llama exactamente `aiPlayer` y es del tipo `AIPlayerScript`.
- [ ] Los 6 metadatos están definidos y `description` / `badgeName` están en español.
- [ ] La función `play` envuelve toda su lógica en un `try/catch` y nunca devuelve `undefined`.
- [ ] La función `play` siempre devuelve un array con al menos una acción (aunque sea `end_turn`).
- [ ] **Mantengo un estado simulado y planifico cada acción contra él**, replicando moves (conducción, tackle, captura en trayectoria) y passes (recepción de compañero, balón suelto, intercepción).
- [ ] Mi `getValidMoves` implementa el BLOQUEO: los moves lineales se detienen en la primera pieza del camino (propia o rival). No reutilizo la lógica de pases (que sobrevuelan) para generar moves.
- [ ] Recalculo movimientos y pases desde la posición de la pieza en el estado SIMULADO, nunca desde su posición al inicio del turno.
- [ ] Valido cada acción contra mi estado simulado antes de incluirla en el array; si no pasa, busco alternativa — nunca entrego una acción que sé que será descartada, ni reintento la misma acción ilegal turno tras turno.
- [ ] Mi `getValidPasses` INCLUYE las casillas de compañeros como destino (así se pasa el balón) y solo excluye al portero bloqueado.
- [ ] Mi `isPassSafe` IGNORA mis propias piezas en la trayectoria (el balón las sobrevuela); solo el primer rival cuenta.
- [ ] Tengo una función `isPassSafe` y la llamo antes de CADA `pass`, sin excepción.
- [ ] Llamo a `isBallDestinationSafe` antes de pasar a cualquier casilla vacía.
- [ ] Compruebo `endsInOffside` sobre el estado final simulado mirando al PORTADOR final (sea cual sea la pieza, no solo la última movida): nunca termino el turno con un no-rey portando el balón dentro del área rival, ni paso el balón a un compañero dentro del área salvo que chute este turno.
- [ ] Re-evalúo `findShotOnGoal` tras CADA acción simulada (conducir → chutar, pasar → chutar): el gol casi nunca está disponible al inicio del turno.
- [ ] Si el balón está suelto, intento capturarlo (`findLooseBallCapture`) antes que cualquier reposicionamiento.
- [ ] Detecto disparos a portería y los priorizo sobre cualquier otra acción, re-evaluando tras cada acción simulada (mover → chutar, pasar → chutar).
- [ ] Cuando el rival tiene el balón, llamo a `isKingUnderDirectThreat` Y a `findIncomingShotSquares` (amenaza de mover+chutar) y actúo en consecuencia (tackle o bloqueo).
- [ ] Cuando el rival tiene el balón y puedo tacklear, priorizo el tackle sobre el reposicionamiento.
- [ ] Si el rival tiene un caballo con disparo al rey y no puedo tacklear, muevo el rey dentro del área.
- [ ] Parametrizo el sentido de ataque según `aiSide` (no hardcodeo "atacar hacia y=11").
- [ ] Uso `boardState.actionPoints` como presupuesto (no asumo 5 fijos) e intento agotarlo con acciones útiles.
- [ ] Respeto `hasMovedThisTurn`: nunca añado dos `move` para la misma pieza en el mismo array.
- [ ] No intento mover piezas no-rey a mi propia área ni el rey fuera de su área.
- [ ] No intento "tacklear" al rey rival (ni a un portador con las 4 ortogonales ocupadas).
- [ ] No genero `end_turn` en la segunda acción si todavía tengo opciones útiles.
- [ ] Leo los `pieceId` del `boardState`; no los reconstruyo desde la posición actual.
- [ ] Mis bucles tienen cota superior clara y no pueden quedarse colgados.
- [ ] **No soy predecible** (sección 8b): no hago el movimiento idéntico en la posición idéntica; en particular el saque tras un gol varía entre partidas. Uso un RNG sembrado desde el tablero y elijo con algo de azar entre las mejores jugadas (nunca hacia ilegales/blunders).
- [ ] **Apunto a máxima fuerza** (sección 8c): búsqueda profunda del turno completo, combos de gol, defensa completa y **sin errores deliberados**; declaro `difficulty: "expert"`. Lo verifico con el harness (`scripts/self-play/`): gana o compite con los 4 scripts y produce secuencias distintas en la misma posición entre partidas.

Si todo está marcado, entrega el código.
