# Architecture — Task 004

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

## Definitions versus runtime state

Task 001 copied definition fields into each Unit. Task 002 deliberately replaces that shape:

- `UnitDefinition` is a deeply readonly catalog entry: name, faction, starting model count, stats, default base, equipment, keywords and ability data.
- `GameState.definitions` holds that catalog once per snapshot, making a match self-contained for local restoration. There is no separate database or fetching layer.
- `Unit` contains only ID, definitionId, playerId, runtime models and action flags. Static characteristics resolve through definitionId, never through a copied `unit.stats` or `unit.name`.
- `Model` owns position, wounds, alive state, its physical base geometry and movementUsed. Base geometry is initialized from the definition's default base, allowing a later per-model footprint without copying the entire unit catalog into runtime instances.
- Armies still reference runtime unit IDs. Dead models remain in their unit, but do not block movement, participate in coherency or engage enemies.

The engine copies loaded state and every returned snapshot. Readonly types protect catalog data at compile time; input/output copying protects the internal catalog at runtime. There is no command to edit catalog characteristics during play.

`schemaVersion` is now **3**. Schema-1 and schema-2 snapshots are rejected explicitly; there was no shipped persistent save format to migrate. The original Task 001 test scenarios are retained, with static-field assertions adapted to catalog lookup. `loadMatch` accepts trusted typed snapshots and checks core identity, geometry, configuration and transaction invariants. It is not a complete parser for hostile/untyped JSON. A full parser and version migrations remain future work.

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

`SpatialRules.engagementDistance` is an inclusive edge-to-edge threshold. `enemyModelsWithinEngagement` returns nearby living enemies; `isUnitEngaged` checks living models in a unit. The prototype also rejects normal-move destinations inside this threshold. Task 004 reuses these spatial queries for charge and melee. Fall Back and reaction rules remain absent.

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

GameEvents (including the original movement events) have deterministic sequence, round, turn, player and unit IDs. Types are movement-started, model-moved (from/to/distance/total used), movement-cancelled (restored positions) and movement-completed. They live in the snapshot for a future log/animation/debug layer; there are no timestamps or random IDs. Events are append-only within the current match, including cancelled attempts. This is **not** full event sourcing: no replay executor, phase-event history, disk persistence or log retention policy yet. A future replay must start from an initial snapshot and record any additional action types it needs.

Dice still require an explicit RNG; no movement command uses randomness. Future random battle commands need persisted RNG state or recorded outcomes before promising full replay/resume.

## UI conversion and interaction

`coordinateTransform` uses uniform scaling and letterbox offsets to map inches to view coordinates and back. It does not clamp destinations, calculate allowance or decide legality. Base diameters use the same scale as positions, preserving the world geometry regardless of resolution.

The debug screen distinguishes players by colour and labels, allows friendly unit/model selection, and sends tapped destination coordinates to the engine. It displays legal/rejected feedback, movement usage, COMPLETE MOVE and CANCEL MOVE. Numbered model buttons supplement small circle tap targets. No drag, zoom, polished graphics or real-device verification is claimed.

## Future extensions

Keep new tabletop rules as tested pure functions under rules/ and route mutations through engine commands. Catalogs should remain keyed data; supported ability IDs may later resolve to pure rule handlers. Never hardcode faction characteristics in React components or execute strings from catalog data. No terrain, vertical movement, Advance, Fall Back, transports, reserves, missions, objectives, AI, multiplayer or backend are included.


## Shooting subsystem (Task 003)

The existing static/runtime separation and movement commands remain intact. Schema 3 adds `shooting`, the generic `GameEvent` union and `Battlefield.losBlockers`. Snapshots include catalog, health, active transactions and events, but not executable policies or RNG state. The previous 49 tests remain unchanged.

New modules:

- `rules/shootingTargets.ts`: shooter/weapon validation, engagement guard, range policy and target queries.
- `rules/visibility.ts`: segment/rectangle intersection and replaceable VisibilityPolicy.
- `rules/weaponValues.ts`: validation and fixed/dice value resolution using existing D6 utilities.
- `rules/combatRolls.ts`: hit thresholds, strength/toughness wound targets and signed-AP saves.
- `rules/damageAllocation.ts`: pure prototype allocation and damage application.
- `rules/resolveShooting.ts`: backward-compatible entry point delegating to the shared `resolveCombat.ts` pipeline.
- `engine/validateShootingState.ts`: blocker, event-reference and shooting-transaction integrity checks.
- `ui/ShootingPanel.tsx` and `ui/BattleLog.tsx`: legal choices from the engine and summaries from events.

