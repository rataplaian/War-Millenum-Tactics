# Architecture — Task 002

## Dependency boundary and folders

`App.tsx → src/ui → src/game`. The simulation imports no React, React Native, Expo, screen dimensions, clocks or implicit random source. The UI sends commands and renders detached snapshots. Tests run in Node without an emulator.

- `src/game/models/`: serializable domain contracts, static definitions, runtime instances, spatial configuration, command results and movement events.
- `src/game/engine/`: instance construction, snapshot integrity validation and GameEngine command service.
- `src/game/rules/movement.ts`: pure normal-movement validation, split into action and endpoint checks.
- `src/game/rules/spatial.ts`: pure coherency and enemy engagement queries.
- `src/game/rules/progression.ts`: deterministic phase/turn transitions.
- `src/game/utils/geometry.ts`: unit conversion, distances, circular footprints and battlefield bounds.
- `src/game/utils/dice.ts`: seeded/injected D6 utilities from Task 001.
- `src/game/data/prototype.ts`: two invented unit definitions, initial positions, a battlefield and centralized spatial configuration.
- `src/ui/coordinates.ts`: reversible screen/world conversion only; no movement rules.
- `src/ui/BattlefieldView.tsx`: top-down circles and destination selection.
- `src/ui/GameScreen.tsx`: debug controls, messages and snapshots.
- `tests/`: engine, dice, geometry, movement, coherency, engagement and coordinate conversion tests.

## Definitions versus runtime state (schema 2)

Task 001 copied definition fields into each Unit. Task 002 deliberately replaces that shape:

- `UnitDefinition` is a deeply readonly catalog entry: name, faction, starting model count, stats, default base, equipment, keywords and ability data.
- `GameState.definitions` holds that catalog once per snapshot, making a match self-contained for local restoration. There is no separate database or fetching layer.
- `Unit` contains only ID, definitionId, playerId, runtime models and action flags. Static characteristics resolve through definitionId, never through a copied `unit.stats` or `unit.name`.
- `Model` owns position, wounds, alive state, its physical base geometry and movementUsed. Base geometry is initialized from the definition's default base, allowing a later per-model footprint without copying the entire unit catalog into runtime instances.
- Armies still reference runtime unit IDs. Dead models remain in their unit, but do not block movement, participate in coherency or engage enemies.

The engine copies loaded state and every returned snapshot. Readonly types protect catalog data at compile time; input/output copying protects the internal catalog at runtime. There is no command to edit catalog characteristics during play.

`schemaVersion` is now **2**. Schema-1 snapshots are rejected explicitly; there was no shipped persistent save format to migrate. The original Task 001 test scenarios are retained, with static-field assertions adapted to catalog lookup. `loadMatch` accepts trusted typed snapshots and checks core identity, geometry, configuration and transaction invariants. It is not a complete parser for hostile/untyped JSON. A full parser and version migrations remain future work.

## Coordinates, battlefield and bases

World positions and distances use floating-point **inches**, with origin (0, 0) at the top-left, positive x right and positive y down. There is no grid, pixel coordinate, height or snapping in the engine. A Battlefield provides configurable width and height. The fixture is 30 × 24 inches; no movement function assumes that size.

A circular base stores `kind: 'circle'` and `diameterMm`. Conversion uses 25.4 mm per inch; radius is derived in inches so diameter and radius cannot drift out of sync. Future hull shapes can extend this discriminated union and the geometry functions.

`centreDistance`/`distanceTravelled` are Euclidean. `edgeDistance` subtracts both radii and clamps the gap to zero. `basesOverlap` checks actual penetration; tangent contact is allowed. `positionInsideBattlefield` checks a point, whereas normal movement uses `baseInsideBattlefield` to require the entire base inside all four edges. EPSILON=1e-9 inches is a centralized numerical comparison tolerance, not a game-rule distance.

## Normal movement transaction

1. `beginMovement(unitId)` requires an in-progress match, Movement phase, an active-player unit with living models, no completed move and no other open transaction. As a conservative prototype policy, engaged units cannot begin a normal move; Fall Back is absent.
2. The engine snapshots all original model positions and movement usage in `GameState.movement`.
3. `previewMove(modelId, target)` returns the same validation as `moveModel`, without changing state or events.
4. `moveModel(modelId, target)` checks ownership through the active unit, alive state, finite coordinates, remaining allowance, full-base bounds, friendly/enemy endpoint collision and enemy engagement distance. A legal command updates only that model's coordinates and cumulative usage, and emits an event.
5. Distance is the sum of accepted straight-line segments, not displacement from the original point. Returning towards the starting point still consumes allowance. Every model has its own allowance from the referenced definition.
6. `completeMovement()` rechecks final placement and whole-unit coherency. On success it marks the unit as moved and closes the transaction. Even completion without displacement consumes the unit's normal movement action.
7. `cancelMovement()` before completion restores positions and usage exactly from the originals, closes the action, and leaves the unit eligible to begin again. It does not erase events; it appends a cancellation event.

