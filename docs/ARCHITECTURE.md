# Architecture — Task 006

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
- `Unit` contains ID, definitionId, playerId, runtime models and action flags, plus optional history/location/arrival records. Static characteristics resolve through definitionId, never through a copied `unit.stats` or `unit.name`.
- `Model` owns position, wounds, alive state, its physical base geometry and movementUsed. Base geometry is initialized from the definition's default base, allowing a later per-model footprint without copying the entire unit catalog into runtime instances.
- Armies still reference runtime unit IDs. Dead models remain in their unit, but do not block movement, participate in coherency or engage enemies.

The engine copies loaded state and every returned snapshot. Readonly types protect catalog data at compile time; input/output copying protects the internal catalog at runtime. There is no command to edit catalog characteristics during play.

`schemaVersion` is now **3**. Schema-1 and schema-2 snapshots are rejected explicitly; there was no shipped persistent save format to migrate. The original Task 001 test scenarios are retained, with static-field assertions adapted to catalog lookup. `loadMatch` accepts trusted typed snapshots and checks core identity, geometry, configuration and transaction invariants. It is not a complete parser for hostile/untyped JSON. A full parser and version migrations remain future work.

## Coordinates, battlefield and bases

World positions and distances use floating-point **inches**, with origin (0, 0) at the top-left, positive x right and positive y down. There is no grid, pixel coordinate or snapping in the engine. Optional z supplies logical elevation; omitted z means zero. A Battlefield provides configurable width and height. The terrain fixture is 40 × 30 inches (legacy fixtures remain 30 × 24); no movement function assumes that size.

A circular base stores `kind: 'circle'` and `diameterMm`. Conversion uses 25.4 mm per inch; radius is derived in inches so diameter and radius cannot drift out of sync. Future hull shapes can extend this discriminated union and the geometry functions.

`centreDistance` is horizontal Euclidean distance. `distanceTravelled` adds horizontal distance and absolute elevation change. `edgeDistance` combines the nonnegative horizontal base gap with the elevation difference using Euclidean distance. `basesOverlap` checks actual penetration; tangent contact is allowed. `positionInsideBattlefield` checks a point, whereas normal movement uses `baseInsideBattlefield` to require the entire base inside all four edges. EPSILON=1e-9 inches is a centralized numerical comparison tolerance, not a game-rule distance.

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

Model-to-model collision remains endpoint-only: a path may cross another model. Task 005 additionally validates terrain along axis-separated horizontal/vertical segments. Cylinder height intervals allow non-overlapping models on separate floors. No general pathfinder is implied.

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

Keep new tabletop rules as tested pure functions under rules/ and route mutations through engine commands. Catalogs should remain keyed data; supported ability IDs may later resolve to pure rule handlers. Never hardcode faction characteristics in React components or execute strings from catalog data. Advance, Fall Back, transports, missions, objectives, AI, multiplayer and backend remain outside scope. Deployment and reserves are added in Task 006 below.


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

`beginShooting(unitId)` requires Shooting phase, the active player's living unit, no previous completed shooting action, an eligible ranged profile and no open movement/shooting transaction. Task 009 narrows Advanced units to Assault weapons and engaged units to Close-Quarters/Monster/Vehicle permissions. `getRangedWeapons(unitId)` lists unused profiles; `getLegalTargets(unitId, weaponId)` returns enemy units with eligible firing model IDs and nearest living-pair distance. Queries do not consume RNG or mutate state and can also be used before beginning an action.

`fireWeapon(weaponId, targetUnitId, rng)` validates the action before consuming any RNG. Each ranged profile may fire once per action, even if it generates no hits. Different profiles can target different units. Source-aware ownership from Task 008 determines each model's available profiles; Task 009 adds per-model One Shot consumption.

`completeShooting(rng?)` marks hasShot, even if no weapon was fired. `cancelShooting()` leaves hasShot unset and is allowed only while hasRolled is false. Dice-based attacks that roll zero still lock cancellation. Fixed zero ordinary attacks consume no RNG and can still be cancelled; selection of One Shot or Hazardous weapons commits their consequences. Cancellation appends an event rather than deleting history. Phase/turn progression and movement cannot proceed during an open shooting action. Normal turn transitions reset hasShot.

Expected failures are domain results and change neither health, transaction, events nor RNG. Resolution works on detached target data before committing, so a broken injected RNG/allocation policy can throw without partially changing battle state. Such programming errors cannot restore the external RNG stream: callers must repair the provider and restart from a known stream, not assume RNG rollback.

### Range and visibility

Range uses the centralized `rangedDistance` policy: base-edge distance in inches, inclusive at maximum range with the existing numerical tolerance. At least one living target must be both in range and visible to the same firing model. Dead models are excluded. nearestDistance describes the closest living pair and is not a claim that this pair is visible.

Task 005 replaces the default centre-ray policy with `terrain/visibility.ts` and its `VisibilityProvider`. Shooting asks that provider for visibility, without embedding LOS geometry. The old `VisibilityPolicy` injection remains a deprecated compatibility adapter for existing callers/tests. Legacy rectangular `losBlockers` are interpreted as infinitely tall opaque prisms by the new default provider. Policies are executable dependencies and must be supplied again when restoring a snapshot.

### Deterministic resolution pipeline

All random calls use the supplied RandomSource via the existing D6 helpers. The UI creates one seed-42 stream per test battle. The engine never uses Math.random, timestamps or random IDs. A full replay/resume system must later persist RNG state or supply the correct continuation stream; restoring a snapshot alone does not reconstruct the RNG.

1. Resolve attacks independently for each eligible firing model in stable model order. Fixed values require no rolls; dice values record each roll and modifier result. Catalog validation rejects negative possible outcomes, invalid die counts/sides and unsafe integer values.
2. Resolve each generated attack completely before the next: hit D6 against Skill, wound D6 against the centralized strength/toughness threshold, armour save, then damage for an unsaved wound.
3. Wound targets are 2/3/4/5/6 according to the Task 003 strength-versus-toughness relationship. Skills are 2–6; Task 005 supplies temporary per-firing-model Cover/Plunging Fire modifiers. Task 009 centralizes critical outcomes, reroll permissions and per-attack records in `combat/AttackPipeline.ts`.
4. Required save is `Save - signedAP`. Save data supports 2–7 and AP is a non-positive integer. Requirements above 6 are automatically unsaved with a null save roll and no RNG consumption.
5. Resolve fixed/dice damage and allocate to a wounded living model first, otherwise the first living model in stable snapshot array order. Allocation is a separate injectable pure policy. It selects from the target unit's living models, not just those originally visible/in range; this is an explicit prototype unit-wide allocation convention.
6. Damage applies to exactly one model. Excess is lost; zero wounds means alive=false. Dead models stay in state and disappear from circles and subsequent movement/spatial/shooting queries.

If the unit is destroyed, stop further hit/wound/save/damage rolls. `attacks` records all generated attacks; hitRolls.length records the attacks actually processed. Attack-count rolls happen before the sequential attacks, so their results are still recorded even when later attacks become unnecessary. `totalDamage` is wounds actually removed, excluding excess.

