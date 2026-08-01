# Ranger Atlas SKSE Integration

This project is being introduced in compatibility-gated stages.

## Field Console

`0.12.0` adds an optional native **Field Console**. It is a real in-game C++
window, not a Skyrim Platform script and not a temporary Skyrim map marker.
Press `F7` after entering the outdoor Skyrim world to open it.

The Menu Framework window is created only after that first `F7`
press. Ranger Atlas performs no menu registration, texture loading, or UI
rendering during Keizaal character selection and outdoor terrain startup.

The console requires [SKSE Menu Framework](https://www.nexusmods.com/skyrimspecialedition/mods/120352)
to be installed alongside Ranger Atlas. It is an SKSE DLL dependency, not an
ESP/ESM/ESL. If it is absent, Ranger Atlas simply shows a notification and does
not open the console; the rest of the local bridge remains unchanged.

Keep the Atlas page open in a browser with **Live position** enabled. The page
remains the local Atlas store and Discord/Supabase session; the in-game console
uses the loopback bridge to drive it. This deliberately avoids putting a
Discord device token or Supabase credential into the DLL.

From the Field Console a Ranger can:

- see a bordered Skyrim atlas with a smoothly interpolated, heading-aware live player pointer, distinct Trailmark flags, exact range rings, and a gold route to the nearest Trailmark;
- read distance in metres and compass direction, with the nearest three Trailmarks listed when travelling outside the 20-metre Trailmark radius;
- see the closest official Trailmark, radius state, its notes, and recent visits;
- record or refresh a nearby Trailmark visit;
- write and send a field drop without tabbing out;
- create and categorize a named field mark at the current outdoor position.

Opening with `F7` starts in interactive mode, which captures the cursor for the
Field and Mark tabs without pausing the multiplayer world. **Travel view**
releases Skyrim's controls and can use a Compact, Standard, or Large live map.
`F7` closes either view; opening it again returns to the interactive console.

The resulting mark is saved directly into the local Atlas copy. Rangers can
edit it later in **Edit Atlas**. Trails, ranges, sharing, and Guild publishing
remain browser-only administrative work for this release.

## Stage 1: local position reader

The `0.12.0` build initializes as an SKSE DLL and waits for SKSE's
post-load/new-game signal. It then reads the local player's position on
Skyrim's main thread four times per second. A separate scheduler only queues
one capture at a time; it never reads Skyrim state itself. Diagnostic logging
and the readable position file remain throttled to once every five seconds.
The plugin writes:

- a readable entry to `RangerAtlas.log`;
- the latest coordinates and form IDs to `RangerAtlasPosition.json`.

After the character enters the world, it also serves the same snapshot from
`http://127.0.0.1:38471/position`. The bridge also accepts a complete official
Trailmark snapshot at `POST /markers` and makes it available to the native
Field Console. The bridge binds only to the local loopback
interface and makes no outbound requests.

It performs no position work during Keizaal login or character selection. It
still has no ESP, ESM, or ESL and no outbound networking.

## Field Console control

The `0.12.0` build uses one in-game shortcut after the character has entered
the outdoor world:

- `F7` opens or closes the native Field Console when SKSE Menu Framework is
  installed. Its Travel view can remain visible while moving.

Marks, Trailmark visits, and field drops are handled inside that console. The
older `F8`, `F11`, and `Insert` shortcuts are no longer registered.

The release package includes the compact map image used by the Field Console.
The browser still remains the Atlas source of truth for sharing, Discord links,
and remote data.

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

## Optional native Skyrim map markers

The normal `0.8.0` release does not install a Skyrim Platform JavaScript plugin.
The companion `ranger-atlas-skyrim-platform.js` plugin is experimental and performs the
`placeAtMe`/`addToMap` operation from Skyrim Platform, one marker per update,
only after outdoor Tamriel is confirmed. The C++ DLL never constructs
`ExtraMapMarker` data. The Platform plugin waits for Skyrim's completed-load
signal and for `MapMenu` to be open before it creates a marker. It creates one
temporary marker at a time; closing the map disables those temporary markers.
This separation is intentional for SkyMP's server-managed load transitions, but the
JavaScript add-on is not part of the supported release because it can interfere with
Keizaal login on some installations.

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

The `0.8.0` build writes native lifecycle messages to `RangerAtlas.log`.

Install the supported release from the archive:

```text
SKSE/Plugins/RangerAtlas.dll
```

If an older integration was installed, remove this file before launching:

```text
Data/Platform/Plugins/ranger-atlas-skyrim-platform.js
```

Keep the browser Atlas open with **Live position** enabled. The browser Atlas,
position sharing, field actions, trailmark visits, and field drops work without
Skyrim Platform. Only temporary native Skyrim map markers require the experimental
JavaScript add-on.

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
    RangerAtlas/
      field-map.jpg
      badges/
```

The Field Console includes a local working Clipboard. It autosaves through the
browser Atlas on the same PC and can create a mark at the current Skyrim
position or send a report after reaching an official Trailmark. Linked Discord
rank and medal artwork is shown together as a compact ribbon from the packaged
badge files.
The identity area also shows the aggregate number of other Rangers whose live
position has updated within the active presence window. Names and positions are
not exposed by this count.

The experimental Platform add-on is kept in the repository under
`tools/ranger-atlas-platform`, but is deliberately excluded from the supported
release archive.
