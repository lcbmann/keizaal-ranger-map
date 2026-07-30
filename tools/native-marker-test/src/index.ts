import {
  Debug,
  DxScanCode,
  Game,
  ObjectReference,
  on,
  once,
  printConsole,
  storage,
} from "skyrimPlatform";

const PLUGIN = "RangerAtlasNativeMarkerTest";
const TEMPLATE_REF_ID = 0x000162a4; // RiverwoodMapMarker in Skyrim.esm
const TEST_NAME = "Ranger Atlas Native Marker Test";
const STORAGE_KEY = "rangerAtlasNativeMarkerTestRefId";

let testMarker: ObjectReference | null = null;
let busy = false;

function log(message: string): void {
  printConsole(`[${PLUGIN}] ${message}`);
}

function hexFormId(formId: number): string {
  return `0x${formId.toString(16).toUpperCase().padStart(8, "0")}`;
}

function storedMarkerId(): number {
  const value = storage[STORAGE_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolveTestMarker(): ObjectReference | null {
  if (testMarker) {
    return testMarker;
  }

  const formId = storedMarkerId();
  if (!formId) {
    return null;
  }

  return ObjectReference.from(Game.getFormEx(formId));
}

async function removeTestMarker(showResult: boolean): Promise<void> {
  if (busy) {
    return;
  }

  busy = true;
  try {
    const marker = resolveTestMarker();
    if (!marker) {
      delete storage[STORAGE_KEY];
      testMarker = null;
      log("No test marker exists to remove.");
      if (showResult) {
        Debug.notification("Ranger Atlas test: no marker to remove.");
      }
      return;
    }

    const formId = marker.getFormID();
    marker.disableNoWait(false);
    await marker.delete();
    delete storage[STORAGE_KEY];
    testMarker = null;
    log(`Removed test marker ${hexFormId(formId)}.`);
    if (showResult) {
      Debug.notification("Ranger Atlas native test marker removed.");
    }
  } catch (error) {
    log(`Cleanup failed: ${String(error)}`);
    Debug.messageBox(
      "Ranger Atlas native marker cleanup failed. Do not save the game; check the Skyrim Platform log.",
    );
  } finally {
    busy = false;
  }
}

async function createTestMarker(): Promise<void> {
  if (busy) {
    return;
  }

  if (resolveTestMarker()) {
    Debug.messageBox(
      "A Ranger Atlas test marker already exists. Press F11 to remove it before running the test again.",
    );
    return;
  }

  busy = true;
  try {
    const player = Game.getPlayer();
    if (!player) {
      throw new Error("Player reference is unavailable");
    }
    if (!player.getWorldSpace()) {
      Debug.messageBox(
        "Stand outdoors in Skyrim before running the marker test. Interior cells do not have a world map position.",
      );
      return;
    }

    const template = ObjectReference.from(Game.getFormEx(TEMPLATE_REF_ID));
    if (!template) {
      throw new Error(
        `Could not resolve Riverwood map marker ${hexFormId(TEMPLATE_REF_ID)}`,
      );
    }

    const marker = player.placeAtMe(template, 1, true, false);
    if (!marker) {
      throw new Error("PlaceAtMe returned no reference");
    }

    testMarker = marker;
    storage[STORAGE_KEY] = marker.getFormID();

    const renamed = marker.setDisplayName(TEST_NAME, true);
    marker.addToMap(false);

    const formId = hexFormId(marker.getFormID());
    const visible = marker.isMapMarkerVisible();
    const fastTravel = marker.canFastTravelToMarker();
    log(
      `Created ${formId}; renamed=${renamed}; visible=${visible}; fastTravel=${fastTravel}.`,
    );

    Debug.messageBox(
      [
        "Ranger Atlas native marker test created.",
        "",
        "Open the Skyrim world map now and look at your current position for:",
        TEST_NAME,
        "",
        `Reference: ${formId}`,
        `Engine reports visible: ${visible}`,
        `Fast travel enabled: ${fastTravel}`,
        "",
        "Press F11 after checking the map to remove the test marker. Do not save during this test.",
      ].join("\n"),
    );
  } catch (error) {
    log(`Creation failed: ${String(error)}`);
    Debug.messageBox(
      `Ranger Atlas native marker test failed before the map check.\n\n${String(
        error,
      )}\n\nCheck the Skyrim Platform log for details.`,
    );
  } finally {
    busy = false;
  }
}

once("update", () => {
  const existingId = storedMarkerId();
  log(
    `Loaded. Press F10 outdoors to create the test marker; press F11 to remove it.${
      existingId ? ` Stored marker: ${hexFormId(existingId)}.` : ""
    }`,
  );
});

on("buttonEvent", (event) => {
  if (!event.isDown || event.isRepeating) {
    return;
  }

  if (event.code === DxScanCode.F10) {
    void createTestMarker();
  } else if (event.code === DxScanCode.F11) {
    void removeTestMarker(true);
  }
});
