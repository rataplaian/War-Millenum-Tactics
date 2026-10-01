# Task 013B — Browser Playtest

## One application

Expo SDK 57 exports the existing `index.ts` / `App.tsx` application through React Native Web. PLAY, both faction choices, AI Standard, Proving Ground and DEBUG use the same UI, session, rules and engine as Android. There is no web-specific game implementation.

Expo-recommended dependencies: react-dom 19.2.3, react-native-web ~0.21.0, @expo/metro-runtime ~57.0.15. Native configuration and mobile scripts remain unchanged. Task 013A stays on its separate branch/PR; this branch starts from main and does not remove its pending Android changes.

## Export

```sh
npm ci
npm run export:web
```

Expo uses Metro **at build time only** to produce `dist/`. The deployed SPA runs without a development server, Expo token, backend or local PC. `web.output: single` and `web.bundler: metro` are explicit. `experiments.baseUrl` prefixes assets with `/War-Millenum-Tactics`, including the capital letters used in the repository name.

The app uses in-memory screen navigation, so no extra deep-link routes or Pages 404 rewriting is needed. Open the root URL ending in `/`. Refreshing closes the current in-memory match; persistent saves are outside this task. Generated artifacts remain ignored by Git.

## GitHub Pages workflow

`.github/workflows/web-preview.yml` installs the lockfile, checks app/engine types, exports the SPA and uploads it with official Pages actions. Pull requests build only. Pushes to `feature/task-013b-browser-playtest` or `main` build and deploy to the same preview URL; the feature branch allows testing before merge. No merge is performed by the workflow. Concurrent deployments are serialized/cancelled in favor of the newest run.

Expected public URL after a successful Pages deployment:

https://rataplaian.github.io/War-Millenum-Tactics/

Initial repository setup may require the owner to select **GitHub Actions** as the publishing source under **Settings → Pages → Build and deployment**. The connector cannot administer repository settings. If GitHub's `github-pages` environment restricts deployment branches, the Task 013B branch must be allowed there as well. Retry the failed deployment after enabling Pages. No personal access token or Expo credentials are needed; deployment uses the workflow's short-lived GitHub token and OIDC permissions.

## Validation scope

- Web production export, app and engine typechecks, whitespace checks.
- Android production bundle export as a compatibility check (not an APK or real-device test).
- Browser smoke check of the exported assets under the actual repository subpath, at mobile and desktop viewport sizes.
- No engine changes and no local multi-seed simulations. Existing GitHub regression CI still runs according to the repository's existing workflow.

This is the existing functional prototype UI, not a redesign. AI work runs in the browser and may pause rendering on slower devices. Existing reaction-shooting limitations remain unchanged.

References: https://docs.expo.dev/guides/publishing-websites/ and https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