Temporary incoherency while repositioning individual models is permitted; endpoint overlap is never permitted. Failed completion leaves the transaction open for correction or cancellation. Cancellation is unit-local, not global undo. A snapshot of an open transaction can be loaded and continued or cancelled deterministically.

`tryNextPhase()` and `tryNextTurn()` return domain results and cannot progress while movement is open. Turn transitions reset per-model usage and unit action flags. Existing `nextPhase()`/`nextTurn()` remain compatibility helpers that throw on a rejected progression; new UI code uses the result APIs.

## Collision and engagement policy

`validateFinalPosition` is an endpoint policy seam separate from allowance/action checks. It scans all living friendly and enemy models, excludes the moving model itself and returns the first blocking model ID in deterministic state order. Initial/loaded live bases must also be in bounds and non-overlapping.

Only final positions are checked. A segment may currently cross a friendly model, enemy model or engagement area when its destination is clear. Add intermediate/path validation before endpoint validation when those rules are implemented. No terrain, swept collision or pathfinding is implied by the current API.

`SpatialRules.engagementDistance` is an inclusive edge-to-edge threshold. `enemyModelsWithinEngagement` returns nearby living enemies; `isUnitEngaged` checks living models in a unit. The prototype also rejects normal-move destinations inside this threshold. These are spatial queries and a normal-move guard only: no charge, Fall Back, melee, reactions or engagement-turn rules exist.

## Configurable coherency

The prototype configuration in `src/game/data/prototype.ts` uses:

- maximum edge gap: 2 inches;
- one required neighbour for living unit sizes 1–5;
- two required neighbours for living unit sizes 6+;
- a connected neighbour graph required;
- engagement distance: 1 inch.

These are **prototype tuning values, not an official rules transcription**. Coherency size bands are ascending minimum model counts and must start at 1. The highest applicable band selects the required neighbour count based on current living size. Single surviving models are automatically coherent. Empty units have no formation to check but cannot begin movement. Thresholds and connectivity are configuration data, not UI or faction conditionals.

The graph uses base edge distances. Each model must have enough neighbours and, when configured, all living models must belong to one connected component. This prevents disconnected pairs from passing merely because each has a local neighbour. Tests cover a line, cluster, isolated model, disconnected groups, size bands and a lone survivor.

## Results, events and determinism

Expected illegal player actions return `{ ok: false, reason, ...details }`, with optional blockingModelId, distance, remaining or failing model IDs. Successful movement returns measured distance, cumulative use and remaining allowance. Rejections do not mutate coordinates, transactions, flags, usage or events. Corrupted loaded state throws before replacement.

Movement events have deterministic sequence, round, turn, player and unit IDs. Types are movement-started, model-moved (from/to/distance/total used), movement-cancelled (restored positions) and movement-completed. They live in the snapshot for a future log/animation/debug layer; there are no timestamps or random IDs. Events are append-only within the current match, including cancelled attempts. This is **not** full event sourcing: no replay executor, phase-event history, disk persistence or log retention policy yet. A future replay must start from an initial snapshot and record any additional action types it needs.

Dice still require an explicit RNG; no movement command uses randomness. Future random battle commands need persisted RNG state or recorded outcomes before promising full replay/resume.

## UI conversion and interaction

`coordinateTransform` uses uniform scaling and letterbox offsets to map inches to view coordinates and back. It does not clamp destinations, calculate allowance or decide legality. Base diameters use the same scale as positions, preserving the world geometry regardless of resolution.

The debug screen distinguishes players by colour and labels, allows friendly unit/model selection, and sends tapped destination coordinates to the engine. It displays legal/rejected feedback, movement usage, COMPLETE MOVE and CANCEL MOVE. Numbered model buttons supplement small circle tap targets. No drag, zoom, polished graphics or real-device verification is claimed.

## Future extensions

Keep new tabletop rules as tested pure functions under rules/ and route mutations through engine commands. Catalogs should remain keyed data; supported ability IDs may later resolve to pure rule handlers. Never hardcode faction characteristics in React components or execute strings from catalog data. No shooting, charges, melee, terrain, vertical movement, Advance, Fall Back, transports, reserves, missions, objectives, AI, multiplayer or backend are included.
