import csv
import json
import math
import re
import sys
from pathlib import Path

MAP_WIDTH = 8192
MAP_HEIGHT = 6144
CREATED_AT = "2026-07-01T00:00:00.000Z"
CELL_RE = re.compile(r" at (-?\d+),(-?\d+)\)?$")
DROP_WORDS = [
    "MapMarkerREF",
    "MapmarkerRef",
    "MapMarkerRef",
    "MapMarker",
    "Mapmarker",
    "MarkerREF",
    "MarkerRef",
    "Marker",
    "REF",
    "Ref",
]
DEFAULT_TITLES = {
    "dawnstar",
    "winterhold",
    "windhelm",
    "riften",
    "falkreath",
    "markarth",
    "solitude",
    "morthal",
    "whiterun",
    "dragon bridge",
    "karthwasten",
    "rorikstead",
    "helgen",
    "ivarstead",
    "shor's stone",
    "shors stone",
    "riverwood",
}
TITLE_OVERRIDES = {
    "BlindCliffMapMarker": "Blind Cliff Cave",
    "BloatedMansGrottoMapMarker": "Bloated Man's Grotto",
    "BrandyMugFarmMapMarkerRef": "Brandy-Mug Farm",
    "BrittleShinPassNorthMapMarker": "Brittleshin Pass",
    "BrittleShinPassSouthMapMarker": "South Brittleshin Pass",
    "CrackedTuskMapMarker": "Cracked Tusk Keep",
    "BYOHHouse1MapMarker": "Lakeview Manor",
    "BYOHHouse2MapMarker": "Windstad Manor",
    "BYOHHouse3MapMarker": "Heljarchen Hall",
    "ShrineofAzuraMapMarkerREF": "Shrine of Azura",
    "DA02BoethiahShrineMapMarker": "Sacellum of Boethiah",
    "DagonShrineMapMarker": "Shrine of Mehrunes Dagon",
    "DaintySloadMapMarker": "The Dainty Sload",
    "DBSanctuaryMapMarker": "Dark Brotherhood Sanctuary",
    "DoomstoneSerpentMapMarker": "The Serpent Stone",
    "DLC1VQ07MapMarker": "Castle Volkihar",
    "DLC1_AncestorGladeMapMarker": "Ancestor Glade",
    "DLC1_DarkfallCaveMapMarker": "Darkfall Cave",
    "DLC1_FortDawnguardMapMarker": "Fort Dawnguard",
    "DLC1_ForebearsHoldoutMapMarker": "Forebears' Holdout",
    "DLC1DawnguardMapMarkerMain": "Fort Dawnguard",
    "DLC1DawnguardMapMarkerValley01": "Dayspring Canyon",
    "DLC1FerryDropOffMapMarker": "Icewater Jetty",
    "DLC1FerryDropOffMarker": "Icewater Jetty",
    "DLC1ForbearsHoldoutMapMarkerREF": "Forebears' Holdout",
    "DLC1ToSolstheimMapMarker": "Windhelm Docks",
    "DLC1VampireCastleMapMarker": "Castle Volkihar",
    "DLC1VolkiharFerryRef": "Castle Volkihar Ferry",
    "GeirmundsHallMapMarker": "Geirmund's Hall",
    "GoldenglowMapMarkerRef": "Goldenglow Estate",
    "HaemarsShameMapMarker": "Haemar's Shame",
    "HaemarsShameMapMarkerREF": "Haemar's Shame",
    "HalloftheVigilantMapMarker": "Hall of the Vigilant",
    "HillgrundsTombMapMarker": "Hillgrund's Tomb",
    "HobsFallCaveMapMarker": "Hob's Fall Cave",
    "IlinaltasDeepMapMarker": "Ilinalta's Deep",
    "LabyrinthianMapMarker": "Labyrinthian",
    "LabryinthianMapMarker": "Labyrinthian",
    "LoreiusMapMarker": "Loreius Farm",
    "MerryFairMapMarker": "Merryfair Farm",
    "MS04AvanchnzelMarker": "Avanchnzel",
    "MS07ShipwreckMapMarker": "Icerunner",
    "NightingaleHallMapMarker": "Nightingale Hall",
    "NightCallerMapMarker": "Nightcaller Temple",
    "nightingaleCaveMapMarkerREF": "Nightingale Hall",
    "RedRoadPassMapMarker": "Red Road Pass",
    "ReachcliffSecretMapMarker": "Reachcliff Secret Entrance",
    "SerpentsBluffRedoubtMapMarker": "Serpent's Bluff Redoubt",
    "ShroudHearthBarrowMapMarker": "Shroud Hearth Barrow",
    "ShroudHearthMapMarker": "Shroud Hearth Barrow",
    "SoljundsSinkholeMapMarker": "Soljund's Sinkhole",
    "StendarrsBeaconMapMarkerREF": "Stendarr's Beacon",
    "ThroatoftheWorldMapMarker": "Throat of the World",
    "TolvaldsCaveMapMarkerRef": "Tolvald's Cave",
    "TowerofMzarkMapMarker": "Tower of Mzark",
    "WinterholdCollegeMapMarkerRef": "College of Winterhold",
    "YsgramorsTombMapMarkerREF": "Ysgramor's Tomb",
}

