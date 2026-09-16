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

`beginShooting(unitId)` requires Shooting phase, the active player's living unit, no previous completed shooting action, a ranged profile, no engagement and no open movement/shooting transaction. `getRangedWeapons(unitId)` lists unused profiles; `getLegalTargets(unitId, weaponId)` returns enemy units with eligible firing model IDs and nearest living-pair distance. Queries do not consume RNG or mutate state and can also be used before beginning an action.

`fireWeapon(weaponId, targetUnitId, rng)` validates the action before consuming any RNG. Each ranged profile may fire once per action, even if it generates no hits. Different profiles can target different units. Every living eligible model has the unit definition's ranged profiles: heterogeneous per-model equipment is deliberately deferred.

`completeShooting()` marks hasShot, even if no weapon was fired. `cancelShooting()` leaves hasShot unset and is allowed only while hasRolled is false. Dice-based attacks that roll zero still lock cancellation. Fixed zero attacks consume no RNG and can still be cancelled. Cancellation appends an event rather than deleting history. Phase/turn progression and movement cannot proceed during an open shooting action. Normal turn transitions reset hasShot.

Expected failures are domain results and change neither health, transaction, events nor RNG. Resolution works on detached target data before committing, so a broken injected RNG/allocation policy can throw without partially changing battle state. Such programming errors cannot restore the external RNG stream: callers must repair the provider and restart from a known stream, not assume RNG rollback.

### Range and visibility

Range uses the centralized `rangedDistance` policy: base-edge distance in inches, inclusive at maximum range with the existing numerical tolerance. At least one living target must be both in range and visible to the same firing model. Dead models are excluded. nearestDistance describes the closest living pair and is not a claim that this pair is visible.

Task 005 replaces the default centre-ray policy with `terrain/visibility.ts` and its `VisibilityProvider`. Shooting asks that provider for visibility, without embedding LOS geometry. The old `VisibilityPolicy` injection remains a deprecated compatibility adapter for existing callers/tests. Legacy rectangular `losBlockers` are interpreted as infinitely tall opaque prisms by the new default provider. Policies are executable dependencies and must be supplied again when restoring a snapshot.

### Deterministic resolution pipeline

All random calls use the supplied RandomSource via the existing D6 helpers. The UI creates one seed-42 stream per test battle. The engine never uses Math.random, timestamps or random IDs. A full replay/resume system must later persist RNG state or supply the correct continuation stream; restoring a snapshot alone does not reconstruct the RNG.

1. Resolve attacks independently for each eligible firing model in stable model order. Fixed values require no rolls; dice values record each roll and modifier result. Catalog validation rejects negative possible outcomes, invalid die counts/sides and unsafe integer values.
2. Resolve each generated attack completely before the next: hit D6 against Skill, wound D6 against the centralized strength/toughness threshold, armour save, then damage for an unsaved wound.
3. Wound targets are 2/3/4/5/6 according to the Task 003 strength-versus-toughness relationship. Skills are 2–6; Task 005 supplies temporary per-firing-model Cover/Plunging Fire modifiers. Rerolls and critical effects remain absent.
4. Required save is `Save - signedAP`. Save data supports 2–7 and AP is a non-positive integer. Requirements above 6 are automatically unsaved with a null save roll and no RNG consumption.
5. Resolve fixed/dice damage and allocate to a wounded living model first, otherwise the first living model in stable snapshot array order. Allocation is a separate injectable pure policy. It selects from the target unit's living models, not just those originally visible/in range; this is an explicit prototype unit-wide allocation convention.
6. Damage applies to exactly one model. Excess is lost; zero wounds means alive=false. Dead models stay in state and disappear from circles and subsequent movement/spatial/shooting queries.

If the unit is destroyed, stop further hit/wound/save/damage rolls. `attacks` records all generated attacks; hitRolls.length records the attacks actually processed. Attack-count rolls happen before the sequential attacks, so their results are still recorded even when later attacks become unnecessary. `totalDamage` is wounds actually removed, excluding excess.

### Combat events and extension points

GameEvent preserves all movement variants and adds shooting-started, weapon-fired, model-damaged, model-destroyed, shooting-cancelled and shooting-completed. Every event uses deterministic sequence/round/turn/player/unit context. weapon-fired includes eligible model IDs, per-model attack rolls/counts, hit/wound rolls, saves, damage rolls, applied/excess damage and casualty IDs. It is followed by ordered damage/casualty detail events. The UI consumes these events directly; it does not recalculate combat outcomes. This remains a lightweight debug history, not event sourcing or a complete replay executor.

Weapon traits remain inert data. Future attack-count/hit/wound/save stages can add weapon modifiers, Torrent, Rapid Fire, Sustained/Lethal Hits, Devastating Wounds, rerolls, invulnerable saves and Feel No Pain without moving rules into UI. Eligibility and visibility policies are the extension points for Pistols, Indirect Fire and reaction shooting; allocation is the seam for Precision, attachments and player choice. None of those mechanics is implemented here.


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
