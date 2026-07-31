import {
  Game,
  HttpClient,
  ObjectReference,
  on,
  printConsole,
} from "skyrimPlatform";

const PLUGIN = "RangerAtlasSkyrimPlatform";
const BRIDGE = "http://127.0.0.1:38471";
const TEMPLATE_REF_ID = 0x000162a4; // RiverwoodMapMarker in Skyrim.esm.
const TAMRIEL_FORM_ID = 0x0000003c;
const POLL_INTERVAL_MS = 4000;
const MARKER_BATCH_SIZE = 1;

const WORLD_TO_ATLAS_X = [73.826813, 0.215295427, 4067.73578];
const WORLD_TO_ATLAS_Y = [-0.324059025, 74.56657, 3036.85421];
const ATLAS_TO_WORLD_DETERMINANT =
  WORLD_TO_ATLAS_X[0] * WORLD_TO_ATLAS_Y[1] -
  WORLD_TO_ATLAS_X[1] * WORLD_TO_ATLAS_Y[0];

interface AtlasMarker {
  id: string;
  title: string;
  x: number;
  y: number;
}

interface ActiveMarker {
  x: number;
  y: number;
  title: string;
  reference: ObjectReference;
}

const http = new HttpClient(BRIDGE);
const activeMarkers: Record<string, ActiveMarker> = {};
let desiredMarkers: AtlasMarker[] = [];
let desiredKey = "";
let worldReady = false;
let pollInFlight = false;
let createInFlight = false;
let nextPollAt = 0;
let createIndex = 0;

function log(message: string): void {
  printConsole(`[${PLUGIN}] ${message}`);
}

function isOutdoorTamriel(): boolean {
  const player = Game.getPlayer();
  const cell = player ? player.getParentCell() : null;
  const worldspace = player ? player.getWorldSpace() : null;
  return Boolean(
    player &&
      cell &&
      worldspace &&
      !cell.isInterior() &&
      worldspace.getFormID() === TAMRIEL_FORM_ID,
  );
}

function atlasToWorld(atlasX: number, atlasY: number): { x: number; y: number } | null {
  if (!Number.isFinite(atlasX) || !Number.isFinite(atlasY)) {
    return null;
  }

  const rightX = atlasX - WORLD_TO_ATLAS_X[2];
  const rightY = atlasY - WORLD_TO_ATLAS_Y[2];
  const cellX =
    (rightX * WORLD_TO_ATLAS_Y[1] - WORLD_TO_ATLAS_X[1] * rightY) /
    ATLAS_TO_WORLD_DETERMINANT;
  const cellY =
    (WORLD_TO_ATLAS_X[0] * rightY - rightX * WORLD_TO_ATLAS_Y[0]) /
    ATLAS_TO_WORLD_DETERMINANT;
  return { x: cellX * 4096, y: cellY * 4096 };
}

function disableMarker(marker: ActiveMarker): void {
  try {
    marker.reference.disableNoWait(false);
    void marker.reference.delete();
  } catch (error) {
    log(`Marker cleanup failed: ${String(error)}`);
  }
}

function clearNativeMarkers(): void {
  Object.keys(activeMarkers).forEach((id) => {
    disableMarker(activeMarkers[id]);
    delete activeMarkers[id];
  });
  createIndex = 0;
}

function applyDesiredMarkers(markers: AtlasMarker[]): void {
  const normalized = markers
    .filter(
      (marker) =>
        typeof marker.id === "string" &&
        typeof marker.title === "string" &&
        marker.title.length > 0 &&
        marker.title.length <= 160 &&
        Number.isFinite(marker.x) &&
        Number.isFinite(marker.y),
    )
    .map((marker) => ({
      id: marker.id,
      title: marker.title,
      x: Number(marker.x),
      y: Number(marker.y),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const nextKey = JSON.stringify(normalized);
  if (nextKey === desiredKey) {
    return;
  }

  const desiredById: Record<string, AtlasMarker> = {};
  normalized.forEach((marker) => {
    desiredById[marker.id] = marker;
  });

  Object.keys(activeMarkers).forEach((id) => {
    const marker = desiredById[id];
    if (
      !marker ||
      marker.title !== activeMarkers[id].title ||
      marker.x !== activeMarkers[id].x ||
      marker.y !== activeMarkers[id].y
    ) {
      disableMarker(activeMarkers[id]);
      delete activeMarkers[id];
    }
  });

  desiredMarkers = normalized;
  desiredKey = nextKey;
  createIndex = 0;
  log(`Received ${normalized.length} official Trailmark marker${normalized.length === 1 ? "" : "s"}.`);
}

async function createNextMarker(): Promise<void> {
  if (!worldReady || createInFlight || createIndex >= desiredMarkers.length) {
    return;
  }

  const marker = desiredMarkers[createIndex++];
  if (activeMarkers[marker.id]) {
    return;
  }

  const position = atlasToWorld(marker.x, marker.y);
  const player = Game.getPlayer();
  const template = ObjectReference.from(Game.getFormEx(TEMPLATE_REF_ID));
  if (!position || !player || !template) {
    log(`Skipped Trailmark ${marker.id}: game reference or coordinates unavailable.`);
    return;
  }

  createInFlight = true;
  try {
    const reference = player.placeAtMe(template, 1, true, false);
    if (!reference) {
      throw new Error("placeAtMe returned no reference");
    }

    await reference.setPosition(position.x, position.y, player.getPositionZ());
    reference.setDisplayName(marker.title, true);
    reference.addToMap(false);
    activeMarkers[marker.id] = {
      x: marker.x,
      y: marker.y,
      title: marker.title,
      reference,
    };
    log(
      `Created native Trailmark "${marker.title}" at world x=${position.x.toFixed(1)}, y=${position.y.toFixed(1)}.`,
    );
  } catch (error) {
    log(`Trailmark "${marker.title}" failed: ${String(error)}`);
  } finally {
    createInFlight = false;
  }
}

async function pollMarkerSnapshot(): Promise<void> {
  if (!worldReady || pollInFlight) {
    return;
  }

  pollInFlight = true;
  try {
    const response = await http.get("/markers");
    if (response.status !== 200 || !response.body) {
      return;
    }
    const payload = JSON.parse(response.body) as { version?: number; markers?: AtlasMarker[] };
    if (payload.version !== 1 || !Array.isArray(payload.markers)) {
      return;
    }
    applyDesiredMarkers(payload.markers);
  } catch (error) {
    // The browser and DLL are optional; retry silently until they are available.
  } finally {
    pollInFlight = false;
    nextPollAt = Date.now() + POLL_INTERVAL_MS;
  }
}

on("preLoadGame", () => {
  worldReady = false;
  desiredMarkers = [];
  desiredKey = "";
  clearNativeMarkers();
});

on("update", () => {
  if (!worldReady) {
    if (!isOutdoorTamriel()) {
      return;
    }
    worldReady = true;
    nextPollAt = 0;
    log("Outdoor Tamriel confirmed; native Trailmark sync is active.");
  }

  if (Date.now() >= nextPollAt) {
    void pollMarkerSnapshot();
  }
  for (let count = 0; count < MARKER_BATCH_SIZE; count += 1) {
    void createNextMarker();
  }
});

log("Loaded. Waiting for outdoor Tamriel before touching native map markers.");
