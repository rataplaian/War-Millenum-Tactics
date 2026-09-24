# War Millennium Tactics

Continuous tabletop movement and combat prototype for a local, single-player, turn-based tabletop tactical game for Android and iOS. The first prototype uses one **placeholder** Aeldari unit and one **placeholder** Emperor’s Children unit. All fixture statistics/equipment are invented test data, not official datasheets.

## Stack

Expo SDK 57, React Native, React, strict TypeScript, Node/npm. Automated tests use Node's built-in test runner with tsx. No backend.

## Setup

Use Node 24 LTS (see `.nvmrc`) and npm. Clone this repository, enter the project folder, then:

```sh
npm ci
npm start
```

Open the project with a compatible Expo Go client, or an Expo development build. Your device must be able to reach the development server. Android emulator: `npm run android`. iOS simulator: `npm run ios` (requires macOS and Xcode). No native build tools are needed for engine tests. On a restricted work PC, development and checks can run in a cloud checkout; do not install locally unless permitted.

[Expo setup documentation](https://docs.expo.dev/get-started/create-a-project/)

## Checks

```sh
npm test
npm run typecheck
npm run typecheck:engine
npm run check
# Optional bundling check, not part of Task 009 validation:
npm run export:mobile
```

The mobile export checks bundling for Android and iOS; it does not build an APK/IPA or replace real-device testing. Build outputs and node_modules are ignored; commit package-lock.json and use npm ci for portable installs.

## Current status: Task 009

Implemented: immutable unit definitions separated from runtime instances, circular bases in millimetres, continuous tabletop coordinates in inches, configurable battlefield, endpoint collisions, per-model normal movement allowance, unit movement transactions with exact cancellation, configurable coherency/engagement queries and deterministic movement events. Task 001 dice and phase/turn progression remain supported.

### Universal combat abilities (Task 009)

The shared Shooting/melee pipeline now supports the Section 24 weapon catalog, explicit duplicate-ability choices, qualified unit keywords, critical hits/wounds, controlled rerolls, normal/invulnerable saves, mortal wounds and Feel No Pain. New core behavior includes Deadly Demise, Hover, Lone Operative, Stealth and Super-heavy Walker; existing deployment, attachment and transport abilities keep their controllers.

- `setAttackChoices(weaponId, choices)` chooses duplicate instances, Psychic/Lethal behavior, authorized rerolls and unit-wide Indirect shooting before committing a target. Model-count and range inputs are captured at target selection.
- One Shot is serialized per original model/weapon, including through attached splits and embark. Hazardous resolves through the existing Hazard utility when the unit finishes; completion accepts an injected RNG when required.
- Legal Hit/Wound reactions pause the same serializable attack job. Use the existing **PASS** controls, then **CONTINUE ATTACK**. No subsequent dice are consumed while waiting. No reaction catalog is added.
- `beginMovement(..., { takingToSkies, mobile })` and the Charge equivalent reuse terrain paths. MOBILE requires Super-heavy Walker and a completion D6; Hover removes the sky allowance penalty. Destruction queues wait for remaining attacks and Emergency Disembarks, then use **RESOLVE DESTRUCTION EFFECTS** when needed.
- Fixtures and new tests use invented technical profiles. UI remains deliberately minimal; advanced ability choices are engine APIs rather than new panels.

Task 009 validation: **568 tests** (491 previous tests unchanged + 77 new tests), app/isolated-engine TypeScript and diff checks. No mobile exports, dependency upgrades or device builds were run for this task. CI runs the inexpensive `npm run check`; mobile exports are opt-in through the workflow's `mobile_export` dispatch input.

### Transports and Attached Units (Task 008)

Select **TRANSPORTS** for invented capacity-6/Firing-Deck-2 and capacity-12/Dedicated fixtures, a five-model Bodyguard, compatible Leader and Support, and an opposing Bodyguard with different Toughness. The roster is assembled before deployment; the standard deployment and Command panels remain in use.

- During Declare Battle Formations select a passenger and **START EMBARKED**. The manifest derives capacity from living models and their own keywords. Only the Transport deploys.
- Movement supports Normal, Advance and Fall Back entry points through the same transaction. **COMPLETE MOVE + EMBARK** validates every passenger within 3 inches and commits removal atomically.
- **DISEMBARK** determines Rapid, Tactical or Combat. Tactical provides a legal candidate formation and blocks progression until the required Normal/Advance move is completed. Rapid inherits Ingress restrictions. Combat/Emergency roll injected Hazard dice and cannot cancel after rolling.
- A destroyed Transport retains its frozen geometry and passenger queue until all Emergency Disembarks resolve. The UI shows mode, rolls, candidates and pending movement. Coordinates can be edited or tapped; only engine confirmation commits them.
- Select passenger model/weapon options, then **SHOOT WITH FIRING DECK**. Borrowed weapons use the existing Shooting panel and disappear at completion. Both shooting and melee expose optional visible-Character Precision selection.
- The transport panel displays component identities, model-derived keyword union, ability sources, attack Toughness, allocation groups and completed splits. The engine defers attack-induced separation until the attacking unit finishes.

Schema remains 3 with optional additive extensions; old fixtures do not gain attachments or transports implicitly. Validation rejects orphan parents, invalid capacity/provenance and corrupt temporary loadouts. Manifests/capacity are derived from serialized passenger state instead of duplicated counters.

Task 008 validation: **491 tests** (427 previous tests unchanged + 64 new tests), app and isolated-engine TypeScript checks, Android and iOS exports. No real-device testing is claimed.

Automatic placement is a bounded candidate search, not a complete continuous packing solver. Ground-only circular arrangements can certify an individually impossible placement. Unresolved packing/terrain cases return `PLACEMENT_SEARCH_LIMIT` without casualties or committing an illegal fallback; API callers can provide a complete legal Tactical formation. Emergency placement prioritizes nearest candidates, but does not prove a global optimum across arbitrary terrain. See ARCHITECTURE for the exact limits.

### Command, CP and timing (Task 007)

The debug UI enables Match Flow automatically. Existing schema-3 fixtures remain available in explicit legacy mode for regression testing; callers opt into the new system with `engine.enableMatchFlow()`.

- At each open timing window, both players must **PASS**, or use an available technical stratagem before passing. The panel shows legal options and rejection reasons. Windows block battle commands and phase progression.
- In Command, use **ADVANCE COMMAND STEP** through Start → Core CP → Battle-shock → Command Abilities → End. Both players gain 1 Core CP. Roll every pending Battle-shock test; mandatory abilities must also resolve. A failed roll opens the test override window.
- Both players' CP and additional gains are visible. The default extra allowance is 1 CP per player per battle round. Core gains do not consume it.
- **NEXT PHASE** first opens the end-of-phase window; pass and press again to commit the transition. Fight also opens an end-of-turn window. Direct debug turn skipping is blocked with Match Flow enabled. The default match ends after both players complete round 5; the limit is configurable.
- Selecting a Shooting target now commits the selection and opens **AFTER_TARGET_SELECTED** before any dice. The opponent may use **TEST REACTIVE DEFENCE**. Pass, then FIRE. A committed selection must resolve; it cannot be cancelled to undo a reaction.
- The panel shows Battle-shock, effective OC (a dash when shocked), action/retreat eligibility, pending resolutions, active effects and their expiry. Battle-shock persists until a successful required recovery roll or an explicit authorized effect.

Four invented stratagems exercise the framework: offensive BS −1, reactive Save −1, Command OC +1 until the target owner's next Command start, and a failed Battle-shock override. They are **technical fixtures, not official stratagems**. Catalog profiles are never edited. Fights First granted by a charge uses the shared effect system.

Validation: **427 passing tests**, comprising the original 324 unchanged tests and 103 new flow/resource/stratagem/effect/snapshot/integration tests. The full Command → Movement → Shooting → Charge → Fight → next-player path is tested through engine APIs.

### Try deployment and reserves (Task 006)

The default **DEPLOYMENT** scenario contains six invented archetypes per player: normal, Infiltrators, Scouts 6, Infiltrators + Scouts 6, Deep Strike, and Fortification. Each has two models and fictitious points. The 48 × 36 inch table has opposite deployment zones and an elevated terrain platform.

1. Start the scenario and advance from PRE_BATTLE to DECLARE_BATTLE_FORMATIONS. Select Strategic Reserves (points used/limit shown for each player) and choose Scouts or Infiltrators for the dual-ability units.
2. Choose the first-turn player, then advance to DEPLOY_ARMIES. The engine identifies the next deployment player. Select normal/Infiltrators deployment, tap a formation anchor or enter exact x/y/z; individual model controls also work. Confirm or cancel.
3. After every pending unit is deployed, advance to PRE_BATTLE_RULES. Resolve or skip Scouts for the first-turn player, then the other player. Scouts in Strategic Reserves can instead set up in their own deployment zone. Advance again to start the battle.
4. During Movement, eligible reserve units can choose **STRATEGIC EDGE** or **DEEP STRIKE**. Standard arrival starts in round 2. Preview, edit and confirm the whole formation. Green/red debug samples are optional hints, not a grid or an exhaustive legal-position map.
5. Progress through the Command steps, phases and timing windows to reach later rounds. **DEBUG: NEXT PLAYER TURN** cannot bypass these mandatory steps in Task 007. Reposition and end-battle debug buttons exercise the generic rule hooks.

Initial Strategic Reserves are limited to 50% of the configured battle points limit per player. Fortifications are excluded. Setup uses horizontal enemy distances, full-base bounds/support, collision and coherency. Arrivals record method/turn and block other move types until the next Charge phase. Unarrived initial Strategic Reserves expire after round 3; repositioned units are exempt from that deadline. End-battle resolution applies separately.

### Try the debug movement screen

1. Choose a terrain scenario, tap **START TEST BATTLE**, complete the Command steps and timing windows, then use **NEXT PHASE** to enter Movement.
2. Tap **SELECT UNIT** for the active player's unit, then a numbered model button (or tap its circle).
3. Tap the battlefield to choose a destination. A legal move updates the model; a rejected move displays the reason and leaves state unchanged. Each accepted segment consumes that model's allowance.
4. Move the other models as needed, then **COMPLETE MOVE**. The final unit formation must satisfy configured coherency.
5. **CANCEL MOVE** restores all positions and movement usage from the start of that unit's action. Complete or cancel before advancing phases.

The terrain debug field is a configurable 40″ × 30″ prototype; earlier fixtures remain available. Both factions and all spatial-rule values are test fixtures, not official rules. Player 1 is blue; Player 2 is pink. A unit cannot complete a second normal movement action in the same turn. Engaged units and destinations within the configured enemy engagement distance are rejected for normal movement.

### Try shooting

1. Advance to **Shooting** after completing or cancelling any movement action.
2. Use **SHOOT: [unit]**, select an available ranged weapon and one of the engine's legal targets; resolve/pass the target-selection reaction window, then **FIRE**.
3. Read the battle log: attacks, hits, wounds, failed saves, actual damage and casualties. Dead circles are hidden; unit cards retain health/model counts.
4. Use **COMPLETE SHOOTING** to finish. **CANCEL SHOOTING** is available before target commitment or any dice have been rolled.

Both invented factions have ranged weapons. The engine supports one use per profile and different targets for different profiles. It checks three-dimensional base-edge range and the modular primitive-volume Visibility Engine, then resolves attacks → hits → wounds → armour saves → damage with an explicit RNG. The debug battle uses seed 42 for repeatable results. The scenario picker supplies clear, partial, blocked, Obscuring, Hidden, Plunging Fire and vertical-movement examples.

### Try charge and fight

The debug scenarios use **2-inch engagement**. Both units have invented melee equipment. Older engine fixtures retain their original deployment and configurable 1-inch engagement.

1. Advance through Movement and Shooting to **Charge**. Select **CHARGE: [unit]** to roll 2D6, then choose legal target(s) and **CONFIRM CHARGE TARGETS**.
2. Tap a charging model and a destination. Move each model closer to the selected targets; **COMPLETE COMBAT MOVE** checks the whole formation. Failed completion leaves positions editable. **RESOLVE AS FAILED CHARGE** restores starting positions but consumes this charge attempt; it never refunds the roll.
3. Enter Fight, **START FIGHT PHASE**, then **NEXT FIGHT STEP**. Resolve or explicitly pass each unit's Pile In, active player's units first.
4. Enter the Fight step, select an eligible unit, choose its melee weapon/target, resolve attacks and **COMPLETE FIGHT UNIT**. Selection order and Fights First come from the engine. Unengaged eligible units can use **OVERRUN PILE IN** with a new target.
5. After all fights, enter Consolidate. Resolve or pass each eligible unit's movement, then reach END and **NEXT PHASE**. Fresh enemies engaged by consolidation get an intervening fight opportunity.

Pile In and Consolidation can be cancelled before completion; fight selection can be cancelled before rolling or completing an Overrun. Model positions, movement usage, casualties and logs are engine-owned. The separate Fight selector may be the opponent, even though the main turn remains the active player's.

### Try terrain and visibility

Choose a scenario before **START TEST BATTLE**. Yellow outlines show Terrain Areas; feature labels show EXPOSED / LIGHT / DENSE and height, while blue outlines mark elevated surfaces. The inspector reports model elevation, area membership, Hidden, Detection Range, target visibility, Cover and effective BS. These values come from engine queries.

In the VERTICAL terrain scenario, enter Movement and select a model. Choose elevation 3 and its existing x/y coordinates to climb onto the ruin platform; each climb costs 3 inches. Move the other models before completing if needed for coherency. Battlefield taps use the selected elevation. Cancel restores the original positions including elevation.

Task 005 adds data-driven areas/features, shared terrain paths for normal and combat movement, supported elevated placement, a replaceable VisibilityProvider, Hidden/Detection, Obscuring/Solid, and per-model Cover/Plunging Fire attack modifiers. Shooting immediately updates Hidden eligibility when attacks are generated; shooting history survives turn resets.

### Scope and limits

Model-to-model collision checks remain endpoint-only. Terrain uses horizontal/vertical waypoint paths and swept base checks; it is not a general pathfinder. Charge target queries retain bounded deterministic formation search (10,000 nodes; 256 target combinations), including terrain validation, and can conservatively omit legal detours or crowded formations.

Visibility samples logical cylinders against extruded polygons and openings; it distinguishes hidden, partial and full visibility but is not exact mesh LOS. Query caches belong to detached snapshots and cannot survive movement. Large-army performance has not been benchmarked. The project implements a documented prototype subset, not complete 11th-edition compliance.

Snapshots remain schema 3: optional terrain, deployment/reserve transactions, locations, core abilities, shooting history and z are additive; missing z means ground level. Older Task 003–005 snapshots remain loadable; omitted location means the legacy battlefield, and omitted deployment state means an already-started battle. Schema 1/2 are rejected. RNG continuation is caller-owned. There is no persistent save, replay executor or hostile-JSON parser.

Generic RESERVES require an explicit arrival policy. Oversized bases that cannot fit an edge constraint are rejected unless a setup policy supplies a fallback; no transport gameplay is implemented. Off-field positions are retained as inert history and never participate in battlefield queries.

No complete Actions system, official stratagem catalog, faction rules, complete weapon keyword pack, Feel No Pain, AI, army building, missions, objectives, multiplayer, backend, final art, drag or zoom. Task 008 adds minimal Advance/Fall Back entry points for transport interactions; intermediate miniature crossing remains the existing endpoint-collision approximation. Invulnerable saves are supported in allocation groups. Hit/wound timing identifiers are extension points; individual attack rolls still resolve atomically and do not offer reroll interruptions. Mobile exports check bundling, not real-device behavior or APK/IPA builds.

See [architecture](docs/ARCHITECTURE.md) for data migration details, command semantics, geometry and configuration.

Development workflow: Codex cloud workspace → GitHub feature branch → pull request → CI → review. No operation on the user’s PC is required. Merge into main only after explicit authorization.
