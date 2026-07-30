# Ranger Atlas Native Marker Test

This Skyrim Platform test checks whether a dynamically cloned vanilla MapMarker
keeps enough marker metadata to appear on Skyrim's native world map.

It contains no ESP, ESM, or ESL and does not enable fast travel.

## Controls

- `F10`: Create one marker named `Ranger Atlas Native Marker Test` at the
  player's current outdoor position.
- `F11`: Disable and delete the test marker.

Use a disposable save, remain outdoors in the Tamriel worldspace, do not save
during the test, and press `F11` before quitting.

## Build

```powershell
npm install
npm run build
```

The output is `build/ranger-atlas-native-marker-test.js`. For a manual
installation, copy it to:

```text
Skyrim Special Edition\Data\Platform\Plugins\
```

For Vortex, install an archive containing:

```text
Platform\
  Plugins\
    ranger-atlas-native-marker-test.js
```
