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

## Current status: Task 004

Implemented: immutable unit definitions separated from runtime instances, circular bases in millimetres, continuous tabletop coordinates in inches, configurable battlefield, endpoint collisions, per-model normal movement allowance, unit movement transactions with exact cancellation, configurable coherency/engagement queries and deterministic movement events. Task 001 dice and phase/turn progression remain supported.

### Try the debug movement screen

1. Tap **START TEST BATTLE**, then **NEXT PHASE** to enter Movement.
2. Tap **SELECT UNIT** for the active player's unit, then a numbered model button (or tap its circle).
3. Tap the battlefield to choose a destination. A legal move updates the model; a rejected move displays the reason and leaves state unchanged. Each accepted segment consumes that model's allowance.
4. Move the other models as needed, then **COMPLETE MOVE**. The final unit formation must satisfy configured coherency.
5. **CANCEL MOVE** restores all positions and movement usage from the start of that unit's action. Complete or cancel before advancing phases.

The field is a configurable 30″ × 24″ prototype. Both factions and all spatial-rule values are test fixtures, not official rules. Player 1 is blue; Player 2 is pink. A unit cannot complete a second normal movement action in the same turn. Engaged units and destinations within the configured enemy engagement distance are rejected for normal movement.

### Try shooting

1. Advance to **Shooting** after completing or cancelling any movement action.
2. Use **SHOOT: [unit]**, select an available ranged weapon and one of the engine's legal targets, then **FIRE**.
3. Read the battle log: attacks, hits, wounds, failed saves, actual damage and casualties. Dead circles are hidden; unit cards retain health/model counts.
4. Use **COMPLETE SHOOTING** to finish. **CANCEL SHOOTING** is available only before any dice have been rolled.

Both invented factions have ranged weapons. The engine supports one use per profile and different targets for different profiles. It checks base-edge range and basic centre-ray LOS, then resolves attacks → hits → wounds → armour saves → damage with an explicit RNG. The debug battle uses seed 42 for repeatable results. Default battlefield: no LOS blockers; rectangular blocker cases are tested separately.

### Try charge and fight

The debug scenario starts the units closer together and uses **2-inch engagement**. Both units have invented melee equipment. Older engine fixtures retain their original deployment and configurable 1-inch engagement.

1. Advance through Movement and Shooting to **Charge**. Select **CHARGE: [unit]** to roll 2D6, then choose legal target(s) and **CONFIRM CHARGE TARGETS**.
2. Tap a charging model and a destination. Move each model closer to the selected targets; **COMPLETE COMBAT MOVE** checks the whole formation. Failed completion leaves positions editable. **RESOLVE AS FAILED CHARGE** restores starting positions but consumes this charge attempt; it never refunds the roll.
3. Enter Fight, **START FIGHT PHASE**, then **NEXT FIGHT STEP**. Resolve or explicitly pass each unit's Pile In, active player's units first.
4. Enter the Fight step, select an eligible unit, choose its melee weapon/target, resolve attacks and **COMPLETE FIGHT UNIT**. Selection order and Fights First come from the engine. Unengaged eligible units can use **OVERRUN PILE IN** with a new target.
5. After all fights, enter Consolidate. Resolve or pass each eligible unit's movement, then reach END and **NEXT PHASE**. Fresh enemies engaged by consolidation get an intervening fight opportunity.

Pile In and Consolidation can be cancelled before completion; fight selection can be cancelled before rolling or completing an Overrun. Model positions, movement usage, casualties and logs are engine-owned. The separate Fight selector may be the opponent, even though the main turn remains the active player's.

### Scope and limits

Collision checks only the final base position, not the path. Charge target queries search for a complete legal formation, using a bounded deterministic search (10,000 formation nodes; 256 target combinations). They may conservatively omit legal crowded formations or movement orderings outside that search. This is a tested prototype rules subset, not a claim of complete 11th-edition rules compliance. No full terrain, vertical movement, Advance, Fall Back, transports, Deep Strike, AI, army building, missions, objectives, multiplayer, backend or polished art. No drag or zoom yet.

Snapshots use schema version 3 with an optional closeCombat extension. Unmodified Task 003 snapshots remain loadable; open charge/fight/movement actions can be restored in memory. Schema-1 and schema-2 snapshots are explicitly rejected. Ranged loadouts are homogeneous, wound allocation is automatic and LOS is only a replaceable 2D rectangle policy. No weapon special rules, cover, invulnerable saves or Feel No Pain. RNG continuation is caller-owned and is not stored in snapshots. There is no disk save, replay executor or full untrusted-JSON parser; restarting the app resets the battle. Mobile export is not a real-device test or APK/IPA build.

See [architecture](docs/ARCHITECTURE.md) for data migration details, command semantics, geometry and configuration.

GitHub is the primary versioned copy. Later clone it into a local development folder; keep both synchronized with normal git pull/commit/push. Work on feature branches and review pull requests before merging into main.
