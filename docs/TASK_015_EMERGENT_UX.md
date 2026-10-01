# Task 015 — Emergent battlefield UX port

Base: Task 014 (`ce2f4f95fda0254ab87b7d965b15f5180a9b61b0`). Issue #16.

The reference ZIP was acquired and its AGENTS.md, Battlefield, PortraitLayer,
RadialMenu, WeaponBubbles, AttackCard, HUD, PromptBar, BottomBar, CombatPopup,
UnitInfoPanel and index.css were read. The reference README is stale; its rules,
Vite/Zustand store and game implementation were not imported.

## Adapted interaction

PLAY prioritizes the battlefield. Tap a living model to select its unit and model.
The selected squad has an outline; a viewport-clamped contextual menu offers only
commands found in the current LegalActions plus read-only Info and Back.
The secondary unit list and exhaustive controls remain under More actions.
Enemy selection opens read-only information, including actual loadouts and attached
components. Runtime model bases, positions, vehicle sizes and token identities are
preserved. Token images have explicit base-relative dimensions on Web and native.

Movement envelopes and weapon reach are informational dashed overlays. They do
not promise legal destinations or visibility. Green suggestions come from existing
engine-validated actions; arbitrary movement taps use engine preview and require
confirmation. Cancel calls the original movement transaction through PlaySession.
Passive previews use detached engine snapshots, memoized for the current revision
and selection only. They never cache legality across engine changes.

Shooting offers actual legal weapon profiles, then highlights their legal targets.
Target and attack decisions require explicit confirmation. Reaction windows remain
visible and are resolved through existing legal actions; attacks are not silently
resumed or reactions automatically passed. The compact action bar exposes pending
resolutions. Completed combat events feed a non-modal result showing the real dice,
hits, wounds, damage and casualties, without consuming RNG or changing AI timing.

## Intentional differences

Expo / React Native / Web remains the single application. WMT owns its five-round
flow, CP, terrain/visibility, attack modifiers, all movement validation and reactions.
No simplified Emergent math, fake Focus Fire command, grid, whole-squad translation
or second state store was introduced. Zoom buttons and scroll pan are retained;
context controls do not scale with the board. DEBUG remains available.

## Validation and limits

13 focused presentation tests cover legal-action derivation, immutable profiles,
weapon-specific target lists, detached previews, engine submission, completed event
feedback and viewport/menu placement. Local regression: 712 passing tests; the two
unchanged expensive full-match simulations are excluded as requested by issue #16.
The complete catalog contains 714 tests. App and engine typechecks, Web export,
Android export and diff check are required before delivery.

Touch-size controls and a 390px browser viewport are checked. Browser smoke is not
real-device testing. Setup and rare commands retain the secondary controls; no
pinch/drag interaction or final combat animation is added. Range overlays show reach
from the selected model, not a complete legal region or LOS map. If no non-overlapping
menu position exists, the menu remains clamped within the viewport.

Known prior limitation: Vaul's Vengeance reaction Shooting does not expose nested
mid-roll reaction pauses. This port does not change that pipeline.

### Browser smoke performed

Chromium, exported Web bundle, desktop 1280×1000 and phone viewport 390×900:
- Human Aeldari: setup/deployment into Movement; select Dark Reapers directly;
  contextual Move/Info/Back, whole-squad selection, range previews, movement mode,
  Cancel transaction; advance through explicit end-phase reaction windows.
- Shooting: select Night Spinner, choose Doomweaver, tap Noise Marines + Lord
  Kakophonist, confirm target, resolve/pass reaction windows explicitly, confirm fire;
  completed result: 5 attacks, 3 hits, 2 wounds, 0 damage, 0 casualties.
- Human Emperor's Children: start separate match, deploy, inspect Noise Marines +
  Lord Kakophonist as seven independent runtime models with attached identity and
  actual weapon profiles, including during the AI opponent's turn.
- No page exceptions; no horizontal root overflow in the checked phone viewport.

These are smoke checks, not complete browser matches or Android device tests.
