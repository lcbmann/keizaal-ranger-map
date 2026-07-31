# Ranger Atlas Skyrim Platform marker bridge

This plugin is the native Skyrim map-marker side of the Ranger Atlas
integration. It waits until the player is outdoors in the Tamriel worldspace,
then polls the Ranger Atlas SKSE bridge for the official Trailmark snapshot.
Each Trailmark is cloned from Skyrim's vanilla Riverwood map-marker reference,
moved to the calibrated Atlas coordinate, renamed, and added to the native map.

It contains no ESP, ESM, or ESL. The companion `RangerAtlas.dll` only provides
the loopback bridge and player position; it does not construct map-marker
metadata. The browser Atlas remains the source of truth.

Build with `npm install` and `npm run build`. Install the generated file at:

```text
Skyrim Special Edition\Data\Platform\Plugins\ranger-atlas-skyrim-platform.js
```

The browser Atlas must have Live position enabled. Official Trailmarks are
sent to the local bridge when the Guild Atlas loads or changes. Do not save
while testing temporary native markers.