### Shooting transaction and commands

`beginShooting(unitId)` requires Shooting phase, the active player's living unit, no previous completed shooting action, a ranged profile, no engagement and no open movement/shooting transaction. `getRangedWeapons(unitId)` lists unused profiles; `getLegalTargets(unitId, weaponId)` returns enemy units with eligible firing model IDs and nearest living-pair distance. Queries do not consume RNG or mutate state and can also be used before beginning an action.

`fireWeapon(weaponId, targetUnitId, rng)` validates the action before consuming any RNG. Each ranged profile may fire once per action, even if it generates no hits. Different profiles can target different units. Every living eligible model has the unit definition's ranged profiles: heterogeneous per-model equipment is deliberately deferred.

`completeShooting()` marks hasShot, even if no weapon was fired. `cancelShooting()` leaves hasShot unset and is allowed only while hasRolled is false. Dice-based attacks that roll zero still lock cancellation. Fixed zero attacks consume no RNG and can still be cancelled. Cancellation appends an event rather than deleting history. Phase/turn progression and movement cannot proceed during an open shooting action. Normal turn transitions reset hasShot.

Expected failures are domain results and change neither health, transaction, events nor RNG. Resolution works on detached target data before committing, so a broken injected RNG/allocation policy can throw without partially changing battle state. Such programming errors cannot restore the external RNG stream: callers must repair the provider and restart from a known stream, not assume RNG rollback.

### Range and replaceable basic LOS

Range uses the centralized `rangedDistance` policy: base-edge distance in inches, inclusive at maximum range with the existing numerical tolerance. At least one living target must be both in range and visible to the same firing model. Dead models are excluded. nearestDistance describes the closest living pair and is not a claim that this pair is visible.

`VisibilityPolicy(shooter, target, battlefield)` is injected through optional GameEngine policies. The default is centre-to-centre segment testing against opaque axis-aligned rectangles. Closed boundary contact, endpoints inside a blocker and corner tangency block LOS. Transparent blockers do not block. Other models never occlude. Blockers must be finite positive rectangles inside the battlefield and have unique IDs. The prototype has no blockers by default; tests provide dedicated blocker layouts. The UI renders blockers if supplied.

These rectangles are temporary LOS geometry, not terrain: they impose no movement restrictions, cover, height, windows, obscuring, detection or indirect-fire rules. Future visibility implementations can replace the policy without altering combat resolution. Restore snapshots with the same policy configuration; functions are not serialized.

### Deterministic resolution pipeline

All random calls use the supplied RandomSource via the existing D6 helpers. The UI creates one seed-42 stream per test battle. The engine never uses Math.random, timestamps or random IDs. A full replay/resume system must later persist RNG state or supply the correct continuation stream; restoring a snapshot alone does not reconstruct the RNG.

1. Resolve attacks independently for each eligible firing model in stable model order. Fixed values require no rolls; dice values record each roll and modifier result. Catalog validation rejects negative possible outcomes, invalid die counts/sides and unsafe integer values.
2. Resolve each generated attack completely before the next: hit D6 against Skill, wound D6 against the centralized strength/toughness threshold, armour save, then damage for an unsaved wound.
3. Wound targets are 2/3/4/5/6 according to the Task 003 strength-versus-toughness relationship. Skills are 2–6; no modifiers, rerolls or critical effects are applied.
4. Required save is `Save - signedAP`. Save data supports 2–7 and AP is a non-positive integer. Requirements above 6 are automatically unsaved with a null save roll and no RNG consumption.
5. Resolve fixed/dice damage and allocate to a wounded living model first, otherwise the first living model in stable snapshot array order. Allocation is a separate injectable pure policy. It selects from the target unit's living models, not just those originally visible/in range; this is an explicit prototype unit-wide allocation convention.
6. Damage applies to exactly one model. Excess is lost; zero wounds means alive=false. Dead models stay in state and disappear from circles and subsequent movement/spatial/shooting queries.

If the unit is destroyed, stop further hit/wound/save/damage rolls. `attacks` records all generated attacks; hitRolls.length records the attacks actually processed. Attack-count rolls happen before the sequential attacks, so their results are still recorded even when later attacks become unnecessary. `totalDamage` is wounds actually removed, excluding excess.

