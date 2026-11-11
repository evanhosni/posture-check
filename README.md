# Posture Check

A Chrome and Firefox extension that watches you through the webcam and sounds off
when you start slouching. Pose estimation runs locally — the video never leaves
the machine, and the extension makes no network requests at runtime.

## Install in Chrome (unpacked)

```bash
yarn
yarn build:chrome
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `dist` folder in this repo.
4. Pin the extension so the icon stays visible.

There is no page and no panel. The toolbar icon is the switch:

- **Grayed out** — off. This is the default; nothing runs.
- **Click it** — a window opens in the middle of the screen reading "Calibrating
  posture / Sit up straight.", showing the camera and a bar that fills over five
  seconds, then closes itself.
- **Blue `…` badge** — calibrating, or loading the pose model and opening the
  camera.
- **In color** — on and watching. Click again to turn it off.
- **Red `!` badge** — your posture has gone bad right now, whether or not the
  alert delay has elapsed yet.

The calibration window is where camera access is granted. It asks every time it
opens, hands the camera straight back, and nothing starts measuring until it has
been allowed — an offscreen document cannot raise that prompt itself.
**Recalibrate now** works with the extension switched off.

If Chrome refuses to open the camera from the offscreen document, the extension
reports the error in the settings dialog and keeps retrying rather than opening
a window for it.

Settings live in a dialog: right-click the icon → **Options**. Sensitivity
(1-10, default 5), the alert delay (default 5s), the sounds, desktop
notifications (off until you turn them on), plus
**Recalibrate now** and **Test alert**. Calibration is always 5 seconds.

## Install in Firefox (temporary)

```bash
yarn build:firefox
```

Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick
`dist-firefox/manifest.json`. Firefox has no offscreen-document API, so the
camera can only run in a visible page: switching on opens a small monitor window
that has to stay open. Temporary add-ons are also dropped on restart.

## How it decides posture is bad

Each frame, MediaPipe's pose model returns body landmarks. Four numbers come out
of the nose, ears and shoulders, all normalized by shoulder width so they survive
moving around in the chair:

| Metric | What it catches |
| --- | --- |
| Ear-to-shoulder gap | Head sinking toward the shoulders |
| Shoulder width | Leaning in toward the screen |
| Shoulder slope | Collapsing onto one side |
| Head offset from shoulder center | Head drifting off center |

When any metric strays far enough from the calibrated baseline for the
configured number of seconds, a two-wail siren plays, a robotic voice announces
"Bad posture alert", and a desktop notification fires. The alert repeats at most
once a minute while posture stays bad, and re-arms after three seconds of
sitting well again.

Sensitivity is a 1-10 dial that scales every threshold, doubling every five
steps: 5 is neutral, 1 is forgiving but still catches a real slouch, and 10
reacts to small movements. Switching on always recalibrates, so the baseline matches how
you are sitting right now.

## Layout

```
src/            Camera-to-verdict core, independent of any extension API
  watcher.ts    PostureWatcher: camera, detection loop, scoring, alert timing
  metrics.ts    Landmarks -> posture metrics -> verdict
  alerts.ts     Siren, voice and notification
  pose.ts       MediaPipe pose landmarker setup
  overlay.ts    Skeleton drawing helper
extension/
  background.ts Service worker: the on/off switch, icon state, calibration UI,
                notifications and the camera host's lifecycle
  shared/       Settings, message protocol, PostureWatcher-to-worker binding
  offscreen.*   Chrome's invisible background camera host
  monitor.*     The camera host on Firefox, which has no offscreen document
  options.*     The settings dialog
extension/icon-source.png  The image every icon size is rendered from
scripts/        Bundled wasm + model download, icon generation, manifest writing
```

Only one place holds the camera at a time: the calibration window while it is
open, otherwise the offscreen document on Chrome and the monitor window on
Firefox.

## Development

```bash
yarn dev:chrome      # rebuild dist/ on change, then hit Reload in chrome://extensions
yarn dev:firefox     # the same for dist-firefox/
yarn typecheck
yarn build:chrome    # Chrome -> dist/
yarn build:firefox   # Firefox -> dist-firefox/
yarn package:chrome  # Chrome -> posture-check-chrome.zip, for the Web Store
yarn package:firefox # Firefox -> posture-check-firefox.zip, for addons.mozilla.org
```

`yarn assets` (run by the builds) copies the MediaPipe wasm runtime out of
`node_modules` and downloads the pose model into `extension/public`, so the
packed extension loads everything from its own origin — MV3 forbids pulling code
from a CDN at runtime.

## Notes

- The pose model is ~6 MB, so the unpacked extension is ~38 MB. None of it is
  fetched at runtime.
- Chrome 116+ (offscreen documents) and Firefox 128+ (MV3 module background).
- Recalibrate from the settings dialog after changing chair or desk position,
  or just toggle off and on.
