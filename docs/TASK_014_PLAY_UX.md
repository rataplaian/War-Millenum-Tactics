# Task 014 — Unit tokens and guided PLAY

## Shared application

PLAY and DEBUG continue to use the same React Native UI on Android and Web. GameEngine, AI, match rules, snapshots and unit data are unchanged. The task adds presentation metadata and a guided command panel over the existing LegalAction/PlaySession APIs.

## Token source and mapping

17 optimized 256px JPEG crops come from the two previously generated sheets, without regenerating the artwork. Source A: `image-gen-1(5).png` (Aeldari 3×3). Source B: `image-gen-2(5).png` (Emperor’s Children 5×2). Defiler and the additional champion artwork are excluded because they are outside the selected datasheets.

| Datasheet | Token | Sheet cell (row, column) |
| --- | --- | --- |
| Farseer / Warlock | aeldari-seer | A 1,1 |
| Autarch | aeldari-autarch | A 1,2 |
| Dire Avengers | aeldari-avenger | A 1,3 |
| Fire Dragons | aeldari-dragon | A 2,1 |
| Storm Guardians | aeldari-guardian | A 2,2 |
| Rangers | aeldari-ranger | A 2,3 |
| Dark Reapers | aeldari-reaper | A 3,1 |
| Night Spinner | aeldari-spinner | A 3,2 |
| Wave Serpent | aeldari-serpent | A 3,3 |
| Lord Exultant | ec-exultant | B 1,1 |
| Sorcerer | ec-sorcerer | B 1,2 |
| Lord Kakophonist | ec-kakophonist | B 1,3 |
| Infractors | ec-infractor | B 1,4 |
| Tormentors | ec-tormentor | B 1,5 |
| Flawless Blades | ec-blade | B 2,1 |
| Noise Marines | ec-noise | B 2,2 |
| Chaos Rhino / Chaos Land Raider | ec-tank | B 2,3 |

Portraits are approximate, deliberately shared for Warlock/Farseer and the two Chaos vehicles. Size, name and stats distinguish those units. `unitPresentation.ts` owns the mapping; `tokenArt.ts` owns static React Native asset requires. Assets do not enter game snapshots.

## Multi-model rendering and bases

BattlefieldView renders **every living runtime Model**, at its authoritative continuous tabletop position with its own base diameter. Casualties stop rendering. A five-model squad produces five bases; ten models produce ten bases. Attached leaders/support retain the original component definition's portrait rather than being replaced by the bodyguard picture. The unit strip reports the runtime count, which includes added leaders/support models. Embarked and unplaced units are available in the unit strip but do not appear stacked at (0,0).

No visual formation rewrites game positions. Deployment ghost positions are a preview of one engine-approved formation; they are applied only after confirmation. Physical base size is multiplied by the existing game-to-screen transform; metadata labels Infantry, Elite, Heavy, Leader, Vehicle and Large vehicle aid recognition. Existing circular vehicle proxies remain authoritative; this task does not invent rectangular collision hulls.

Zoom and panning only affect rendering. The board starts at 720px wide with zoom up to 3×, so infantry bases are selectable in a mobile viewport. Names and per-model selection buttons also provide selection without precise pointer aim. The tactical world remains continuous; green dots are engine-approved candidate positions, not grid cells or an exhaustive reachable-area mask.

## Guided commands

1. Select a friendly unit from its portrait strip or a base.
2. Choose a named legal command (Move unit, Shoot, Deploy unit, etc.). Global setup/phase/reaction commands remain available.
3. Select a model, destination, or weapon/target option as appropriate.
4. Review the pending command and press CONFIRM ACTION.
5. Complete the unit transaction using the matching completion command. Cancel unit move uses the existing deterministic movement cancellation.

The fixed header always shows the next instruction, round/phase and CP/VP. Yellow rings select the squad; numbered models distinguish members; green rings indicate legal targets; blue/pink rings distinguish factions. During AI control the command panel waits; reactions still return control through PlaySession. All listed choices remain accessible (no 40-action truncation).

`playCommands.ts` handles names, ownership and presentation grouping only. Legality comes from getHumanActions / engine previews and is revalidated by PlaySession.submit. A custom normal/combat move uses the existing preview validator. Setup and reaction move taps select the closest **existing legal suggestion**; the UI does not calculate new legal formations. An invalid custom destination stays uncommitted and disables confirmation.

## Limits

- This is an interaction improvement, not finished art or animation.
- Models move individually, then the unit move must be completed; no automatic squad translation is introduced.
- Deployment/reaction positions are bounded engine suggestions. Click-to-target selects the first displayed matching weapon/target option; the confirmation names the weapon, and alternate options remain visible.
- No exhaustive threat-range overlay, grid, or changed targeting rules. No new elevation selector.
- In-memory matches still reset on page refresh. Browser AI performance limitations remain.
- Vaul's Vengeance reaction Shooting does not expose nested mid-roll reaction pauses.

## Validation and publication

Eight presentation tests cover all 19 token references, model counts/casualties, attached component portraits, vehicle base proxies, detached setup coordinates, command ownership and labels/highlights. App/engine typechecks, Web and Android exports and browser smoke interactions verify the shared app. The existing GitHub regression workflow remains unchanged.

The Pages workflow additionally deploys `feature/task-014-unit-tokens-play-ux` before merge to the existing public playtest URL, https://rataplaian.github.io/War-Millenum-Tactics/. Pull requests build only. No automatic merge.
