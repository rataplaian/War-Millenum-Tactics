# Android internal preview

The `preview` EAS Build profile produces a standalone release APK with its JavaScript bundle included. Users install it directly on Android: no Metro, Expo Go, Play Store account, or development client is required. This task does not configure iOS builds.

## Repository configuration

- Application ID: `com.rataplaian.warmillenniumtactics`.
- Version: app config; Android version code starts at `1` (`appVersionSource: local`).
- `eas.json`: internal distribution, Android `buildType: apk`, Node 24.19.0, Android build image `latest`.
- No invented Expo owner or project ID. EAS must create/link the real project first.
- EAS CLI is run through `npx`; no application dependency changes are needed.

## First build from the Codex cloud workspace

No commands need to run on the user's PC. An Expo account with access to the intended project is required.

1. Sign in at https://expo.dev/ and create an access token under Account settings → Access tokens (https://expo.dev/settings/access-tokens).
2. Provide that token through the cloud execution environment's secure secret configuration as `EXPO_TOKEN`. Never commit it or paste it into a PR, document, or chat. Merely connecting the Expo GitHub App does not authenticate this CLI workspace. If this workspace offers no secure secret input, an authenticated execution environment is required before continuing.
3. In the authorized cloud workspace, run:

   ```sh
   npx eas-cli@24.8.0 whoami
   npx eas-cli@24.8.0 init
   npx eas-cli@24.8.0 build --platform android --profile preview
   ```

   Select the intended Expo account/project during initialization. Commit only the actual `extra.eas.projectId` (and owner if EAS adds it), on the same feature branch. Let EAS generate/manage the Android signing keystore when prompted; retain that keystore for future updates. Do not commit credentials.
4. Follow the EAS build page until the build succeeds. Share its installation URL and APK download link. Submission alone is not build success. No build ID or installation URL exists before a real build is created.

The CLI's browser login redirects to localhost on the machine running EAS. Opening that login URL on a separate phone does not authenticate this cloud workspace.

## Optional subsequent builds from GitHub in a web browser

After the first successful CLI build has initialized project and signing credentials:

1. In Expo account settings → Connections, connect GitHub and install/authorize the Expo GitHub App for `rataplaian/War-Millenum-Tactics`.
2. In the EAS project → Settings → GitHub, link this repository.
3. Under Builds → Build from GitHub, select the intended branch, Android, and profile `preview`. The repository root is the app directory. During review, select `feature/task-013a-android-preview`; use `main` only after a separately authorized merge includes this configuration.

GitHub CI typechecks/tests are not an APK build. No Play Store submission is configured.

## Install and verify

Open the successful EAS build's installation link on Android, download the APK, and allow installation from that browser when Android prompts. Launch the app; Metro is unnecessary. Signing-key changes can prevent upgrading an existing installation. A cloud build/export does not prove real-device behavior; device testing must be reported separately.

## References

- https://docs.expo.dev/build-reference/apk/
- https://docs.expo.dev/build/internal-distribution/
- https://docs.expo.dev/build/building-from-github/
- https://docs.expo.dev/accounts/programmatic-access/

## Current validation status

Repository configuration is ready for EAS initialization. At preparation time the workspace was not logged in and had no `EXPO_TOKEN`; no remote build, signing credentials, project ID, or APK installation URL was created.