### Combat events and extension points

GameEvent preserves all movement variants and adds shooting-started, weapon-fired, model-damaged, model-destroyed, shooting-cancelled and shooting-completed. Every event uses deterministic sequence/round/turn/player/unit context. weapon-fired includes eligible model IDs, per-model attack rolls/counts, hit/wound rolls, saves, damage rolls, applied/excess damage and casualty IDs. It is followed by ordered damage/casualty detail events. The UI consumes these events directly; it does not recalculate combat outcomes. This remains a lightweight debug history, not event sourcing or a complete replay executor.

Task 009 activates the typed universal weapon catalog through the shared pipeline described below. Known legacy trait IDs map to typed abilities through a fixed compatibility table; arbitrary UI labels are never parsed as rules. Existing allocation, visibility and movement policies remain authoritative.


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

`reachablePositions` builds candidate endpoints from circle intersections, circle projections, and battlefield boundaries using the existing geometry utilities. It has no screen sampling, grid or pixel tolerance. Task 005 validates candidate default paths against terrain and considers relevant surface elevations. Model-to-model swept collision is still absent. Valid charges requiring detours outside the generated paths may be conservatively omitted.

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


## Terrain and visibility subsystem (Task 005)

### Data, geometry and compatibility

`models/index.ts` defines TerrainArea (regulatory polygon, feature references, metadata) separately from TerrainFeature (physical sections, openings, category, height and surfaces). Obscuring is derived from referenced LIGHT/DENSE features, never stored as a second mutable truth. Features and rules are data-driven; keyword checks never inspect unit or faction names.

`terrain/geometry.ts` provides polygon containment, base support, segment/prism intersections and cylinder occlusion. Coordinates and heights are inches. Simple concave polygons are supported; polygon holes and arbitrary meshes are not. A model's optional logical cylinder volume defaults to height 1.5 inches with its existing circular base radius.

Schema remains 3 because additions are optional. Missing z means 0 without rewriting legacy snapshots; missing terrain means an empty battlefield. `validateTerrainState.ts` validates polygons, references, surfaces, volumes, history and live/original transaction placements. Snapshot round-trips cover old and new data. This remains a trusted typed-state loader, not an arbitrary JSON parser.

### Shared movement interaction

`terrain/movement.ts` owns traversal and final support. Normal Move, Charge, Pile In, Overrun and Consolidation all call the same validator. Future Advance/Fall Back commands can use it, but those actions are not introduced here.

Movement commands optionally accept a waypoint path (at most 64 points). Segments are horizontal or vertical; the total is horizontal distance plus absolute vertical distance, never a diagonal shortcut. Without waypoints, ascent approaches then climbs, and descent drops then moves horizontally. Vertical segments must remain within the configured 0.5-inch proximity of an appropriate physical section or surface. Explicit paths permit supported climb/traverse/descent combinations; the engine does not find arbitrary routes automatically.

EXPOSED/LIGHT permit traversal. DENSE permits horizontal traversal for INFANTRY/BEASTS/SWARM/MOBILE and vertical traversal for INFANTRY/BEASTS/SWARM. Other models may cross sections up to the configured 2-inch threshold horizontally; taller sections require legal climbing. Floors/ceilings remain physical obstacles to unsupported traversal. Opening traversal is conservative and may require explicit waypoint subdivision.

Elevated endpoints require INFANTRY/BEASTS/SWARM/FLY/MONSTER, a stable surface at the destination elevation and full base support with no overhang. Physical sections cannot contain a final model volume; Dense low openings closed by Solid are also invalid endpoints. Ground and elevated placement share battlefield bounds and cylinder collision checks. Stability is supplied by terrain data rather than a physics simulation. Slopes, vehicle hulls and flight-specific shortcuts are not implemented.

Transactions retain original z and cumulative movement cost. Cancel restores positions exactly; rejected commands mutate nothing. Existing close-combat priorities, sequencing and irreversible dice boundaries remain controller responsibilities.

### Visibility provider and performance

`terrain/visibility.ts` exposes model LOS, model visible/fully visible, unit visible/fully visible and an inspection result. Each provider owns a detached state snapshot and a pair-query cache; engines create a fresh provider for each query/command, so movement, casualties and shooting cannot leave stale results.

The deterministic prototype samples 27 observer points and 18 target-facing cylinder points (up to 486 rays per pair). Any clear ray permits visibility; full visibility requires one observer sample to see every sampled facing point. This is a bounded primitive approximation, not proof of visibility for every continuous mesh point. Same-observer-unit models are ignored. Other living models occlude; full-unit checks additionally ignore target-unit members. Dead models do not occlude.

Physical sections block rays except at openings. Dense Solid closes the opening portion at or below the configured 3-inch threshold; upper openings can transmit rays. An intervening Obscuring area blocks regardless of height, but an area containing either model is excluded. A second intervening area still blocks. Area membership uses base intersection, while supported placement requires the entire base.

Geometry queries are isolated for a future spatial index. Current work per pair is bounded rays times candidate terrain/model count, and unit queries examine relevant model pairs. No large-army benchmark or global cache is claimed. A future renderer may replace the provider without changing Shooting.

### Hidden, Detection and attack modifiers

`terrain/rules.ts` centralizes keyword rules and configurable thresholds. Hidden is derived for INFANTRY/BEASTS/SWARM inside an area containing DENSE, provided the unit generated no ranged attacks this or the preceding player turn. `lastRangedAttackTurnIndex` survives action resets; legacy snapshots fall back to recorded weapon-fired events. Actual generated attacks update history immediately, even if they miss; zero attacks do not. Hidden becomes eligible again two player-turn indices after the last attack.

Detection defaults to 15 inches and is supplied through an observer-based policy as requested for this prototype. It adds a visibility requirement only for Hidden enemies; it neither grants LOS nor limits ordinary weapon range. The provider still checks physical LOS and Obscuring.

`terrain/attackModifiers.ts` derives Cover only when every living target model qualifies: eligible light-body keywords inside an area, or incomplete visibility caused by terrain. Model-only occlusion does not grant Cover. Plunging Fire requires a visible unit containing a ground-level model and either a supported attacker on terrain at least 3 inches high or TOWERING within 12 inches.

Cover adds 1 to required BS; Plunging Fire subtracts 1. The shared modifier function combines them and clamps effective skill to the prototype's centralized 2–6 bounds. Values are captured per eligible firing model when resolving a profile and recorded in resolution metadata; catalog profiles stay unchanged. The existing hit/wound/save/damage/allocation pipeline is reused, with melee unaffected.

### Events and debug UI

`terrain/events.ts` compares successful state transitions and appends area entered/left, elevation changed and Hidden gained/lost events. Shooting adds Cover/Plunging Fire events and per-model effective BS metadata. Pure inspection never emits events. Cancellation also records the meaningful restored spatial changes.

`terrainPrototype.ts` supplies a Dense ruin with a floor/platform and low/upper openings, a Light area and an Exposed feature. Eight selectable scenarios exercise clear/partial/blocked LOS, Obscuring, Hidden near/far, Plunging Fire and climbing. Older fixtures and their tests remain unchanged.

