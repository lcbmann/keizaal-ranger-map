# Ranger Atlas SKSE Integration

This project is being introduced in compatibility-gated stages.

## Stage 1: local position reader

The `0.5.0` build initializes as an SKSE DLL and waits for SKSE's
post-load/new-game signal. It then reads the local player's position on
Skyrim's main thread every five seconds. A separate scheduler only queues the
captures; it never reads Skyrim state itself. The plugin writes:

- a readable entry to `RangerAtlas.log`;
- the latest coordinates and form IDs to `RangerAtlasPosition.json`.

After the character enters the world, it also serves the same snapshot from
`http://127.0.0.1:38471/position`. The bridge binds only to the local loopback
interface and makes no outbound requests.

It performs no position work during Keizaal login or character selection. It
still has no ESP, ESM, or ESL; no gameplay hooks; no outbound networking; and
no Skyrim Platform JavaScript.

## Field controls

The `0.5.0` build adds three optional keyboard controls after the character has
entered the world:

- `F7` queues a mark at the current outdoor Skyrim position. The open Atlas
  page receives the event and opens a draft mark using the calibrated map
  coordinates.
- `F8` asks the open Atlas page to open the nearest official Trailmark's
  field-drop dialog. The Ranger still writes and submits the message in the
  browser, where the existing Discord link and permissions are used.
- `F6` opens a safe native Skyrim instruction box listing the field actions.
  Press OK, then use `F7` or `F8`; the Atlas
  page must be open in the browser to receive the selected action.

This build does not embed a miniature copy of the Atlas map inside Skyrim yet;
the native menu is only a safe action launcher while the map remains in the
browser.

The local bridge now exposes `GET /events` on loopback. It contains a bounded
queue of recent field actions and never sends data outside the local computer.
The website consumes each action once per browser using a local event cursor.
The native controls are intentionally limited to the outdoor Skyrim world;
interiors are rejected because they do not have a stable position on the
province map.

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
```