NOTE_RULES = [
    (("camp",), "Military camp or field camp marked on Skyrim's map."),
    (("cave", "grotto", "cavern"), "Cave or cavern marked on Skyrim's map."),
    (("mine",), "Mine marked on Skyrim's map."),
    (("fort",), "Fortified site marked on Skyrim's map."),
    (("tower",), "Tower or lookout marked on Skyrim's map."),
    (("redoubt",), "Forsworn redoubt or fortified camp marked on Skyrim's map."),
    (("barrow", "tomb", "crypt"), "Nordic tomb or burial site marked on Skyrim's map."),
    (("ruin", "ruins", "bthardamz", "mzinchaleft", "alftand", "irkngthand", "raldbthar", "avanchnzel", "arkngthamz"), "Dwemer ruin or ancient site marked on Skyrim's map."),
    (("shrine", "sacellum", "temple"), "Religious shrine or temple marked on Skyrim's map."),
    (("sanctuary", "hall", "coven"), "Secluded refuge or faction site marked on Skyrim's map."),
    (("farm", "mill", "meadery"), "Farm, mill, or rural holding marked on Skyrim's map."),
    (("docks", "jetty", "ship", "sload", "icerunner", "ferry"), "Coastal landing or ship location marked on Skyrim's map."),
    (("manor",), "Player homestead location from Hearthfire."),
    (("college",), "College or institutional site marked on Skyrim's map."),
    (("castle",), "Castle or major stronghold marked on Skyrim's map."),
    (("estate",), "Estate or rural holding marked on Skyrim's map."),
    (("stone",), "Standing stone marked on Skyrim's map."),
    (("peak", "point", "crater", "ascent", "throat"), "Mountain landmark marked on Skyrim's map."),
]

# Cell-to-atlas affine transform fitted from known exterior settlement markers
# against the hand-placed atlas defaults in app.js.
COEF_X = (73.8268130, 0.215295427, 4067.73578)
COEF_Y = (-0.324059025, 74.5665700, 3036.85421)


def title_from_editor_id(editor_id, fallback):
    if editor_id in TITLE_OVERRIDES:
        return TITLE_OVERRIDES[editor_id]
    raw = editor_id.strip() or fallback.strip()
    for word in DROP_WORDS:
        raw = raw.replace(word, "")
    raw = raw.replace("DLC1", "").replace("DLC2", "")
    raw = raw.replace("CW", "Civil War ")
    raw = re.sub(r"([a-z])([A-Z])", r"\1 \2", raw)
    raw = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", raw)
    raw = re.sub(r"[_\-]+", " ", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    if not raw:
        return fallback.strip() or "Skyrim Location"
    return raw


def location_note(title):
    title_lower = title.lower()
    for keywords, note in NOTE_RULES:
      if any(keyword in title_lower for keyword in keywords):
          return note
    return "Vanilla Skyrim map location."


def marker_cell(row):
    match = CELL_RE.search(row.get("path", ""))
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def atlas_point(cell_x, cell_y):
    x = COEF_X[0] * cell_x + COEF_X[1] * cell_y + COEF_X[2]
    y = COEF_Y[0] * cell_x + COEF_Y[1] * cell_y + COEF_Y[2]
    return round(max(0, min(MAP_WIDTH, x))), round(max(0, min(MAP_HEIGHT, y)))


def is_tamriel_marker(row):
    path = row.get("path", "")
    if 'Tamriel "Skyrim"' not in path:
        return False
    if "Warehouse Map Markers" in path:
        return False
    return marker_cell(row) is not None


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: python convert-skyrim-map-markers.py input.csv output.json")

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    rows = list(csv.DictReader(input_path.open(encoding="utf-8-sig")))
    features = []
    seen_titles = set()

    for row in rows:
        if not is_tamriel_marker(row):
            continue
        cell = marker_cell(row)
        if not cell:
            continue
        form_id = row.get("form_id", "").strip()
        editor_id = row.get("editor_id", "").strip()
        if not editor_id:
            continue
        title = title_from_editor_id(editor_id, form_id)
        normalized_title = title.lower().replace("'", "")
        if normalized_title in DEFAULT_TITLES:
            continue
        if not title or title in seen_titles:
            continue
        seen_titles.add(title)
        x, y = atlas_point(*cell)
        features.append({
            "id": f"canon-skyrim-{form_id.lower()}",
            "type": "marker",
            "category": "landmark",
            "title": title,
            "confidence": "scouted",
            "creator": "",
            "notes": location_note(title),
            "points": [{"x": x, "y": y}],
            "source": "personal",
            "createdAt": CREATED_AT,
            "updatedAt": CREATED_AT,
        })

    features.sort(key=lambda feature: feature["title"].lower())
    payload = {
        "map": {"image": "SR-map-Skyrim.jpg", "width": MAP_WIDTH, "height": MAP_HEIGHT},
        "features": features,
        "meta": {
            "name": "Skyrim Canon Locations",
            "source": "SSEEdit MapMarker export",
            "coordinateBasis": "Exterior cell coordinates fitted to atlas defaults",
            "featureCount": len(features),
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {len(features)} features to {output_path}")


if __name__ == "__main__":
    main()
