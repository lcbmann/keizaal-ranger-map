# Ranger Atlas SKSE Integration

Ranger Atlas `0.18.6` is a native CommonLibSSE-NG/SKSE plugin with no ESP,
ESM, ESL, Papyrus, or Skyrim Platform component. Its MapMenu surface is a
custom Scaleform menu. Its compact nonblocking Travel View uses SKSE Menu
Framework.

## Map Companion

Opening Skyrim's normal map with `M` places a full-screen illustrated Ranger
Atlas surface over it. The implementation follows Skyrim's normal custom-menu
pattern: a registered `IMenu`, a packaged SWF, and structured state supplied
from C++. It does not depend on Map Menu Extension or copy its hooks. Skyrim's
3D MapMenu is hidden while the Atlas is active so it cannot receive movement,
cursor, or hover input. Pressing `Tab` switches to Skyrim's native map.

The companion renders:

- the calibrated illustrated Skyrim map and smoothed player heading;
- all official Trailmarks, with an emphasized Headquarters marker;
- authoritative Cities and Towns;
- visible personal and Guild marks;
- visible routes, bounded and sampled for stable rendering cost;
- exact nearest-Trailmark distance, direction, and range state;
- Trailmark directions, recent visitors, check-in, and Wayfinder field drops;
- a field clipboard that can save notes or create a personal landmark;
- linked Ranger identity, rank and medals;
- separate in-Skyrim and Discord-online counts;
- Skyrim's current in-game date and time.

Clicking a mark selects the same entry in the browser Atlas. The native detail
pane follows browser selection in return. Nearby Trailmark actions and field
notes are available directly from the right panel and footer. Mouse wheel
zooms, dragging pans, `Home` resets the view, `R` refreshes the browser
snapshot, `Tab` or **Normal Map** switches to Skyrim's map, and `M` or `Escape`
closes the active map surface. **Travel View** opens the compact nonblocking
map. The footer's opening-mode control switches between:

- **M: Atlas | F7: Travel** (default); and
- **M: Normal | F7: Atlas**.

The choice is saved per player in
`Documents/My Games/Skyrim Special Edition/SKSE/RangerAtlas.ini` and survives
mod upgrades.

If the SWF is missing, opening `M` falls back to the existing Menu Framework
Map Companion. No map object is created, moved, or replicated, so either path
remains local to the client and cannot produce shared SkyMP references.

## Travel View and fallback console

In the default opening mode, press `F7` outdoors for the compact Travel View.
It keeps Skyrim running and shows the live illustrated map, Ranger identity and
presence, and nearest-Trailmark navigation in Pocket, Compact, Standard, or
Large sizes. The same view is available from the full Atlas footer.

The former full F7 console remains compiled only as a recovery path if the
Scaleform Atlas asset is missing. Check-in, visitor logs, field drops, selected
entry details, and Field Notes now live in the M Atlas instead of requiring a
second interface.

Trailmark is intentionally absent from the native category picker. Official
Trailmarks, Cities, and Towns remain authoritative Marshal-controlled data.

## Runtime model

The plugin waits for SKSE's post-load/new-game signal and then for an outdoor
Tamriel world before registering controls, Menu Framework windows, or the
MapMenu listener. It does no map or position work at title screens, character
selection, or during a save transition.

Player state is read on Skyrim's main thread four times per second. A worker
serializes the already-captured values and updates the loopback bridge. Only a
single main-thread capture can be pending. Human-readable position logging and
the disk snapshot are throttled to once every 30 seconds.

The bridge binds only to `127.0.0.1:38471` and exposes:

- `GET /position` for the latest local player sample;
- `POST /field-state` and `GET /field-state` for the browser/native view model;
- `GET /events` for a bounded queue of native field actions;
- `POST /markers` and `GET /markers` as a compatibility fallback.

The DLL makes no outbound request and stores no Discord or Supabase token. The
browser Atlas remains the authenticated data owner and processes native field
actions.

## Performance boundaries

The browser sends a compact native snapshot only when state changes. The
native view caches parsed state and refreshes at most four times per second.
Map payloads are capped at 80 ordinary marks and 16 visible routes, with each
route sampled to at most 160 points. Texture loading is lazy and badge textures
are cached.

## Compatibility

The `0.18.6` local test is built for the established Keizaal Skyrim
`1.6.1170` environment and the older Address Library runtimes supported by the
current universal CommonLibSSE-NG package. Bethesda's `1.7.x` executable line
requires a separate dependency and licensing migration; it is not claimed by
this binary until that build has been compiled and tested independently.

Required runtime components:

- SKSE matching the installed Skyrim executable;
- Address Library for SKSE Plugins;
- SKSE Menu Framework and its listed requirements.

## Package layout

```text
SKSE/
  Plugins/
    RangerAtlas.dll
    RangerAtlas/
      field-map.jpg
      badges/
Interface/
  rangeratlasmenu.swf
```

The package includes a 4:3 optimized copy of the official illustrated map and
all current Ranger rank and medal artwork. Illustrated Skyrim map artwork is by
[@islor](https://www.instagram.com/islor/).

The unsupported historical Skyrim Platform marker experiment remains excluded
from the release. If it was ever installed manually, remove:

```text
Data/Platform/Plugins/ranger-atlas-skyrim-platform.js
Data/Platform/Plugins/ranger-atlas-native-marker-test.js
```

## Building the Scaleform surface

The SWF is generated from the ActionScript 2 source in `scaleform/` with the
open-source MTASC and swfmill toolchain. Set `MTASC_EXE`, `MTASC_CLASSPATH`,
and `SWFMILL_EXE`, ensure `ffmpeg` is available, then run:

```powershell
.\scaleform\build-scaleform.ps1
.\scaleform\build-scaleform.ps1 -Preview
```

The second command builds a populated Ruffle QA fixture; only
`rangeratlasmenu.swf` belongs in the Skyrim package.
