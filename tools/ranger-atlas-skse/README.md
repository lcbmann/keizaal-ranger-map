# Ranger Atlas SKSE Integration

This project is being introduced in compatibility-gated stages.

## Stage 1: local position reader

The `0.7.7` build initializes as an SKSE DLL and waits for SKSE's
post-load/new-game signal. It then reads the local player's position on
Skyrim's main thread every five seconds. A separate scheduler only queues the
captures; it never reads Skyrim state itself. The plugin writes:

- a readable entry to `RangerAtlas.log`;
- the latest coordinates and form IDs to `RangerAtlasPosition.json`.

After the character enters the world, it also serves the same snapshot from
`http://127.0.0.1:38471/position`. The bridge also accepts a complete official
Trailmark snapshot at `POST /markers` and serves it to the companion Skyrim
Platform plugin at `GET /markers`. The bridge binds only to the local loopback
interface and makes no outbound requests.

It performs no position work during Keizaal login or character selection. It
still has no ESP, ESM, or ESL and no outbound networking.

## Field controls

The `0.7.7` build adds an in-game Ranger Atlas action menu after the character has
entered the world:

- `F7` opens the Ranger Atlas menu. Press `F8` for a mark or `F11` for a
  nearby Trailmark drop after closing the menu.
- `F8` queues a mark at the current outdoor Skyrim position. The open Atlas
  page receives the event and opens a draft mark using the calibrated map
  coordinates.
- `F11` asks the open Atlas page to open the nearest official Trailmark's
  field-drop dialog. The Ranger still writes and submits the message in the
  browser, where the existing Discord link and permissions are used.
- `Insert` opens a safe native Skyrim instruction box listing the field actions.
  The Atlas page must be open in the browser to receive the selected action.

This build does not embed a miniature copy of the Atlas map inside Skyrim yet;
the native menu is only a safe action launcher while the map remains in the
browser.

The local bridge now exposes `GET /events` on loopback. It contains a bounded
queue of recent field actions and never sends data outside the local computer.
The website consumes each action once per browser using a local event cursor.
Atlas shortcut events are consumed by the plugin after they are queued, without
rewriting Skyrim's input event data, so they do not fall through to other menu
or gameplay handlers.
The native controls are intentionally limited to the outdoor Skyrim world;
interiors are rejected because they do not have a stable position on the
province map.

The plugin also waits for an outdoor Tamriel world instead of assuming that a
normal save-load signal means the player is ready. This matters for SkyMP
character selection and other server-managed transitions.

## Native Skyrim map markers

The `0.7.7` release moves native marker creation out of the C++ DLL. The
companion `ranger-atlas-skyrim-platform.js` plugin performs the known-working
`placeAtMe`/`addToMap` operation from Skyrim Platform, one marker per update,
only after outdoor Tamriel is confirmed. The C++ DLL never constructs
`ExtraMapMarker` data. The Platform plugin waits for Skyrim's completed-load
signal and for `MapMenu` to be open before it creates a marker. It creates one
temporary marker at a time; closing the map disables those temporary markers.
This separation is intentional for SkyMP's server-managed load transitions.

The DLL itself is dormant during the title screen and Keizaal login. Its
position worker starts only after SKSE reports a post-load or new-game signal.
The Platform plugin is completely dormant during title/login. It does not
register a gameplay update path, call the local bridge, or run a startup hook.
It registers the temporary gameplay update handler only after the native
`MapMenu` opens, and unsubscribes it when the map closes. At that point the
player is already in the world, so it can inspect Skyrim state and synchronize
the temporary Trailmark markers safely.
The Platform plugin also creates its loopback HTTP client lazily, after the
completed-load/map-open path begins.

Install both files from the release archive:

```text
SKSE/Plugins/RangerAtlas.dll
Platform/Plugins/ranger-atlas-skyrim-platform.js
```

Keep the browser Atlas open with **Live position** enabled to send the current
official Trailmark snapshot. Do not save while testing temporary native markers.

## Optional Trailmark visits

The website can use the local position snapshot to detect arrival at an
official Guild Trailmark. Visit recording is off by default and requires a
name under **Signed As**. When enabled, the website sends only the Trailmark
location ID, entered Ranger name, and visit time to Supabase. Exact
coordinates and movement history remain on the player's computer.

Discord linking is also optional. Wayfinder creates a one-time code, the
website exchanges it for a browser-specific device token, and a Trailmark
arrival can then request temporary access to the matching private Discord
channel. The DLL itself still makes no outbound requests.

## Package layout

```text
SKSE/
  Plugins/
    RangerAtlas.dll
Platform/
  Plugins/
    ranger-atlas-skyrim-platform.js
```
