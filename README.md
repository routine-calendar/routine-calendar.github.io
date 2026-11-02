# routine-calendar.github.io

GitHub Pages organization site (organization **routine-calendar**, owned by **wojpaj**) for the **Routine Calendar** Android app (`com.routinecalendar.app`, source in `D:\Apps\routine-calendar`).
It does two things:

1. **Android App Links verification.** `/.well-known/assetlinks.json` tells Android that `https://routine-calendar.github.io` links may
   be opened directly by the app signed with the listed certificate.
2. **Shared routine page.** The app shares a routine as
   `https://routine-calendar.github.io/routines/create?shared=<payload>` (`<payload>` is the base64url of the UTF-8 JSON of a
   `RoutineTemplate` v1). With the app installed and verified, Android opens the app directly, the app adds the routine by itself
   and this site is never contacted. Otherwise `routines/create.html` shows a read-only preview and, on Android, **opens the app
   automatically at once** (no choice to make) through a Chrome `intent://` URL to the `routinecalendar://` route; the app then adds
   the routine by itself, exactly as it was shared. Only when that cannot work does the page show a fallback with the reason,
   **Copy link** and numbered steps for the app's Import shared routine card (plus **Try opening the app again** where a retry can help):
   - the app is not installed (Chrome comes back through the intent's `S.browser_fallback_url`, this page with `&fallback=1`),
   - the page is still visible 2.5 s later (the browser ignored or blocked the intent),
   - the device is not Android (desktop, iOS),
   - the payload is longer than 100,000 characters (too long for a reliable intent; the app's paste card still accepts up to 256 KiB),
   - the link is damaged (only the error is shown) or comes from a newer app version (update the app, then retry).

There is no build step, no framework and no tracking: plain HTML, CSS and JavaScript.

## Files

| Path | Purpose |
| --- | --- |
| `.well-known/assetlinks.json` | Digital Asset Links statement: package name + SHA-256 signing certificate fingerprint(s). |
| `.nojekyll` | Turns Jekyll off, so GitHub Pages publishes the `.well-known` folder (Jekyll skips dot folders). |
| `routines/create.html` | Shared routine page; GitHub Pages serves it at `/routines/create` (same path as the app route). |
| `assets/share.js` | Reads `?shared=`, decodes it like `src/features/routineTemplate/shareCodec.ts`, renders the preview with `textContent` only, opens the app automatically or shows the fallback. English or Polish from the browser language. |
| `assets/style.css` | Styles, light and dark (brand color `#087F70`). |
| `assets/icon.png`, `assets/favicon.png` | Copied from the app's `assets/images/`. |
| `index.html` | Short home page. |
| `404.html` | Not-found page; `/routines/create/` (trailing slash) is redirected to `/routines/create` with the query kept. |
| `robots.txt` | Keeps `/routines/` out of search engines (the page also sets `noindex` and `no-referrer`). |

## Publish (one time)

1. On GitHub, inside the organization **routine-calendar** (not on the personal account), create a **public** repository named
   exactly **`routine-calendar.github.io`**, without a README, .gitignore or license. Only an organization or user site
   (`<name>.github.io`) is served at the domain root, which App Links require for `/.well-known/`.
2. Push this folder:

   ```sh
   cd D:\Apps\routine-calendar.github.io
   git init -b main
   git add .
   git commit -m "Routine Calendar share pages and App Links"
   git remote add origin https://github.com/routine-calendar/routine-calendar.github.io.git
   git push -u origin main
   ```

3. Repository **Settings > Pages**: Source **Deploy from a branch**, branch **main**, folder **/ (root)**. Keep
   **Enforce HTTPS** on (default for `github.io`).
4. Wait for the deployment (Actions tab, about a minute), then check:
   - <https://routine-calendar.github.io/.well-known/assetlinks.json> returns the JSON (HTTP 200, `application/json`, no redirect).
   - Google's checker: <https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://routine-calendar.github.io&relation=delegate_permission/common.handle_all_urls>
   - <https://routine-calendar.github.io/routines/create?shared=eyJ2ZXJzaW9uIjoxLCJuYW1lIjoiVGVzdCJ9> shows a routine called "Test".

## Connect the app

The app side (in `D:\Apps\routine-calendar`) declares an `autoVerify` intent filter for `https://routine-calendar.github.io/routines/create`
in `app.json` and builds share links with this origin. After changing `app.json`, a **new native build** is required
(`npx expo prebuild` / `npx expo run:android` or the local release build); a JavaScript reload is not enough.

Android verifies the domain when the app is installed (it needs internet then). Check or retry on a device:

```sh
adb shell pm get-app-links com.routinecalendar.app        # routine-calendar.github.io: verified
adb shell pm verify-app-links --re-verify com.routinecalendar.app
adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
  -d "https://routine-calendar.github.io/routines/create?shared=eyJ2ZXJzaW9uIjoxLCJuYW1lIjoiVGVzdCJ9"
```

If the state is not `verified`, the link opens this page in the browser instead, and the page opens the app automatically.
On the phone, **Settings > Apps > Routine Calendar > Open by default** shows the link state and lets you add it manually.

## Signing certificate

`assetlinks.json` lists the SHA-256 fingerprint of the certificate that signs the APK. Today both debug and release builds of the
app are signed with `android/app/debug.keystore` (see `android/app/build.gradle`), whose fingerprint is:

```
FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C
```

That is the public React Native template debug key: fine for a personal sideloaded app, but anyone could sign an app with it.
When you switch to your own release keystore (or Google Play App Signing), add its fingerprint to the array (keep the old one
while old installs exist) and push:

```sh
keytool -list -v -keystore <your.keystore> -alias <alias>   # copy the "SHA256:" line
```

For Play App Signing, copy the fingerprint from Play Console > Setup > App signing (it also offers a ready `assetlinks.json`).

## Privacy and limits

- The routine travels inside the link. When the app opens it, nothing is sent anywhere. When the page opens in a browser, the
  full URL (with the routine) reaches GitHub Pages like any web request; the page itself sends nothing further, stores nothing,
  sets no cookies and loads no third-party resources.
- Photos are never part of a shared routine.
- Very large routines make very long URLs. Typical routines are a few hundred to a few thousand characters; a link longer than
  roughly 8 KB may be refused by the GitHub Pages servers (HTTP 414) when it is opened in a browser. Opening it in the app is not
  affected, and the app's paste import accepts the same link.
