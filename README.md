# War Millennium Tactics

Technical foundation for a local, single-player, turn-based tabletop tactical game for Android and iOS. The first prototype uses one **placeholder** Aeldari unit and one **placeholder** Emperor’s Children unit. All fixture statistics/equipment are invented test data, not official datasheets.

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

## Current status: Task 001

Implemented: typed domain models, continuous coordinates, deterministic dice, isolated game engine, creation/loading of typed snapshots, phase/turn/round sequencing, two data fixtures and a minimal UI. Tap **START TEST BATTLE**, then **NEXT PHASE** to inspect progression. The round increases after both players finish five phases.

Not implemented: actual movement/combat rules, AI, army building, full armies, multiplayer, backend, save-to-disk, victory conditions or polished graphics. Loading currently means restoring an in-memory typed snapshot. App restarts reset the match. Device testing remains necessary.

See [architecture](docs/ARCHITECTURE.md) for extension points and state semantics.

GitHub is the primary versioned copy. Later clone it into a local development folder; keep both synchronized with normal git pull/commit/push. Work on feature branches and review pull requests before merging into main.
