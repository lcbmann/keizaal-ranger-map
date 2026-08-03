(function () {
  "use strict";

  const MAP_IMAGE = "SR-map-Skyrim.jpg";
  const MAP_WIDTH = 8192;
  const MAP_HEIGHT = 6144;
  const STORAGE_KEY = "keizaal-ranger-map-state-v1";
  const DEFAULT_FEATURES_VERSION = 2;
  const SUPABASE_CONFIG = window.RANGER_ATLAS_SUPABASE || {};
  const SUPABASE_URL = SUPABASE_CONFIG.url || "https://qmuuqnfpbfncwacrrmri.supabase.co";
  const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey || window.RANGER_ATLAS_SUPABASE_ANON_KEY || "";
  const SHARE_CODE_PREFIX = "RGFA2.";
  const LEGACY_GUILD_SHARE_CODE_PREFIX = "RGFA1.";
  const LEGACY_CORPS_SHARE_CODE_PREFIX = "RCFA1.";
  const SHARE_CODE_MAX_LENGTH = 2000;
  const SHARE_CODE_CHUNK_SIZE = 1800;
  const GUILD_ATLAS_CODE = "GUILD";
  const SKYRIM_ATLAS_CODE = "SKYRIM";
  const SKYRIM_ATLAS_DATA = "data/skyrim-canon-atlas.generated.json";
  const LIVE_POSITION_URL = "http://127.0.0.1:38471/position";
  const FIELD_EVENTS_URL = "http://127.0.0.1:38471/events";
  const FIELD_STATE_URL = "http://127.0.0.1:38471/field-state";
  const NATIVE_MARKERS_URL = "http://127.0.0.1:38471/markers";
  const FIELD_ACTION_CURSOR_KEY = "ranger-atlas-field-action-cursor-v1";
  const LAST_OUTDOOR_POSITION_KEY = "ranger-atlas-last-outdoor-position-v1";
  const SKYRIM_WORLDSPACE_FORM_ID = 0x0000003c;
  const WORLD_TO_ATLAS_X = [73.826813, 0.215295427, 4067.73578];
  const WORLD_TO_ATLAS_Y = [-0.324059025, 74.56657, 3036.85421];
  // Initial visual calibration for the game-linked layer. Hand-drawn atlas
  // entries remain fixed; live positions and official Trailmarks share this shift.
  const GAME_LINK_ATLAS_OFFSET = { x: -128, y: 0 };
  const DISCORD_DEVICE_TOKEN_STORAGE_KEY = "ranger-atlas-discord-device-token-v1";
  const ATLAS_UNITS_TO_METERS = 0.79;
  const TRAILMARK_VISIT_RADIUS_METERS = 20;
  const TRAILMARK_VISIT_RADIUS = TRAILMARK_VISIT_RADIUS_METERS / ATLAS_UNITS_TO_METERS;
  const TRAILMARK_VISIT_DWELL_MS = 12000;
  const TRAILMARK_VISIT_COOLDOWN_MS = 30 * 60 * 1000;
  const TRAILMARK_VISIT_FAILURE_RETRY_MS = 60 * 1000;
  const TRAILMARK_VISIT_HEARTBEAT_MS = 20 * 1000;
  const TRAILMARK_ACCESS_POLL_MS = 4000;
  const TRAILMARK_ACCESS_POLL_LIMIT = 30;
  const GUILD_ATLAS_REFRESH_MS = 5 * 60 * 1000;
  const DISCORD_PROFILE_REFRESH_MS = 2 * 60 * 1000;
  const GUILD_ATLAS_CHECK_COOLDOWN_MS = 30 * 1000;
  const LOCAL_POSITION_POLL_INTERVAL_MS = 250;
  const LIVE_POSITION_SHARE_INTERVAL_MS = 10 * 1000;
  const AWAKE_RANGER_POLL_MS = 15 * 1000;
  const OVERWATCH_POLL_MS = 5 * 1000;
  const TRAILMARK_DROP_POLL_MS = 4 * 1000;
  const TRAILMARK_DROP_POLL_LIMIT = 30;

  const categories = [
    { id: "city", label: "City", color: "#2f5878", icon: "city" },
    { id: "town", label: "Town", color: "#3f6f78", icon: "town" },
    { id: "cache", label: "Cache", color: "#9a6424" },
    { id: "contact", label: "Contact", color: "#466f75" },
    { id: "threat", label: "Threat", color: "#8e332b" },
    { id: "camp", label: "Camp", color: "#5f7038" },
    { id: "hunting", label: "Hunting Spot", color: "#6f5f2d" },
    { id: "ore", label: "Ore Vein", color: "#6d6f73" },
    { id: "ingredient", label: "Ingredient", color: "#4f7a45" },
    { id: "range", label: "Range", color: "#2f6548" },
    { id: "route", label: "Trail", color: "#68472e" },
    { id: "post", label: "Guild Post", color: "#6d5a32" },
    { id: "trailmark", label: "Trailmark", color: "#4f6535" },
    { id: "station", label: "Station", color: "#5b6f4a" },
    { id: "landmark", label: "Landmark", color: "#5d5950" },
  ];

  const categoryById = Object.fromEntries(categories.map((category) => [category.id, category]));
  const categoryCodes = Object.fromEntries(categories.map((category, index) => [category.id, index.toString(36)]));
  const categoryIdsByCode = Object.fromEntries(categories.map((category, index) => [index.toString(36), category.id]));
  const typeCodes = { marker: "m", range: "g", route: "t" };
  const typesByCode = { m: "marker", g: "range", t: "route" };
  const confidenceCodes = { confirmed: "c", rumor: "r", scouted: "s", stale: "t" };
  const confidencesByCode = { c: "confirmed", r: "rumor", s: "scouted", t: "stale" };
  const categoryAliases = {
    danger: "threat",
    guild: "post",
    herb: "ingredient",
    hunting_spot: "hunting",
    mine: "ore",
    mineral: "ore",
    loot: "cache",
    npc: "contact",
    other: "landmark",
    plant: "ingredient",
    resource: "ore",
    settlement: "city",
    station: "station",
    ranger_station: "station",
    outpost: "station",
    trail_mark: "trailmark",
    trailcache: "trailmark",
    trailmark: "trailmark",
  };

  const defaultFeatures = [
    defaultMarker("default-dawnstar", "Dawnstar", "city", 4604, 4871),
    defaultMarker("default-winterhold", "Winterhold", "city", 5989, 4794),
    defaultMarker("default-windhelm", "Windhelm", "city", 6414, 3707),
    defaultMarker("default-riften", "Riften", "city", 7253, 1312),
    defaultMarker("default-falkreath", "Falkreath", "city", 3475, 1382),
    defaultMarker("default-markarth", "Markarth", "city", 868, 3097),
    defaultMarker("default-solitude", "Solitude", "city", 2785, 4907),
    defaultMarker("default-morthal", "Morthal", "city", 3349, 4119),
    defaultMarker("default-whiterun", "Whiterun", "city", 4452, 2956),
    defaultMarker("default-dragon-bridge", "Dragon Bridge", "town", 2095, 4429),
    defaultMarker("default-karthwasten", "Karthwasten", "town", 1591, 3625),
    defaultMarker("default-rorikstead", "Rorikstead", "town", 2471, 3049),
    defaultMarker("default-helgen", "Helgen", "town", 4286, 1532),
    defaultMarker("default-ivarstead", "Ivarstead", "town", 5385, 1819),
    defaultMarker("default-shors-stone", "Shor's Stone", "town", 6924, 1827),
    defaultMarker("default-riverwood", "Riverwood", "town", 4376, 2119),
  ];

  const state = {
    features: [],
    filters: Object.fromEntries(categories.map((category) => [category.id, true])),
    showLabels: false,
    darkMode: window.matchMedia?.("(prefers-color-scheme: dark)").matches === true,
    search: "",
    creatorFilter: "",
    selectedId: null,
    selectedIds: [],
    workspaceMode: "field",
    panelView: "browse",
    mode: "select",
    movingFeatureId: null,
    movingOriginalPoint: null,
    creatorName: "",
    livePositionEnabled: false,
    followLivePosition: false,
    livePositionConnection: "off",
    nativeMarkerSyncKey: "",
    livePositionPoint: null,
    lastOutdoorPosition: null,
    lastOutdoorPositionPersistedAt: 0,
    livePositionHeading: 0,
    livePositionSnapshot: null,
    fieldActionCursor: Number(window.localStorage.getItem(FIELD_ACTION_CURSOR_KEY)) || 0,
    sharePositionEnabled: false,
    sharePositionInFlight: false,
    lastSharedPositionAt: 0,
    awakeRangerCount: null,
    guildAtlasUpdatedAt: "",
    guildAtlasLocalChanges: false,
    trailmarkVisitsEnabled: false,
    nearbyTrailmarkId: null,
    trailmarkVisitCandidate: null,
    trailmarkVisitInFlight: false,
    trailmarkVisitActive: null,
    trailmarkVisitLastHeartbeatAt: 0,
    trailmarkVisitDepartureInFlight: false,
    trailmarkVisitCooldowns: {},
    trailmarkVisitRetryAfter: {},
    trailmarkVisitsByFeature: new Map(),
    trailmarkVisitsLoading: new Set(),
    trailmarkVisitErrors: new Map(),
    discordLink: null,
    discordRelinking: false,
    clipboard: {
      title: "Field notes",
      body: "",
      updatedAt: "",
    },
    overwatchEnabled: false,
    overwatchPassphrase: "",
    overwatchPositions: [],
    pendingReceive: null,
    draftFeature: null,
    drawPoints: [],
    draftLayer: null,
    pointerStart: null,
    freehandDrawing: false,
    undoStack: [],
  };

  const map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -4,
    maxZoom: 3,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelDebounceTime: 20,
    wheelPxPerZoomLevel: 80,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: true,
    touchZoom: true,
    inertia: true,
    doubleClickZoom: false,
  });

  const bounds = [
    [0, 0],
    [MAP_HEIGHT, MAP_WIDTH],
  ];

  L.imageOverlay(MAP_IMAGE, bounds).addTo(map);
  map.fitBounds(bounds);
  map.setMaxBounds([
    [-240, -240],
    [MAP_HEIGHT + 240, MAP_WIDTH + 240],
  ]);

  map.createPane("trailmark-pane");
  map.getPane("trailmark-pane").style.zIndex = "720";
  map.createPane("trailmark-radius-pane");
  map.getPane("trailmark-radius-pane").style.zIndex = "710";
  map.createPane("live-position-pane");
  map.getPane("live-position-pane").style.zIndex = "730";

  const featureLayer = L.layerGroup().addTo(map);
  const labelLayer = L.layerGroup().addTo(map);
  const draftLayer = L.layerGroup().addTo(map);
  const trailmarkRadiusLayer = L.layerGroup().addTo(map);
  const livePositionLayer = L.layerGroup().addTo(map);
  const overwatchPositionLayer = L.layerGroup().addTo(map);

  const elements = {
    toolButtons: Array.from(document.querySelectorAll(".tool-button")),
    workspaceModeButtons: Array.from(document.querySelectorAll("[data-workspace-mode]")),
    panelViewButtons: Array.from(document.querySelectorAll("[data-panel-view]")),
    panelPanes: Array.from(document.querySelectorAll("[data-panel-pane]")),
    fieldOverview: document.getElementById("fieldOverview"),
    fieldConsoleStatus: document.getElementById("fieldConsoleStatus"),
    fieldConsoleHint: document.getElementById("fieldConsoleHint"),
    fieldMarkHereBtn: document.getElementById("fieldMarkHereBtn"),
    awakeRangerCounter: document.getElementById("awakeRangerCounter"),
    awakeRangerCountText: document.getElementById("awakeRangerCountText"),
    followLivePositionInput: document.getElementById("followLivePositionInput"),
    aboutBtn: document.getElementById("aboutBtn"),
    aboutDialog: document.getElementById("aboutDialog"),
    aboutCloseBtn: document.getElementById("aboutCloseBtn"),
    helpBtn: document.getElementById("helpBtn"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    clipboardBtn: document.getElementById("clipboardBtn"),
    helpDialog: document.getElementById("helpDialog"),
    helpCloseBtn: document.getElementById("helpCloseBtn"),
    settingsDialog: document.getElementById("settingsDialog"),
    settingsCloseBtn: document.getElementById("settingsCloseBtn"),
    clipboardDialog: document.getElementById("clipboardDialog"),
    clipboardCloseBtn: document.getElementById("clipboardCloseBtn"),
    clipboardDoneBtn: document.getElementById("clipboardDoneBtn"),
    clipboardTitleInput: document.getElementById("clipboardTitleInput"),
    clipboardBodyInput: document.getElementById("clipboardBodyInput"),
    clipboardStatus: document.getElementById("clipboardStatus"),
    clipboardMarkBtn: document.getElementById("clipboardMarkBtn"),
    clipboardDropBtn: document.getElementById("clipboardDropBtn"),
    showLabelsInput: document.getElementById("showLabelsInput"),
    livePositionInput: document.getElementById("livePositionInput"),
    livePositionStatus: document.getElementById("livePositionStatus"),
    trailmarkVisitsInput: document.getElementById("trailmarkVisitsInput"),
    trailmarkVisitsStatus: document.getElementById("trailmarkVisitsStatus"),
    discordLinkBtn: document.getElementById("discordLinkBtn"),
    discordLinkDialog: document.getElementById("discordLinkDialog"),
    discordLinkCloseBtn: document.getElementById("discordLinkCloseBtn"),
    discordLinkCancelBtn: document.getElementById("discordLinkCancelBtn"),
    discordLinkForm: document.getElementById("discordLinkForm"),
    discordLinkTitle: document.getElementById("discordLinkTitle"),
    discordLinkCodeFields: document.getElementById("discordLinkCodeFields"),
    discordLinkCodeInput: document.getElementById("discordLinkCodeInput"),
    discordLinkStatus: document.getElementById("discordLinkStatus"),
    discordLinkSummary: document.getElementById("discordLinkSummary"),
    discordLinkSubmitBtn: document.getElementById("discordLinkSubmitBtn"),
    discordRelinkBtn: document.getElementById("discordRelinkBtn"),
    discordUnlinkBtn: document.getElementById("discordUnlinkBtn"),
    rangerProfileCard: document.getElementById("rangerProfileCard"),
    rangerMedals: document.getElementById("rangerMedals"),
    trailmarkArrival: document.getElementById("trailmarkArrival"),
    trailmarkArrivalCloseBtn: document.getElementById("trailmarkArrivalCloseBtn"),
    trailmarkArrivalTitle: document.getElementById("trailmarkArrivalTitle"),
    trailmarkArrivalText: document.getElementById("trailmarkArrivalText"),
    trailmarkArrivalVisitors: document.getElementById("trailmarkArrivalVisitors"),
    trailmarkArrivalDropBtn: document.getElementById("trailmarkArrivalDropBtn"),
    trailmarkArrivalLinkBtn: document.getElementById("trailmarkArrivalLinkBtn"),
    receiveDialog: document.getElementById("receiveDialog"),
    receiveCodeInput: document.getElementById("receiveCodeInput"),
    receivePreview: document.getElementById("receivePreview"),
    receiveActions: document.getElementById("receiveActions"),
    receiveActionHelp: document.getElementById("receiveActionHelp"),
    receiveStatus: document.getElementById("receiveStatus"),
    receiveGuildBtn: document.getElementById("receiveGuildBtn"),
    receiveSkyrimBtn: document.getElementById("receiveSkyrimBtn"),
    receiveReviewBtn: document.getElementById("receiveReviewBtn"),
    receiveMergeBtn: document.getElementById("receiveMergeBtn"),
    receiveReplaceBtn: document.getElementById("receiveReplaceBtn"),
    receiveCancelBtn: document.getElementById("receiveCancelBtn"),
    clearDialog: document.getElementById("clearDialog"),
    clearSummary: document.getElementById("clearSummary"),
    clearScopeInputs: Array.from(document.querySelectorAll('input[name="clearScope"]')),
    clearCategoryList: document.getElementById("clearCategoryList"),
    clearSelectAllBtn: document.getElementById("clearSelectAllBtn"),
    clearSelectNoneBtn: document.getElementById("clearSelectNoneBtn"),
    clearConfirmBtn: document.getElementById("clearConfirmBtn"),
    clearCancelBtn: document.getElementById("clearCancelBtn"),
    clearKeepBtn: document.getElementById("clearKeepBtn"),
    undoBtn: document.getElementById("undoBtn"),
    guildAdminBtn: document.getElementById("guildAdminBtn"),
    guildPublishDialog: document.getElementById("guildPublishDialog"),
    guildPublishSummary: document.getElementById("guildPublishSummary"),
    guildEntryList: document.getElementById("guildEntryList"),
    guildPassphraseForm: document.getElementById("guildPassphraseForm"),
    guildPassphraseInput: document.getElementById("guildPassphraseInput"),
    overwatchPassphraseForm: document.getElementById("overwatchPassphraseForm"),
    overwatchPassphraseInput: document.getElementById("overwatchPassphraseInput"),
    overwatchToggleBtn: document.getElementById("overwatchToggleBtn"),
    overwatchStatus: document.getElementById("overwatchStatus"),
    guildPublishStatus: document.getElementById("guildPublishStatus"),
    guildPublishConfirmBtn: document.getElementById("guildPublishConfirmBtn"),
    guildRecoverAllBtn: document.getElementById("guildRecoverAllBtn"),
    guildPublishCancelBtn: document.getElementById("guildPublishCancelBtn"),
    guildPublishKeepBtn: document.getElementById("guildPublishKeepBtn"),
    guildSelectAllBtn: document.getElementById("guildSelectAllBtn"),
    guildSelectNoneBtn: document.getElementById("guildSelectNoneBtn"),
    shareDialog: document.getElementById("shareDialog"),
    shareSummary: document.getElementById("shareSummary"),
    shareEntryList: document.getElementById("shareEntryList"),
    shareStatus: document.getElementById("shareStatus"),
    shareCopyBtn: document.getElementById("shareCopyBtn"),
    shareReportBtn: document.getElementById("shareReportBtn"),
    shareCancelBtn: document.getElementById("shareCancelBtn"),
    shareKeepBtn: document.getElementById("shareKeepBtn"),
    shareSelectAllBtn: document.getElementById("shareSelectAllBtn"),
    shareSelectNoneBtn: document.getElementById("shareSelectNoneBtn"),
    exportBtn: document.getElementById("exportBtn"),
    exportMapBtn: document.getElementById("exportMapBtn"),
    importBtn: document.getElementById("importBtn"),
    clearBtn: document.getElementById("clearBtn"),
    creatorInput: document.getElementById("creatorInput"),
    searchInput: document.getElementById("searchInput"),
    creatorFilterInput: document.getElementById("creatorFilterInput"),
    atlasCount: document.getElementById("atlasCount"),
    filterAllBtn: document.getElementById("filterAllBtn"),
    filterNoneBtn: document.getElementById("filterNoneBtn"),
    categoryFilters: document.getElementById("categoryFilters"),
    featureList: document.getElementById("featureList"),
    statusBar: document.getElementById("statusBar"),
    emptySelection: document.getElementById("emptySelection"),
    selectionSummary: document.getElementById("selectionSummary"),
    editorForm: document.getElementById("editorForm"),
    featureId: document.getElementById("featureId"),
    titleInput: document.getElementById("titleInput"),
    categoryField: document.getElementById("categoryField"),
    categoryInput: document.getElementById("categoryInput"),
    confidenceInput: document.getElementById("confidenceInput"),
    rangeColorField: document.getElementById("rangeColorField"),
    rangeColorLabel: document.getElementById("rangeColorLabel"),
    rangeColorInput: document.getElementById("rangeColorInput"),
    creatorMeta: document.getElementById("creatorMeta"),
    trailmarkPresencePanel: document.getElementById("trailmarkPresencePanel"),
    trailmarkPresenceStatus: document.getElementById("trailmarkPresenceStatus"),
    trailmarkPresenceList: document.getElementById("trailmarkPresenceList"),
    refreshTrailmarkVisitsBtn: document.getElementById("refreshTrailmarkVisitsBtn"),
    trailmarkDropBtn: document.getElementById("trailmarkDropBtn"),
    trailmarkDropDialog: document.getElementById("trailmarkDropDialog"),
    trailmarkDropCloseBtn: document.getElementById("trailmarkDropCloseBtn"),
    trailmarkDropCancelBtn: document.getElementById("trailmarkDropCancelBtn"),
    trailmarkDropForm: document.getElementById("trailmarkDropForm"),
    trailmarkDropTitle: document.getElementById("trailmarkDropTitle"),
    trailmarkDropMessageInput: document.getElementById("trailmarkDropMessageInput"),
    trailmarkDropStatus: document.getElementById("trailmarkDropStatus"),
    trailmarkDropSubmitBtn: document.getElementById("trailmarkDropSubmitBtn"),
    notesInput: document.getElementById("notesInput"),
    saveFeatureBtn: document.getElementById("saveFeatureBtn"),
    moveFeatureBtn: document.getElementById("moveFeatureBtn"),
    moveFeatureActions: document.getElementById("moveFeatureActions"),
    confirmMoveBtn: document.getElementById("confirmMoveBtn"),
    cancelMoveBtn: document.getElementById("cancelMoveBtn"),
    deleteFeatureBtn: document.getElementById("deleteFeatureBtn"),
  };

  let lastDragEndedAt = 0;
  let suppressNextClickUntil = 0;
  let searchAutofillGuardUntil = Date.now() + 5000;
  let livePositionPollTimer = null;
  let livePositionRequest = null;
  let fieldActionPollTimer = null;
  let fieldActionRequest = null;
  let livePositionMarker = null;
  let trailmarkAccessPollTimer = null;
  let guildAtlasRefreshTimer = null;
  let discordProfileRefreshTimer = null;
  let guildAtlasRefreshInFlight = false;
  let guildAtlasLastCheckedAt = 0;
  let overwatchPollTimer = null;
  let trailmarkDropPollTimer = null;
  let nativeMarkerSyncInFlight = false;
  let nativeMarkerSyncQueued = false;
  let nativeMarkerPostChain = Promise.resolve();
  let nativeFieldStatePostChain = Promise.resolve();
  let nativeFieldStateKey = "";
  let clipboardSyncTimer = null;
  let awakeRangerPollTimer = null;

  init();

  function…48569 tokens truncated…ayload(raw) {
    const payload = JSON.parse(raw);
    return decodeCompactPayloadObject(payload);
  }

  function decodeCompactPayloadObject(payload) {
    if (!payload || payload.v !== 2 || !Array.isArray(payload.f)) {
      throw new Error("Invalid compact payload");
    }
    return {
      map: {
        image: MAP_IMAGE,
        width: payload.w || MAP_WIDTH,
        height: payload.h || MAP_HEIGHT,
      },
      features: payload.f.map(decodeCompactFeature),
    };
  }

  function decodeCompactFeature(value) {
    const primaryCategory = categoryIdsByCode[value[2]] || value[2];
    const additionalCategories = Array.isArray(value[12])
      ? value[12].map((categoryId) => categoryIdsByCode[categoryId] || categoryId)
      : [];
    return {
      id: decodeFeatureId(value[0]),
      type: typesByCode[value[1]] || value[1],
      category: primaryCategory,
      categories: [primaryCategory, ...additionalCategories],
      title: value[3] || "Untitled",
      confidence: confidencesByCode[value[4]] || value[4] || "scouted",
      notes: value[5] || "",
      points: expandPoints(Array.isArray(value[6]) ? value[6] : []),
      createdAt: decodeDate(value[7]),
      updatedAt: decodeDate(value[8] || value[7]),
      creator: normalizeCreatorName(value[9] || ""),
      updatedBy: normalizeCreatorName(value[10] || ""),
      color: normalizeHexColor(value[11] || ""),
    };
  }

  function flattenPoints(points) {
    return points.flatMap((point) => [point.x, point.y]);
  }

  function expandPoints(points) {
    const expanded = [];
    for (let index = 0; index < points.length; index += 2) {
      expanded.push({ x: points[index], y: points[index + 1] });
    }
    return expanded;
  }

  function encodeFeatureId(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id.replace(/-/g, "")
      : id;
  }

  function decodeFeatureId(id) {
    return /^[0-9a-f]{32}$/i.test(id)
      ? `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
      : id;
  }

  function encodeDate(value) {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) ? timestamp.toString(36) : "";
  }

  function decodeDate(value) {
    const timestamp = Number.parseInt(value || "", 36);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
  }

  function getVisibleFeatures() {
    return state.features.filter((feature) => {
      const forcedVisible = isFeatureSelected(feature.id);
      const featureCategories = getFeatureCategories(feature);
      const categoryVisible = forcedVisible || featureCategories.some((categoryId) => state.filters[categoryId] !== false);
      if (!categoryVisible) {
        return false;
      }

      if (state.creatorFilter && !forcedVisible && !isDefaultFeature(feature) && !isCanonFeature(feature) && feature.creator !== state.creatorFilter) {
        return false;
      }

      if (forcedVisible || isDefaultFeature(feature) || !state.search) {
        return true;
      }

      const categorySearchText = featureCategories
        .map((categoryId) => `${categoryId} ${(categoryById[categoryId] || categoryById.landmark).label}`)
        .join(" ");
      const haystack = [feature.title, categorySearchText, feature.confidence, feature.creator, feature.notes]
        .join(" ")
        .toLowerCase();
      return haystack.includes(state.search);
    });
  }

  function getSelectedFeature() {
    if (state.draftFeature && state.draftFeature.id === state.selectedId) {
      return state.draftFeature;
    }
    return state.features.find((feature) => feature.id === state.selectedId) || null;
  }

  function getSelectedFeatures() {
    const ids = new Set(state.selectedIds);
    const selected = state.features.filter((feature) => ids.has(feature.id));
    if (state.draftFeature && ids.has(state.draftFeature.id)) {
      selected.push(state.draftFeature);
    }
    return selected;
  }

  function isFeatureSelected(id) {
    return state.selectedIds.includes(id);
  }

  function isAdditiveSelectionEvent(event) {
    return Boolean(event && (event.ctrlKey || event.metaKey || event.shiftKey));
  }

  function getDraftFeature(applyEditor = false) {
    if (!state.draftFeature) {
      return null;
    }
    if (applyEditor && state.selectedId === state.draftFeature.id) {
      applyEditorValues(state.draftFeature);
    }
    return state.draftFeature;
  }

  function applyEditorValues(feature) {
    feature.title = elements.titleInput.value.trim() || "Untitled";
    const selectedCategories = getSelectedCategoryIds();
    const currentPrimary = normalizeCategoryId(feature.category);
    const typeCategory = feature.type === "route" ? "route" : feature.type === "range" ? "range" : "";
    feature.category =
      (typeCategory && selectedCategories.includes(typeCategory) && typeCategory) ||
      (selectedCategories.includes(currentPrimary) && currentPrimary) ||
      selectedCategories[0] ||
      "landmark";
    feature.categories = [feature.category, ...selectedCategories.filter((categoryId) => categoryId !== feature.category)];
    feature.confidence = elements.confidenceInput.value;
    if (feature.type === "range" || feature.type === "route") {
      feature.color = normalizeHexColor(elements.rangeColorInput.value) || (categoryById[feature.category] || categoryById.range).color;
    } else {
      delete feature.color;
    }
    feature.notes = elements.notesInput.value.trim();
  }

  function stampFeatureUpdate(feature) {
    const updater = getCurrentCreatorName();
    if (updater && updater !== feature.creator) {
      feature.updatedBy = updater;
    }
  }

  function compareFeaturesForList(a, b) {
    const aDefault = isDefaultFeature(a);
    const bDefault = isDefaultFeature(b);
    const aCanon = isCanonFeature(a);
    const bCanon = isCanonFeature(b);
    const aReference = aDefault || aCanon;
    const bReference = bDefault || bCanon;
    if (aReference !== bReference) {
      return aReference ? 1 : -1;
    }
    if (aCanon !== bCanon) {
      return aCanon ? -1 : 1;
    }
    if (aDefault !== bDefault) {
      return aDefault ? 1 : -1;
    }
    if (aReference && bReference) {
      return a.title.localeCompare(b.title);
    }
    const aTime = Date.parse(a.createdAt || "") || 0;
    const bTime = Date.parse(b.createdAt || "") || 0;
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return a.title.localeCompare(b.title);
  }

  function compareFeaturesForMap(a, b) {
    const orderDifference = getFeatureMapOrder(a) - getFeatureMapOrder(b);
    if (orderDifference) {
      return orderDifference;
    }
    return a.title.localeCompare(b.title);
  }

  function getFeatureMapOrder(feature) {
    if (isFeatureSelected(feature.id)) {
      return 30;
    }
    if (isDefaultFeature(feature)) {
      return 0;
    }
    if (isCanonFeature(feature)) {
      return 5;
    }
    if (isGuildFeature(feature)) {
      return 10;
    }
    return 20;
  }

  function getFeatureZIndexOffset(feature, selected) {
    if (selected) {
      return 300000;
    }
    if (isGuildFeature(feature)) {
      return 100000;
    }
    if (isCanonFeature(feature)) {
      return 50000;
    }
    if (isDefaultFeature(feature)) {
      return 0;
    }
    return 200000;
  }

  function isDefaultFeature(feature) {
    return feature.source === "default" || feature.id.startsWith("default-");
  }

  function isGuildFeature(feature) {
    return feature.source === "guild";
  }

  function isCanonFeature(feature) {
    return feature.source === "canon";
  }

  function isPersonalFeature(feature) {
    return !isDefaultFeature(feature) && !isGuildFeature(feature) && !isCanonFeature(feature);
  }

  function zoomToFeature(feature) {
    if (feature.type === "marker") {
      const point = isOfficialTrailmark(feature) ? getOfficialTrailmarkMapPoint(feature) : feature.points[0];
      if (!point) {
        return;
      }
      map.setView([point.y, point.x], Math.max(map.getZoom(), 0));
      return;
    }

    const latLngs = feature.points.map((point) => [point.y, point.x]);
    map.fitBounds(L.latLngBounds(latLngs).pad(0.2));
  }

  function mergePersonalFeatures(current, incoming) {
    const byId = new Map(current.map((feature) => [feature.id, feature]));
    incoming.forEach((feature) => {
      const existing = byId.get(feature.id);
      if (existing && !isPersonalFeature(existing)) {
        return;
      }
      byId.set(feature.id, feature);
    });
    return applyDefaultFeatures(Array.from(byId.values()));
  }

  function replacePersonalFeatures(current, incoming) {
    const preserved = current.filter((feature) => !isPersonalFeature(feature));
    return applyDefaultFeatures(preserved.concat(incoming));
  }

  function applyDefaultFeatures(features) {
    const defaultIds = new Set(defaultFeatures.map((feature) => feature.id));
    const defaultTitles = new Set(defaultFeatures.map((feature) => feature.title.toLowerCase()));
    const defaultishCategories = new Set(["city", "landmark", "settlement", "town"]);
    const preserved = features.filter((feature) => {
      const title = feature.title.toLowerCase();
      return !defaultIds.has(feature.id) && !(feature.type === "marker" && defaultTitles.has(title) && defaultishCategories.has(feature.category));
    });
    return preserved.concat(defaultFeatures.map(cloneFeature));
  }

  function normalizeFeatures(features, sourceMap) {
    const sourceWidth = Number(sourceMap && sourceMap.width);
    const sourceHeight = Number(sourceMap && sourceMap.height);
    const scaleX = sourceWidth && sourceWidth !== MAP_WIDTH ? MAP_WIDTH / sourceWidth : 1;
    const scaleY = sourceHeight && sourceHeight !== MAP_HEIGHT ? MAP_HEIGHT / sourceHeight : 1;

    return features.map((feature) => {
      const { ranger, timer, ...rest } = feature;
      const category = normalizeCategoryId(rest.category);
      const featureCategories = normalizeFeatureCategoryIds(rest.categories, category);
      const source = rest.source === "guild" ? "guild" : rest.source === "canon" ? "canon" : rest.id && rest.id.startsWith("default-") ? "default" : "personal";
      return {
        ...rest,
        category,
        categories: featureCategories,
        creator: normalizeCreatorName(rest.creator || ""),
        updatedBy: normalizeCreatorName(rest.updatedBy || ""),
        color: rest.type === "range" || rest.type === "route" ? normalizeHexColor(rest.color) : "",
        source,
        points: rest.points.map((point) =>
        clampPoint({
          lng: Math.round(point.x * scaleX),
          lat: Math.round(point.y * scaleY),
        }),
        ),
      };
    });
  }

  function normalizeCategoryId(categoryId) {
    return categoryById[categoryId] ? categoryId : categoryAliases[categoryId] || "landmark";
  }

  function normalizeFeatureCategoryIds(categoryIds, primaryCategory) {
    const primary = normalizeCategoryId(primaryCategory);
    const candidates = Array.isArray(categoryIds) ? categoryIds : [];
    return Array.from(new Set([primary, ...candidates.map(normalizeCategoryId)]));
  }

  function getFeatureCategories(feature) {
    return normalizeFeatureCategoryIds(feature && feature.categories, feature && feature.category);
  }

  function getFeatureCategoryColors(feature) {
    return getFeatureCategories(feature).map((categoryId) => (categoryById[categoryId] || categoryById.landmark).color);
  }

  function getFeatureMarkerFill(feature) {
    const colors = getFeatureCategoryColors(feature);
    if (colors.length < 2) {
      return colors[0] || categoryById.landmark.color;
    }

    const segmentSize = 100 / colors.length;
    const segments = colors
      .map((color, index) => `${color} ${(index * segmentSize).toFixed(3)}% ${((index + 1) * segmentSize).toFixed(3)}%`)
      .join(", ");
    return `conic-gradient(from -90deg, ${segments})`;
  }

  function getFeatureMarkerStyle(feature) {
    const primaryColor = (categoryById[feature.category] || categoryById.landmark).color;
    return `--marker-color:${primaryColor};--marker-fill:${getFeatureMarkerFill(feature)}`;
  }

  function getFeatureSwatchStyle(feature) {
    return `background:${getFeatureMarkerFill(feature)}`;
  }

  function getFeatureCategoryLabel(feature) {
    return getFeatureCategories(feature)
      .map((categoryId) => (categoryById[categoryId] || categoryById.landmark).label)
      .join(" + ");
  }

  function featureHasAnyCategory(feature, categoryIds) {
    return getFeatureCategories(feature).some((categoryId) => categoryIds.has(categoryId));
  }

  function isValidFeature(feature) {
    return (
      feature &&
      typeof feature.id === "string" &&
      ["marker", "route", "range"].includes(feature.type) &&
      typeof feature.category === "string" &&
      Array.isArray(feature.points) &&
      feature.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    );
  }

  function clampPoint(latlng) {
    const x = Number(latlng?.lng ?? latlng?.x);
    const y = Number(latlng?.lat ?? latlng?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return {
      x: Math.max(0, Math.min(MAP_WIDTH, Math.round(x))),
      y: Math.max(0, Math.min(MAP_HEIGHT, Math.round(y))),
    };
  }

  function setStatus(message) {
    elements.statusBar.textContent = message;
  }

  function getCurrentCreatorName() {
    return normalizeCreatorName(state.creatorName);
  }

  function normalizeCreatorName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  }

  function getFeatureColor(feature, category) {
    if (feature.type === "range" || feature.type === "route") {
      return normalizeHexColor(feature.color) || category.color;
    }
    return category.color;
  }

  function normalizeHexColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "";
  }

  function getFeatureTooltip(feature, category) {
    const title = escapeHtml(feature.title || category.label);
    const categoryLabel = escapeHtml(getFeatureCategoryLabel(feature));
    return [title, `<span class="tooltip-meta">${categoryLabel}</span>`, getAttributionHtml(feature), `<span class="tooltip-meta">${escapeHtml(getFeatureFreshnessLabel(feature))}</span>`]
      .filter(Boolean)
      .join("<br>");
  }

  function getAttributionHtml(feature) {
    const lines = [];
    if (isGuildFeature(feature)) {
      lines.push("Official Guild Atlas");
    }
    if (feature.creator) {
      lines.push(`Mapped by ${escapeHtml(feature.creator)}`);
    }
    if (feature.updatedBy) {
      lines.push(`Updated by ${escapeHtml(feature.updatedBy)}`);
    }
    return lines.map((line) => `<span>${line}</span>`).join("<br>");
  }

  function getFeatureFreshnessLabel(feature) {
    if (feature.confidence === "stale") {
      return "Marked stale";
    }
    return `Updated ${formatRelativeDate(feature.updatedAt || feature.createdAt)}`;
  }

  function formatRelativeDate(value) {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) {
      return "unknown";
    }
    const days = Math.floor((Date.now() - timestamp) / 86400000);
    if (days <= 0) {
      return "today";
    }
    if (days === 1) {
      return "yesterday";
    }
    if (days < 30) {
      return `${days} days ago`;
    }
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} month${months === 1 ? "" : "s"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }

  function formatRelativeTime(value) {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) {
      return "at an unknown time";
    }
    const elapsedMs = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(elapsedMs / 60000);
    if (minutes < 1) {
      return "just now";
    }
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    if (days < 30) {
      return `${days}d ago`;
    }
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }

  function getCategoryIcon(category) {
    const icons = {
      cache: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14v10H5z"/><path d="M7 9l2-4h6l2 4"/><path d="M9 13h6"/></svg>',
      camp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19 12 5l8 14z"/><path d="M12 5v14"/><path d="M7 19h10"/></svg>',
      city: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V8l3 2 4-4 4 4 3-2v12z"/><path d="M9 20v-5h6v5"/><path d="M8 12h1M15 12h1"/></svg>',
      contact: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M6 20c1-4 11-4 12 0"/></svg>',
      hunting: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5"/><path d="M7 5h6v6"/><path d="M5 7l4 4"/><path d="M14 16l3 3"/></svg>',
      ingredient: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V9"/><path d="M12 12c-4 0-6-2-6-5 4 0 6 2 6 5z"/><path d="M12 15c4 0 6-2 6-5-4 0-6 2-6 5z"/></svg>',
      landmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 19 20H5z"/><path d="M9 20h6"/></svg>',
      ore: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17 9 7l7-2 4 6-5 8z"/><path d="M9 7l6 12"/><path d="M16 5l-1 14"/></svg>',
      post: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16"/><path d="M5 8c2 2 5 2 7 0 2 2 5 2 7 0"/><path d="M7 20h10"/></svg>',
      range: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7 12 4l7 4v9l-7 3-7-3z"/><path d="M9 10h6v4H9z"/></svg>',
      route: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18c5-9 9 1 14-8"/><circle cx="5" cy="18" r="1.5"/><circle cx="19" cy="10" r="1.5"/></svg>',
      station: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14"/><path d="M7 20V10l5-4 5 4v10"/><path d="M10 20v-5h4v5"/><path d="M9 11h6"/><path d="M12 6V3"/><path d="M10 3h4"/></svg>',
      threat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 21 20H3z"/><path d="M12 9v5"/><path d="M12 17h.01"/></svg>',
      trailmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h10l-2 4 2 4H7z"/><path d="M9 13v7"/><path d="M6 20h6"/><path d="M14 7h.01M11 10h3"/></svg>',
      town: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10l7-5 7 5v10z"/><path d="M10 20v-6h4v6"/><path d="M8 12h2M14 12h2"/></svg>',
    };
    return icons[category] || icons.landmark;
  }

  function getFeatureMarkerIcon(feature) {
    const featureCategories = getFeatureCategories(feature);
    if (featureCategories.length < 2) {
      return getCategoryIcon(feature.category);
    }

    const icons = featureCategories
      .slice(0, 2)
      .map((categoryId) => `<span>${getCategoryIcon(categoryId)}</span>`)
      .join("");
    const remaining = featureCategories.length > 2 ? `<b class="mixed-marker-count">+${featureCategories.length - 2}</b>` : "";
    return `<span class="mixed-marker-icons">${icons}</span>${remaining}`;
  }

  function truncate(value, length) {
    return value.length > length ? `${value.slice(0, length - 3)}...` : value;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();

