# War Millennium Tactics

Continuous tabletop movement prototype for a local, single-player, turn-based tabletop tactical game for Android and iOS. The first prototype uses one **placeholder** Aeldari unit and one **placeholder** Emperor’s Children unit. All fixture statistics/equipment are invented test data, not official datasheets.

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

## Current status: Task 002

Implemented: immutable unit definitions separated from runtime instances, circular bases in millimetres, continuous tabletop coordinates in inches, configurable battlefield, endpoint collisions, per-model normal movement allowance, unit movement transactions with exact cancellation, configurable coherency/engagement queries and deterministic movement events. Task 001 dice and phase/turn progression remain supported.

### Try the debug movement screen

1. Tap **START TEST BATTLE**, then **NEXT PHASE** to enter Movement.
2. Tap **SELECT UNIT** for the active player's unit, then a numbered model button (or tap its circle).
3. Tap the battlefield to choose a destination. A legal move updates the model; a rejected move displays the reason and leaves state unchanged. Each accepted segment consumes that model's allowance.
4. Move the other models as needed, then **COMPLETE MOVE**. The final unit formation must satisfy configured coherency.
5. **CANCEL MOVE** restores all positions and movement usage from the start of that unit's action. Complete or cancel before advancing phases.

The field is a configurable 30″ × 24″ prototype. Both factions and all spatial-rule values are test fixtures, not official rules. Player 1 is blue; Player 2 is pink. A unit cannot complete a second normal movement action in the same turn. Engaged units and destinations within the configured enemy engagement distance are rejected for normal movement.

### Scope and limits

Collision checks only the final base position, not the path. No terrain, vertical movement, combat, charge rolls, Advance, Fall Back, transports, Deep Strike, AI, army building, missions, objectives, multiplayer, backend or polished art. No drag or zoom yet.

Snapshots use schema version 2 and can restore an in-progress movement transaction in memory. Schema-1 snapshots are explicitly rejected. There is no disk save, replay executor or full untrusted-JSON parser; restarting the app resets the battle. Mobile export is not a real-device test or APK/IPA build.

See [architecture](docs/ARCHITECTURE.md) for data migration details, command semantics, geometry and configuration.

GitHub is the primary versioned copy. Later clone it into a local development folder; keep both synchronized with normal git pull/commit/push. Work on feature branches and review pull requests before merging into main.
