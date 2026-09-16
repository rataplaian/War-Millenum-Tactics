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
npm run export:mobile
```

The mobile export checks bundling for Android and iOS; it does not build an APK/IPA or replace real-device testing. Build outputs and node_modules are ignored; commit package-lock.json and use npm ci for portable installs.

## Current status: Task 006

Implemented: immutable unit definitions separated from runtime instances, circular bases in millimetres, continuous tabletop coordinates in inches, configurable battlefield, endpoint collisions, per-model normal movement allowance, unit movement transactions with exact cancellation, configurable coherency/engagement queries and deterministic movement events. Task 001 dice and phase/turn progression remain supported.

### Try deployment and reserves (Task 006)

The default **DEPLOYMENT** scenario contains six invented archetypes per player: normal, Infiltrators, Scouts 6, Infiltrators + Scouts 6, Deep Strike, and Fortification. Each has two models and fictitious points. The 48 × 36 inch table has opposite deployment zones and an elevated terrain platform.

1. Start the scenario and advance from PRE_BATTLE to DECLARE_BATTLE_FORMATIONS. Select Strategic Reserves (points used/limit shown for each player) and choose Scouts or Infiltrators for the dual-ability units.
2. Choose the first-turn player, then advance to DEPLOY_ARMIES. The engine identifies the next deployment player. Select normal/Infiltrators deployment, tap a formation anchor or enter exact x/y/z; individual model controls also work. Confirm or cancel.
3. After every pending unit is deployed, advance to PRE_BATTLE_RULES. Resolve or skip Scouts for the first-turn player, then the other player. Scouts in Strategic Reserves can instead set up in their own deployment zone. Advance again to start the battle.
4. During Movement, eligible reserve units can choose **STRATEGIC EDGE** or **DEEP STRIKE**. Standard arrival starts in round 2. Preview, edit and confirm the whole formation. Green/red debug samples are optional hints, not a grid or an exhaustive legal-position map.
5. **DEBUG: NEXT PLAYER TURN** advances through engine progression, including round boundaries and reserve expiration. It rejects unfinished actions. Use it twice to reach the next round with the same active player. Reposition and end-battle debug buttons exercise the generic rule hooks.

Initial Strategic Reserves are limited to 50% of the configured battle points limit per player. Fortifications are excluded. Setup uses horizontal enemy distances, full-base bounds/support, collision and coherency. Arrivals record method/turn and block other move types until the next Charge phase. Unarrived initial Strategic Reserves expire after round 3; repositioned units are exempt from that deadline. End-battle resolution applies separately.

### Try the debug movement screen

1. Choose a terrain scenario, tap **START TEST BATTLE**, then **NEXT PHASE** to enter Movement.
2. Tap **SELECT UNIT** for the active player's unit, then a numbered model button (or tap its circle).
3. Tap the battlefield to choose a destination. A legal move updates the model; a rejected move displays the reason and leaves state unchanged. Each accepted segment consumes that model's allowance.
4. Move the other models as needed, then **COMPLETE MOVE**. The final unit formation must satisfy configured coherency.
5. **CANCEL MOVE** restores all positions and movement usage from the start of that unit's action. Complete or cancel before advancing phases.

The terrain debug field is a configurable 40″ × 30″ prototype; earlier fixtures remain available. Both factions and all spatial-rule values are test fixtures, not official rules. Player 1 is blue; Player 2 is pink. A unit cannot complete a second normal movement action in the same turn. Engaged units and destinations within the configured enemy engagement distance are rejected for normal movement.

### Try shooting

1. Advance to **Shooting** after completing or cancelling any movement action.
2. Use **SHOOT: [unit]**, select an available ranged weapon and one of the engine's legal targets, then **FIRE**.
3. Read the battle log: attacks, hits, wounds, failed saves, actual damage and casualties. Dead circles are hidden; unit cards retain health/model counts.
4. Use **COMPLETE SHOOTING** to finish. **CANCEL SHOOTING** is available only before any dice have been rolled.

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

No Advance/Fall Back actions, faction rules, complete weapon keyword pack, invulnerable saves, Feel No Pain, transports, reserves, AI, army building, missions, objectives, multiplayer, backend, final art, drag or zoom. Mobile exports check bundling, not real-device behavior or APK/IPA builds.

See [architecture](docs/ARCHITECTURE.md) for data migration details, command semantics, geometry and configuration.

GitHub is the primary versioned copy. Later clone it into a local development folder; keep both synchronized with normal git pull/commit/push. Work on feature branches and review pull requests before merging into main.
