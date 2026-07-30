# Ranger Atlas SKSE Integration

This project is being introduced in compatibility-gated stages.

## Stage 1: local position reader

The current `0.4.0` build initializes as an SKSE DLL and waits for SKSE's
post-load/new-game signal. It then reads the local player's position on
Skyrim's main thread every five seconds. A separate scheduler only queues the
captures; it never reads Skyrim state itself. The plugin writes:

- a readable entry to `RangerAtlas.log`;
- the latest coordinates and form IDs to `RangerAtlasPosition.json`.

After the character enters the world, it also serves the same snapshot from
`http://127.0.0.1:38471/position`. The bridge binds only to the local loopback
interface and makes no outbound requests.

It performs no position work during Keizaal login or character selection. It
still has no ESP, ESM, or ESL; no hooks; no outbound networking; no UI; no
input handling; no marker or gameplay changes; and no Skyrim Platform
JavaScript.

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