`TerrainOverlay` renders polygon outlines, physical sections and surface labels. `TerrainDebugPanel` requests engine inspection for model area membership, elevation, Hidden, Detection, target visibility, Cover and effective BS. The screen/world conversion remains x/y only; selected z is a separate command input. Exact-coordinate controls permit vertical moves without tying world geometry to pixels. No rules are calculated in the rendering layer.

### Reference and limits

Terrain/visibility behavior was checked against the official [core rules PDF](https://assets.warhammer-community.com/eng_01-06_warhammer40k_new40k_core_rules-was6fbu1ix-hfewhmxyiy.pdf), particularly terrain sections 13.06–13.11 and Plunging Fire 22.05. The repository contains original implementations and placeholder data, not copied rulebook passages. Sampled volumes, observer-based Detection policy, conservative charge/path search and simplified characteristic bounds are explicit prototype choices. No complete rules compliance, final mesh precision or real-device testing is claimed.


## Deployment and reserves subsystem (Task 006)

### Modules and dependency boundary

- `setup/types.ts` defines serializable locations, core abilities, zones, preparation stages, setup/Scout transactions, reserve records and arrival records.
- `setup/SetupValidator.ts` centralizes full-formation validation. `SetupController.ts` stages/commits deployment, Infiltrators, Scout reserve setup and both Ingress methods.
- `deployment/DeploymentController.ts` sequences preparation, alternates deployment, resolves ability choices and determines Scout player order. `ScoutController.ts` reuses the existing terrain-path and endpoint validators.
- `reserves/location.ts` centralizes presence on the battlefield; `ReservePolicy.ts` holds configuration and policy hooks; `ReserveController.ts` handles removal and expiration.
- `engine/validateDeploymentState.ts` checks additive snapshot contracts. GameEngine exposes commands on detached drafts and commits only successful results.
- `data/deploymentPrototype.ts` and `ui/DeploymentPanel.tsx` supply the invented test scenario and debug controls. No game module depends on React or display coordinates.

### Locations and catalog data

Static definitions optionally add points and typed core abilities. A model can explicitly override its inherited core-ability list; all living models must have the required ability. Scouts uses the minimum of each model's best Scouts distance. Existing untyped Ability data remains available for future non-core rules.

Unit location is BATTLEFIELD, STRATEGIC_RESERVES, RESERVES or DESTROYED. Pending deployment uses RESERVES without an initial strategic-reserve selection; the pre-battle queue distinguishes these units from selected Strategic Reserves. Off-field models retain health, coordinates, base geometry and flags, but their coordinates are inert. Presence filtering applies to collision, spatial engagement, LOS occlusion, targeting, charge/fight eligibility, terrain membership and rendering. Destroyed models remain in snapshots, with zero wounds and alive=false.

There is no EMBARKED gameplay. The discriminated location type can later grow alongside a transport reference and appropriate presence policy. A reserve record's optional transportHasIngressed field is only an expiration-policy seam.

### Preparation and sequencing

The optional deployment state explicitly progresses PRE_BATTLE → DECLARE_BATTLE_FORMATIONS → DEPLOY_ARMIES → PRE_BATTLE_RULES → BATTLE_STARTED. Missing deployment state means a legacy already-started battle. Battle commands and phase/turn progression reject during preparation.

Declaration selects Strategic Reserves and accounts for their catalog points per player against configured battle points × ratio (default 0.5). FORTIFICATION is rejected. Selection can be changed during declarations; it is frozen afterwards. The initial selection IDs preserve the original accounting after units arrive.

Deployment alternates after each committed unit, skipping a side with no pending units. The starting deployment player is configuration. First turn is an explicit player input, finalized before pre-battle rules; no roll or mission engine is invented. Turn progression and snapshot turn consistency use this player as the round's first player, without reordering player identities.

A unit with both Scouts and Infiltrators requires an explicit choice. Choices may be changed before deployment/use; confirmed deployment locks the choice. Using either incompatible mode records it for the battle. Scouts opportunities resolve first-turn player's units before the opponent's. Each must be completed or explicitly skipped before battle start. Scouts in Strategic Reserves may instead use the shared setup transaction to deploy wholly inside their own zone, consuming their Scout opportunity.

### Setup geometry and transactions

DeploymentZone is an owned polygon with metadata. Normal setup requires every living model's full circular base to fit one owned zone. Infiltrators replaces this with a strictly greater-than configured horizontal distance from every enemy model and enemy zone; default is 8 inches. Distances subtract base radii and deliberately ignore elevation. Exact boundary equality is rejected with the shared numerical tolerance.

The shared validator replaces the candidate unit in a detached battlefield view, then checks bounds, terrain/support, elevation, friendly/enemy collisions, zone/edge constraints and whole-unit coherency. It accepts optional policy restrictions for future redeploy/disembark rules without implementing those actions.

`beginDeployment`, `beginIngress` or `beginScoutSetup` opens a setup transaction. `stageSetupModel` and `stageSetupFormationAt` edit candidate positions only. Candidates may be incomplete or geometrically illegal while being edited; `previewSetup` reports the full formation result. Live positions/location change only on `completeSetup`. Rejected confirmation leaves all state unchanged. `cancelSetup` discards candidates, with an append-only cancellation event. An open transaction round-trips through snapshots.

Scouts differs because it is actual movement: `beginScoutMove` records originals; `moveScoutModel` uses the shared waypoint distance, terrain and endpoint rules and tracks its own per-model usage. Completion checks coherency and horizontal enemy separation; cancellation restores exact positions and normal movement usage. Scouts does not consume the first turn's normal movement allowance. The inherited model-to-model collision policy remains endpoint-only.

### Ingress and arrival effects

Ingress is a Movement-phase move type, not a separate Reinforcements step. Both STRATEGIC_EDGE and DEEP_STRIKE use the same setup controller/validator. Normal Strategic Reserves start at configured round 2, require full formation within 6 inches of a common battlefield edge, more than 8 horizontal inches from enemies, and exclude enemy deployment zones before round 3. Per this task's explicit contract, the default uses one common edge; broader edge-union handling is not inferred.

Deep Strike requires the ability on every living model, removes the edge restriction and permits the enemy zone; enemy distance, terrain and coherency still apply. A Deep Strike-capable unit in Strategic Reserves chooses its method explicitly on every Ingress. Generic RESERVES have no automatic strategic arrival permission: a supplied ReservePolicy must authorize an Ingress, whose selected method still determines geometry.

Arrival records contain the method (STRATEGIC_RESERVES, DEEP_STRIKE or REPOSITION), Ingress method and absolute player-turn index. `moveLock: UNTIL_NEXT_CHARGE` blocks further move types until phase progression reaches Charge; advancing directly to another turn also clears the expired lock. Catalogs are never changed. Arrival state is not inferred from coordinates or hasMoved.

`moveUnitToStrategicReserves(unitId, reason)` and the generic-reserves counterpart are trusted ability/debug hooks, not free player actions exposed by an implemented faction rule. They reject open transactions and preserve health, Battle-shock data, Advanced/Fell Back flags, shooting history and still-valid temporary effects. Existing ordinary turn expiry/reset behavior remains separate. No Battle-shock resolution system or new ability trigger engine is added.

### Expiration and snapshots

At the transition ending configured round 3, unarrived Strategic Reserves are destroyed. The default policy exempts repositioned units, units with prior Ingress and the future transport-arrival marker. `finishBattle()` independently resolves remaining Strategic/Generic Reserves, then marks the match finished. Custom policies can exempt units; they cannot select battlefield units for reserve destruction.

Schema stays 3: every new field is additive. Omitted location retains legacy battlefield semantics; off-field positions are finite but need not satisfy battlefield placement. Omitted z remains zero. New snapshots validate zones, ownership, ability choices, points, stage, transaction exclusivity, arrivals, Scout originals/usage and active battlefield action sources. The loader is still for trusted typed snapshots, not a general hostile-JSON parser. Supplied executable policies and RNG continuation remain caller-owned.

Events record reserve selection, deployment/mode, Scouts, Ingress/method, repositioning and reserve destruction. Pre-battle event actors are unit owners and need not be the future first-turn player. Pure previews generate no events.

### Debug preview and limitations

The debug screen can render 108 bounded complete-formation samples at the selected elevation. A green/red point evaluates translating the current formation to that anchor; it is neither an exhaustive legal region nor a game grid. Exact arbitrary floating-point coordinates are always accepted as input and validated at confirmation. No unbounded placement search is used.

Large bases use the same full-base constraints. When no ordinary edge setup fits, the default rejects; `largeModelEdgeFallback` is a centralized policy hook. Detailed large-model arrival exceptions and their downstream attack/movement restrictions are deferred. No transports, leaders, CP, Rapid Ingress stratagem, mission scoring, objectives, faction rules, army builder, AI or persistent saves are introduced.

Reference: official core-rules sections 20.01–20.04, 24.09, 24.20 and 24.31–24.32 in the PDF linked above, plus the explicit Task 006 rules contract. Thresholds are centralized configuration, not copied rulebook prose or UI conditions.


## Match flow, Command and temporary rules (Task 007)

### Ownership and modules

`flow/MatchFlowController.ts` coordinates the existing progression primitive with Command steps, timing windows, effect expiry and match limits. Canonical round/turn/player/phase remain `GameState.round`, `turn`, `activePlayerId`, `phase`; they are not duplicated in another object. `flow.firstPlayerId`, monotonically increasing `phaseIndex`, `commandStep`, pending resolutions, current/queued windows and transition boundary supplement them. Fight's finer steps remain in its existing controller. `maximumBattleRounds` defaults to 5 and `maxExtraCpPerBattleRound` to 1.

`command/CommandController.ts` implements the five Command steps. `BattleShock.ts` owns strength fractions, leadership resolution, recovery and action/retreat gates. `resources/CommandPoints.ts` is the only CP writer. `stratagems/StratagemEngine.ts` validates and resolves definitions; executable extension policies are separate from serialized data. `effects/EffectEngine.ts` supplies shared modifiers, flags, stacking and expiry. None of these modules import React Native.

GameEngine remains the public coordinator: command implementations work on detached drafts and commit only successful results. Expected illegal actions return domain results. Corrupt RNG/policies may throw, without committing partial state. External RNG state cannot be rolled back. Query policies receive copies; trusted effect/ability resolvers receive the transactional draft.

### Phase and Command boundaries

`canAdvancePhase()` returns every blocking reason: open transactions, unresolved Command step, pending mandatory work, windows, unfinished Fight and injected rule blockers. `tryNextTurn()` cannot skip phases in managed mode. The first request to advance a completed phase opens END_OF_PHASE; both players pass; the next request ends it. Fight additionally opens END_OF_TURN after phase expiry. Turn expiry precedes the next player, and round expiry/counter reset occurs only after the second player. Reserve expiration still runs at the same round boundary. The final configured round ends the match and resolves reserve end-battle policy without incrementing into an extra round.

Command uses START_OF_COMMAND_PHASE → GAIN_CORE_CP → BATTLE_SHOCK → COMMAND_ABILITIES → END_OF_COMMAND_PHASE. Entry executes each step once, and advancement cannot skip pending work. Start/end windows expose future triggers. End Command resolves ordinary pending abilities before the separate MISSION_HOOK stage; no mission logic is provided. Optional abilities are enumerable and may resolve once during their matching step. Mandatory ability IDs are persisted in `pending`; callers must supply the matching resolver after loading. Missing resolvers block rather than silently discard obligations.

Timing windows are serialized by ID, trigger, actor, optional unit/target context and passed player IDs. Start-turn/phase/Command windows queue deterministically; only the current window is usable. Both players pass to close it. A successful stratagem clears passes so reactions can be reconsidered. Pass is not cancellation of a committed attack. No query emits events.

`AFTER_HIT_ROLL` and `AFTER_WOUND_ROLL` are connected to real pausable attack jobs by Task 009. They open only when the injected stratagem catalog offers a legal reaction; PASS plus `resumeAttack(rng)` continues from the stored die. See the universal combat subsystem below.

### CP and Battle-shock

Both players gain one Core CP on entering GAIN_CORE_CP. Core gains bypass the extra allowance. Other gains are capped by remaining per-player allowance and return the granted amount; configurable limits/explicit ignore-limit hooks support future rules. Counts are nonnegative safe integers; costs are validated before subtraction. UI and stratagem resolvers use the resource API.

Half-strength compares living models with immutable starting model count. A one-model unit instead compares remaining with starting wounds. Destroyed and off-field units do not enter the mandatory roll queue. Active-player units that are currently shocked or at/below half strength each receive one pending roll. Per-model optional Leadership overrides permit heterogeneous characteristics; otherwise the catalog value applies. The central resolver rolls two injected D6 and succeeds against any eligible living model's effective Leadership.

Battle-shock is persistent runtime state, preserved by turn resets. Command start does not clear it. Failure sets it; a successful required recovery roll clears it. OC returns `null` to represent the rules' dash instead of changing catalog OC. `canStartAction`/`canCompleteAction` disallow shocked units. `fallBackOptions` forbids Ordered Retreat and indicates Desperate Escape is required. There is no Fall Back or complete Actions controller in Tasks 001–006; this is their centralized integration gate, not a new movement subsystem.

### Stratagem transaction and targeting

Definitions contain labels, cost, phase/trigger/turn ownership, target relation/count/keyword selector, conditions, named restrictions/resolver, usage limits and explicit exceptions. The engine validates timing, exact target IDs, restrictions, resources, Battle-shock and limits before committing CP or effects. A failed/throwing resolver rolls back the whole draft. Usage is recorded per player, target, phase index, turn and round. Defaults enforce once per stratagem per phase and one stratagem targeting a given unit per player per phase. Overrides are explicit definition policies. Battle-shock restricts the controlling player's targeting, not the opponent's.

Technical fixtures are in `stratagems/testStratagems.ts`: offensive BS −1; defensive Save −1; Command OC +1; and shock removal after a failed roll. They are not official content. The debug option enumerator lists singleton target candidates used by these fixtures; multi-target definitions can be validated/submitted as explicit batches without an unbounded combinations search.

Shooting has a serialized `selectedTarget` commitment. `selectShootingTarget` validates the existing visibility/range pipeline and opens the reaction window. `fireWeapon` requires matching commitment and all passes, then revalidates and resolves. This prevents bypassing a defensive effect by retargeting or cancelling after spending enemy CP. Completed attacks remove the commitment, and the next unused profile can select another target. Legacy shooting snapshots retain their old direct-fire API until migration.

### Effects and modifiers

Each effect stores ID, source, unit target, typed modifier/flag payload, creation stamp, expiry owner, duration, stacking and active state. Supported boundaries are current phase/turn/round, start/end of the target owner's next Command phase, or explicit removal. Expiry owner can be supplied explicitly. Next-Command duration requires a later absolute player turn, so an opponent Command does not expire an owner-specific effect. Start-of-next-Command expiry occurs when the queued Command-start window actually becomes active. Effects expire before subsequent stage actions and are retained inactive for debugging.

STACK sums modifiers; REPLACE_SAME_SOURCE deactivates matching source/target/payload effects; NON_STACKING suppresses a later duplicate payload on that target; HIGHEST_ONLY chooses the greatest numeric value (stable first-wins ties) and reevaluates when the winner expires. These are literal numeric policies, not a guess about whether positive or negative is beneficial.

Move is queried by the existing normal movement validator. BS combines with Cover/Plunging Fire; WS, Save, Leadership, OC, Hit and Wound use the shared modifier layer. Skill, save, Leadership and hit/wound bounds are centralized; unmodified natural 1 fails and natural 6 succeeds for hit/wound rolls. Attack metadata records effective skills and roll/save deltas. Unit/weapon catalog data is never mutated. Flag effects support FIGHTS_FIRST and eligibility denials. Managed charges grant FIGHTS_FIRST through this engine; migrated legacy charge effects are converted explicitly.

Movement usage records actual spent distance. In managed snapshots it may legitimately exceed the catalog Move after a buff expires; validation therefore retains finite/nonnegative and transaction displacement checks rather than rejecting historical usage against the unmodified catalog allowance. Current commands always validate remaining movement against the effective characteristic.

### Events, migration and debug

Global temporal/resource events use a discriminated `GameEvent` member `{ type: 'flow', name, detail, ...context }`; `unitId` is empty for genuinely global events. Names cover battle rounds, turns, phases, Command steps, CP, Battle-shock, windows, stratagems and effects. Existing combat/movement events are preserved. Shooting history validation now admits intervening flow events, necessary for reactive defence.

Schema remains 3 through additive `flow`, CP, Leadership and target-commitment fields. Missing `flow` explicitly means legacy Task 001–006 phase behavior; loading does not silently issue CP, reopen windows or replay entry triggers. `enableMatchFlow()` is the explicit migration and rejects an open action or repeat migration. New debug matches always enable it; pre-battle enabling waits until deployment/scouts finish before beginning temporal events. Executable policies and RNG continuation remain caller-owned. New state validates resource bounds, phase index, first player, pending references, window IDs/passes, effect payloads/expiry/timestamps, usage and commitment. Loading is atomic. This remains a trusted typed snapshot loader, not a comprehensive hostile-JSON parser.

`ui/CommandPanel.tsx` shows steps, both CP totals, extra counters, pending rolls/abilities, shock and OC, windows, legal/illegal fixture stratagems, passes and effect expiry. It only issues engine commands. Existing battlefield, terrain, movement, shooting and close-combat screens stay in place. Android/iOS exports validate bundling; no real-device test is claimed.

Rules reference: the official core PDF linked above, sections 01.06–01.07, 08.01–08.05 and 15.01, plus the explicit September-2026 Task 007 contract. The implementation deliberately includes no faction rules, official stratagem catalog, mission scoring, full Actions, transports, attached leaders, AI or persistent saves.


## Task 008 — transport and attachment extensions

### Identity, roster and source data

`attachments/AttachmentController.ts` validates roster assignments before Task 006 deployment. A Bodyguard accepts one Leader and one Support by default; explicit policy overrides may change limits. Compatibility is catalog data. Support cannot remain unattached. The aggregate receives a runtime ID and derived catalog entry, while `AttachmentRecord.components` retains original unit IDs, definitions, models and starting strength. Each aggregate model records `componentUnitId` and `sourceDefinitionId`; model statistics and keywords are resolved from that source, not from the aggregate profile. Component-prefixed weapon IDs preserve ownership and prevent every model from gaining every component's equipment.

`unitKeywords` and `modelKeywords` are deliberately separate. Terrain, capacity and model eligibility use the latter; unit selectors use the former. `attackToughness` uses the highest living Bodyguard Toughness and falls back to living Characters when Bodyguards are gone. An optional model Toughness override allows heterogeneous test/effect inputs. Leadership rolls likewise query each living model's source characteristic.

Abilities carry UNIT/MODEL scope and source identity. Optional model abilities apply only to that model. Source-unit abilities survive source destruction until the attacking unit completes all attacks. `startedBattleAttached` preserves while-leading behavior after separation. Embarked abilities/effects are suppressed unless explicitly opted in; a passenger modifier reaches its Transport only with both `whileEmbarked` and `viaFiringDeck`. This is a typed prototype effect bridge, not a general natural-language ability interpreter.

### Combat allocation and separation

`AllocationGroups` creates individual Character groups and non-Character groups by Wounds/Save/Invulnerable Save. Wounded non-Characters precede other non-Characters; all non-Characters precede Characters; wounded Characters precede unwounded Characters. The existing shared sequential hit/wound/save/damage resolver uses the selected model's defence profile, including optional invulnerable saves. Precision is optional and restricted to Characters visible to actual eligible attacking models. Shooting and melee share the same resolver and allocation logic.

Component destruction emits an event with only the destroyed component's original keywords. Bodyguard destruction or loss of all attached Characters schedules separation. Attack-caused separation waits for `finishAttacker`; other casualties separate after their transaction commits. Original runtime IDs return, preserving wounds, shock, action flags, location, embark records and shooting history. Living components inherit still-active unit-targeted effects; dead components have parent/move locks removed. Fight eligibility/completion lists and legacy Fights First effects are remapped. Archived runtime identities keep historical events and inactive effects resolvable after splitting. Catalog/source history remains immutable.

The shared attack pipeline resolves individual attacks sequentially. Task 009 extends its weapon abilities and reactions without introducing a batched-save/allocation-order UI. Defenders' equivalent allocation choices use deterministic group/model order.

### Location, capacity and embark

`EMBARKED` extends Task 006 location. Existing `onBattlefield` filtering removes passengers from spatial collisions, LOS, attacks and ordinary rules. `embarked` stores parent, turn, phase and pre-battle provenance. Passenger manifest and remaining capacity are pure derived queries; storing a second manifest/counter would risk divergence. Transport definitions specify maximum capacity, permitted/excluded model keywords, weighted costs, Dedicated status and Firing Deck limit. Attached passengers consume capacity for all living source models.

Embark is a commit option of the existing Movement transaction. All models must finish within 3 inches, pass friendly/type/capacity checks and not have been set up this turn. Initial deployment stamps turn zero, so it does not accidentally prohibit first-turn embark. The same transaction supports minimal Normal/Advance/Fall Back modes: Advance rolls an injected D6 and records bonus allowance; Battle-shocked Fall Back uses the shared Hazard resolver. Irreversible rolls disable cancellation. These modes reuse terrain paths and existing endpoint model collisions; they do not add full intermediate-model traversal rules.

Initial embark occurs in Declare Battle Formations. Passengers are excluded from deployment queues and their points count with an initially reserved Transport. Ingress marks parent history; Rapid Disembark calls the existing setup constraint factory, preserving edge/enemy-zone/distance restrictions. A Transport that never arrives and expires in reserves also loses its passengers off-field; no battlefield Emergency placement is created.

### Disembark transactions and destruction

`TransportController` stages coordinates outside live models. It derives the required mode:

- Rapid after Normal/Ingress: wholly within 3 inches, inherited setup restrictions, no Charge this turn.
- Tactical before movement/stationary: legal setup within 3 inches followed by a mandatory Normal/Advance movement transaction. Cancelling that follow-up does not clear the obligation.
- Combat only when the Tactical region is proven unavailable: Hazard per model, wholly within 6 inches, restricted enemy engagement exceptions, Battle-shock and no Charge.
- Emergency on destruction: frozen parent geometry remains valid through a mandatory queue, Hazard per model, coherent placement within 6 inches and no arbitrary cancel. Only certified impossible models are destroyed by placement failure. Parent removal waits for the last passenger.

`HazardRoll` is reusable: simultaneous injected D6 rolls, failure on 1–2, one mortal wound per failure or three when every living model is MONSTER/VEHICLE. Mortal wounds spill through the deterministic allocation order. Hazard deaths, transaction outcomes and split events serialize deterministically. Expected invalid commands return domain failures against detached drafts.

The default placement search is bounded to 20,000 candidate visits. It tests circular tangencies and angular/radial candidates through the existing SetupValidator, terrain, collision and coherency systems. It prioritizes nearest positions, but is not a global packing optimizer. `placementFeasibility` can certify an empty ground-only circular placement region using boundary arrangements. It deliberately ignores terrain for impossibility proofs: absent a certificate, failure is indeterminate (`PLACEMENT_SEARCH_LIMIT`), never permission to kill passengers or force Combat. Complex terrain/packing Emergency cases can remain pending until a future complete placement policy is supplied. Callers may supply a full Tactical formation to `beginDisembark` and bypass candidate enumeration while retaining all legality checks. Continuous manually entered coordinates are never snapped.

### Firing Deck, Scouts and UI

Firing Deck selections are temporary `ShootingTransaction` loadout entries: at most X distinct embarked models, one owned ranged weapon each, no One Shot, no already-selected passenger. All embarked units receive the turn-scoped shooting restriction, including unselected passengers. The Transport is the attacker; ordinary passenger abilities never transfer automatically. Completion/cancellation discards the loadout without modifying catalog weapons. Selection events retain provenance for historical validation.

Dedicated Transports derive Scouts only if every living passenger model has Scouts, taking the minimum allowance. Existing ScoutController checks full deployment-zone containment and uses the same ScoutMoveTransaction. No new Scout geometry exists.

`TransportPanel` adds manifest/capacity, unit/component/ability/allocation inspection, embark/disembark commands, Hazard output, candidate coordinates, emergency resolution and deck selection. BattlefieldView can render staged passenger candidates. Shooting/CloseCombat panels expose Precision. `transportPrototype` supplies invented profiles and pre-match assignments, not official datasheets or a full army builder. UI never mutates engine snapshots.

### Snapshot and verification policy

Schema stays 3: all additions are optional and legacy meaning is unchanged. `validateTransportState` rejects orphan parents, over-capacity manifests, invalid component provenance, emergency queues and altered borrowed profiles. Historical lookup is permitted for archived event/effect references; active transactions still require live runtime entities. Capacity and manifest are recomputed from serialized sources. RNG state and injected policies remain caller-owned, consistent with prior tasks.

Task 008 adds 64 deterministic tests to the unchanged 427-test baseline (491 total), including both successful transactions and rejection/rollback paths, source-aware attack integration, deferred splits, Firing Deck snapshots, multiple emergency passengers, impossible oversized bases and existing Scout transaction reuse. App/engine typechecks and both mobile exports are required. No physical-device or simulator interaction has been claimed.

## Task 009 — universal combat abilities

Reference: the official 11th-edition core PDF linked above, September 2026 snapshot, principally Section 24 and Shooting 10.05–10.07. `abilities/types.ts` records the individual rule identifiers in `RULE_IDS` and `CORE_ABILITY_RULES`. These are original implementations and concise behavioral notes, not reproduced rulebook text.

### Typed data and responsibilities

`WeaponAbilityDefinition` has a stable instance ID, type, optional value/threshold, keyword and target-keyword conditions, source and metadata. `weaponAbilities` is the typed list; old `traits` use a fixed ID compatibility map. Pistol normalizes to Close-Quarters. The registry selects one instance of each duplicated kind, even if its parameters/keywords differ. Missing choices produce `ABILITY_CHOICE_REQUIRED` before attack dice. `setAttackChoices` cannot grant a reroll without a data-defined permission.

Core duplicates store a chosen instance index on the runtime model. `getPendingCoreChoices`/`chooseCoreAbility` expose required choices, and action/flow guards prevent resolving with an unchosen duplicate. Scouts retains its established shared-distance rule. `coreAbilityCatalog` bridges existing Deep Strike/Scouts/Infantry deployment data, attachment Leader/Support data and transport Firing Deck data; none of those controllers was replaced.

| Ability / behavior | Authoritative module |
| --- | --- |
| Anti, Lethal Hits, Sustained Hits, Torrent, Devastating Wounds | `combat/AttackPipeline.ts`, critical helpers in `combat/dice.ts` |
| Rapid Fire, Blast, Cleave, Melta | Shared attack count/damage stages, existing base-edge measurement |
| Heavy, Lance, Psychic | `combat/modifiers.ts`, shared pipeline and existing temporary effects |
| Twin-linked / generic rerolls | `combat/dice.ts`, explicit permissions and die history |
| Assault, Close-Quarters / Pistol, Indirect Fire | `rules/shootingTargets.ts`, shared Hit stage, VisibilityProvider |
| Ignores Cover, Stealth | `terrain/attackModifiers.ts`, existing Benefit of Cover |
| Extra Attacks | `engine/CloseCombatController.ts`, per-model regular/extra weapon usage |
| One Shot | Runtime `Model.oneShotExpended`, original weapon identity in registry |
| Hazardous | Existing `transports/HazardRoll.ts`, unit-completion commands |
| Precision | Existing `attachments/AllocationGroups.ts` and visibility-constrained selection |
| Feel No Pain / mortal wounds | `combat/damage.ts` |
| Deadly Demise | `combat/destruction.ts`, iterative deferred destruction queue |
| Hover / Super-heavy Walker | `abilities/movement.ts`, existing shared terrain path validator |
| Lone Operative | `abilities/registry.ts`, VisibilityProvider and ranged targeting |
| Fights First | Existing FightSequenceController and temporary effects, with core lookup |
| Deep Strike / Infiltrators / Scouts | Existing deployment/setup/reserve controllers |
| Firing Deck / Leader / Support | Existing transport and attachment controllers |
| Normal / invulnerable saves | `combat/save.ts`, existing source-model allocation groups |

### Shared attack state machine

`createAttackJob` builds a context per eligible bearer and resolves attack-count expressions. `runAttackJob` is the sole Hit → Wound → Allocate → Save → Damage → FNP implementation for Shooting and melee; `resolveCombat` remains its synchronous compatibility facade. Fixed, D3, D6 and flat-modifier expressions use explicit RNG. A prototype guard rejects more than 10,000 generated attacks per bearer.

Contexts freeze source identities, weapon/ability choices, selection distance/count, visibility, movement, engagement and charge data. Shooting captures target-count and distance before `AFTER_TARGET_SELECTED`, so reactions do not silently change Blast/Rapid Fire inputs. The visibility provider is shared within job creation rather than rebuilt per attack. Current temporary modifiers are read at the relevant stage, allowing a legal reaction to affect the pending roll without changing catalog data.

Each attack records its original/rerolled dice, critical/automatic outcomes, additional-hit provenance, chosen save, damage/mortals, ignored wounds and casualties. Additional hits are explicit non-critical records; Lethal auto-wounds do not become critical wounds. Devastating damage waits until the weapon's normal damage finishes and caps each critical wound at one allocated model. Deferred entries reference record indices so JSON snapshots do not depend on object identity.

`combat/dice.ts` supports kind/source, individual-die or full-roll reroll permissions and a `wasRerolled` guard. Hit/Wound/Save rerolls occur at their roll stages; attack-count/Damage expressions retain individual die records. Player preferences select among granted permissions; they cannot create a permission. Critical thresholds default to 6 and can be supplied by `GameState.combatRules`. Lone Operative defaults to 12 inches in the same rules object; parameterized ability instances can override it.

Characteristic modifiers reuse the existing EffectEngine and attached source effects. Records contain source, target, amount, timing, stacking and priority. BS/WS changes remain distinct from Hit/Wound changes; the net roll delta is capped after gathering weapon and effect modifiers. AP changes only armour saves. The best legal armour/invulnerable target is selected before rolling, then FNP runs per lost wound. Mortal wounds share that FNP/allocation path for Devastating Wounds, Hazard and Deadly Demise.

### 11th-edition interactions

- Heavy uses the actual at-most-3-inch movement condition, not a historical stationary-only interpretation.
- Stealth grants Cover when every living model has it. Ignores Cover suppresses Cover, including Stealth, but never ignores visibility, Obscuring or terrain geometry.
- Psychic can retain modifiers, ignore penalties, or ignore all BS/WS and Hit modifiers. No Psychic phase exists.
- Indirect shooting is an explicit unit mode locked after its first weapon. Indirect weapons can target unseen units, grant Cover and disallow Hit rerolls. Unmodified 1–5 fail, or 1–3 when stationary with a friendly spotting unit. Other weapons still need visibility. Lone Operative remains a target restriction even for indirect shots.
- Non-Monster/Vehicle models select Close-Quarters or other ranged profiles. Advanced and engaged permissions cannot be combined arbitrarily. Blast cannot attack a target the shooting unit is engaged with.
- Extra Attacks tracks additional weapons separately from the one regular melee choice and blocks completion while legally required selections remain. One Shot keys use original model/weapon provenance, surviving turn resets, embark and attached separation.

### Reactions, irreversible work and destruction

After each actual Hit/Wound die, the engine emits a structured flow event. An offered legal roll reaction opens the existing timing window and stores `GameState.attackJob`; otherwise resolution continues immediately. Torrent skips Hit dice/windows; Lethal auto-wounds skip Wound dice/windows. Both players PASS through the existing framework, then `resumeAttack(rng)` continues. New attack/finish/cancel commands cannot bypass a pending job. RNG continuation remains caller-owned; a snapshot does not rewind or recreate the external RNG stream.

Hazardous counts selected weapons/bearers, not attack dice, and resolves after the unit's attacks. Completion requires an RNG only when needed. Damage/weapon selection and job cursors commit atomically from detached drafts; a provider exception cannot partly update game state.

Deadly Demise captures each destroyed model once, preserves its base/provenance and waits for the attacking unit to finish. Emergency passenger placement takes priority over explosions. `resolveDestructionEffects(rng)` drains available queue entries iteratively; a new destroyed transport pauses the queue for its passengers. New explosions append entries instead of recursively resolving them. Unresolved released entries block phase progression. Normalization never makes dead models participate in movement/visibility, but frozen queue geometry remains available for range queries.

### Movement, snapshots, UI and limits

Normal/Advance/Fall Back and Charge accept a taking-to-skies choice before movement. Flying models use the existing horizontal/vertical path, ignore vertical cost and traverse terrain; final support/bounds/collision rules still apply. The allowance loses 2 inches unless Hover applies. Super-heavy Walker uses the same path validator for sections up to 4 inches, blocks traversal through TITANIC models and optionally gains movement-local MOBILE permission; completion D6=1 applies Battle-shock. Cancellation restores positions and removes transaction-local choices. No new geometry engine or permanent keyword mutation is introduced.

Schema remains 3 with optional additive fields: attack job, core instance choices, One Shot usage, Hazardous counters, movement choices, critical configuration and destruction queue. `validateAttackState` checks references, pause cursor/die, choice data, selection inputs and queued destruction identities. Old snapshots continue to load unchanged. This remains a trusted typed loader, not a complete hostile-JSON schema validator.

The debug UI adds only continuation/destruction buttons to existing controls and passes RNG to unit completion. Advanced selection policies are engine APIs, not a new UI editor. Existing simple circular geometry, sampled LOS, bounded placement search, deterministic defender allocation and caller-owned RNG limitations remain. The current stratagem options UI/catalog uses single-target selectors; no full reroll-stratagem pack, final graphics, persistent saves, real datasheets or device testing is added.

Task 009 validation is the unchanged 491-test baseline plus 77 focused tests (568 total), app TypeScript, isolated engine TypeScript and `git diff --check`. CI runs those inexpensive checks. Android/iOS exports remain available only as a manually opted-in workflow step and were not run for Task 009; dependencies are unchanged.


## Task 010 — mission and scoring architecture

Reference: [official 11th-edition Core Rules](https://assets.warhammer-community.com/eng_01-06_warhammer40k_new40k_core_rules-was6fbu1ix-hfewhmxyiy.pdf), sections 14 and 16, September 2026 snapshot. Mission definitions and score values here are invented technical fixtures; they are not the official mission-card catalog.

| Responsibility | Engine module |
| --- | --- |
| Mission/objective/action/ledger data and Force Disposition identifiers | `missions/types.ts` |
| Terrain Objective footprint membership and model-level effective OC | `missions/objectives.ts` + existing `terrain/geometry.ts`, `effects/EffectEngine.ts` and attachment model definitions |
| Core Action eligibility, start, interruption and completion | `missions/actions.ts`; Shooting/Charge validators enforce turn-long restrictions |
| Mission setup, event consumption, scoring windows, Fixed/Tactical cards, caps and result | `missions/MissionEngine.ts` |
| Serializable state validation | `missions/validateMissionState.ts`, called by `engine/validateState.ts` |
| Invented five-site mission / optional real deployment fixture | `missions/provingGround.ts` |
| Text-only player inspection | `ui/MissionPanel.tsx`; no rules live in UI |

`GameState.mission` is additive and optional in schema 3; older snapshots load without a mission. The mission embeds a serializable `MissionDefinition`, current objective states, action history, per-player progress, card decks/hands/discards, chronological VP entries and `MatchResult`. Definitions consist of data (condition types and timing identifiers), not callbacks or JSX. Player `forceDisposition` supports the five 11th-edition identifiers without assigning faction/detachment rules. Setup stores attacker and defender independently from the existing first-player choice. `createProvingGroundDeploymentMatch()` exercises the Task 006 deployment transaction with a mission; the default debug fixture begins with test models already on the battlefield.

A Terrain Objective references an existing Terrain Area ID; `calculateLevelOfControl` uses that area's unchanged polygon and the model base intersection utility. OC is resolved per surviving on-board model through the existing characteristic/effect machinery, including attached source definitions. Embarked and dead models cannot contribute. `resolveObjectiveControl` runs at each phase and turn end. A tie removes unsecured ownership; securing requires explicit rule provenance. Secured ownership persists without friendly models and is lost only when opposing OC exceeds friendly OC at a phase-end check. Control-change, secured, lost and contested events emit only on real state changes.

`startAction` validates timing, keywords, effective OC, location, Battle-shock, engagement, movement history, one-Action-per-unit-turn and declared use limits. Its `ActiveAction` records both start/completion timing and a terminal state. Engine commit hooks compare pre/post transaction positions and location, so a staged or cancelled drag cannot interrupt the Action; committed movement and leaving the battlefield emit a structured interruption. The Pile In and Consolidation completion events are explicit exceptions. At the configured completion window a live, un-interrupted Action resolves its effect exactly once. Unit-level Shooting/Charge validators continue to apply the Action restriction for the entire turn, with the Core TITANIC shooting exception.

`MatchFlowController` invokes the mission event consumer before incrementing turn/phase at boundaries. This ensures Action effects, secured timestamps and VP entries retain the correct turn. The consumer persists its event-sequence cursor, reads existing events (unit destruction, attacks, Battle-shock, ingress, Action completion and control changes), and dispatches scoring rules at Start/End Command, End Phase, End Turn, End Round and End Battle. `UNIT_DESTROYED` records the loss once when the last living model disappears; its event player is the owner of the lost unit. It does not replay the combat resolver. Configurable Primary rules may be asymmetric; Fixed cards stay selected, while an explicitly shuffled Tactical deck draws into a limited hand and retains/discards according to mission policy. An injected RNG creates the saved shuffled order; future draws consume no RNG. The `awardVictoryPoints` ledger clamps each entry to per-round, category and total mission caps. Completion computes totals and winner or draw without kill-count tie-breaking, after the existing reserve cleanup policy. No mission-scoring code is added to React Native components.

The implementation uses a small typed condition vocabulary (`CONTROLLED_OBJECTIVES`, `EVENT`, `ACTION_COMPLETED`) and technical Action effects (`SECURE_OBJECTIVE`, `MISSION_PROGRESS`, `AWARD_VP`). Real mission cards, optional twists, target-specific objective markers and faction-specific exceptions need future definitions/resolvers. Mission setup validation rejects invalid references; snapshot validation checks ownership, deck uniqueness, score caps and result consistency. RNG continuation remains caller-owned except the saved Tactical deck order. UI represents Terrain Areas and circles using the existing debug overlay; it does not implement mission art or final gameplay presentation.

Task 010 validation adds 29 focused tests to the unchanged 568-test baseline (597 total). The project runs app and isolated-engine TypeScript checks and `git diff --check`; mobile exports and device builds are intentionally excluded from this task.

## Task 011 — faction vertical slice in progress

`content/factionDatasheets.ts` contains only the 19 chosen Aeldari and Emperor's Children definitions. `modelProfiles` supplies the equipment, wounds and base for each group of models without copying stats into mutable unit state. `createUnit` instantiates those profiles, and `attachments/queries.ts` resolves original weapons and characteristics on joined units. The two preset rosters live in `content/presets.ts`; the seeded match creator uses the existing Task 006 mission, Task 008 attachment and transport transactions, and deployment stage. `verifiedEntries.ts` records the exact source snapshot and point references. The catalog is not a general army database.

Battle Focus token totals and six timing choices belong to `content/BattleFocus.ts`; the two reactive moves reuse the terrain path, final-base placement, coherency and event helpers. Thrill Seekers tracks turn, prior engagement and selected attack/charge targets in `content/factionRules.ts`. Exquisite Swordsmanship records a Fight activation choice before the shared attack job. Aspect Shrine tokens are serializable unit resources consumed on the shared paused Hit/Wound die. A Rhino's Shock Disembark and a Land Raider's Assault disembark are generic transport data permissions, not vehicle-name branches.

`content/factionStratagems.ts` declares six Stratagems per detachment for the generic CP and timing engine. Its currently wired resolver IDs cover selected movement, offensive, defensive, reserve and Battle-shock cases. The shared `AttackPipeline` reads temporary modifiers for Deft Parry, Shield Nodes, Cruel Bladesman and objective-based Warding Salvoes; it does not modify immutable weapon profiles. Cut Down the Weak opens a reaction using the ordinary Charge controller and keeps the rolled charge transaction irreversible. A pending Death Ecstasy response stores destroyed defender model IDs until the attacker completes its activation. Legacy snapshots omit all optional Task 011 fields; new snapshots keep source IDs, tokens, reaction state and pending responses, validated on load.

**Still incomplete:** the source-only `FactionContentRegistry` has not been populated with executable resolvers for every chosen datasheet ability or verified by `validatePresetRoster` for both real presets. Vaul's Vengeance requires a War Walkers unit outside the agreed 19 datasheets. Fight-on-death with attached-unit splitting, Heroic Intervention/Faultless Opportunist, all six manoeuvre timing/interaction edge cases, the final debug UI and broad faction regression coverage remain to be finished before PR #11 can be marked ready. Do not treat the presence of an ability ID or a Stratagem definition as an implemented rule. The source priority is official 11th-edition GW rules and errata, followed by the 11th-edition datasheet mirror; older-edition pages are not used.