### Combat events and extension points

GameEvent preserves all movement variants and adds shooting-started, weapon-fired, model-damaged, model-destroyed, shooting-cancelled and shooting-completed. Every event uses deterministic sequence/round/turn/player/unit context. weapon-fired includes eligible model IDs, per-model attack rolls/counts, hit/wound rolls, saves, damage rolls, applied/excess damage and casualty IDs. It is followed by ordered damage/casualty detail events. The UI consumes these events directly; it does not recalculate combat outcomes. This remains a lightweight debug history, not event sourcing or a complete replay executor.

Weapon traits remain inert data. Future attack-count/hit/wound/save stages can add weapon modifiers, Torrent, Rapid Fire, Sustained/Lethal Hits, Devastating Wounds, rerolls, invulnerable saves and Feel No Pain without moving rules into UI. Eligibility and visibility policies are the extension points for Pistols, Indirect Fire, detection and reaction shooting; allocation is the seam for Precision, attachments and player choice. None of those mechanics is implemented here.


## Charge and Fight subsystem (Task 004)

### Contracts and compatibility

`GameState.closeCombat` is an optional, serializable extension to schema 3. Missing means no charge, no fight controller and no temporary effects; old Task 003 snapshots remain unchanged when loaded. The first combat command initializes the extension. No migration of catalog or model coordinates is necessary. `validateCloseCombatState` checks transaction ownership, phase, roll totals, references, movement usage and original positions before load replaces state. As before, loading accepts trusted typed snapshots, not arbitrary hostile JSON.

`UnitState.hasAdvanced` and `hasFallenBack` are optional eligibility flags for future movement commands, not implementations of Advance/Fall Back. `canDeclareCharge` centralizes eligibility; a generic injected `chargeExceptions` policy may grant permissions. No faction names occur in those rules. Temporary `FIGHTS_FIRST` effects reference a unit and expire at END_OF_TURN; future ability evaluation can supply the same effect contract. Turn progression clears the close-combat action state and effects.

### Engine boundaries and transactions

`GameEngine` exposes declareCharge, selectChargeTargets, failCharge, moveCombatModel, previewCombatMove, completeCombatMove, cancelCombatMove, startFightPhase, advanceFightStep, beginPileIn, beginOverrun, beginConsolidation, skipTacticalMove, selectFightUnit, meleeAttack, cancelFightUnit and completeFightUnit.

`CloseCombatController` operates on a detached draft. Only a successful command replaces the engine state. Illegal commands consume no RNG; unexpected RNG/allocation errors throw without committing partial state. External RNG continuation remains caller-owned. There is no UI coordinate mutation, duplicate geometry library, or React dependency in the engine.

CombatMove extends the original MovementTransaction shape with kind, targets, allowance and a separate per-model cumulative usage map. Normal movement usage is preserved. Accepted segments consume distance even if the player later changes direction. Endpoint collision and bounds call the same `validateFinalPosition` function; the explicit engagement permission is only used by close-combat movement. Coherency is checked at completion so models may temporarily lose formation during repositioning.

Pile In and Consolidation cancellation restore positions and normal movement usage exactly. An unfinished Overrun movement can also be cancelled without cancelling the selected fight. Charge declaration and rolling are one atomic command: after the roll, cancellation is unavailable. `failCharge` restores any draft charge positions but leaves the declaration consumed and its dice events intact. This resolves failure without allowing rerolls. Completed movement cannot be undone globally. A selected fight can be cancelled before dice or a completed Overrun, restoring the selector/category; after that it must be completed.

### Charge geometry and feasibility

The charge roll is two injected D6. Selection occurs afterwards and checks enemy ownership, 12-inch declaration distance, rolled distance and a full formation witness. Multi-target sets are validated together, including engagement with every selected target and no unselected enemy. Charge movement is limited per model by the roll. Each model ends closer to a selected target; completion enforces the one-inch/engagement endpoint priorities where a legal placement is available.

`reachablePositions` builds candidate endpoints from circle intersections, circle projections, and battlefield boundaries using the existing geometry utilities. It has no screen sampling, grid or pixel tolerance. Endpoint feasibility does not imply clear intermediate movement: as with Task 002, swept collision, terrain and paths are outside this task.

