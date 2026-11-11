# Privacy Policy for Posture Check

Last updated: 10 November 2026

## The short version

Posture Check does not collect, store, or transmit any personal data. Everything it
does happens on your own computer.

## What the extension accesses

**Your webcam.** When you switch Posture Check on, it opens your camera and runs a pose
detection model to work out where your head and shoulders are. The model file ships
inside the extension and runs locally in your browser.

Video frames are held in memory only for as long as it takes to measure one frame, and
are then discarded. No image, no video, and no recording is ever saved, uploaded, or
shown to anyone. The camera is released as soon as you switch the extension off.

## What is stored

Two things, both kept on your own machine in your browser's local extension storage:

- **Your settings:** sensitivity, alert delay, and whether the sound and notifications
  are turned on.
- **Your calibration baseline:** a handful of numbers describing the proportions of your
  upright posture, for example the distance between your shoulders relative to the frame.
  It is not an image and cannot be used to reconstruct one.

Uninstalling the extension deletes both.

## What is transmitted

Nothing. Posture Check makes no network requests while running. The pose model and all
of its supporting files are bundled with the extension rather than downloaded, so the
extension works with no internet connection at all.

## Third parties

There are none. No analytics, no crash reporting, no advertising, and no data is sold,
shared, or transferred to anyone.

## Permissions

The extension requests the permissions it needs to do the above and nothing more:
camera access for posture detection, local storage for your settings and baseline,
notifications and text to speech for the alerts, an offscreen document to run the camera
in the background, alarms to keep that background process alive, and tabs access limited
strictly to finding and closing the extension's own calibration window.

## Contact

Questions about this policy can be raised at
https://github.com/evanhosni/posture-check/issues
