# Architecture — Task 001

## Dependency boundary

`App.tsx → src/ui → src/game`. The simulation imports no React, React Native, Expo, platform APIs, clocks or implicit random sources. The UI owns a GameEngine reference, sends commands and renders detached snapshots. Tests run in Node without a mobile emulator.

## Folders

- `App.tsx`, `index.ts`: Expo registration and safe-area application shell.
- `src/ui/`: minimal start and battle/debug screen; presentation only.
- `src/game/models/`: serializable TypeScript domain contracts, including factions, players, armies, unit definitions/instances, individual models, weapons and match state.
- `src/game/engine/`: unit construction, match validation, snapshot ownership and central service.
- `src/game/rules/`: deterministic state transitions. Current transitions are prototype sequencing, not a complete tabletop rules implementation.
- `src/game/data/`: two explicitly marked technical fixtures with invented statistics. No official datasheets.
- `src/game/utils/`: seeded/injected D6 utilities.
- `tests/`: Node test runner with tsx for TypeScript.
- `docs/`: technical decisions and future extension guidance.

## State and identity

An army references units by ID; GameState.units owns the unit instances, avoiding duplicate mutable copies. Each unit owns its models. IDs are explicit and deterministic. Unit definitions contain base characteristics, keywords, equipment and parameterized ability references; instances add ownership, models and action state.

Positions are continuous x/y coordinates in tabletop inches. Fractional values are retained. No grid, movement legality, collision, base geometry or board bounds exist yet. Dead models remain represented with zero wounds and alive=false.

GameState is JSON-serializable and schemaVersion=1. The service validates core integrity and copies input/output snapshots to protect internal state. loadMatch accepts a trusted typed GameState; it is not an exhaustive parser for hostile/untyped JSON. Add runtime schema validation and version migrations before file imports or external saves. Loading is in-memory only; nothing persists across application restarts.

## Prototype sequencing

Command → Movement → Shooting → Charge → Fight → next player's Command. The first listed player begins. `turn` counts player turns from 1; `round` advances after both players. nextTurn explicitly ends the current turn, even mid-phase. Temporary action flags reset at each turn boundary. Finished matches reject progression. Ending a match, round limits, reactions and phase eligibility are deferred.

## Determinism

The engine uses no randomness currently. Dice require an explicit RNG; the seeded uint32 LCG produces repeatable sequences. Tests assert a known sequence and injected boundary values. Future random commands should receive an explicit RNG and record results/events, or persist the RNG state in GameState before promising replay/resume of random battles.

## Adding rules and data

Add rules as pure functions under rules/, with explicit state/action inputs and tests for legal and illegal actions. Route commands through the engine so the UI never applies wounds, calculates hits or decides legal movement. Add targeted invariants when new mutable state is introduced.

Weapon profiles distinguish melee/ranged and support fixed or dice-based attacks/damage, plus parameterized traits. Ability IDs and parameters are inert data until a rule handler is implemented; do not evaluate strings or execute data as code. Keep faction/unit catalogs separate from UI, keyed by stable IDs; a future registry can resolve supported ability IDs to pure handlers. Avoid faction-name conditionals in components. Heterogeneous model equipment/stats and attachment rules can extend the current homogeneous unit fixture model when needed.

No backend, multiplayer, AI, army builder, combat resolution or full rules database is included.