`findChargeFormation` searches candidate endpoints in deterministic model order and validates the whole witness against coherency, engagement and priority constraints. It examines at most 10,000 search nodes; target queries examine at most 256 target combinations. This is deliberately conservative: complex formations requiring other model orders or endpoints not represented by this candidate search may be omitted. Selection revalidates the requested exact target set. Final movement completion remains authoritative and does not rely on the search witness being followed by the player.

Endpoint priority checks use the current positions of the other models and do not solve hypothetical coordinated rearrangements for every individual move. This and the bounded formation search are explicit prototype limitations. No optimal path or complete tabletop legality solver is claimed.

### Fight sequencing and movement

FightPhaseState explicitly records START, PILE_IN, FIGHT, CONSOLIDATE and END, plus pile-in opportunities consumed, units eligible/engaged at the start of the Fight step, units that fought, consolidation opportunities consumed and the selected unit's used models. The player must resolve or explicitly pass each optional movement opportunity before advancing its step. Normal pile-ins run for all active-player units before the opponent's; attacks cannot start while those opportunities remain.

The pure `FightSequenceController` prioritizes FIGHTS_FIRST and alternates selectors, skipping an empty side. Its next selector carries into REMAINING_COMBATS; it does not reset at the category boundary. Future effects can supply Fights First without a charge. Already-fought and destroyed units are excluded. Phase/turn commands reject unfinished combat work.

Pile In and Overrun use a three-inch allowance. Engaged units automatically target their currently engaged enemies; an unengaged unit selects enemies within the centralized five-inch pile-in target limit. Moved models must approach a closest original target; base-contact models are locked. Completion preserves each model's existing enemy-unit engagements and checks coherency and a final engaged unit.

Eligibility at the start of the Fight step survives the destruction of an enemy. Such an unengaged unit can select an Overrun, make one extra pile-in and attack if it reaches a target. If no legal target remains, it can complete its activation without attacks. Units first engaged during the Fight step can also use the Overrun pathway. Selection consumes the unit's fight only on completion; no model attacks twice in an activation.

Consolidation uses the same transaction and three-inch endpoint rules after combat. Active player's units resolve before the opponent's. Engaged units preserve engagements; unengaged units select enemies within three inches and must finish engaged with all selected targets. Each unit consolidates at most once in this prototype. Freshly engaged unfought enemies receive a fight opportunity before consolidation continues. Objective-directed destinations are deliberately absent; adding them should extend the consolidation target policy rather than place objective logic in the UI.

### Shared melee resolution and events

Weapon's existing discriminant remains `ranged` or `melee`; melee range is null, and skill is WS for melee / BS for shooting. `getModelsEligibleToFight` checks each living model's base-edge distance to the selected enemy. A unit-level engagement flag does not generate attacks for distant models. The Task 004 fixture uses two-inch engagement; all spatial subsystems use the same configured threshold in a match.

`resolveCombat` is the single Attacks → Hit → Wound → Save → Damage → Casualties pipeline. `resolveShooting` re-exports it for backward compatibility. No wound, save, allocation, dice or damage algorithms were duplicated. Melee resolves all unused eligible models with the selected profile and marks those models used; heterogeneous equipment, extra-attack traits and per-model weapon splitting are future work.

Events extend GameEvent with charge-declared, charge-rolled, charge-target-selected, charge-failed, combat-move-started/completed/cancelled, combat-model-moved, fight-unit-selected/completed/cancelled, overrun-fight, melee-attack-started and melee-attack-resolved. The `kind` on combat-move events distinguishes charge, pile-in, overrun and consolidate. Melee resolution includes the same dice, wounds, damage and casualty records as shooting. Event playerId is the actual acting unit owner, which may differ from the turn owner during Fight. Events remain an append-only debugging foundation, not a replay executor.

### Debug UI and rules references

`CloseCombatPanel` renders engine choices/results and calls commands. `GameScreen` routes circle taps and world-coordinate destinations to the active transaction; `coordinates.ts` is unchanged. `BattleLog` reads either shooting or melee resolutions. `closeCombatPrototype.ts` supplies the close deployment, two-inch engagement and invented melee equipment; the original fixtures remain usable by previous tests.

The user-specified sequencing was cross-checked against the official [combat changes overview](https://www.warhammer-community.com/en-gb/articles/m3son4il/new40k-combat-changes-shake-up-fighting-in-the-new-edition/), including two-inch engagement, post-roll target selection and Fight ordering. The project implements a documented subset, not a complete or licensed rules database. No official datasheets or rulebook passages are copied.
