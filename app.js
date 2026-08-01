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
  const SKYRIM_WORLDSPACE_FORM_ID = 0x0000003c;
  const WORLD_TO_ATLAS_X = [73.826813, 0.215295427, 4067.73578];
  const WORLD_TO_ATLAS_Y = [-0.324059025, 74.56657, 3036.85421];
  const DISCORD_DEVICE_TOKEN_STORAGE_KEY = "ranger-atlas-discord-device-token-v1";
  const TRAILMARK_VISIT_RADIUS = 96;
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

  function init() {
    prepareSearchInputAgainstAutofill();
    loadState();
    applyTheme();
    updateWorkspaceUI();
    renderFilters();
    renderAll();
    bindEvents();
    updateMapDensity();
    syncViewInputsFromState();
    [0, 100, 500, 1500, 3000].forEach((delay) => window.setTimeout(clearRestoredSearchInput, delay));
    setStatus("Ready");
    updateTrailmarkVisitControls();
    updateSharePositionControls();
    if (isSupabaseConfigured()) {
      void refreshDiscordLink();
      void refreshOfficialGuildAtlas();
      void pollAwakeRangerCount();
      guildAtlasRefreshTimer = window.setInterval(
        () => void refreshOfficialGuildAtlas(),
        GUILD_ATLAS_REFRESH_MS,
      );
      discordProfileRefreshTimer = window.setInterval(
        () => void refreshDiscordLink(),
        DISCORD_PROFILE_REFRESH_MS,
      );
    }
    window.addEventListener("focus", () => {
      void refreshOfficialGuildAtlas();
      void refreshDiscordLink();
    });
    if (state.livePositionEnabled) {
      startLivePositionPolling();
      startFieldActionPolling();
      void syncNativeTrailmarks();
      void syncNativeFieldState(true);
    } else {
      void clearNativeTrailmarks();
    }
  }

  function prepareSearchInputAgainstAutofill() {
    const input = elements.searchInput;
    const randomSuffix = Math.random().toString(36).slice(2, 10);
    input.name = `atlas_search_${randomSuffix}`;
    input.autocomplete = "off";
    input.readOnly = true;

    const unlockSearch = () => {
      input.readOnly = false;
      input.autocomplete = "off";
    };

    input.addEventListener("pointerdown", unlockSearch, { once: true });
    input.addEventListener("keydown", unlockSearch, { once: true });
    input.addEventListener("focus", unlockSearch, { once: true });
  }

  function bindEvents() {
    elements.workspaceModeButtons.forEach((button) => {
      button.addEventListener("click", () => setWorkspaceMode(button.dataset.workspaceMode));
    });
    elements.panelViewButtons.forEach((button) => {
      button.addEventListener("click", () => setPanelView(button.dataset.panelView));
    });
    elements.toolButtons.forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    elements.aboutBtn.addEventListener("click", () => elements.aboutDialog.showModal());
    elements.aboutCloseBtn.addEventListener("click", () => elements.aboutDialog.close());
    closeDialogOnBackdrop(elements.aboutDialog);
    elements.helpBtn.addEventListener("click", () => elements.helpDialog.showModal());
    elements.helpCloseBtn.addEventListener("click", () => elements.helpDialog.close());
    closeDialogOnBackdrop(elements.helpDialog);
    elements.settingsBtn.addEventListener("click", () => elements.settingsDialog.showModal());
    elements.settingsCloseBtn.addEventListener("click", () => elements.settingsDialog.close());
    closeDialogOnBackdrop(elements.settingsDialog);
    elements.clipboardBtn.addEventListener("click", openClipboardDialog);
    elements.clipboardCloseBtn.addEventListener("click", closeClipboardDialog);
    elements.clipboardDoneBtn.addEventListener("click", closeClipboardDialog);
    elements.clipboardTitleInput.addEventListener("input", saveClipboardFromDialog);
    elements.clipboardBodyInput.addEventListener("input", saveClipboardFromDialog);
    elements.clipboardMarkBtn.addEventListener("click", createClipboardMarkHere);
    elements.clipboardDropBtn.addEventListener("click", sendClipboardFieldDrop);
    closeDialogOnBackdrop(elements.clipboardDialog);
    elements.themeToggleBtn.addEventListener("click", () => {
      state.darkMode = !state.darkMode;
      applyTheme();
      saveState();
      setStatus(state.darkMode ? "Dark interface enabled" : "Parchment interface enabled");
    });
    elements.showLabelsInput.addEventListener("change", (event) => {
      state.showLabels = event.target.checked;
      saveState();
      renderAll();
      renderDraft();
      setStatus(state.showLabels ? "Location names shown" : "Location names hidden");
    });
    elements.livePositionInput.addEventListener("change", (event) => {
      const enabled = event.target.checked;
      if (enabled && !getCurrentCreatorName()) {
        event.target.checked = false;
        setStatus("Enter your Ranger name before connecting to Skyrim");
        elements.creatorInput.focus();
        return;
      }
      if (enabled && !isSupabaseConfigured()) {
        event.target.checked = false;
        setStatus("Supabase is not configured, so live position cannot be shared");
        return;
      }

      state.livePositionEnabled = enabled;
      state.sharePositionEnabled = enabled;
      saveState();
      if (state.livePositionEnabled) {
        renderTrailmarkVisitRadii();
        startLivePositionPolling();
        startFieldActionPolling();
        void syncNativeTrailmarks(true);
        setStatus("Connecting to the local Ranger Atlas integration");
      } else {
        state.followLivePosition = false;
        elements.followLivePositionInput.checked = false;
        void removeSharedLivePosition();
        stopLivePositionPolling();
        stopFieldActionPolling();
        void clearNativeTrailmarks();
        setStatus("Live position hidden");
      }
      updateTrailmarkVisitControls();
      updateSharePositionControls();
    });
    elements.followLivePositionInput.addEventListener("change", (event) => {
      state.followLivePosition = event.target.checked;
      saveState();
      if (state.followLivePosition && state.livePositionPoint && !state.livePositionPoint.stale) {
        centerOnLivePosition(true);
      }
      setStatus(state.followLivePosition ? "Following live position" : "Live position follow paused");
    });
    elements.fieldMarkHereBtn.addEventListener("click", () => {
      if (!state.livePositionPoint || state.livePositionPoint.stale) {
        setStatus("Connect to Skyrim before placing a mark here");
        return;
      }
      placeDraftAtPoint(state.livePositionPoint, "Current Skyrim position");
    });
    elements.trailmarkVisitsInput.addEventListener("change", handleTrailmarkVisitsToggle);
    elements.discordLinkBtn.addEventListener("click", openDiscordLinkDialog);
    elements.discordLinkCloseBtn.addEventListener("click", closeDiscordLinkDialog);
    elements.discordLinkCancelBtn.addEventListener("click", closeDiscordLinkDialog);
    elements.discordLinkForm.addEventListener("submit", claimDiscordLink);
    elements.discordRelinkBtn.addEventListener("click", beginDiscordRelink);
    elements.discordUnlinkBtn.addEventListener("click", unlinkDiscord);
    closeDialogOnBackdrop(elements.discordLinkDialog);
    elements.trailmarkArrivalCloseBtn.addEventListener("click", hideTrailmarkArrival);
    elements.trailmarkArrivalDropBtn.addEventListener("click", () => {
      const feature = state.features.find(
        (candidate) => candidate.id === elements.trailmarkArrival.dataset.featureId,
      );
      openTrailmarkDropDialog(feature);
    });
    elements.trailmarkArrivalLinkBtn.addEventListener("click", openDiscordLinkDialog);
    elements.refreshTrailmarkVisitsBtn.addEventListener("click", () => {
      const feature = getSelectedFeature();
      if (isOfficialTrailmark(feature)) {
        void refreshTrailmarkVisits(feature, true);
      }
    });
    elements.trailmarkDropBtn.addEventListener("click", openTrailmarkDropDialog);
    elements.trailmarkDropCloseBtn.addEventListener("click", closeTrailmarkDropDialog);
    elements.trailmarkDropCancelBtn.addEventListener("click", closeTrailmarkDropDialog);
    elements.trailmarkDropForm.addEventListener("submit", submitTrailmarkDrop);
    elements.trailmarkDropDialog.addEventListener("close", () => {
      window.clearTimeout(trailmarkDropPollTimer);
      trailmarkDropPollTimer = null;
    });
    closeDialogOnBackdrop(elements.trailmarkDropDialog);

    elements.undoBtn.addEventListener("click", undoLastAction);
    elements.guildAdminBtn.addEventListener("click", openGuildPublishDialog);
    elements.guildPassphraseForm.addEventListener("submit", (event) => event.preventDefault());
    elements.overwatchPassphraseForm.addEventListener("submit", (event) => event.preventDefault());
    elements.guildPublishConfirmBtn.addEventListener("click", publishGuildAtlas);
    elements.guildRecoverAllBtn.addEventListener("click", recoverAllAtlasEntries);
    elements.guildPublishCancelBtn.addEventListener("click", () => closeGuildPublishDialog());
    elements.guildPublishKeepBtn.addEventListener("click", () => closeGuildPublishDialog());
    elements.guildSelectAllBtn.addEventListener("click", () => setGuildEntryChecks(true));
    elements.guildSelectNoneBtn.addEventListener("click", () => setGuildEntryChecks(false));
    elements.guildEntryList.addEventListener("change", updateGuildPublishDialogState);
    elements.overwatchToggleBtn.addEventListener("click", toggleOverwatch);
    closeDialogOnBackdrop(elements.guildPublishDialog);
    elements.exportBtn.addEventListener("click", openShareDialog);
    elements.exportMapBtn.addEventListener("click", exportVisibleMap);
    elements.shareCopyBtn.addEventListener("click", copySelectedShareCode);
    elements.shareReportBtn.addEventListener("click", copySelectedFieldReport);
    elements.shareCancelBtn.addEventListener("click", () => closeShareDialog());
    elements.shareKeepBtn.addEventListener("click", () => closeShareDialog());
    elements.shareSelectAllBtn.addEventListener("click", () => setShareEntryChecks(true));
    elements.shareSelectNoneBtn.addEventListener("click", () => setShareEntryChecks(false));
    elements.shareEntryList.addEventListener("change", updateShareDialogState);
    closeDialogOnBackdrop(elements.shareDialog);
    elements.importBtn.addEventListener("click", openReceiveDialog);
    elements.receiveCancelBtn.addEventListener("click", () => closeReceiveDialog());
    elements.receiveCodeInput.addEventListener("input", resetReceivePreview);
    elements.receiveGuildBtn.addEventListener("click", reviewGuildAtlasCode);
    elements.receiveSkyrimBtn.addEventListener("click", reviewSkyrimAtlasCode);
    elements.receiveReviewBtn.addEventListener("click", () => reviewReceiveCode());
    elements.receiveMergeBtn.addEventListener("click", () => receiveShareCode(false));
    elements.receiveReplaceBtn.addEventListener("click", () => receiveShareCode(true));
    closeDialogOnBackdrop(elements.receiveDialog);
    elements.clearBtn.addEventListener("click", openClearDialog);
    elements.clearConfirmBtn.addEventListener("click", clearAtlas);
    elements.clearSelectAllBtn.addEventListener("click", () => setClearCategoryChecks(true));
    elements.clearSelectNoneBtn.addEventListener("click", () => setClearCategoryChecks(false));
    elements.clearScopeInputs.forEach((input) => input.addEventListener("change", renderClearCategories));
    elements.clearCategoryList.addEventListener("change", updateClearDialogState);
    elements.clearCancelBtn.addEventListener("click", () => elements.clearDialog.close());
    elements.clearKeepBtn.addEventListener("click", () => elements.clearDialog.close());
    closeDialogOnBackdrop(elements.clearDialog);

    elements.creatorInput.addEventListener("input", (event) => {
      const previousCreatorName = state.creatorName;
      state.creatorName = normalizeCreatorName(event.target.value);
      if (previousCreatorName && previousCreatorName !== state.creatorName) {
        state.trailmarkVisitCandidate = null;
        void leaveTrailmarkVisit();
      }
      if (!state.creatorName && state.trailmarkVisitsEnabled) {
        state.trailmarkVisitsEnabled = false;
        state.trailmarkVisitCandidate = null;
        void leaveTrailmarkVisit();
        elements.trailmarkVisitsInput.checked = false;
        setStatus("Trailmark visit recording stopped because Signed As is empty");
      }
      if (!state.creatorName && state.livePositionEnabled) {
        state.livePositionEnabled = false;
        state.sharePositionEnabled = false;
        elements.livePositionInput.checked = false;
        void removeSharedLivePosition();
        stopLivePositionPolling();
        void clearNativeTrailmarks();
        setStatus("Live position stopped because Signed As is empty");
      }
      if (
        state.creatorName
        && !state.livePositionEnabled
        && isSupabaseConfigured()
      ) {
        state.livePositionEnabled = true;
        state.sharePositionEnabled = true;
        elements.livePositionInput.checked = true;
        startLivePositionPolling();
        startFieldActionPolling();
        void syncNativeTrailmarks(true);
      }
      saveState();
      updateTrailmarkVisitControls();
      updateSharePositionControls();
    });

    elements.searchInput.addEventListener("input", (event) => {
      if (shouldRejectSearchAutofill(event.target.value)) {
        event.target.value = "";
        state.search = "";
        renderAll();
        return;
      }
      state.search = event.target.value.trim().toLowerCase();
      renderAll();
    });

    elements.creatorFilterInput.addEventListener("change", (event) => {
      state.creatorFilter = event.target.value;
      renderAll();
    });
    elements.filterAllBtn.addEventListener("click", () => setCategoryFilters(true));
    elements.filterNoneBtn.addEventListener("click", () => setCategoryFilters(false));

    [elements.titleInput, elements.confidenceInput, elements.rangeColorInput, elements.notesInput].forEach((element) => {
      element.addEventListener("input", syncDraftFromEditor);
      element.addEventListener("change", syncDraftFromEditor);
    });
    elements.categoryInput.addEventListener("change", handleCategorySelectionChange);

    elements.editorForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveSelectedFeature();
    });

    elements.moveFeatureBtn.addEventListener("click", beginMoveSelectedFeature);
    elements.confirmMoveBtn.addEventListener("click", confirmFeatureMove);
    elements.cancelMoveBtn.addEventListener("click", () => cancelFeatureMove());
    elements.deleteFeatureBtn.addEventListener("click", deleteSelectedFeature);

    map.on("click", handleMapClick);
    map.on("mousedown", handleDrawStart);
    map.on("mousemove", handleDrawMove);
    map.on("mouseup", handleDrawEnd);
    map.on("mouseout", handleDrawEnd);
    map.on("dragend", () => {
      lastDragEndedAt = Date.now();
    });
    map.on("zoomstart zoom zoomend", () => {
      if (state.mode !== "route" && state.mode !== "range" && !map.dragging.enabled()) {
        map.dragging.enable();
      }
    });
    map.on("zoomend", updateMapDensity);
    map.on("dblclick", () => {
      if (state.mode === "route" || state.mode === "range") {
        finishDrawing();
      }
    });

    window.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (state.workspaceMode !== "edit") {
          return;
        }
        const editable =
          event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']");
        if (editable) {
          return;
        }
        event.preventDefault();
        undoLastAction();
        return;
      }

      if (event.key === "Escape") {
        if (state.movingFeatureId) {
          cancelFeatureMove();
        } else if (state.drawPoints.length) {
          cancelDrawing();
        } else if (hasActiveViewFilters()) {
          resetViewFilters();
          renderAll();
          setStatus("View filters cleared");
        } else {
          selectFeature(null);
        }
      }
    });
  }

  function closeDialogOnBackdrop(dialog) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  }

  function loadState() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.features = defaultFeatures.map(cloneFeature);
      saveState();
      return;
    }

    try {
      const saved = JSON.parse(raw);
      let shouldSave = false;
      if (Array.isArray(saved.features)) {
        state.features = normalizeFeatures(saved.features.filter(isValidFeature), saved.map);
      }
      if (saved.defaultsVersion !== DEFAULT_FEATURES_VERSION) {
        state.features = applyDefaultFeatures(state.features);
        shouldSave = true;
      }
      if (saved.filters && typeof saved.filters === "object") {
        categories.forEach((category) => {
          state.filters[category.id] = saved.filters[category.id] !== false;
        });
      }
      state.showLabels = saved.showLabels === true;
      elements.showLabelsInput.checked = state.showLabels;
      if (typeof saved.darkMode === "boolean") {
        state.darkMode = saved.darkMode;
      }
      state.livePositionEnabled = saved.livePositionEnabled === true;
      elements.livePositionInput.checked = state.livePositionEnabled;
      state.followLivePosition = saved.followLivePosition === true;
      elements.followLivePositionInput.checked = state.followLivePosition;
      state.creatorName = normalizeCreatorName(saved.creatorName || "");
      elements.creatorInput.value = state.creatorName;
      state.guildAtlasUpdatedAt = typeof saved.guildAtlasUpdatedAt === "string" ? saved.guildAtlasUpdatedAt : "";
      state.guildAtlasLocalChanges = saved.guildAtlasLocalChanges === true;
      state.sharePositionEnabled = Boolean(state.creatorName)
        && isSupabaseConfigured()
        && state.livePositionEnabled;
      if (state.livePositionEnabled && !state.sharePositionEnabled) {
        state.livePositionEnabled = false;
        elements.livePositionInput.checked = false;
        shouldSave = true;
      }
      state.sharePositionEnabled = state.livePositionEnabled;
      state.trailmarkVisitsEnabled = saved.trailmarkVisitsEnabled === true && Boolean(state.creatorName);
      elements.trailmarkVisitsInput.checked = state.trailmarkVisitsEnabled;
      if (saved.clipboard && typeof saved.clipboard === "object") {
        state.clipboard = normalizeClipboard(saved.clipboard);
      }
      if (saved.trailmarkVisitCooldowns && typeof saved.trailmarkVisitCooldowns === "object") {
        const oldestUsefulVisit = Date.now() - TRAILMARK_VISIT_COOLDOWN_MS;
        state.trailmarkVisitCooldowns = Object.fromEntries(
          Object.entries(saved.trailmarkVisitCooldowns)
            .map(([featureId, timestamp]) => [featureId, Number(timestamp)])
            .filter(([featureId, timestamp]) => featureId && Number.isFinite(timestamp) && timestamp > oldestUsefulVisit),
        );
      }
      syncViewInputsFromState();
      if (shouldSave) {
        saveState();
      }
    } catch (error) {
      console.warn("Could not load saved map state", error);
    }
  }

  function saveState() {
    const payload = {
      version: 1,
      map: {
        image: MAP_IMAGE,
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
      },
      savedAt: new Date().toISOString(),
      defaultsVersion: DEFAULT_FEATURES_VERSION,
      filters: state.filters,
      showLabels: state.showLabels,
      darkMode: state.darkMode,
      livePositionEnabled: state.livePositionEnabled,
      followLivePosition: state.followLivePosition,
      sharePositionEnabled: state.sharePositionEnabled,
      guildAtlasUpdatedAt: state.guildAtlasUpdatedAt,
      guildAtlasLocalChanges: state.guildAtlasLocalChanges,
      trailmarkVisitsEnabled: state.trailmarkVisitsEnabled,
      trailmarkVisitCooldowns: state.trailmarkVisitCooldowns,
      clipboard: state.clipboard,
      creatorName: state.creatorName,
      features: state.features,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.darkMode ? "dark" : "light";
    elements.themeToggleBtn.setAttribute("aria-label", state.darkMode ? "Use parchment mode" : "Use dark mode");
    elements.themeToggleBtn.title = state.darkMode ? "Use parchment mode" : "Use dark mode";
  }

  function startLivePositionPolling() {
    stopLivePositionPolling(false);
    state.livePositionConnection = "connecting";
    updateLivePositionStatus("Connecting...", "connecting");
    pollLivePosition();
  }

  function startFieldActionPolling() {
    stopFieldActionPolling();
    pollFieldActions();
  }

  function stopFieldActionPolling() {
    window.clearTimeout(fieldActionPollTimer);
    fieldActionPollTimer = null;
    if (fieldActionRequest) {
      fieldActionRequest.abort();
      fieldActionRequest = null;
    }
  }

  function postNativeMarkerSnapshot(payload) {
    const send = async () => {
      const response = await fetch(NATIVE_MARKERS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Native marker bridge returned ${response.status}`);
      }
    };
    const request = nativeMarkerPostChain.then(send, send);
    nativeMarkerPostChain = request.catch(() => undefined);
    return request;
  }

  async function clearNativeTrailmarks() {
    nativeMarkerSyncQueued = false;
    try {
      await postNativeMarkerSnapshot({ version: 1, markers: [] });
      state.nativeMarkerSyncKey = "";
    } catch (error) {
      console.debug("Native Skyrim Trailmark clear unavailable", error);
    }
  }

  async function syncNativeTrailmarks(force = false) {
    if (!state.livePositionEnabled) {
      return;
    }
    if (nativeMarkerSyncInFlight) {
      nativeMarkerSyncQueued = true;
      return;
    }

    const markers = state.features
      .filter(isOfficialTrailmark)
      .map((feature) => ({
        id: feature.id,
        title: feature.title || "Trailmark",
        x: Number(feature.points?.[0]?.x),
        y: Number(feature.points?.[0]?.y),
      }))
      .filter((marker) => marker.id && marker.title && Number.isFinite(marker.x) && Number.isFinite(marker.y))
      .sort((left, right) => left.id.localeCompare(right.id));
    const payload = { version: 1, markers };
    const syncKey = JSON.stringify(payload);
    if (!force && syncKey === state.nativeMarkerSyncKey) {
      return;
    }

    nativeMarkerSyncInFlight = true;
    try {
      await postNativeMarkerSnapshot(payload);
      state.nativeMarkerSyncKey = syncKey;
    } catch (error) {
      state.nativeMarkerSyncKey = "";
      console.debug("Native Skyrim Trailmark sync unavailable", error);
    } finally {
      nativeMarkerSyncInFlight = false;
      if (nativeMarkerSyncQueued) {
        nativeMarkerSyncQueued = false;
        if (state.livePositionEnabled) {
          void syncNativeTrailmarks(true);
        }
      }
    }
  }

  function getNearestOfficialTrailmark(point = state.livePositionPoint) {
    if (!point || point.stale) {
      return null;
    }
    return state.features
      .filter(isOfficialTrailmark)
      .map((feature) => ({
        feature,
        distance: Math.hypot(feature.points[0].x - point.x, feature.points[0].y - point.y),
      }))
      .sort((left, right) => left.distance - right.distance)[0] || null;
  }

  function createNativeFieldState() {
    const nearest = getNearestOfficialTrailmark();
    const nearestFeature = nearest?.feature;
    const visits = nearestFeature ? state.trailmarkVisitsByFeature.get(nearestFeature.id) : [];
    const playerPoint = state.livePositionPoint && !state.livePositionPoint.stale
      ? { x: state.livePositionPoint.x, y: state.livePositionPoint.y, heading: state.livePositionPoint.heading || 0 }
      : null;
    const officialTrailmarks = playerPoint
      ? state.features
        .filter(isOfficialTrailmark)
        .map((feature) => ({
          id: feature.id,
          title: feature.title || "Trailmark",
          x: feature.points[0]?.x,
          y: feature.points[0]?.y,
          distance: Math.hypot(feature.points[0].x - playerPoint.x, feature.points[0].y - playerPoint.y),
          within_range: Math.hypot(feature.points[0].x - playerPoint.x, feature.points[0].y - playerPoint.y) <= TRAILMARK_VISIT_RADIUS,
        }))
        .filter((feature) => Number.isFinite(feature.x) && Number.isFinite(feature.y))
        .sort((left, right) => left.distance - right.distance)
      : [];
    const mapMarkers = playerPoint
      ? getVisibleFeatures()
        .filter((feature) => feature.type === "marker" && !isOfficialTrailmark(feature) && !isDefaultFeature(feature) && !isCanonFeature(feature))
        .map((feature) => ({
          id: feature.id,
          title: feature.title || "Atlas mark",
          category: feature.category || "landmark",
          source: isGuildFeature(feature) ? "guild" : "personal",
          x: feature.points[0]?.x,
          y: feature.points[0]?.y,
          distance: Math.hypot(feature.points[0].x - playerPoint.x, feature.points[0].y - playerPoint.y),
        }))
        .filter((feature) => Number.isFinite(feature.x) && Number.isFinite(feature.y))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, 80)
      : [];
    return {
      version: 1,
      ready: Boolean(state.livePositionEnabled && state.livePositionConnection === "linked" && getCurrentCreatorName()),
      ranger_name: getCurrentCreatorName(),
      ranger_profile: normalizeDiscordProfile(state.discordLink?.profile),
      awake_ranger_count: state.awakeRangerCount,
      clipboard: {
        title: state.clipboard.title,
        body: state.clipboard.body,
        updated_at: state.clipboard.updatedAt,
      },
      game_link: state.livePositionConnection === "linked" ? "Connected to Skyrim" : "Waiting for Skyrim",
      player_point: playerPoint,
      official_trailmarks: officialTrailmarks,
      map_markers: mapMarkers,
      nearest_trailmark: nearestFeature
        ? {
            id: nearestFeature.id,
            title: nearestFeature.title || "Trailmark",
            notes: nearestFeature.notes || "",
            point: nearestFeature.points[0] ? { x: nearestFeature.points[0].x, y: nearestFeature.points[0].y } : null,
            distance: nearest.distance,
            within_range: nearest.distance <= TRAILMARK_VISIT_RADIUS,
            recent_visits: Array.isArray(visits)
              ? visits.map((visit) => ({
                  ranger_name: normalizeCreatorName(visit.ranger_name) || "Unknown Ranger",
                  activity: formatTrailmarkVisitActivity(visit).label,
                }))
              : [],
            recent_visitor_lines: Array.isArray(visits)
              ? visits.map((visit) => `${normalizeCreatorName(visit.ranger_name) || "Unknown Ranger"}: ${formatTrailmarkVisitActivity(visit).label}`)
              : [],
          }
        : null,
    };
  }

  async function syncNativeFieldState(force = false) {
    const payload = createNativeFieldState();
    const key = JSON.stringify(payload);
    if (!force && key === nativeFieldStateKey) {
      return;
    }

    const send = async () => {
      const response = await fetch(FIELD_STATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        body: key,
      });
      if (!response.ok) {
        throw new Error(`Field console bridge returned ${response.status}`);
      }
      nativeFieldStateKey = key;
    };
    const request = nativeFieldStatePostChain.then(send, send);
    nativeFieldStatePostChain = request.catch(() => undefined);
    try {
      await request;
    } catch (error) {
      nativeFieldStateKey = "";
      console.debug("Native Field Console sync unavailable", error);
    }
  }

  async function pollFieldActions() {
    if (!state.livePositionEnabled) {
      return;
    }

    const controller = new AbortController();
    fieldActionRequest = controller;
    const timeout = window.setTimeout(() => controller.abort(), 1800);

    try {
      const response = await fetch(FIELD_EVENTS_URL, {
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Local bridge returned ${response.status}`);
      }
      const payload = await response.json();
      const events = Array.isArray(payload.events) ? payload.events : [];
      events
        .filter((event) => Number(event.id) > state.fieldActionCursor)
        .sort((a, b) => Number(a.id) - Number(b.id))
        .forEach(handleFieldAction);
    } catch (error) {
      if (error.name !== "AbortError") {
        // The position poller owns the visible connection status; event polling is optional.
      }
    } finally {
      window.clearTimeout(timeout);
      if (fieldActionRequest === controller) {
        fieldActionRequest = null;
      }
      if (state.livePositionEnabled) {
        fieldActionPollTimer = window.setTimeout(pollFieldActions, 1200);
      }
    }
  }

  function handleFieldAction(event) {
    const eventId = Number(event.id);
    if (!Number.isFinite(eventId) || eventId <= state.fieldActionCursor) {
      return;
    }
    state.fieldActionCursor = eventId;
    window.localStorage.setItem(FIELD_ACTION_CURSOR_KEY, String(eventId));

    if (event.type === "open_nearby_trailmark") {
      void openNearbyTrailmarkDrop();
      return;
    }
    if (event.type === "record_nearby_trailmark_visit") {
      void recordNearbyTrailmarkVisitFromFieldConsole();
      return;
    }
    if (event.type === "refresh_nearby_trailmark_visits") {
      void refreshNearbyTrailmarkVisitsFromFieldConsole();
      return;
    }
    if (event.type === "submit_nearby_trailmark_drop") {
      void submitNearbyTrailmarkDropFromFieldConsole(event.payload?.message);
      return;
    }
    if (event.type === "create_mark_at_position") {
      createFieldMarkFromConsole(event);
      return;
    }
    if (event.type === "save_clipboard") {
      state.clipboard = normalizeClipboard(event.payload);
      saveState();
      if (!elements.clipboardDialog.open) {
        syncClipboardDialogInputs();
      }
      scheduleNativeClipboardSync();
      return;
    }
    if (event.type !== "mark_here") {
      return;
    }

    const snapshot = event.snapshot;
    if (
      snapshot &&
      isValidLivePositionSnapshot(snapshot) &&
      Number(snapshot.worldspace_form_id) === SKYRIM_WORLDSPACE_FORM_ID &&
      snapshot.interior !== true
    ) {
      const point = worldPositionToAtlasPoint(Number(snapshot.x), Number(snapshot.y));
      state.livePositionPoint = { ...point, stale: false, heading: state.livePositionHeading };
      renderLivePosition();
      placeDraftAtPoint(point, "In-game mark queued");
      setStatus("In-game mark received. Add details, then save it");
    } else if (state.livePositionPoint && !state.livePositionPoint.stale) {
      placeDraftAtPoint(state.livePositionPoint, "Current Skyrim position");
    } else {
      setStatus("In-game mark received, but Skyrim is not in the outdoor world map");
    }
  }

  function getFieldEventAtlasPoint(event) {
    const snapshot = event?.snapshot;
    if (
      snapshot &&
      isValidLivePositionSnapshot(snapshot) &&
      Number(snapshot.worldspace_form_id) === SKYRIM_WORLDSPACE_FORM_ID &&
      snapshot.interior !== true
    ) {
      return worldPositionToAtlasPoint(Number(snapshot.x), Number(snapshot.y));
    }
    return state.livePositionPoint && !state.livePositionPoint.stale ? state.livePositionPoint : null;
  }

  function createFieldMarkFromConsole(event) {
    const point = getFieldEventAtlasPoint(event);
    if (!point) {
      setStatus("Field mark could not be placed outside the Skyrim world map");
      return;
    }
    const title = String(event.payload?.title || "Field note").trim().slice(0, 120) || "Field note";
    const notes = String(event.payload?.notes || "").trim().slice(0, 800);
    const category = categoryById[event.payload?.category] ? event.payload.category : "landmark";
    const feature = createFeature({
      type: "marker",
      category,
      title,
      points: [clampPoint(point)],
    });
    feature.categories = [category];
    feature.notes = notes;
    feature.confidence = "scouted";
    pushUndo("field mark create");
    state.features.push(feature);
    saveState();
    renderAll();
    setStatus(`Created ${feature.title} at your current Skyrim position`);
  }

  async function recordNearbyTrailmarkVisitFromFieldConsole() {
    const nearest = getNearestOfficialTrailmark();
    if (!nearest || nearest.distance > TRAILMARK_VISIT_RADIUS) {
      setStatus("No official Trailmark is within field range");
      return;
    }
    if (!state.trailmarkVisitsEnabled || !getCurrentCreatorName()) {
      setStatus("Enable Record visits and enter your name before recording a visit");
      return;
    }
    await recordTrailmarkVisit(nearest.feature);
    void syncNativeFieldState(true);
  }

  async function refreshNearbyTrailmarkVisitsFromFieldConsole() {
    const nearest = getNearestOfficialTrailmark();
    if (!nearest) {
      setStatus("No official Trailmark is nearby");
      return;
    }
    await refreshTrailmarkVisits(nearest.feature, true);
    void syncNativeFieldState(true);
  }

  async function submitNearbyTrailmarkDropFromFieldConsole(message) {
    const nearest = getNearestOfficialTrailmark();
    const cleanMessage = String(message || "").trim().slice(0, 1800);
    if (!nearest || nearest.distance > TRAILMARK_VISIT_RADIUS) {
      setStatus("No official Trailmark is within field-drop range");
      return false;
    }
    if (!cleanMessage) {
      setStatus("Write a field drop before sending it");
      return false;
    }
    if (!state.discordLink || !getStoredDiscordDeviceToken()) {
      setStatus("Link Discord in the Atlas before leaving a field drop");
      return false;
    }
    if (Date.now() - Number(state.trailmarkVisitCooldowns[nearest.feature.id] || 0) >= TRAILMARK_VISIT_COOLDOWN_MS) {
      if (!state.trailmarkVisitsEnabled || !getCurrentCreatorName()) {
        setStatus("Enable Record visits before leaving a field drop");
        return false;
      }
      await recordTrailmarkVisit(nearest.feature);
    }
    if (Date.now() - Number(state.trailmarkVisitCooldowns[nearest.feature.id] || 0) >= TRAILMARK_VISIT_COOLDOWN_MS) {
      return false;
    }
    try {
      const result = await callSupabaseRpc("submit_atlas_trailmark_drop", {
        device_token_input: getStoredDiscordDeviceToken(),
        atlas_location_id_input: nearest.feature.id,
        message_input: cleanMessage,
      });
      setStatus(result?.drop_id ? "Field drop sent to Wayfinder" : "Wayfinder did not return a drop receipt");
      return Boolean(result?.drop_id);
    } catch (error) {
      setStatus(getReadableError(error, "The Trailmark drop could not be sent."));
      return false;
    }
  }

  async function openNearbyTrailmarkDrop() {
    const point = state.livePositionPoint;
    if (!point || point.stale) {
      setStatus("Connect to Skyrim before opening a Trailmark drop");
      return;
    }

    const nearest = state.features
      .filter(isOfficialTrailmark)
      .map((feature) => ({
        feature,
        distance: Math.hypot(feature.points[0].x - point.x, feature.points[0].y - point.y),
      }))
      .filter((candidate) => candidate.distance <= TRAILMARK_VISIT_RADIUS)
      .sort((left, right) => left.distance - right.distance)[0];

    if (!nearest) {
      setStatus("No official Trailmark is within field-drop range");
      return;
    }

    if (state.workspaceMode !== "field") {
      setWorkspaceMode("field");
    }
    selectFeature(nearest.feature.id);
    if (Date.now() - Number(state.trailmarkVisitCooldowns[nearest.feature.id] || 0) < TRAILMARK_VISIT_COOLDOWN_MS) {
      openTrailmarkDropDialog(nearest.feature);
      return;
    }

    if (!state.trailmarkVisitsEnabled || !getCurrentCreatorName()) {
      setStatus("Enable Record visits and enter your name before opening a Trailmark drop");
      return;
    }
    if (state.trailmarkVisitInFlight) {
      setStatus(`Checking in at ${nearest.feature.title}`);
      return;
    }

    state.trailmarkVisitCandidate = null;
    setStatus(`Recording your arrival at ${nearest.feature.title}`);
    await recordTrailmarkVisit(nearest.feature);
    if (Date.now() - Number(state.trailmarkVisitCooldowns[nearest.feature.id] || 0) < TRAILMARK_VISIT_COOLDOWN_MS) {
      openTrailmarkDropDialog(nearest.feature);
    }
  }

  function stopLivePositionPolling(clearPosition = true) {
    window.clearTimeout(livePositionPollTimer);
    livePositionPollTimer = null;
    if (livePositionRequest) {
      livePositionRequest.abort();
      livePositionRequest = null;
    }
    state.livePositionConnection = state.livePositionEnabled ? "connecting" : "off";
    if (clearPosition) {
      void leaveTrailmarkVisit();
      state.livePositionPoint = null;
      state.livePositionSnapshot = null;
      state.trailmarkVisitCandidate = null;
      livePositionLayer.clearLayers();
      trailmarkRadiusLayer.clearLayers();
      livePositionMarker = null;
      updateLivePositionStatus("Off", "off");
      updateTrailmarkVisitControls();
    }
  }

  async function pollLivePosition() {
    if (!state.livePositionEnabled) {
      return;
    }

    const controller = new AbortController();
    livePositionRequest = controller;
    const timeout = window.setTimeout(() => controller.abort(), 1800);

    try {
      const response = await fetch(LIVE_POSITION_URL, {
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        signal: controller.signal,
      });

      if (response.status === 503) {
        updateLivePositionStatus("Waiting for character", "connecting");
      } else if (!response.ok) {
        throw new Error(`Local bridge returned ${response.status}`);
      } else {
        const snapshot = await response.json();
        if (!isValidLivePositionSnapshot(snapshot)) {
          throw new Error("Local bridge returned an invalid position");
        }
        applyLivePositionSnapshot(snapshot);
        void syncNativeTrailmarks();
        void syncNativeFieldState();
      }
    } catch (error) {
      if (error.name !== "AbortError" || state.livePositionEnabled) {
        const wasLinked = state.livePositionConnection === "linked";
        state.livePositionConnection = "unavailable";
        updateLivePositionStatus(
          state.livePositionPoint ? "Last position" : "Game link unavailable",
          "unavailable",
        );
        markLivePositionStale();
        if (wasLinked) {
          setStatus("Live game link lost; showing the last outdoor position");
        }
      }
    } finally {
      window.clearTimeout(timeout);
      if (livePositionRequest === controller) {
        livePositionRequest = null;
      }
      if (state.livePositionEnabled) {
        livePositionPollTimer = window.setTimeout(pollLivePosition, LOCAL_POSITION_POLL_INTERVAL_MS);
      }
    }
  }

  function isValidLivePositionSnapshot(snapshot) {
    return Boolean(
      snapshot &&
        Number.isFinite(Number(snapshot.x)) &&
        Number.isFinite(Number(snapshot.y)) &&
        Number.isFinite(Number(snapshot.worldspace_form_id)) &&
        Number.isFinite(Number(snapshot.updated_at_unix_ms)),
    );
  }

  function applyLivePositionSnapshot(snapshot) {
    const wasLinked = state.livePositionConnection === "linked";
    state.livePositionConnection = "linked";
    state.livePositionSnapshot = snapshot;

    if (
      Number(snapshot.worldspace_form_id) === SKYRIM_WORLDSPACE_FORM_ID &&
      snapshot.interior !== true
    ) {
      const nextPoint = worldPositionToAtlasPoint(Number(snapshot.x), Number(snapshot.y));
      const previousPoint = state.livePositionPoint;
      if (previousPoint && !previousPoint.stale) {
        const deltaX = nextPoint.x - previousPoint.x;
        const deltaY = nextPoint.y - previousPoint.y;
        if (Math.hypot(deltaX, deltaY) >= 0.75) {
          state.livePositionHeading = (Math.atan2(deltaX, deltaY) * 180) / Math.PI;
        }
      }
      state.livePositionPoint = {
        ...nextPoint,
        heading: state.livePositionHeading,
        stale: false,
      };
      updateLivePositionStatus("Linked to Skyrim", "linked");
      evaluateTrailmarkProximity(state.livePositionPoint);
      void shareLivePosition(state.livePositionPoint);
    } else if (state.livePositionPoint) {
      state.livePositionPoint = { ...state.livePositionPoint, stale: true };
      updateLivePositionStatus("Last outdoor position", "linked");
      state.trailmarkVisitCandidate = null;
      updateTrailmarkVisitControls();
    } else {
      updateLivePositionStatus("Inside another area", "linked");
      state.trailmarkVisitCandidate = null;
      updateTrailmarkVisitControls();
    }

    renderLivePosition();
    centerOnLivePosition(false);
    updateSharePositionControls();
    void syncNativeFieldState();
    if (!wasLinked) {
      setStatus("Live position linked to Skyrim");
    }
  }

  function markLivePositionStale() {
    if (!state.livePositionPoint || state.livePositionPoint.stale) {
      return;
    }
    state.livePositionPoint = { ...state.livePositionPoint, stale: true };
    void leaveTrailmarkVisit();
    state.trailmarkVisitCandidate = null;
    updateTrailmarkVisitControls();
    updateSharePositionControls();
    renderLivePosition();
    void syncNativeFieldState();
  }

  function worldPositionToAtlasPoint(worldX, worldY) {
    const cellX = worldX / 4096;
    const cellY = worldY / 4096;
    return {
      x: clampNumber(
        WORLD_TO_ATLAS_X[0] * cellX + WORLD_TO_ATLAS_X[1] * cellY + WORLD_TO_ATLAS_X[2],
        0,
        MAP_WIDTH,
      ),
      y: clampNumber(
        WORLD_TO_ATLAS_Y[0] * cellX + WORLD_TO_ATLAS_Y[1] * cellY + WORLD_TO_ATLAS_Y[2],
        0,
        MAP_HEIGHT,
      ),
    };
  }

  function clampNumber(value, minimum, maximum) {
    return Math.max(minimum, Math.min(value, maximum));
  }

  function updateLivePositionStatus(text, status) {
    elements.livePositionStatus.textContent = text;
    elements.livePositionStatus.classList.toggle("is-linked", status === "linked");
    elements.livePositionStatus.classList.toggle("is-unavailable", status === "unavailable");
    renderFieldOverview(getSelectedFeature());
  }

  function renderLivePosition() {
    if (!state.livePositionEnabled || !state.livePositionPoint) {
      livePositionLayer.clearLayers();
      livePositionMarker = null;
      return;
    }

    const point = state.livePositionPoint;
    if (!livePositionMarker) {
      livePositionMarker = L.marker([point.y, point.x], {
        // Keep the player arrow visible above Trailmarks without blocking
        // clicks on the Trailmark underneath it.
        interactive: false,
        keyboard: false,
        pane: "live-position-pane",
        zIndexOffset: 100000,
        icon: L.divIcon({
          className: "live-position-leaflet-marker",
          html: `
            <div class="live-position-marker" style="--heading:0deg">
              <svg class="live-position-arrow" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M49 2Q52 1 54 6L89 92Q91 97 86 95L62 86Q56 84 53 90L50 96Q48 101 45 96L15 84Q10 82 15 78Z" />
              </svg>
            </div>
          `,
          iconSize: [38, 42],
          iconAnchor: [19, 21],
        }),
      }).addTo(livePositionLayer);
      livePositionMarker.bindTooltip("", {
        direction: "top",
        offset: [0, -17],
      });
    }

    livePositionMarker.setLatLng([point.y, point.x]);
    livePositionMarker.setTooltipContent(point.stale ? "Last known outdoor position" : "Your live position");
    const markerElement = livePositionMarker.getElement()?.querySelector(".live-position-marker");
    if (markerElement) {
      markerElement.classList.toggle("is-stale", point.stale);
      markerElement.style.setProperty("--heading", `${Number(point.heading) || 0}deg`);
    }
  }

  function renderTrailmarkVisitRadii() {
    trailmarkRadiusLayer.clearLayers();
    if (!elements.livePositionInput.checked || state.workspaceMode !== "field") {
      return;
    }

    state.features
      .filter(isOfficialTrailmark)
      .forEach((feature) => {
        const trailmarkPoint = feature.points[0];
        const boundary = Array.from({ length: 48 }, (_, index) => {
          const angle = (index / 48) * Math.PI * 2;
          return [
            trailmarkPoint.y + Math.sin(angle) * TRAILMARK_VISIT_RADIUS,
            trailmarkPoint.x + Math.cos(angle) * TRAILMARK_VISIT_RADIUS,
          ];
        });
        L.polygon(boundary, {
          pane: "trailmark-radius-pane",
          interactive: false,
          bubblingMouseEvents: false,
          color: "#7da56a",
          weight: 1,
          opacity: 0.38,
          dashArray: "4 5",
          fillColor: "#7da56a",
          fillOpacity: 0.025,
          smoothFactor: 0,
          className: "trailmark-visit-radius",
        }).addTo(trailmarkRadiusLayer);
      });
  }

  function centerOnLivePosition(zoomIn) {
    if (!state.followLivePosition || !state.livePositionPoint || state.livePositionPoint.stale) {
      return;
    }
    const point = state.livePositionPoint;
    const targetZoom = zoomIn ? Math.max(map.getZoom(), 0.75) : Math.max(map.getZoom(), 0.25);
    map.stop();
    map.flyTo([point.y, point.x], targetZoom, {
      animate: true,
      duration: 0.65,
      easeLinearity: 0.25,
    });
  }

  function updateSharePositionControls() {
    // Live position and private position sync are one setting. Keep the
    // internal flag aligned without exposing the staff-sharing mechanism.
    state.sharePositionEnabled = Boolean(
      state.livePositionEnabled && getCurrentCreatorName() && isSupabaseConfigured(),
    );
  }

  async function pollAwakeRangerCount() {
    window.clearTimeout(awakeRangerPollTimer);
    awakeRangerPollTimer = null;
    const previousCount = state.awakeRangerCount;
    try {
      const count = await callSupabaseRpc("get_atlas_awake_ranger_count", {
        device_token_input: getOrCreateDiscordDeviceToken(),
      });
      state.awakeRangerCount = Math.max(0, Number.parseInt(count, 10) || 0);
      renderAwakeRangerCount();
    } catch (error) {
      state.awakeRangerCount = null;
      renderAwakeRangerCount();
      console.debug("Ranger activity count unavailable", error);
    } finally {
      if (state.livePositionEnabled && previousCount !== state.awakeRangerCount) {
        void syncNativeFieldState(true);
      }
      awakeRangerPollTimer = window.setTimeout(pollAwakeRangerCount, AWAKE_RANGER_POLL_MS);
    }
  }

  function renderAwakeRangerCount() {
    const count = state.awakeRangerCount;
    elements.awakeRangerCounter.hidden = !Number.isInteger(count);
    if (!Number.isInteger(count)) {
      return;
    }
    elements.awakeRangerCountText.textContent = count === 0
      ? "No other Rangers awake"
      : `${count} other ${count === 1 ? "Ranger" : "Rangers"} awake`;
  }

  async function shareLivePosition(point) {
    if (
      !state.sharePositionEnabled ||
      state.sharePositionInFlight ||
      !point ||
      point.stale ||
      !getCurrentCreatorName() ||
      Date.now() - state.lastSharedPositionAt < LIVE_POSITION_SHARE_INTERVAL_MS
    ) {
      return;
    }

    state.sharePositionInFlight = true;
    try {
      await callSupabaseRpc("upsert_atlas_live_position", {
        device_token_input: getOrCreateDiscordDeviceToken(),
        ranger_name_input: getCurrentCreatorName(),
        atlas_x_input: point.x,
        atlas_y_input: point.y,
        heading_degrees_input: Number(point.heading) || 0,
      });
      state.lastSharedPositionAt = Date.now();
    } catch (error) {
      const message = getReadableError(error, "Position could not be shared");
      setStatus(message);
    } finally {
      state.sharePositionInFlight = false;
    }
  }

  async function removeSharedLivePosition() {
    state.lastSharedPositionAt = 0;
    const deviceToken = getStoredDiscordDeviceToken();
    if (!deviceToken || !isSupabaseConfigured()) {
      updateSharePositionControls();
      return;
    }
    try {
      await callSupabaseRpc("remove_atlas_live_position", {
        device_token_input: deviceToken,
      });
    } catch (error) {
      console.warn("Could not remove shared live position", error);
    }
    updateSharePositionControls();
  }

  async function toggleOverwatch() {
    if (state.overwatchEnabled) {
      stopOverwatch();
      return;
    }

    const passphrase = elements.overwatchPassphraseInput.value.trim();
    if (!passphrase) {
      elements.overwatchStatus.textContent = "Enter the Overwatch passphrase.";
      return;
    }
    if (!isSupabaseConfigured()) {
      elements.overwatchStatus.textContent = "Supabase is not configured.";
      return;
    }

    elements.overwatchToggleBtn.disabled = true;
    elements.overwatchStatus.textContent = "Opening Overwatch...";
    state.overwatchPassphrase = passphrase;
    try {
      await refreshOverwatchPositions();
      state.overwatchEnabled = true;
      elements.overwatchToggleBtn.textContent = "Close Overwatch";
      elements.overwatchToggleBtn.disabled = false;
      elements.overwatchStatus.textContent = `${state.overwatchPositions.length} active ${state.overwatchPositions.length === 1 ? "Ranger" : "Rangers"} shown.`;
      elements.guildPublishDialog.close();
      overwatchPollTimer = window.setTimeout(pollOverwatchPositions, OVERWATCH_POLL_MS);
      setStatus("Overwatch enabled");
    } catch (error) {
      state.overwatchPassphrase = "";
      elements.overwatchToggleBtn.disabled = false;
      elements.overwatchStatus.textContent = getReadableError(error, "Overwatch could not be opened.");
    }
  }

  function stopOverwatch() {
    window.clearTimeout(overwatchPollTimer);
    overwatchPollTimer = null;
    state.overwatchEnabled = false;
    state.overwatchPassphrase = "";
    state.overwatchPositions = [];
    elements.overwatchPassphraseInput.value = "";
    elements.overwatchToggleBtn.textContent = "Open Overwatch";
    elements.overwatchStatus.textContent = "Overwatch closed.";
    overwatchPositionLayer.clearLayers();
    setStatus("Overwatch disabled");
  }

  async function pollOverwatchPositions() {
    if (!state.overwatchEnabled) {
      return;
    }
    try {
      await refreshOverwatchPositions();
    } catch (error) {
      elements.overwatchStatus.textContent = getReadableError(error, "Overwatch refresh failed.");
    } finally {
      if (state.overwatchEnabled) {
        overwatchPollTimer = window.setTimeout(pollOverwatchPositions, OVERWATCH_POLL_MS);
      }
    }
  }

  async function refreshOverwatchPositions() {
    const positions = await callSupabaseRpc("get_atlas_live_positions", {
      overwatch_passphrase: state.overwatchPassphrase,
    });
    state.overwatchPositions = Array.isArray(positions) ? positions : [];
    renderOverwatchPositions();
  }

  function renderOverwatchPositions() {
    overwatchPositionLayer.clearLayers();
    state.overwatchPositions.forEach((position) => {
      const x = Number(position.atlas_x);
      const y = Number(position.atlas_y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      const name = normalizeCreatorName(position.ranger_name) || "Unknown Ranger";
      const marker = L.marker([y, x], {
        interactive: true,
        keyboard: false,
        zIndexOffset: 2550,
        icon: L.divIcon({
          className: "",
          html: `
            <div class="overwatch-position-marker" style="--heading:${Number(position.heading_degrees) || 0}deg">
              <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 27 28 16 21 5 28Z" /></svg>
            </div>
            <span class="overwatch-position-label">${escapeHtml(name)}</span>
          `,
          iconSize: [1, 1],
          iconAnchor: [0, 0],
        }),
      });
      marker.bindTooltip(`${escapeHtml(name)} · ${escapeHtml(formatRelativeTime(position.updated_at))}`, {
        direction: "top",
        offset: [0, -18],
      });
      overwatchPositionLayer.addLayer(marker);
    });
    if (state.overwatchEnabled) {
      elements.overwatchStatus.textContent = `${state.overwatchPositions.length} active ${state.overwatchPositions.length === 1 ? "Ranger" : "Rangers"} shown.`;
    }
  }

  function handleTrailmarkVisitsToggle(event) {
    const enabled = event.target.checked;
    if (enabled && !getCurrentCreatorName()) {
      event.target.checked = false;
      state.trailmarkVisitsEnabled = false;
      elements.creatorInput.focus();
      updateTrailmarkVisitStatus("Enter Signed As first", "unavailable");
      setStatus("Enter your Ranger name before recording Trailmark visits");
      return;
    }

    if (enabled && !isSupabaseConfigured()) {
      event.target.checked = false;
      state.trailmarkVisitsEnabled = false;
      updateTrailmarkVisitStatus("Sharing unavailable", "unavailable");
      setStatus("Supabase is not configured, so Trailmark visits cannot be shared");
      return;
    }

    state.trailmarkVisitsEnabled = enabled;
    state.trailmarkVisitCandidate = null;
    if (enabled) {
      state.sharePositionEnabled = true;
    }
    if (enabled && !state.livePositionEnabled) {
      state.livePositionEnabled = true;
      elements.livePositionInput.checked = true;
      startLivePositionPolling();
      startFieldActionPolling();
      void syncNativeTrailmarks(true);
    }
    if (!enabled) {
      void leaveTrailmarkVisit();
      hideTrailmarkArrival();
    }
    saveState();
    updateTrailmarkVisitControls();
    setStatus(enabled ? "Trailmark visit recording enabled" : "Trailmark visit recording disabled");
  }

  function updateTrailmarkVisitControls() {
    elements.trailmarkVisitsInput.checked = state.trailmarkVisitsEnabled;
    elements.discordLinkBtn.textContent = state.discordLink ? "Discord linked" : "Link Discord";
    elements.discordLinkBtn.classList.toggle("is-linked", Boolean(state.discordLink));
    renderRangerProfile();

    if (!state.trailmarkVisitsEnabled) {
      updateTrailmarkVisitStatus("Off", "off");
      return;
    }
    if (!getCurrentCreatorName()) {
      updateTrailmarkVisitStatus("Name required", "unavailable");
      return;
    }
    if (!state.livePositionEnabled) {
      updateTrailmarkVisitStatus("Live position required", "unavailable");
      return;
    }
    if (state.livePositionConnection === "unavailable") {
      updateTrailmarkVisitStatus("Game link unavailable", "unavailable");
      return;
    }
    if (state.livePositionConnection !== "linked") {
      updateTrailmarkVisitStatus("Waiting for Skyrim", "connecting");
      return;
    }
    updateTrailmarkVisitStatus("Watching Trailmarks", "linked");
  }

  function updateTrailmarkVisitStatus(text, status) {
    elements.trailmarkVisitsStatus.textContent = text;
    elements.trailmarkVisitsStatus.removeAttribute("title");
    elements.trailmarkVisitsStatus.classList.toggle("is-linked", status === "linked");
    elements.trailmarkVisitsStatus.classList.toggle("is-unavailable", status === "unavailable");
    renderFieldOverview(getSelectedFeature());
  }

  function evaluateTrailmarkProximity(point) {
    if (!state.trailmarkVisitsEnabled || !getCurrentCreatorName() || !point || point.stale) {
      void leaveTrailmarkVisit();
      if (state.nearbyTrailmarkId) {
        state.nearbyTrailmarkId = null;
        renderAll();
      }
      state.trailmarkVisitCandidate = null;
      updateTrailmarkVisitControls();
      return;
    }

    const nearest = state.features
      .filter(isOfficialTrailmark)
      .map((feature) => ({
        feature,
        distance: Math.hypot(feature.points[0].x - point.x, feature.points[0].y - point.y),
      }))
      .filter((candidate) => candidate.distance <= TRAILMARK_VISIT_RADIUS)
      .sort((left, right) => left.distance - right.distance)[0];

    const nearbyChanged = state.nearbyTrailmarkId !== (nearest?.feature.id || null);
    state.nearbyTrailmarkId = nearest?.feature.id || null;

    if (!nearest) {
      if (nearbyChanged) {
        renderAll();
      }
      void leaveTrailmarkVisit();
      state.trailmarkVisitCandidate = null;
      updateTrailmarkVisitStatus("Watching Trailmarks", "linked");
      return;
    }

    if (nearbyChanged && state.workspaceMode === "field" && !getSelectedFeature()) {
      selectFeature(nearest.feature.id);
    } else if (nearbyChanged) {
      renderAll();
    }

    if (state.trailmarkVisitActive && state.trailmarkVisitActive.featureId !== nearest.feature.id) {
      void leaveTrailmarkVisit();
    }

    if (state.trailmarkVisitActive && state.trailmarkVisitActive.featureId === nearest.feature.id) {
      if (Date.now() - state.trailmarkVisitLastHeartbeatAt >= TRAILMARK_VISIT_HEARTBEAT_MS) {
        void touchTrailmarkVisit(nearest.feature);
      }
      state.trailmarkVisitCandidate = null;
      updateTrailmarkVisitStatus(`At ${nearest.feature.title}`, "linked");
      return;
    }

    if (state.trailmarkVisitInFlight) {
      state.trailmarkVisitCandidate = null;
      return;
    }

    const lastVisit = Number(state.trailmarkVisitCooldowns[nearest.feature.id] || 0);
    if (Date.now() - lastVisit < TRAILMARK_VISIT_COOLDOWN_MS) {
      if (!state.trailmarkVisitActive) {
        state.trailmarkVisitActive = {
          featureId: nearest.feature.id,
          rangerName: getCurrentCreatorName(),
          deviceToken: getStoredDiscordDeviceToken(),
        };
        state.trailmarkVisitLastHeartbeatAt = 0;
      }
      if (Date.now() - state.trailmarkVisitLastHeartbeatAt >= TRAILMARK_VISIT_HEARTBEAT_MS) {
        void touchTrailmarkVisit(nearest.feature);
      }
      state.trailmarkVisitCandidate = null;
      updateTrailmarkVisitStatus(`At ${nearest.feature.title}`, "linked");
      return;
    }

    const retryAfter = Number(state.trailmarkVisitRetryAfter[nearest.feature.id] || 0);
    if (Date.now() < retryAfter) {
      const retrySeconds = Math.ceil((retryAfter - Date.now()) / 1000);
      state.trailmarkVisitCandidate = null;
      updateTrailmarkVisitStatus(`Retry available in ${retrySeconds}s`, "unavailable");
      const lastError = state.trailmarkVisitErrors.get(nearest.feature.id);
      if (lastError) {
        elements.trailmarkVisitsStatus.title = lastError;
      }
      return;
    }

    if (!state.trailmarkVisitCandidate || state.trailmarkVisitCandidate.featureId !== nearest.feature.id) {
      state.trailmarkVisitCandidate = {
        featureId: nearest.feature.id,
        enteredAt: Date.now(),
      };
      updateTrailmarkVisitStatus(`Near ${nearest.feature.title}`, "linked");
      return;
    }

    const remainingSeconds = Math.ceil(
      (TRAILMARK_VISIT_DWELL_MS - (Date.now() - state.trailmarkVisitCandidate.enteredAt)) / 1000,
    );
    if (remainingSeconds > 0) {
      updateTrailmarkVisitStatus(`Checking in ${remainingSeconds}s`, "linked");
      return;
    }

    state.trailmarkVisitCandidate = null;
    void recordTrailmarkVisit(nearest.feature);
  }

  async function recordTrailmarkVisit(feature) {
    state.trailmarkVisitInFlight = true;
    updateTrailmarkVisitStatus(`Recording ${feature.title}...`, "linked");
    try {
      const result = await callSupabaseRpc("record_atlas_trailmark_visit", {
        atlas_location_id: feature.id,
        ranger_name: getCurrentCreatorName(),
        device_token: getStoredDiscordDeviceToken(),
      });
      state.trailmarkVisitCooldowns[feature.id] = Date.now();
      delete state.trailmarkVisitRetryAfter[feature.id];
      state.trailmarkVisitErrors.delete(feature.id);
      state.trailmarkVisitActive = {
        featureId: feature.id,
        rangerName: getCurrentCreatorName(),
        deviceToken: getStoredDiscordDeviceToken(),
      };
      state.trailmarkVisitLastHeartbeatAt = Date.now();
      saveState();
      showTrailmarkArrival(feature, result || {});
      await refreshTrailmarkVisits(feature, true);
      if (result && result.access_request_id) {
        pollTrailmarkAccessRequest(feature, result.access_request_id, 0);
      }
      updateTrailmarkVisitStatus(`Visited ${feature.title}`, "linked");
      setStatus(`Recorded your visit to ${feature.title}`);
    } catch (error) {
      console.error("Could not record Trailmark visit", error);
      const message = getReadableError(error, "Could not record this Trailmark visit");
      state.trailmarkVisitRetryAfter[feature.id] = Date.now() + TRAILMARK_VISIT_FAILURE_RETRY_MS;
      state.trailmarkVisitErrors.set(feature.id, message);
      updateTrailmarkVisitStatus("Visit failed; retry in 60s", "unavailable");
      elements.trailmarkVisitsStatus.title = message;
      setStatus(message);
    } finally {
      state.trailmarkVisitInFlight = false;
    }
  }

  async function touchTrailmarkVisit(feature) {
    const active = state.trailmarkVisitActive;
    if (!active || active.featureId !== feature.id) {
      return;
    }
    state.trailmarkVisitLastHeartbeatAt = Date.now();
    try {
      await callSupabaseRpc("touch_atlas_trailmark_visit", {
        atlas_location_id_input: feature.id,
        ranger_name_input: active.rangerName,
        device_token_input: active.deviceToken,
      });
    } catch (error) {
      console.warn("Could not update Trailmark presence", error);
    }
  }

  async function leaveTrailmarkVisit() {
    const active = state.trailmarkVisitActive;
    if (!active || state.trailmarkVisitDepartureInFlight) {
      return;
    }
    state.trailmarkVisitActive = null;
    state.trailmarkVisitLastHeartbeatAt = 0;
    state.trailmarkVisitDepartureInFlight = true;
    try {
      await callSupabaseRpc("leave_atlas_trailmark_visit", {
        atlas_location_id_input: active.featureId,
        ranger_name_input: active.rangerName,
        device_token_input: active.deviceToken,
      });
      const feature = state.features.find((candidate) => candidate.id === active.featureId);
      if (feature) {
        state.trailmarkVisitsByFeature.delete(feature.id);
        await refreshTrailmarkVisits(feature, true);
      }
    } catch (error) {
      console.warn("Could not record Trailmark departure", error);
    } finally {
      state.trailmarkVisitDepartureInFlight = false;
    }
  }

  function isOfficialTrailmark(feature) {
    return Boolean(
      feature &&
        isGuildFeature(feature) &&
        feature.type === "marker" &&
        getFeatureCategories(feature).includes("trailmark") &&
        feature.points[0],
    );
  }

  async function refreshTrailmarkVisits(feature, force = false) {
    if (!isOfficialTrailmark(feature) || !isSupabaseConfigured()) {
      return;
    }
    if (!force && state.trailmarkVisitsByFeature.has(feature.id)) {
      renderTrailmarkPresence(feature);
      return;
    }
    if (state.trailmarkVisitsLoading.has(feature.id)) {
      return;
    }

    state.trailmarkVisitsLoading.add(feature.id);
    renderTrailmarkPresence(feature);
    try {
      const visits = await callSupabaseRpc("get_recent_atlas_trailmark_visits", {
        atlas_location_id_input: feature.id,
      });
      state.trailmarkVisitErrors.delete(feature.id);
      state.trailmarkVisitsByFeature.set(feature.id, Array.isArray(visits) ? visits : []);
    } catch (error) {
      console.error("Could not load recent Trailmark visits", error);
      state.trailmarkVisitErrors.set(
        feature.id,
        getReadableError(error, "Recent Trailmark visits could not be loaded."),
      );
      state.trailmarkVisitsByFeature.set(feature.id, null);
    } finally {
      state.trailmarkVisitsLoading.delete(feature.id);
      if (getSelectedFeature() && getSelectedFeature().id === feature.id) {
        renderTrailmarkPresence(feature);
      }
      renderTrailmarkArrivalVisitors(feature.id);
    }
  }

  function renderTrailmarkPresence(feature) {
    const visible = isOfficialTrailmark(feature);
    elements.trailmarkPresencePanel.hidden = !visible;
    if (!visible) {
      elements.trailmarkPresenceList.innerHTML = "";
      elements.trailmarkDropBtn.disabled = true;
      return;
    }

    elements.trailmarkPresenceList.innerHTML = "";
    const recentVisit = Number(state.trailmarkVisitCooldowns[feature.id] || 0);
    const canLeaveDrop =
      Boolean(state.discordLink) &&
      Date.now() - recentVisit < TRAILMARK_VISIT_COOLDOWN_MS;
    elements.trailmarkDropBtn.disabled = !canLeaveDrop;
    elements.trailmarkDropBtn.title = !state.discordLink
      ? "Link Discord before leaving a drop"
      : canLeaveDrop
        ? "Post a field drop to this Trailmark's Discord channel"
        : "Arrive at this Trailmark with Record visits enabled before leaving a drop";
    if (state.trailmarkVisitsLoading.has(feature.id)) {
      elements.trailmarkPresenceStatus.textContent = "Checking the latest field record...";
      return;
    }

    const visits = state.trailmarkVisitsByFeature.get(feature.id);
    if (visits === null) {
      const message = state.trailmarkVisitErrors.get(feature.id) || "Recent visits could not be loaded.";
      elements.trailmarkPresenceStatus.textContent = message;
      elements.trailmarkPresenceStatus.title = message;
      return;
    }
    if (!Array.isArray(visits)) {
      elements.trailmarkPresenceStatus.textContent = "Select Refresh to check recent visits.";
      return;
    }
    if (!visits.length) {
      elements.trailmarkPresenceStatus.textContent = "No recorded visits in the last 30 days.";
      return;
    }

    elements.trailmarkPresenceStatus.textContent = `${visits.length} recent ${visits.length === 1 ? "visitor" : "visitors"}.`;
    visits.forEach((visit) => {
      const item = document.createElement("li");
      const activity = formatTrailmarkVisitActivity(visit);
      item.innerHTML = `
        <strong>${escapeHtml(normalizeCreatorName(visit.ranger_name) || "Unknown Ranger")}</strong>
        <time datetime="${escapeHtml(activity.datetime)}">${escapeHtml(activity.label)}</time>
      `;
      elements.trailmarkPresenceList.appendChild(item);
    });
  }

  function openTrailmarkDropDialog(featureOverride = null) {
    const feature = featureOverride || getSelectedFeature();
    if (!isOfficialTrailmark(feature)) {
      setStatus("Select an official Trailmark first");
      return;
    }
    if (!state.discordLink) {
      setStatus("Link Discord before leaving a Trailmark drop");
      openDiscordLinkDialog();
      return;
    }
    const recentVisit = Number(state.trailmarkVisitCooldowns[feature.id] || 0);
    if (Date.now() - recentVisit >= TRAILMARK_VISIT_COOLDOWN_MS) {
      setStatus(`Arrive at ${feature.title} with Record visits enabled before leaving a drop`);
      return;
    }

    window.clearTimeout(trailmarkDropPollTimer);
    trailmarkDropPollTimer = null;
    elements.trailmarkDropDialog.dataset.featureId = feature.id;
    elements.trailmarkDropTitle.textContent = `Leave a Drop at ${feature.title}`;
    elements.trailmarkDropMessageInput.value = "";
    elements.trailmarkDropStatus.textContent = "";
    elements.trailmarkDropSubmitBtn.disabled = false;
    elements.trailmarkDropDialog.showModal();
    window.setTimeout(() => elements.trailmarkDropMessageInput.focus(), 0);
  }

  function closeTrailmarkDropDialog() {
    window.clearTimeout(trailmarkDropPollTimer);
    trailmarkDropPollTimer = null;
    elements.trailmarkDropDialog.close();
    elements.trailmarkDropDialog.dataset.featureId = "";
  }

  async function submitTrailmarkDrop(event) {
    event.preventDefault();
    const featureId = elements.trailmarkDropDialog.dataset.featureId;
    const feature = state.features.find((candidate) => candidate.id === featureId);
    const message = elements.trailmarkDropMessageInput.value.trim();
    const deviceToken = getStoredDiscordDeviceToken();
    if (!isOfficialTrailmark(feature)) {
      elements.trailmarkDropStatus.textContent = "This Trailmark is no longer available.";
      return;
    }
    if (!message) {
      elements.trailmarkDropStatus.textContent = "Write a message before sending the drop.";
      return;
    }
    if (!deviceToken || !state.discordLink) {
      elements.trailmarkDropStatus.textContent = "Link Discord before leaving a drop.";
      return;
    }

    elements.trailmarkDropSubmitBtn.disabled = true;
    elements.trailmarkDropStatus.textContent = "Sending to Wayfinder...";
    try {
      const result = await callSupabaseRpc("submit_atlas_trailmark_drop", {
        device_token_input: deviceToken,
        atlas_location_id_input: feature.id,
        message_input: message,
      });
      if (!result || !result.drop_id) {
        throw new Error("Wayfinder did not return a drop receipt");
      }
      pollTrailmarkDrop(result.drop_id, deviceToken, 0);
    } catch (error) {
      elements.trailmarkDropSubmitBtn.disabled = false;
      elements.trailmarkDropStatus.textContent = getReadableError(error, "The Trailmark drop could not be sent.");
    }
  }

  async function pollTrailmarkDrop(dropId, deviceToken, attempt) {
    if (!elements.trailmarkDropDialog.open) {
      return;
    }
    if (attempt >= TRAILMARK_DROP_POLL_LIMIT) {
      elements.trailmarkDropSubmitBtn.disabled = false;
      elements.trailmarkDropStatus.textContent =
        "Wayfinder has not confirmed the post yet. Check the Trailmark channel before sending again.";
      return;
    }

    try {
      const result = await callSupabaseRpc("get_atlas_trailmark_drop", {
        drop_id_input: dropId,
        device_token_input: deviceToken,
      });
      if (result && result.status === "posted") {
        elements.trailmarkDropStatus.textContent = "Drop posted to the Trailmark channel.";
        setStatus("Trailmark field drop posted through Wayfinder");
        return;
      }
      if (result && result.status === "failed") {
        elements.trailmarkDropSubmitBtn.disabled = false;
        elements.trailmarkDropStatus.textContent =
          result.error_message || "Wayfinder could not post this drop.";
        return;
      }
    } catch (error) {
      console.warn("Could not check Trailmark drop status", error);
    }

    trailmarkDropPollTimer = window.setTimeout(
      () => pollTrailmarkDrop(dropId, deviceToken, attempt + 1),
      TRAILMARK_DROP_POLL_MS,
    );
  }

  function showTrailmarkArrival(feature, result) {
    window.clearTimeout(trailmarkAccessPollTimer);
    trailmarkAccessPollTimer = null;
    selectFeature(feature.id);
    elements.trailmarkArrival.dataset.featureId = feature.id;
    elements.trailmarkArrivalTitle.textContent = feature.title;
    const discordLinked = Boolean(result.discord_linked || state.discordLink);
    elements.trailmarkArrivalText.textContent = discordLinked
      ? "Visit recorded. You can leave a field drop here through the Atlas."
      : "Visit recorded. Link Discord to leave a field drop through the Atlas.";
    elements.trailmarkArrivalDropBtn.textContent = discordLinked
      ? "Leave Field Drop"
      : "Link Discord to Leave Drop";
    elements.trailmarkArrivalLinkBtn.hidden = true;
    elements.trailmarkArrival.hidden = false;
    renderTrailmarkArrivalVisitors(feature.id);
  }

  function renderTrailmarkArrivalVisitors(featureId) {
    if (elements.trailmarkArrival.dataset.featureId !== featureId) {
      return;
    }
    const visits = state.trailmarkVisitsByFeature.get(featureId);
    if (!Array.isArray(visits)) {
      elements.trailmarkArrivalVisitors.textContent = "Checking recent visitors...";
      return;
    }
    if (!visits.length) {
      elements.trailmarkArrivalVisitors.textContent = "No other recent visits are recorded.";
      return;
    }
    elements.trailmarkArrivalVisitors.textContent = `Recently here: ${visits
      .slice(0, 4)
      .map((visit) => {
        const activity = formatTrailmarkVisitActivity(visit);
        return `${normalizeCreatorName(visit.ranger_name) || "Unknown Ranger"} ${activity.label.toLowerCase()}`;
      })
      .join(", ")}.`;
  }

  function formatTrailmarkVisitActivity(visit) {
    if (visit && visit.is_active) {
      return {
        datetime: visit.last_seen_at || "",
        label: "Here now",
      };
    }
    if (visit && visit.last_left_at) {
      return {
        datetime: visit.last_left_at,
        label: `Left ${formatRelativeTime(visit.last_left_at)}`,
      };
    }
    const lastSeenAt = visit?.last_seen_at || visit?.last_visited_at || "";
    return {
      datetime: lastSeenAt,
      label: lastSeenAt ? `Last seen ${formatRelativeTime(lastSeenAt)}` : "Visit time unavailable",
    };
  }

  function hideTrailmarkArrival() {
    elements.trailmarkArrival.hidden = true;
  }

  async function pollTrailmarkAccessRequest(feature, requestId, attempt) {
    const deviceToken = getStoredDiscordDeviceToken();
    if (!deviceToken || attempt >= TRAILMARK_ACCESS_POLL_LIMIT) {
      if (!elements.trailmarkArrival.hidden && elements.trailmarkArrival.dataset.featureId === feature.id) {
        elements.trailmarkArrivalText.textContent =
          "Visit recorded. Wayfinder has not confirmed Discord access yet.";
      }
      return;
    }

    try {
      const request = await callSupabaseRpc("get_atlas_trailmark_access_request", {
        access_request_id: requestId,
        device_token: deviceToken,
      });
      if (request && request.status === "granted") {
        elements.trailmarkArrivalText.textContent = "Trailmark access is ready. You can leave a field drop through the Atlas.";
        return;
      }
      if (request && request.status === "failed") {
        elements.trailmarkArrivalText.textContent =
          request.error_message || "Wayfinder could not open this Trailmark channel.";
        return;
      }
    } catch (error) {
      console.warn("Could not check Trailmark Discord access", error);
    }

    trailmarkAccessPollTimer = window.setTimeout(
      () => pollTrailmarkAccessRequest(feature, requestId, attempt + 1),
      TRAILMARK_ACCESS_POLL_MS,
    );
  }

  function openDiscordLinkDialog() {
    elements.discordLinkStatus.textContent = "";
    renderDiscordLinkDialog();
    elements.discordLinkDialog.showModal();
    if (!state.discordLink) {
      window.setTimeout(() => elements.discordLinkCodeInput.focus(), 0);
    }
  }

  function closeDiscordLinkDialog() {
    state.discordRelinking = false;
    elements.discordLinkCodeInput.value = "";
    elements.discordLinkStatus.textContent = "";
    elements.discordLinkDialog.close();
  }

  function renderDiscordLinkDialog() {
    const linked = Boolean(state.discordLink);
    const relinking = linked && state.discordRelinking;
    elements.discordLinkTitle.textContent = linked ? "Discord Connected" : "Link Discord";
    elements.discordLinkSummary.hidden = !linked;
    elements.discordLinkSummary.innerHTML = linked
      ? `<strong>Linked to ${escapeHtml(state.discordLink.discord_display_name || "Discord")}</strong><br />Trailmark arrivals can now request temporary channel access.`
      : "";
    elements.discordLinkCodeFields.hidden = linked && !relinking;
    elements.discordLinkCodeInput.disabled = linked && !relinking;
    elements.discordLinkSubmitBtn.hidden = linked && !relinking;
    elements.discordLinkSubmitBtn.textContent = relinking ? "Update Discord Link" : "Link Discord";
    elements.discordRelinkBtn.hidden = !linked || relinking;
    elements.discordUnlinkBtn.hidden = !linked;
    updateTrailmarkVisitControls();
    const selectedFeature = getSelectedFeature();
    if (isOfficialTrailmark(selectedFeature)) {
      renderTrailmarkPresence(selectedFeature);
    }
  }

  function beginDiscordRelink() {
    state.discordRelinking = true;
    renderDiscordLinkDialog();
    elements.discordLinkStatus.textContent = "Run /atlas link in Discord, then enter the new one-time code.";
    window.setTimeout(() => elements.discordLinkCodeInput.focus(), 0);
  }

  function normalizeClipboard(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      title: String(source.title || "Field notes").trim().slice(0, 120) || "Field notes",
      body: String(source.body || "").slice(0, 6000),
      updatedAt: String(source.updated_at || source.updatedAt || "").slice(0, 40),
    };
  }

  function syncClipboardDialogInputs() {
    elements.clipboardTitleInput.value = state.clipboard.title;
    elements.clipboardBodyInput.value = state.clipboard.body;
  }

  function openClipboardDialog() {
    syncClipboardDialogInputs();
    elements.clipboardStatus.textContent = state.clipboard.updatedAt
      ? "Saved locally"
      : "Start writing to save this clipboard locally.";
    elements.clipboardDialog.showModal();
    window.setTimeout(() => elements.clipboardBodyInput.focus(), 0);
  }

  function closeClipboardDialog() {
    elements.clipboardDialog.close();
  }

  function saveClipboardFromDialog() {
    state.clipboard = normalizeClipboard({
      title: elements.clipboardTitleInput.value,
      body: elements.clipboardBodyInput.value,
      updated_at: new Date().toISOString(),
    });
    saveState();
    elements.clipboardStatus.textContent = "Saved locally";
    scheduleNativeClipboardSync();
  }

  function scheduleNativeClipboardSync() {
    window.clearTimeout(clipboardSyncTimer);
    clipboardSyncTimer = window.setTimeout(() => {
      clipboardSyncTimer = null;
      if (state.livePositionEnabled) {
        void syncNativeFieldState(true);
      }
    }, 250);
  }

  function clipboardMessage() {
    const title = state.clipboard.title.trim();
    const body = state.clipboard.body.trim();
    return [title, body].filter(Boolean).join("\n\n").slice(0, 1800);
  }

  function createClipboardMarkHere() {
    if (!state.livePositionPoint || state.livePositionPoint.stale) {
      elements.clipboardStatus.textContent = "Connect to Skyrim outdoors before creating a mark here.";
      return;
    }
    createFieldMarkFromConsole({
      payload: {
        title: state.clipboard.title,
        notes: state.clipboard.body,
        category: "landmark",
      },
    });
    elements.clipboardStatus.textContent = "Field mark created at your current position.";
  }

  async function sendClipboardFieldDrop() {
    const message = clipboardMessage();
    if (!message) {
      elements.clipboardStatus.textContent = "Write a note before sending a field drop.";
      return;
    }
    elements.clipboardDropBtn.disabled = true;
    elements.clipboardStatus.textContent = "Sending through Wayfinder...";
    const sent = await submitNearbyTrailmarkDropFromFieldConsole(message);
    elements.clipboardDropBtn.disabled = false;
    elements.clipboardStatus.textContent = sent
      ? "Field drop sent. Your clipboard was kept."
      : "Field drop could not be sent. Check the Atlas status message.";
  }

  function normalizeDiscordProfile(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const normalizeBadge = (badge) => {
      const id = String(badge?.id || "").toLowerCase();
      const label = String(badge?.label || "").trim().slice(0, 60);
      return /^[a-z0-9-]+$/.test(id) && label ? { id, label } : null;
    };
    return {
      version: 1,
      primary_badge: normalizeBadge(source.primary_badge),
      medals: Array.isArray(source.medals)
        ? source.medals.map(normalizeBadge).filter(Boolean).slice(0, 32)
        : [],
    };
  }

  function profileBadgeAsset(id) {
    const assetId = id.startsWith("medal-the-")
      ? `medal-${id.slice("medal-the-".length)}`
      : id;
    return `assets/ranger-profile/${assetId}.png`;
  }

  function renderRangerProfile() {
    const profile = normalizeDiscordProfile(state.discordLink?.profile);
    const badges = [profile.primary_badge, ...profile.medals]
      .filter((badge, index, all) => badge && all.findIndex((candidate) => candidate?.id === badge.id) === index);
    elements.rangerProfileCard.hidden = badges.length === 0;
    elements.rangerMedals.replaceChildren(...badges.map((medal) => {
      const image = document.createElement("img");
      image.src = profileBadgeAsset(medal.id);
      image.alt = medal.label;
      image.title = medal.label;
      image.addEventListener("error", () => image.remove(), { once: true });
      return image;
    }));
  }

  async function claimDiscordLink(event) {
    event.preventDefault();
    const relinking = state.discordRelinking;
    const rangerName = getCurrentCreatorName();
    if (!rangerName) {
      elements.discordLinkStatus.textContent = "Enter your name under Signed As first.";
      elements.creatorInput.focus();
      return;
    }
    const linkCode = elements.discordLinkCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!linkCode) {
      elements.discordLinkStatus.textContent = "Enter the code given to you by /atlas link.";
      return;
    }
    if (!isSupabaseConfigured()) {
      elements.discordLinkStatus.textContent = "Atlas sharing is not configured.";
      return;
    }

    elements.discordLinkSubmitBtn.disabled = true;
    elements.discordLinkStatus.textContent = "Linking Discord...";
    const deviceToken = getOrCreateDiscordDeviceToken();
    try {
      state.discordLink = await callSupabaseRpc("claim_atlas_discord_link", {
        link_code: linkCode,
        device_token: deviceToken,
        ranger_name: rangerName,
      });
      state.discordRelinking = false;
      elements.discordLinkCodeInput.value = "";
      elements.discordLinkStatus.textContent = relinking ? "Discord link updated." : "Discord linked.";
      renderDiscordLinkDialog();
      setStatus(`Discord linked to ${state.discordLink.discord_display_name || "your account"}`);
    } catch (error) {
      elements.discordLinkStatus.textContent = getReadableError(error, "That code is invalid or expired.");
    } finally {
      elements.discordLinkSubmitBtn.disabled = false;
    }
  }

  async function refreshDiscordLink() {
    const deviceToken = getStoredDiscordDeviceToken();
    if (!deviceToken) {
      state.discordLink = null;
      updateTrailmarkVisitControls();
      return;
    }
    try {
      state.discordLink = await callSupabaseRpc("get_atlas_discord_link", {
        device_token: deviceToken,
      });
      if (!state.discordLink) {
        window.localStorage.removeItem(DISCORD_DEVICE_TOKEN_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Could not verify Discord link", error);
    }
    updateTrailmarkVisitControls();
    void syncNativeFieldState(true);
  }

  async function unlinkDiscord() {
    const deviceToken = getStoredDiscordDeviceToken();
    elements.discordUnlinkBtn.disabled = true;
    try {
      if (deviceToken && isSupabaseConfigured()) {
        await callSupabaseRpc("unlink_atlas_discord", { device_token: deviceToken });
      }
      window.localStorage.removeItem(DISCORD_DEVICE_TOKEN_STORAGE_KEY);
      state.discordLink = null;
      elements.discordLinkStatus.textContent = "Discord unlinked.";
      renderDiscordLinkDialog();
      setStatus("Discord unlinked from this browser");
    } catch (error) {
      elements.discordLinkStatus.textContent = getReadableError(error, "Discord could not be unlinked.");
    } finally {
      elements.discordUnlinkBtn.disabled = false;
    }
  }

  function getStoredDiscordDeviceToken() {
    return window.localStorage.getItem(DISCORD_DEVICE_TOKEN_STORAGE_KEY) || "";
  }

  function getOrCreateDiscordDeviceToken() {
    const stored = getStoredDiscordDeviceToken();
    if (stored) {
      return stored;
    }
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(DISCORD_DEVICE_TOKEN_STORAGE_KEY, token);
    return token;
  }

  function pushUndo(label) {
    state.undoStack.push({
      drawPoints: state.drawPoints.map((point) => ({ ...point })),
      draftFeature: state.draftFeature ? cloneFeature(state.draftFeature) : null,
      features: state.features.map(cloneFeature),
      label,
      mode: state.mode,
      selectedId: state.selectedId,
      selectedIds: state.selectedIds.slice(),
    });
    if (state.undoStack.length > 50) {
      state.undoStack.shift();
    }
    updateUndoButton();
  }

  function undoLastAction() {
    state.movingFeatureId = null;
    state.movingOriginalPoint = null;
    const snapshot = state.undoStack.pop();
    updateUndoButton();
    if (!snapshot) {
      setStatus("Nothing to undo");
      return;
    }

    state.features = snapshot.features.map(cloneFeature);
    state.selectedId = snapshot.selectedId;
    state.selectedIds = Array.isArray(snapshot.selectedIds)
      ? snapshot.selectedIds.slice()
      : snapshot.selectedId
        ? [snapshot.selectedId]
        : [];
    state.draftFeature = snapshot.draftFeature ? cloneFeature(snapshot.draftFeature) : null;
    state.drawPoints = snapshot.drawPoints.map((point) => ({ ...point }));
    state.mode = snapshot.mode;
    state.pointerStart = null;
    state.freehandDrawing = false;
    map.dragging[state.mode === "route" || state.mode === "range" ? "disable" : "enable"]();
    map.getContainer().classList.toggle("is-drawing", state.mode === "route" || state.mode === "range");
    draftLayer.clearLayers();
    renderDraft();
    updateDrawButtons();
    updateModeButtons();
    saveState();
    renderAll();
    setStatus(`Undid ${snapshot.label}`);
  }

  function updateUndoButton() {
    elements.undoBtn.disabled = state.undoStack.length === 0;
  }

  function setWorkspaceMode(mode) {
    const nextMode = mode === "edit" ? "edit" : "field";
    if (state.workspaceMode === nextMode) {
      return;
    }
    if (state.movingFeatureId) {
      cancelFeatureMove(false);
    }
    if (nextMode === "field" && (state.drawPoints.length || state.draftFeature)) {
      cancelDrawing(false, false);
    }

    state.workspaceMode = nextMode;
    if (nextMode === "field") {
      state.mode = "select";
      map.dragging.enable();
      map.getContainer().classList.remove("is-drawing");
      setPanelView(state.selectedId ? "details" : "field", false);
    } else {
      setPanelView(state.selectedId ? "details" : "browse", false);
    }
    updateWorkspaceUI();
    updateModeButtons();
    renderAll();
    window.setTimeout(() => map.invalidateSize(), 0);
    setStatus(nextMode === "field" ? "Field View ready" : "Edit Atlas ready");
  }

  function updateWorkspaceUI() {
    document.documentElement.dataset.workspace = state.workspaceMode;
    elements.workspaceModeButtons.forEach((button) => {
      const active = button.dataset.workspaceMode === state.workspaceMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    updatePanelView();
  }

  function setPanelView(view, announce = true) {
    if (state.workspaceMode === "field") {
      state.panelView = view === "details" && state.selectedId ? "details" : "field";
    } else {
      state.panelView = view === "details" ? "details" : "browse";
    }
    updatePanelView();
    if (announce) {
      setStatus(
        state.panelView === "details"
          ? "Showing selected entry"
          : state.panelView === "field"
            ? "Field Console ready"
            : "Browsing Atlas entries",
      );
    }
  }

  function updatePanelView() {
    const visiblePane = state.workspaceMode === "field"
      ? state.selectedId
        ? "details"
        : "field"
      : state.panelView;
    elements.panelViewButtons.forEach((button) => {
      const active = button.dataset.panelView === visiblePane;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    elements.panelPanes.forEach((pane) => {
      pane.hidden = pane.dataset.panelPane !== visiblePane;
    });
  }

  function setMode(mode) {
    if (state.workspaceMode !== "edit" && mode !== "select") {
      setWorkspaceMode("edit");
    }
    if (state.movingFeatureId) {
      cancelFeatureMove(false);
    }
    if (state.mode !== mode) {
      cancelDrawing(false, false);
    }
    state.mode = mode;
    map.dragging[mode === "route" || mode === "range" ? "disable" : "enable"]();
    map.getContainer().classList.toggle("is-drawing", mode === "route" || mode === "range");

    updateModeButtons();
    updateDrawButtons();
    renderEditor();

    const statusByMode = {
      select: "Select features or drag the map",
      marker: "Click the map to place a mark",
      route: "Drag to sketch a trail, or click points",
      range: "Drag to sketch a range boundary, or click points",
    };
    setStatus(statusByMode[mode] || "Ready");
  }

  function updateModeButtons() {
    elements.toolButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === state.mode);
    });
  }

  function handleMapClick(event) {
    if (Date.now() - lastDragEndedAt < 140 || Date.now() < suppressNextClickUntil) {
      return;
    }

    if (state.mode === "select") {
      if (state.selectedId || state.selectedIds.length) {
        selectFeature(null);
      }
      return;
    }

    const point = clampPoint(event.latlng);
    if (!point) {
      setStatus("Could not read that map position");
      return;
    }

    if (state.mode === "marker") {
      placeDraftAtPoint(point, "Draft mark placed");
      return;
    }

    if (state.mode === "route" || state.mode === "range") {
      pushUndo(`draft ${state.mode === "range" ? "range" : "trail"} point`);
      addDrawPoint(point);
      renderDraft();
      updateDrawButtons();
      setStatus(`${state.drawPoints.length} point${state.drawPoints.length === 1 ? "" : "s"} placed`);
    }
  }

  function handleDrawStart(event) {
    if (state.mode !== "route" && state.mode !== "range") {
      return;
    }

    state.pointerStart = {
      latlng: event.latlng,
      layerPoint: map.latLngToLayerPoint(event.latlng),
    };
    state.freehandDrawing = false;
  }

  function handleDrawMove(event) {
    if (!state.pointerStart || (state.mode !== "route" && state.mode !== "range")) {
      return;
    }

    const current = map.latLngToLayerPoint(event.latlng);
    const moved = current.distanceTo(state.pointerStart.layerPoint);
    if (!state.freehandDrawing && moved < 7) {
      return;
    }

    if (!state.freehandDrawing) {
      state.freehandDrawing = true;
      pushUndo(`draft ${state.mode === "range" ? "range" : "trail"} sketch`);
      addDrawPoint(clampPoint(state.pointerStart.latlng));
    }

    const point = clampPoint(event.latlng);
    if (!point) {
      return;
    }
    addDrawPoint(point, 7);
    renderDraft();
    updateDrawButtons();
    setStatus(`Sketching ${state.mode === "range" ? "range" : "trail"} (${state.drawPoints.length} points)`);
  }

  function handleDrawEnd() {
    if (!state.pointerStart) {
      return;
    }

    if (state.freehandDrawing) {
      suppressNextClickUntil = Date.now() + 180;
      setStatus(`Draft ${state.mode === "range" ? "range" : "trail"} ready. Use the checkmark to save`);
    }

    state.pointerStart = null;
    state.freehandDrawing = false;
  }

  function addDrawPoint(point, minPixelDistance = 0) {
    const previous = state.drawPoints[state.drawPoints.length - 1];
    if (previous && minPixelDistance) {
      const previousLayerPoint = map.latLngToLayerPoint([previous.y, previous.x]);
      const nextLayerPoint = map.latLngToLayerPoint([point.y, point.x]);
      if (previousLayerPoint.distanceTo(nextLayerPoint) < minPixelDistance) {
        return;
      }
    }
    state.drawPoints.push(point);
  }

  function createFeature(input) {
    const creator = getCurrentCreatorName();
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `feature-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: input.type,
      category: input.category,
      categories: [input.category],
      title: input.title,
      confidence: "scouted",
      creator,
      notes: "",
      points: input.points,
      source: "personal",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function defaultMarker(id, title, category, x, y) {
    const city = category === "city";
    return {
      id,
      type: "marker",
      category,
      categories: [category],
      title,
      confidence: "confirmed",
      notes: city ? "Hold capital marked on the printed atlas." : "Town marked on the printed atlas.",
      points: [{ x, y }],
      source: "default",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
    };
  }

  function cloneFeature(feature) {
    return {
      ...feature,
      categories: getFeatureCategories(feature),
      points: feature.points.map((point) => ({ ...point })),
    };
  }

  function renderAll() {
    renderCreatorFilter();
    featureLayer.clearLayers();
    labelLayer.clearLayers();
    renderTrailmarkVisitRadii();

    getVisibleFeatures()
      .slice()
      .sort(compareFeaturesForMap)
      .forEach((feature) => {
        const layer = createLayer(feature);
        if (layer) {
          featureLayer.addLayer(layer);
        }
        if (state.showLabels) {
          labelLayer.addLayer(createFeatureLabelLayer(feature));
        }
      });

    renderFeatureList();
    renderEditor();
    void syncNativeFieldState();
  }

  function placeDraftAtPoint(point, title = "New mark") {
    const draftPoint = clampPoint(point);
    if (!draftPoint) {
      setStatus("Could not read the position for this mark");
      return;
    }
    if (state.workspaceMode !== "edit") {
      setWorkspaceMode("edit");
    }
    pushUndo("draft mark placement");
    state.mode = "marker";
    map.dragging.enable();
    map.getContainer().classList.remove("is-drawing");
    state.draftFeature = createFeature({
      type: "marker",
      category: "landmark",
      title,
      points: [draftPoint],
    });
    state.drawPoints = state.draftFeature.points.map((draftPoint) => ({ ...draftPoint }));
    state.selectedId = state.draftFeature.id;
    state.selectedIds = [state.draftFeature.id];
    setPanelView("details", false);
    updateDrawButtons();
    updateModeButtons();
    renderAll();
    renderDraft();
    setStatus(`${title} received. Add details, then save it`);
  }

  function createFeatureLabelLayer(feature) {
    const category = categoryById[feature.category] || categoryById.landmark;
    const point = feature.type === "marker"
      ? feature.points[0]
      : feature.type === "range"
        ? getPolygonCentroid(feature.points)
        : getLineMidpoint(feature.points);
    const title = truncate(feature.title || category.label, 60);
    const sourceClass = isCanonFeature(feature) ? " is-canon" : isGuildFeature(feature) ? " is-guild" : "";
    return L.marker([point.y, point.x], {
      interactive: false,
      keyboard: false,
      zIndexOffset: 1200,
      icon: L.divIcon({
        className: "",
        html: `<div class="map-location-label${sourceClass}">${escapeHtml(title)}</div>`,
        iconSize: [1, 1],
        iconAnchor: [0, 0],
      }),
    });
  }

  function createLayer(feature) {
    const category = categoryById[feature.category] || categoryById.landmark;
    const selected = isFeatureSelected(feature.id);

    if (feature.type === "marker") {
      const point = feature.points[0];
      const mixed = getFeatureCategories(feature).length > 1;
      const draggable = canRepositionMarker(feature);
      const marker = L.marker([point.y, point.x], {
        draggable,
        pane: isOfficialTrailmark(feature) ? "trailmark-pane" : "markerPane",
        zIndexOffset: getFeatureZIndexOffset(feature, selected),
        icon: L.divIcon({
          className: "",
          html: `<div class="poi-marker marker-${escapeHtml(feature.category)}${mixed ? " is-mixed" : ""}${isGuildFeature(feature) ? " is-guild" : ""}${isCanonFeature(feature) ? " is-canon" : ""}${isOfficialTrailmark(feature) ? " is-trailmark" : ""}${state.nearbyTrailmarkId === feature.id ? " is-nearby" : ""}${selected ? " is-selected" : ""}${draggable ? " is-draggable" : ""}" style="${getFeatureMarkerStyle(feature)}">${getFeatureMarkerIcon(feature)}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        }),
      });
      marker.on("click", (event) => selectFeature(feature.id, isAdditiveSelectionEvent(event.originalEvent)));
      if (draggable) {
        marker.on("dragstart", () => {
          marker.closeTooltip();
        });
        marker.on("dragend", (event) => {
          const point = clampPoint(event.target.getLatLng());
          if (!point) {
            return;
          }
          feature.points = [point];
          state.selectedId = feature.id;
          state.selectedIds = [feature.id];
          lastDragEndedAt = Date.now();
          renderAll();
          setStatus("Review the new position, then confirm or cancel");
        });
      }
      marker.bindTooltip(getFeatureTooltip(feature, category), { direction: "top", offset: [0, -24] });
      return draggable
        ? L.layerGroup([marker, createMoveMapControl(feature)])
        : marker;
    }

    const latLngs = feature.points.map((point) => [point.y, point.x]);
    if (feature.type === "route") {
      return createRouteLayer(latLngs, category, selected, feature);
    }

    const rangeColor = getFeatureColor(feature, category);
    const layer = L.polygon(latLngs, {
      color: rangeColor,
      weight: selected ? 4 : 2.5,
      opacity: selected ? 0.95 : 0.78,
      fillColor: rangeColor,
      fillOpacity: selected ? 0.18 : 0.12,
      lineCap: "round",
      lineJoin: "round",
    });
    layer.on("click", (event) => selectFeature(feature.id, isAdditiveSelectionEvent(event.originalEvent)));
    layer.bindTooltip(getFeatureTooltip(feature, category));
    const symbol = createGeometrySymbolLayer(feature, getPolygonCentroid(feature.points), selected);
    return L.layerGroup([layer, symbol]);
  }

  function createRouteLayer(latLngs, category, selected, feature) {
    const routeColor = getFeatureColor(feature, category);
    const underlay = L.polyline(latLngs, {
      color: "#f5e8c9",
      weight: selected ? 13 : 11,
      opacity: 0.72,
      lineCap: "round",
      lineJoin: "round",
    });
    const ink = L.polyline(latLngs, {
      color: routeColor,
      weight: selected ? 5 : 4,
      opacity: selected ? 0.98 : 0.92,
      dashArray: "24 12 5 12",
      lineCap: "round",
      lineJoin: "round",
    });
    [underlay, ink].forEach((layer) => {
      layer.on("click", (event) => selectFeature(feature.id, isAdditiveSelectionEvent(event.originalEvent)));
      layer.bindTooltip(getFeatureTooltip(feature, category));
    });
    const symbol = createGeometrySymbolLayer(feature, getLineMidpoint(feature.points), selected);
    const group = L.layerGroup([underlay, ink, symbol]);
    return group;
  }

  function canRepositionMarker(feature) {
    return (
      state.workspaceMode === "edit" &&
      state.mode === "select" &&
      state.movingFeatureId === feature.id &&
      feature.type === "marker" &&
      !isDefaultFeature(feature) &&
      !isCanonFeature(feature)
    );
  }

  function createMoveMapControl(feature) {
    const point = feature.points[0];
    const control = L.marker([point.y, point.x], {
      interactive: true,
      zIndexOffset: 1800,
      icon: L.divIcon({
        className: "",
        html: `
          <div class="draft-map-actions move-map-actions" aria-label="Move marker actions">
            <button class="draft-map-action move-map-confirm" type="button" title="Confirm new position" aria-label="Confirm new position">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
            </button>
            <button class="draft-map-action draft-map-discard move-map-cancel" type="button" title="Cancel movement" aria-label="Cancel movement">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 18 18M18 6 6 18" /></svg>
            </button>
          </div>
        `,
        iconSize: [70, 32],
        iconAnchor: [-10, 16],
      }),
    });
    control.on("add", () => {
      const container = control.getElement();
      if (!container) {
        return;
      }
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      container.querySelector(".move-map-confirm").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        confirmFeatureMove();
      });
      container.querySelector(".move-map-cancel").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        cancelFeatureMove();
      });
    });
    return control;
  }

  function createGeometrySymbolLayer(feature, point, selected) {
    const isRange = feature.type === "range";
    const category = categoryById[feature.category] || categoryById[isRange ? "range" : "route"];
    const color = getFeatureColor(feature, category);
    const symbol = L.marker([point.y, point.x], {
      interactive: feature.id !== "draft",
      zIndexOffset: selected ? 700 : 420,
      icon: L.divIcon({
        className: "",
        html: `<div class="geometry-symbol geometry-symbol-${isRange ? "range" : "route"}${selected ? " is-selected" : ""}" style="--geometry-color:${color}">${getCategoryIcon(isRange ? "range" : "route")}</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      }),
    });
    if (feature.id !== "draft") {
      symbol.on("click", (event) => selectFeature(feature.id, isAdditiveSelectionEvent(event.originalEvent)));
    }
    symbol.bindTooltip(getFeatureTooltip(feature, category));
    return symbol;
  }

  function getLineMidpoint(points) {
    if (points.length < 2) {
      return points[0] || { x: 0, y: 0 };
    }

    let totalLength = 0;
    for (let index = 1; index < points.length; index += 1) {
      totalLength += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }

    let distance = totalLength / 2;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
      if (distance <= segmentLength) {
        const ratio = segmentLength ? distance / segmentLength : 0;
        return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
      }
      distance -= segmentLength;
    }
    return points[points.length - 1];
  }

  function getPolygonCentroid(points) {
    let areaTwice = 0;
    let centroidX = 0;
    let centroidY = 0;
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      const cross = point.x * next.y - next.x * point.y;
      areaTwice += cross;
      centroidX += (point.x + next.x) * cross;
      centroidY += (point.y + next.y) * cross;
    });

    if (Math.abs(areaTwice) < 0.001) {
      return points.reduce(
        (center, point) => ({ x: center.x + point.x / points.length, y: center.y + point.y / points.length }),
        { x: 0, y: 0 },
      );
    }
    return { x: centroidX / (3 * areaTwice), y: centroidY / (3 * areaTwice) };
  }

  function renderDraft() {
    draftLayer.clearLayers();

    if (!state.drawPoints.length && !state.draftFeature) {
      state.draftLayer = null;
      return;
    }

    const draft = getDraftFeature();
    const draftIsMarker = state.mode === "marker" || draft?.type === "marker";
    const category = state.mode === "range" ? categoryById.range : categoryById.route;
    const latLngs = state.drawPoints.map((point) => [point.y, point.x]);

    if (draftIsMarker && draft) {
      const point = draft.points[0];
      L.marker([point.y, point.x], {
        icon: L.divIcon({
          className: "",
          html: `<div class="poi-marker marker-${escapeHtml(draft.category)}${getFeatureCategories(draft).length > 1 ? " is-mixed" : ""} is-draft" style="${getFeatureMarkerStyle(draft)}">${getFeatureMarkerIcon(draft)}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        }),
      }).addTo(draftLayer);
      if (state.showLabels) {
        createFeatureLabelLayer(draft).addTo(draftLayer);
      }
      addDraftMapControls(point);
      state.draftLayer = draftLayer;
      return;
    }

    const visibleDraftPoints =
      state.drawPoints.length > 20
        ? [state.drawPoints[0], state.drawPoints[state.drawPoints.length - 1]]
        : state.drawPoints;

    visibleDraftPoints.forEach((point) => {
      L.circleMarker([point.y, point.x], {
        radius: state.drawPoints.length > 20 ? 4 : 5,
        color: "#3c2816",
        weight: 1.5,
        fillColor: category.color,
        fillOpacity: 0.82,
      }).addTo(draftLayer);
    });

    addDraftMapControls(state.drawPoints[state.drawPoints.length - 1]);

    if (state.drawPoints.length > 1) {
      const draftGeometry = {
        id: "draft",
        title: state.mode === "range" ? "Draft range" : "Draft trail",
        type: state.mode === "range" ? "range" : "route",
        category: state.mode === "range" ? "range" : "route",
        color: category.color,
        points: state.drawPoints,
      };
      const layer =
        state.mode === "range"
          ? L.layerGroup([
              L.polygon(latLngs, {
                color: category.color,
                weight: 2.5,
                fillColor: category.color,
                fillOpacity: 0.14,
                dashArray: "8 10",
                lineCap: "round",
                lineJoin: "round",
              }),
              createGeometrySymbolLayer(draftGeometry, getPolygonCentroid(state.drawPoints), true),
              ...(state.showLabels ? [createFeatureLabelLayer(draftGeometry)] : []),
            ])
          : L.layerGroup([
              createRouteLayer(latLngs, category, true, draftGeometry),
              ...(state.showLabels ? [createFeatureLabelLayer(draftGeometry)] : []),
            ]);
      layer.addTo(draftLayer);
      state.draftLayer = layer;
    }
  }

  function addDraftMapControls(point) {
    if (!point) {
      return;
    }

    const canSave = canSaveDraft();
    const control = L.marker([point.y, point.x], {
      interactive: true,
      icon: L.divIcon({
        className: "",
        html: `
          <div class="draft-map-actions" aria-label="Draft actions">
            <button class="draft-map-action draft-map-save" type="button" title="Save draft" aria-label="Save draft"${canSave ? "" : " disabled"}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
            </button>
            <button class="draft-map-action draft-map-discard" type="button" title="Discard draft" aria-label="Discard draft">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 18 18M18 6 6 18" /></svg>
            </button>
          </div>
        `,
        iconSize: [70, 32],
        iconAnchor: [-10, 16],
      }),
    }).addTo(draftLayer);

    const container = control.getElement();
    if (!container) {
      return;
    }

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    const saveButton = container.querySelector(".draft-map-save");
    const discardButton = container.querySelector(".draft-map-discard");
    saveButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      finishDrawing();
    });
    discardButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelDrawing();
      renderAll();
    });
  }

  function finishDrawing() {
    if (state.mode === "marker" || state.draftFeature?.type === "marker") {
      if (!state.draftFeature && state.drawPoints.length < 1) {
        setStatus("Place a draft mark first");
        return;
      }

      const feature = cloneFeature(getDraftFeature(true));
      feature.updatedAt = new Date().toISOString();
      pushUndo("mark save");
      state.features.push(feature);
      showFeatureCategories(feature);
      saveState();
      cancelDrawing(false, false);
      renderAll();
      selectFeature(feature.id);
      setMode("select");
      setStatus(`Created ${feature.title}`);
      return;
    }

    const isRange = state.mode === "range";
    const minimum = isRange ? 3 : 2;
    if (state.drawPoints.length < minimum) {
      setStatus(isRange ? "Range needs at least 3 points" : "Trail needs at least 2 points");
      return;
    }

    const feature = createFeature({
      type: isRange ? "range" : "route",
      category: isRange ? "range" : "route",
      title: isRange ? "New range" : "New trail",
      points: state.drawPoints.slice(),
    });

    pushUndo(`${isRange ? "range" : "trail"} save`);
    state.features.push(feature);
    showFeatureCategories(feature);
    saveState();
    cancelDrawing(false, false);
    renderAll();
    selectFeature(feature.id);
    setMode("select");
    setStatus(`Created ${feature.title}`);
  }

  function cancelDrawing(showStatus = true, recordUndo = true) {
    const draftId = state.draftFeature ? state.draftFeature.id : null;
    if (recordUndo && (state.drawPoints.length || state.draftFeature || state.pointerStart || state.freehandDrawing)) {
      pushUndo("draft cancel");
    }
    if (draftId && state.selectedId === draftId) {
      state.selectedId = null;
    }
    if (draftId) {
      state.selectedIds = state.selectedIds.filter((id) => id !== draftId);
    }
    state.drawPoints = [];
    state.draftFeature = null;
    state.draftLayer = null;
    state.pointerStart = null;
    state.freehandDrawing = false;
    draftLayer.clearLayers();
    updateDrawButtons();
    if (showStatus) {
      setStatus("Draft discarded");
    }
  }

  function updateDrawButtons() {
    // Draft save/discard state is shown next to the draft on the map.
  }

  function canSaveDraft() {
    if (state.mode === "marker" || state.draftFeature?.type === "marker") {
      return Boolean(state.draftFeature);
    }
    if (state.mode === "range") {
      return state.drawPoints.length >= 3;
    }
    if (state.mode === "route") {
      return state.drawPoints.length >= 2;
    }
    return false;
  }

  function renderFilters() {
    elements.categoryFilters.innerHTML = "";

    categories.forEach((category) => {
      const label = document.createElement("label");
      label.className = "check-row";
      label.innerHTML = `
        <span>
          <i class="swatch" style="background:${category.color}" aria-hidden="true"></i>
          ${escapeHtml(category.label)}
        </span>
      `;

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.filters[category.id] !== false;
      input.addEventListener("change", () => {
        state.filters[category.id] = input.checked;
        saveState();
        renderAll();
      });

      label.appendChild(input);
      elements.categoryFilters.appendChild(label);
    });
  }

  function renderCreatorFilter() {
    const creators = Array.from(
      new Set(
        state.features
          .filter((feature) => !isDefaultFeature(feature) && !isCanonFeature(feature) && feature.creator)
          .map((feature) => feature.creator),
      ),
    ).sort((a, b) => a.localeCompare(b));

    const previous = state.creatorFilter;
    elements.creatorFilterInput.innerHTML = '<option value="">Anyone</option>';
    creators.forEach((creator) => {
      const option = document.createElement("option");
      option.value = creator;
      option.textContent = creator;
      elements.creatorFilterInput.appendChild(option);
    });

    state.creatorFilter = creators.includes(previous) ? previous : "";
    elements.creatorFilterInput.value = state.creatorFilter;
  }

  function renderFeatureList() {
    const features = getVisibleFeatures();
    elements.featureList.innerHTML = "";
    elements.atlasCount.textContent = features.length === state.features.length ? `${features.length} entries` : `${features.length} of ${state.features.length}`;

    if (!features.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No matching entries.";
      elements.featureList.appendChild(empty);
      return;
    }

    features
      .slice()
      .sort(compareFeaturesForList)
      .forEach((feature) => {
        const category = categoryById[feature.category] || categoryById.landmark;
        const button = document.createElement("button");
        button.className = `feature-card${isFeatureSelected(feature.id) ? " is-selected" : ""}`;
        button.type = "button";
        button.innerHTML = `
          <strong>${escapeHtml(feature.title || category.label)}</strong>
          <span class="feature-meta">
            <i class="swatch" style="${getFeatureSwatchStyle(feature)}" aria-hidden="true"></i>
            ${escapeHtml(getFeatureCategoryLabel(feature))}
            ${isGuildFeature(feature) ? '<span class="source-badge">Guild</span>' : isCanonFeature(feature) ? '<span class="source-badge">Skyrim</span>' : ""}
            <span>${escapeHtml(getFeatureFreshnessLabel(feature))}</span>
          </span>
          ${feature.creator ? `<span class="feature-creator">Mapped by ${escapeHtml(feature.creator)}</span>` : ""}
          ${feature.updatedBy ? `<span class="feature-creator">Updated by ${escapeHtml(feature.updatedBy)}</span>` : ""}
          ${feature.notes ? `<span class="feature-note">${escapeHtml(truncate(feature.notes, 90))}</span>` : ""}
        `;
        button.addEventListener("click", (event) => {
          const additive = isAdditiveSelectionEvent(event);
          selectFeature(feature.id, additive);
          if (!additive) {
            zoomToFeature(feature);
          }
        });
        elements.featureList.appendChild(button);
      });
  }

  function setCategoryFilters(visible) {
    categories.forEach((category) => {
      state.filters[category.id] = visible;
    });
    saveState();
    renderFilters();
    renderAll();
    setStatus(visible ? "All categories shown" : "All categories hidden");
  }

  function showFeatureCategories(feature) {
    getFeatureCategories(feature).forEach((categoryId) => {
      state.filters[categoryId] = true;
    });
    renderFilters();
  }

  function updateMapDensity() {
    const container = map.getContainer();
    const zoom = map.getZoom();
    container.classList.toggle("map-density-overview", zoom <= -1.5);
    container.classList.toggle("map-density-mid", zoom > -1.5 && zoom < 0);
    container.classList.toggle("map-density-detail", zoom >= 0);
  }

  function renderEditor() {
    const selectedFeatures = getSelectedFeatures();
    const feature = selectedFeatures.length === 1 ? getSelectedFeature() : null;
    const disabled = !feature;
    const editing = state.workspaceMode === "edit";
    const moving = Boolean(feature && state.movingFeatureId === feature.id);

    renderFieldOverview(feature);
    elements.editorForm.hidden = disabled || !editing;
    elements.selectionSummary.hidden = disabled || editing;
    elements.emptySelection.hidden = Boolean(feature);
    elements.emptySelection.textContent =
      selectedFeatures.length > 1
        ? `${selectedFeatures.length} entries selected. Ctrl-click, Cmd-click, or Shift-click entries to adjust the selection.`
        : "Choose a mark, trail, or range from the map or Browse Atlas.";
    if (feature && !editing) {
      renderSelectionSummary(feature);
    } else {
      elements.selectionSummary.innerHTML = "";
    }
    elements.featureId.value = feature ? feature.id : "";
    elements.titleInput.value = feature ? feature.title : "";
    renderCategoryInputs(feature ? getFeatureCategories(feature) : ["landmark"], disabled);
    elements.confidenceInput.value = feature ? feature.confidence : "scouted";
    const showGeometryColor = Boolean(feature && (feature.type === "range" || feature.type === "route"));
    elements.rangeColorField.hidden = !showGeometryColor;
    elements.rangeColorLabel.textContent = feature && feature.type === "route" ? "Trail Color" : "Range Color";
    elements.rangeColorInput.value = feature ? getFeatureColor(feature, categoryById[feature.category] || categoryById.range) : categoryById.range.color;
    elements.creatorMeta.innerHTML = feature ? getAttributionHtml(feature) : "";
    elements.creatorMeta.hidden = !feature || !elements.creatorMeta.innerHTML;
    renderTrailmarkPresence(feature);
    elements.notesInput.value = feature ? feature.notes : "";

    const isDraft = Boolean(feature && state.draftFeature && feature.id === state.draftFeature.id);
    elements.saveFeatureBtn.textContent = isDraft ? "Create Mark" : "Save";
    elements.deleteFeatureBtn.textContent = selectedFeatures.length > 1 ? `Delete ${selectedFeatures.length}` : isDraft ? "Discard" : "Delete";
    const canMove = canBeginFeatureMove(feature) || moving;
    elements.moveFeatureBtn.disabled = !canMove;
    elements.moveFeatureBtn.hidden = isDraft || moving;
    elements.moveFeatureActions.hidden = !moving;
    elements.editorForm.classList.toggle("is-moving-feature", moving);
    elements.editorForm.querySelector(".editor-actions").hidden = moving;

    [
      elements.titleInput,
      elements.categoryField,
      elements.confidenceInput,
      elements.rangeColorInput,
      elements.notesInput,
      elements.saveFeatureBtn,
    ].forEach((element) => {
      element.disabled = disabled || moving;
    });
    elements.deleteFeatureBtn.disabled = selectedFeatures.length === 0 || moving;
  }

  function renderFieldOverview(feature) {
    const fieldMode = state.workspaceMode === "field";
    elements.fieldOverview.hidden = !fieldMode;
    if (!fieldMode) {
      return;
    }

    if (state.livePositionConnection === "linked") {
      elements.fieldConsoleStatus.classList.remove("is-unavailable");
      elements.fieldConsoleStatus.textContent = "Skyrim connected";
      elements.fieldConsoleHint.textContent = state.trailmarkVisitsEnabled
        ? "Trailmark watch active."
        : "Record visits is off.";
      elements.fieldMarkHereBtn.disabled = !state.livePositionPoint || state.livePositionPoint.stale;
      return;
    }
    if (state.livePositionConnection === "connecting") {
      elements.fieldConsoleStatus.classList.remove("is-unavailable");
      elements.fieldConsoleStatus.textContent = "Connecting to Skyrim";
      elements.fieldConsoleHint.textContent = "Waiting for the game link.";
      elements.fieldMarkHereBtn.disabled = true;
      return;
    }
    if (state.livePositionConnection === "unavailable") {
      elements.fieldConsoleStatus.classList.add("is-unavailable");
      elements.fieldConsoleStatus.textContent = "Game link unavailable";
      elements.fieldConsoleHint.textContent = "Skyrim is not connected.";
      elements.fieldMarkHereBtn.disabled = true;
      return;
    }
    elements.fieldConsoleStatus.classList.remove("is-unavailable");
    elements.fieldConsoleStatus.textContent = "Ready for the road";
    elements.fieldConsoleHint.textContent = "Enable Live position.";
    elements.fieldMarkHereBtn.disabled = true;
  }

  function renderSelectionSummary(feature) {
    const category = categoryById[feature.category] || categoryById.landmark;
    const source = isGuildFeature(feature)
      ? '<span class="source-badge">Guild</span>'
      : isCanonFeature(feature)
        ? '<span class="source-badge">Skyrim</span>'
        : "";
    elements.selectionSummary.innerHTML = `
      <div class="selection-summary-heading">
        <span class="selection-summary-symbol" style="${getFeatureSwatchStyle(feature)}">${getFeatureMarkerIcon(feature)}</span>
        <div>
          <h3>${escapeHtml(feature.title || category.label)}</h3>
          <p>${escapeHtml(getFeatureCategoryLabel(feature))} ${source}</p>
        </div>
      </div>
      <dl class="selection-summary-facts">
        <div><dt>Confidence</dt><dd>${escapeHtml(titleCase(feature.confidence || "scouted"))}</dd></div>
        <div><dt>Type</dt><dd>${escapeHtml(titleCase(featureTypeLabel(feature.type)))}</dd></div>
      </dl>
      ${feature.notes ? `<div class="selection-summary-notes"><span>Field notes</span><p>${escapeHtml(feature.notes)}</p></div>` : ""}
      ${getAttributionHtml(feature) ? `<p class="selection-summary-attribution">${getAttributionHtml(feature)}</p>` : ""}
    `;
  }

  function canBeginFeatureMove(feature) {
    return Boolean(
      feature &&
        state.workspaceMode === "edit" &&
        state.mode === "select" &&
        feature.type === "marker" &&
        !isDefaultFeature(feature) &&
        !isCanonFeature(feature) &&
        (!state.draftFeature || feature.id !== state.draftFeature.id),
    );
  }

  function beginMoveSelectedFeature() {
    const feature = getSelectedFeature();
    if (!canBeginFeatureMove(feature)) {
      setStatus("Select a custom marker in Edit Atlas before moving it");
      return;
    }
    pushUndo(`${feature.title} move`);
    state.movingFeatureId = feature.id;
    state.movingOriginalPoint = { ...feature.points[0] };
    renderAll();
    setStatus("Drag the highlighted marker, then confirm or cancel");
  }

  function confirmFeatureMove() {
    const feature = state.features.find((candidate) => candidate.id === state.movingFeatureId);
    if (!feature) {
      cancelFeatureMove(false);
      return;
    }
    stampFeatureUpdate(feature);
    feature.updatedAt = new Date().toISOString();
    if (isGuildFeature(feature)) {
      state.guildAtlasLocalChanges = true;
    }
    state.movingFeatureId = null;
    state.movingOriginalPoint = null;
    saveState();
    renderAll();
    setStatus("Position updated");
  }

  function cancelFeatureMove(showStatus = true) {
    const feature = state.features.find((candidate) => candidate.id === state.movingFeatureId);
    if (feature && state.movingOriginalPoint) {
      feature.points = [{ ...state.movingOriginalPoint }];
    }
    const expectedLabel = feature ? `${feature.title} move` : "";
    const pendingUndo = state.undoStack[state.undoStack.length - 1];
    if (pendingUndo && pendingUndo.label === expectedLabel) {
      state.undoStack.pop();
      updateUndoButton();
    }
    state.movingFeatureId = null;
    state.movingOriginalPoint = null;
    renderAll();
    if (showStatus) {
      setStatus("Move cancelled");
    }
  }

  function renderCategoryInputs(selectedCategoryIds, disabled) {
    const selected = new Set(selectedCategoryIds);
    elements.categoryInput.innerHTML = "";

    categories
      .forEach((category) => {
        const label = document.createElement("label");
        label.className = "entry-category-option";
        label.innerHTML = `
          <input type="checkbox" value="${escapeHtml(category.id)}"${selected.has(category.id) ? " checked" : ""} />
          <i class="swatch" style="background:${category.color}" aria-hidden="true"></i>
          <span>${escapeHtml(category.label)}</span>
        `;
        elements.categoryInput.appendChild(label);
      });

    elements.categoryField.disabled = disabled;
  }

  function getSelectedCategoryIds() {
    return Array.from(elements.categoryInput.querySelectorAll('input[type="checkbox"]:checked')).map(
      (input) => input.value,
    );
  }

  function handleCategorySelectionChange(event) {
    if (!event.target.matches('input[type="checkbox"]')) {
      return;
    }

    const feature = getSelectedFeature();
    if (
      event.target.checked &&
      event.target.value !== "landmark" &&
      feature &&
      feature.type === "marker" &&
      state.draftFeature &&
      feature.id === state.draftFeature.id
    ) {
      const landmarkInput = elements.categoryInput.querySelector('input[value="landmark"]');
      if (landmarkInput) {
        landmarkInput.checked = false;
      }
    }

    if (!getSelectedCategoryIds().length) {
      event.target.checked = true;
      setStatus("Each entry needs at least one category");
      return;
    }

    syncDraftFromEditor();
  }

  function selectFeature(id, additive = false) {
    if (state.movingFeatureId && id !== state.movingFeatureId) {
      cancelFeatureMove(false);
    }
    if (!id) {
      state.selectedIds = [];
      state.selectedId = null;
      setPanelView(state.workspaceMode === "field" ? "field" : "browse", false);
      renderAll();
      setStatus("Selection cleared");
      return;
    }

    if (additive) {
      const selected = new Set(state.selectedIds);
      if (selected.has(id)) {
        selected.delete(id);
      } else {
        selected.add(id);
      }
      state.selectedIds = Array.from(selected);
      state.selectedId = selected.has(id) ? id : state.selectedIds[state.selectedIds.length - 1] || null;
    } else {
      state.selectedIds = [id];
      state.selectedId = id;
    }

    if (!additive) {
      setPanelView("details", false);
    }
    renderAll();
    const selectedFeatures = getSelectedFeatures();
    if (selectedFeatures.length > 1) {
      setStatus(`${selectedFeatures.length} entries selected`);
      return;
    }
    const feature = getSelectedFeature();
    setStatus(feature ? `Selected: ${feature.title}` : "Selection cleared");
    if (isOfficialTrailmark(feature)) {
      void refreshTrailmarkVisits(feature);
    }
  }

  function saveSelectedFeature() {
    const feature = getSelectedFeature();
    if (!feature) {
      return;
    }

    if (state.draftFeature && feature.id === state.draftFeature.id) {
      applyEditorValues(state.draftFeature);
      state.draftFeature.updatedAt = new Date().toISOString();
      state.drawPoints = state.draftFeature.points.map((point) => ({ ...point }));
      finishDrawing();
      return;
    }

    pushUndo(`${feature.title} edit`);
    applyEditorValues(feature);
    showFeatureCategories(feature);
    stampFeatureUpdate(feature);
    feature.updatedAt = new Date().toISOString();
    if (isGuildFeature(feature)) {
      state.guildAtlasLocalChanges = true;
    }
    saveState();
    renderAll();
    setStatus("Saved");
  }

  function syncDraftFromEditor() {
    if (!state.draftFeature || state.selectedId !== state.draftFeature.id) {
      return;
    }
    applyEditorValues(state.draftFeature);
    renderDraft();
  }

  function deleteSelectedFeature() {
    const selectedFeatures = getSelectedFeatures();
    if (!selectedFeatures.length) {
      return;
    }

    const draftId = state.draftFeature ? state.draftFeature.id : null;
    const deletableFeatures = selectedFeatures.filter((feature) => feature.id !== draftId);
    const hasDraftOnly = !deletableFeatures.length && draftId && selectedFeatures.some((feature) => feature.id === draftId);

    if (hasDraftOnly) {
      cancelDrawing(true);
      renderAll();
      return;
    }

    const selectedCount = deletableFeatures.length;
    const preview = deletableFeatures
      .slice(0, 3)
      .map((feature) => `"${feature.title || "Untitled"}"`)
      .join(", ");
    const remaining = selectedCount - Math.min(selectedCount, 3);
    const previewText = remaining > 0 ? `${preview}, and ${remaining} more` : preview;
    const confirmed = window.confirm(
      selectedCount === 1 ? `Delete ${previewText}?` : `Delete ${selectedCount} selected entries?\n\n${previewText}`,
    );
    if (!confirmed) {
      return;
    }

    const selectedIds = new Set(deletableFeatures.map((feature) => feature.id));
    pushUndo(selectedCount === 1 ? `${deletableFeatures[0].title} delete` : `${selectedCount} entries delete`);
    if (deletableFeatures.some(isGuildFeature)) {
      state.guildAtlasLocalChanges = true;
    }
    state.features = state.features.filter((item) => !selectedIds.has(item.id));
    if (draftId && selectedFeatures.some((feature) => feature.id === draftId)) {
      cancelDrawing(false, false);
    }
    state.selectedId = null;
    state.selectedIds = [];
    saveState();
    renderAll();
    setStatus(selectedCount === 1 ? "Deleted" : `Deleted ${selectedCount} entries`);
  }

  async function exportVisibleMap() {
    elements.exportMapBtn.disabled = true;
    setStatus("Preparing map image...");

    try {
      const image = await loadImage(MAP_IMAGE);
      const canvas = renderVisibleMapToCanvas(image);
      const blob = await canvasToBlob(canvas);
      downloadBlob(blob, `ranger-corps-field-atlas-${formatDateForFilename(new Date())}.png`);
      setStatus("Map image exported");
    } catch (error) {
      console.error(error);
      setStatus("Could not export map image");
    } finally {
      elements.exportMapBtn.disabled = false;
    }
  }

  function renderVisibleMapToCanvas(image) {
    const size = map.getSize();
    const maxSide = 2400;
    const deviceScale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const scale = Math.min(deviceScale, maxSide / Math.max(size.x, size.y));
    const width = Math.max(1, Math.round(size.x * scale));
    const height = Math.max(1, Math.round(size.y * scale));
    const canvas = document.createElement("canvas");
    const bounds = getExportBounds();
    const ctx = canvas.getContext("2d");

    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = "#19140d";
    ctx.fillRect(0, 0, width, height);
    drawExportMapImage(ctx, image, bounds, width, height);
    drawExportFeatures(ctx, bounds, width, height, scale);
    drawExportLivePosition(ctx, bounds, width, height, scale);
    drawExportFrame(ctx, width, height, scale);
    return canvas;
  }

  function getExportBounds() {
    const bounds = map.getBounds();
    return {
      west: bounds.getWest(),
      east: bounds.getEast(),
      south: bounds.getSouth(),
      north: bounds.getNorth(),
    };
  }

  function drawExportMapImage(ctx, image, bounds, width, height) {
    const cropWest = Math.max(0, bounds.west);
    const cropEast = Math.min(MAP_WIDTH, bounds.east);
    const cropSouth = Math.max(0, bounds.south);
    const cropNorth = Math.min(MAP_HEIGHT, bounds.north);
    if (cropEast <= cropWest || cropNorth <= cropSouth) {
      return;
    }

    const sourceX = (cropWest / MAP_WIDTH) * image.naturalWidth;
    const sourceY = ((MAP_HEIGHT - cropNorth) / MAP_HEIGHT) * image.naturalHeight;
    const sourceWidth = ((cropEast - cropWest) / MAP_WIDTH) * image.naturalWidth;
    const sourceHeight = ((cropNorth - cropSouth) / MAP_HEIGHT) * image.naturalHeight;
    const destX = ((cropWest - bounds.west) / (bounds.east - bounds.west)) * width;
    const destY = ((bounds.north - cropNorth) / (bounds.north - bounds.south)) * height;
    const destWidth = ((cropEast - cropWest) / (bounds.east - bounds.west)) * width;
    const destHeight = ((cropNorth - cropSouth) / (bounds.north - bounds.south)) * height;

    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, destX, destY, destWidth, destHeight);
  }

  function drawExportFeatures(ctx, bounds, width, height, scale) {
    getVisibleFeatures()
      .filter((feature) => featureIntersectsBounds(feature, bounds))
      .slice()
      .sort(compareFeaturesForMap)
      .forEach((feature) => {
        const category = categoryById[feature.category] || categoryById.landmark;
        if (feature.type === "range") {
          drawExportRange(ctx, feature, category, bounds, width, height, scale);
        } else if (feature.type === "route") {
          drawExportRoute(ctx, feature, category, bounds, width, height, scale);
        } else {
          drawExportMarker(ctx, feature, category, bounds, width, height, scale);
        }
      });
  }

  function drawExportRange(ctx, feature, category, bounds, width, height, scale) {
    const points = feature.points.map((point) => mapPointToExport(point, bounds, width, height));
    if (points.length < 2) {
      return;
    }
    const color = getFeatureColor(feature, category);
    ctx.save();
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.closePath();
    ctx.globalAlpha = isFeatureSelected(feature.id) ? 0.22 : 0.16;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = isFeatureSelected(feature.id) ? 0.95 : 0.78;
    ctx.strokeStyle = color;
    ctx.lineWidth = (isFeatureSelected(feature.id) ? 4 : 2.5) * scale;
    ctx.lineJoin = "round";
    ctx.stroke();
    const labelPoint = mapPointToExport(getPolygonCentroid(feature.points), bounds, width, height);
    drawExportGeometrySymbol(ctx, feature, labelPoint, scale);
    if (state.showLabels) {
      drawExportLabel(ctx, feature.title || category.label, labelPoint.x, labelPoint.y - 18 * scale, scale);
    }
    ctx.restore();
  }

  function drawExportRoute(ctx, feature, category, bounds, width, height, scale) {
    const points = feature.points.map((point) => mapPointToExport(point, bounds, width, height));
    if (points.length < 2) {
      return;
    }

    ctx.save();
    drawExportPath(ctx, points);
    ctx.strokeStyle = "#f5e8c9";
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = (isFeatureSelected(feature.id) ? 13 : 11) * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    drawExportPath(ctx, points);
    ctx.strokeStyle = getFeatureColor(feature, category);
    ctx.globalAlpha = isFeatureSelected(feature.id) ? 0.98 : 0.92;
    ctx.lineWidth = (isFeatureSelected(feature.id) ? 5 : 4) * scale;
    ctx.setLineDash([24 * scale, 12 * scale, 5 * scale, 12 * scale]);
    ctx.stroke();
    const labelPoint = mapPointToExport(getLineMidpoint(feature.points), bounds, width, height);
    drawExportGeometrySymbol(ctx, feature, labelPoint, scale);
    if (state.showLabels) {
      drawExportLabel(ctx, feature.title || category.label, labelPoint.x, labelPoint.y - 18 * scale, scale);
    }
    ctx.restore();
  }

  function drawExportGeometrySymbol(ctx, feature, point, scale) {
    const category = categoryById[feature.category] || categoryById[feature.type === "range" ? "range" : "route"];
    const color = getFeatureColor(feature, category);
    const radius = 13 * scale;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.shadowColor = "rgba(24, 15, 7, 0.34)";
    ctx.shadowBlur = 5 * scale;
    ctx.shadowOffsetY = 2 * scale;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(248, 238, 210, 0.94)";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2 * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (feature.type === "range") {
      ctx.beginPath();
      for (let index = 0; index < 6; index += 1) {
        const angle = -Math.PI / 2 + (index * Math.PI) / 3;
        const x = point.x + Math.cos(angle) * 6 * scale;
        const y = point.y + Math.sin(angle) * 6 * scale;
        index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.strokeRect(point.x - 2.5 * scale, point.y - 2 * scale, 5 * scale, 4 * scale);
    } else {
      ctx.beginPath();
      ctx.moveTo(point.x - 6 * scale, point.y + 5 * scale);
      ctx.bezierCurveTo(point.x - 2 * scale, point.y - 6 * scale, point.x + 2 * scale, point.y + 6 * scale, point.x + 6 * scale, point.y - 5 * scale);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x - 6 * scale, point.y + 5 * scale, 1.8 * scale, 0, Math.PI * 2);
      ctx.arc(point.x + 6 * scale, point.y - 5 * scale, 1.8 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawExportMarker(ctx, feature, category, bounds, width, height, scale) {
    const point = mapPointToExport(feature.points[0], bounds, width, height);
    const selected = isFeatureSelected(feature.id);
    const radius = (isDefaultFeature(feature) ? 6 : selected ? 11 : 9) * scale;
    ctx.save();
    ctx.shadowColor = "rgba(24, 15, 7, 0.34)";
    ctx.shadowBlur = 5 * scale;
    ctx.shadowOffsetY = 2 * scale;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = category.color;
    ctx.fill();
    ctx.shadowColor = "transparent";
    const markerColors = getFeatureCategoryColors(feature);
    markerColors.forEach((color, index) => {
      ctx.beginPath();
      if (markerColors.length > 1) {
        ctx.moveTo(point.x, point.y);
      }
      ctx.arc(
        point.x,
        point.y,
        radius,
        -Math.PI / 2 + (index * Math.PI * 2) / markerColors.length,
        -Math.PI / 2 + ((index + 1) * Math.PI * 2) / markerColors.length,
      );
      if (markerColors.length > 1) {
        ctx.closePath();
      }
      ctx.fillStyle = color;
      ctx.fill();
    });
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.lineWidth = (selected ? 3 : 2) * scale;
    ctx.strokeStyle = selected ? "#fff4d7" : "#efe3c2";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(2.5 * scale, radius * 0.36), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 246, 222, 0.76)";
    ctx.fill();

    if (state.showLabels) {
      drawExportLabel(ctx, feature.title || category.label, point.x, point.y - radius - 4 * scale, scale);
    }
    ctx.restore();
  }

  function drawExportLivePosition(ctx, bounds, width, height, scale) {
    const livePoint = state.livePositionEnabled ? state.livePositionPoint : null;
    if (
      !livePoint ||
      livePoint.x < bounds.west ||
      livePoint.x > bounds.east ||
      livePoint.y < bounds.south ||
      livePoint.y > bounds.north
    ) {
      return;
    }

    const point = mapPointToExport(livePoint, bounds, width, height);
    const radius = 13 * scale;
    ctx.save();
    ctx.globalAlpha = livePoint.stale ? 0.68 : 1;
    ctx.shadowColor = "rgba(24, 15, 7, 0.42)";
    ctx.shadowBlur = 6 * scale;
    ctx.shadowOffsetY = 2 * scale;
    ctx.translate(point.x, point.y);
    ctx.rotate(((Number(livePoint.heading) || 0) * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(radius * 0.72, radius);
    ctx.lineTo(0, radius * 0.48);
    ctx.lineTo(-radius * 0.72, radius);
    ctx.closePath();
    ctx.fillStyle = "#f7edcf";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#1c2d22";
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
    ctx.restore();
    if (state.showLabels) {
      drawExportLabel(
        ctx,
        livePoint.stale ? "Last outdoor position" : "Your position",
        point.x,
        point.y - radius - 4 * scale,
        scale,
      );
    }
  }

  function drawExportPath(ctx, points) {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
  }

  function drawExportLabel(ctx, text, x, y, scale) {
    const label = truncate(String(text || ""), 32);
    const fontSize = 12 * scale;
    const paddingX = 6 * scale;
    const paddingY = 4 * scale;

    ctx.font = `${fontSize}px Georgia, "Times New Roman", serif`;
    const metrics = ctx.measureText(label);
    const width = metrics.width + paddingX * 2;
    const height = fontSize + paddingY * 2;
    const labelX = Math.max(4 * scale, Math.min(x - width / 2, ctx.canvas.width - width - 4 * scale));
    const labelY = Math.max(4 * scale, y - height);

    ctx.fillStyle = "rgba(246, 235, 208, 0.86)";
    ctx.strokeStyle = "rgba(72, 45, 17, 0.42)";
    ctx.lineWidth = 1 * scale;
    drawRoundedRectPath(ctx, labelX, labelY, width, height, 3 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#24190f";
    ctx.fillText(label, labelX + paddingX, labelY + paddingY + fontSize * 0.78);
  }

  function drawRoundedRectPath(ctx, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
  }

  function drawExportFrame(ctx, width, height, scale) {
    const inset = 7 * scale;
    ctx.save();
    ctx.strokeStyle = "rgba(238, 210, 151, 0.54)";
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    ctx.fillStyle = "rgba(246, 235, 208, 0.82)";
    ctx.font = `${12 * scale}px Georgia, "Times New Roman", serif`;
    ctx.fillText("The Ranger Corps - Field Atlas", 14 * scale, height - 14 * scale);
    ctx.restore();
  }

  function mapPointToExport(point, bounds, width, height) {
    return {
      x: ((point.x - bounds.west) / (bounds.east - bounds.west)) * width,
      y: ((bounds.north - point.y) / (bounds.north - bounds.south)) * height,
    };
  }

  function featureIntersectsBounds(feature, bounds) {
    if (feature.type === "marker") {
      const point = feature.points[0];
      return point.x >= bounds.west && point.x <= bounds.east && point.y >= bounds.south && point.y <= bounds.north;
    }

    const featureBounds = feature.points.reduce(
      (accumulator, point) => ({
        west: Math.min(accumulator.west, point.x),
        east: Math.max(accumulator.east, point.x),
        south: Math.min(accumulator.south, point.y),
        north: Math.max(accumulator.north, point.y),
      }),
      { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity },
    );
    return featureBounds.east >= bounds.west && featureBounds.west <= bounds.east && featureBounds.north >= bounds.south && featureBounds.south <= bounds.north;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not create map image"));
        }
      }, "image/png");
    });
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function formatDateForFilename(date) {
    return date.toISOString().slice(0, 10);
  }

  function openShareDialog() {
    const shareFeatures = getShareableFeatures();
    elements.shareStatus.textContent = "";
    elements.shareEntryList.innerHTML = "";

    if (!shareFeatures.length) {
      setStatus("No non-default entries to share");
      return;
    }

    shareFeatures
      .slice()
      .sort(compareFeaturesForList)
      .forEach((feature) => {
        const category = categoryById[feature.category] || categoryById.landmark;
        const label = document.createElement("label");
        label.className = "share-entry-row";
        label.innerHTML = `
          <input class="share-entry-checkbox" type="checkbox" value="${escapeHtml(feature.id)}" checked />
          <span class="share-entry-main">
            <span class="share-entry-title">${escapeHtml(feature.title || category.label)}</span>
            <span class="share-entry-meta">
              <i class="swatch" style="${getFeatureSwatchStyle(feature)}" aria-hidden="true"></i>
              ${escapeHtml(getFeatureCategoryLabel(feature))}
              ${isGuildFeature(feature) ? '<span class="source-badge">Guild</span>' : isCanonFeature(feature) ? '<span class="source-badge">Skyrim</span>' : ""}
              ${feature.creator ? `<span>Mapped by ${escapeHtml(feature.creator)}</span>` : ""}
            </span>
          </span>
        `;
        elements.shareEntryList.appendChild(label);
      });

    elements.shareDialog.showModal();
    updateShareDialogState();
  }

  function closeShareDialog() {
    elements.shareDialog.close();
    elements.shareStatus.textContent = "";
  }

  async function copySelectedShareCode() {
    const shareFeatures = getSelectedShareFeatures();
    if (!shareFeatures.length) {
      elements.shareStatus.textContent = "Select at least one entry.";
      return;
    }

    setShareBusy(true);
    elements.shareStatus.textContent = "Preparing share code...";

    try {
      const { code, status } = await createShareCodeForFeatures(shareFeatures);

      try {
        await navigator.clipboard.writeText(code);
        setStatus(status);
        closeShareDialog();
      } catch (error) {
        window.prompt("Copy this atlas code.", code);
        setStatus(status.replace("Copied", "Atlas code ready to copy"));
        closeShareDialog();
      }
    } catch (error) {
      console.error(error);
      elements.shareStatus.textContent = "Could not create an atlas share code for those entries.";
    } finally {
      setShareBusy(false);
    }
  }

  async function copySelectedFieldReport() {
    const shareFeatures = getSelectedShareFeatures();
    if (!shareFeatures.length) {
      elements.shareStatus.textContent = "Select at least one entry.";
      return;
    }

    setShareBusy(true);
    elements.shareStatus.textContent = "Preparing field report...";

    try {
      const { code, status } = await createShareCodeForFeatures(shareFeatures);
      const report = createFieldReportText(shareFeatures, code);
      try {
        await navigator.clipboard.writeText(report);
        setStatus(status.replace("Copied atlas share code", "Copied field report for Atlas code"));
        closeShareDialog();
      } catch (error) {
        window.prompt("Copy this field report.", report);
        setStatus("Field report ready to copy");
        closeShareDialog();
      }
    } catch (error) {
      console.error(error);
      elements.shareStatus.textContent = "Could not create a field report for those entries.";
    } finally {
      setShareBusy(false);
    }
  }

  async function createShareCodeForFeatures(features) {
    if (isSupabaseConfigured()) {
      try {
        const code = await uploadShareCode(features);
        return {
          code,
          status: `Copied atlas share code ${code} (${features.length} ${features.length === 1 ? "entry" : "entries"})`,
        };
      } catch (error) {
        console.error("Could not upload share code", error);
        const codes = encodeShareCodes(features);
        const partText = codes.length === 1 ? "1 fallback code" : `${codes.length} fallback codes`;
        return {
          code: codes.join("\n"),
          status: `Supabase upload failed; copied ${partText}`,
        };
      }
    }

    const codes = encodeShareCodes(features);
    const partText = codes.length === 1 ? "1 fallback code" : `${codes.length} fallback codes`;
    return {
      code: codes.join("\n"),
      status: `Supabase anon key missing; copied ${partText} for atlas data`,
    };
  }

  function createFieldReportText(features, code) {
    const summary = summarizeAtlasFeatures(features);
    const entryLines = features
      .slice()
      .sort(compareFeaturesForList)
      .slice(0, 8)
      .map((feature) => `- ${featureReportLabel(feature)}`);
    const remaining = Math.max(0, features.length - entryLines.length);
    if (remaining) {
      entryLines.push(`- ${remaining} more ${remaining === 1 ? "entry" : "entries"}`);
    }

    return [
      "Field Atlas Report",
      `Entries: ${summary.typeText}`,
      `Categories: ${summary.categoryText}`,
      `Confidence: ${summary.confidenceText}`,
      `Mapped by: ${summary.creatorText}`,
      code.includes("\n") ? "Atlas code:" : `Atlas code: ${code}`,
      code.includes("\n") ? code : "",
      "",
      "Included entries:",
      ...entryLines,
      "",
      "Paste the Atlas code into Receive Atlas to merge these mapped entries.",
    ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n");
  }

  function summarizeAtlasFeatures(features) {
    const typeCounts = countBy(features, (feature) => feature.type);
    const categoryCounts = countFeatureCategories(features);
    const confidenceCounts = countBy(features, (feature) => titleCase(feature.confidence || "scouted"));
    const creators = Array.from(new Set(features.map((feature) => feature.creator).filter(Boolean))).sort((a, b) => a.localeCompare(b));

    return {
      typeText: [
        `${typeCounts.marker || 0} ${typeCounts.marker === 1 ? "mark" : "marks"}`,
        `${typeCounts.route || 0} ${typeCounts.route === 1 ? "trail" : "trails"}`,
        `${typeCounts.range || 0} ${typeCounts.range === 1 ? "range" : "ranges"}`,
      ].join(", "),
      categoryText: formatCountList(categoryCounts),
      confidenceText: formatCountList(confidenceCounts),
      creatorText: creators.length ? creators.slice(0, 5).join(", ") + (creators.length > 5 ? `, and ${creators.length - 5} more` : "") : "Unsigned",
    };
  }

  function featureReportLabel(feature) {
    const category = categoryById[feature.category] || categoryById.landmark;
    const title = feature.title || category.label;
    const confidence = feature.confidence ? `, ${feature.confidence}` : "";
    const creator = feature.creator ? `, by ${feature.creator}` : "";
    return `${getFeatureCategoryLabel(feature)}: ${title} (${featureTypeLabel(feature.type)}${confidence}${creator})`;
  }

  function countFeatureCategories(features) {
    return features.reduce((counts, feature) => {
      getFeatureCategories(feature).forEach((categoryId) => {
        const label = (categoryById[categoryId] || categoryById.landmark).label;
        counts[label] = (counts[label] || 0) + 1;
      });
      return counts;
    }, {});
  }

  function featureTypeLabel(type) {
    if (type === "marker") {
      return "mark";
    }
    if (type === "route") {
      return "trail";
    }
    if (type === "range") {
      return "range";
    }
    return type || "entry";
  }

  function countBy(items, keyForItem) {
    return items.reduce((counts, item) => {
      const key = keyForItem(item);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }

  function formatCountList(counts) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return entries.length ? entries.map(([label, count]) => `${label} ${count}`).join(", ") : "None";
  }

  function titleCase(value) {
    return String(value || "")
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  function getShareableFeatures() {
    return state.features.filter((feature) => !isDefaultFeature(feature) && !isCanonFeature(feature));
  }

  function getSelectedShareFeatures() {
    const selectedIds = new Set(
      Array.from(elements.shareEntryList.querySelectorAll(".share-entry-checkbox:checked")).map((input) => input.value),
    );
    return getShareableFeatures().filter((feature) => selectedIds.has(feature.id));
  }

  function setShareEntryChecks(checked) {
    elements.shareEntryList.querySelectorAll(".share-entry-checkbox").forEach((input) => {
      input.checked = checked;
    });
    updateShareDialogState();
  }

  function updateShareDialogState() {
    const selectedCount = elements.shareEntryList.querySelectorAll(".share-entry-checkbox:checked").length;
    const totalCount = elements.shareEntryList.querySelectorAll(".share-entry-checkbox").length;
    elements.shareSummary.textContent = `${selectedCount} of ${totalCount} ${totalCount === 1 ? "entry" : "entries"} selected. Printed cities and towns are not included.`;
    elements.shareCopyBtn.disabled = selectedCount === 0;
    elements.shareReportBtn.disabled = selectedCount === 0;
  }

  function setShareBusy(busy) {
    elements.shareEntryList.querySelectorAll("input").forEach((input) => {
      input.disabled = busy;
    });
    elements.shareCopyBtn.disabled = busy || !elements.shareEntryList.querySelector(".share-entry-checkbox:checked");
    elements.shareReportBtn.disabled = busy || !elements.shareEntryList.querySelector(".share-entry-checkbox:checked");
    elements.shareCancelBtn.disabled = busy;
    elements.shareKeepBtn.disabled = busy;
    elements.shareSelectAllBtn.disabled = busy;
    elements.shareSelectNoneBtn.disabled = busy;
  }

  function openGuildPublishDialog() {
    const publishFeatures = getGuildPublishFeatures();
    elements.guildPassphraseInput.value = "";
    elements.guildPublishStatus.textContent = "";
    elements.guildEntryList.innerHTML = "";
    publishFeatures
      .slice()
      .sort(compareFeaturesForList)
      .forEach((feature) => {
        const category = categoryById[feature.category] || categoryById.landmark;
        const label = document.createElement("label");
        label.className = "share-entry-row";
        label.innerHTML = `
          <input class="guild-entry-checkbox" type="checkbox" value="${escapeHtml(feature.id)}" checked />
          <span class="share-entry-main">
            <span class="share-entry-title">${escapeHtml(feature.title || category.label)}</span>
            <span class="share-entry-meta">
              <i class="swatch" style="${getFeatureSwatchStyle(feature)}" aria-hidden="true"></i>
              ${escapeHtml(getFeatureCategoryLabel(feature))}
              ${isGuildFeature(feature) ? '<span class="source-badge">Guild</span>' : ""}
              ${feature.creator ? `<span>Mapped by ${escapeHtml(feature.creator)}</span>` : ""}
            </span>
          </span>
        `;
        elements.guildEntryList.appendChild(label);
      });
    elements.guildPublishDialog.showModal();
    updateGuildPublishDialogState();
    window.setTimeout(() => elements.guildPassphraseInput.focus(), 0);
  }

  function closeGuildPublishDialog() {
    elements.guildPublishDialog.close();
    elements.guildPassphraseInput.value = "";
    elements.guildPublishStatus.textContent = "";
  }

  async function publishGuildAtlas() {
    const passphrase = elements.guildPassphraseInput.value.trim();
    const publishFeatures = getSelectedGuildPublishFeatures();
    if (!passphrase) {
      elements.guildPublishStatus.textContent = "Enter the Marshal passphrase.";
      return;
    }
    if (!publishFeatures.length) {
      elements.guildPublishStatus.textContent = "There are no entries to publish.";
      return;
    }
    if (!isSupabaseConfigured()) {
      elements.guildPublishStatus.textContent = "Supabase anon key missing; cannot publish.";
      return;
    }

    setGuildPublishBusy(true);
    elements.guildPublishStatus.textContent = "Publishing official Guild Atlas...";
    try {
      const payload = createCompactSharePayload(publishFeatures);
      const result = await callSupabaseRpc("publish_guild_atlas", {
        atlas_code: GUILD_ATLAS_CODE,
        share_payload: payload,
        admin_passphrase: passphrase,
        publisher: getCurrentCreatorName(),
      });
      const guildFeatures = markFeaturesAsGuild(publishFeatures);
      pushUndo("guild atlas publish");
      state.features = replaceGuildFeatures(state.features, guildFeatures);
      state.guildAtlasUpdatedAt = typeof result.updated_at === "string" ? result.updated_at : state.guildAtlasUpdatedAt;
      state.guildAtlasLocalChanges = false;
      state.selectedId = null;
      state.selectedIds = [];
      saveState();
      renderAll();
      closeGuildPublishDialog();
      setStatus(`Published ${result.entry_count || guildFeatures.length} official Guild Atlas entries`);
    } catch (error) {
      console.error(error);
      elements.guildPublishStatus.textContent = "Publish failed. Check the passphrase and Supabase setup.";
    } finally {
      setGuildPublishBusy(false);
    }
  }

  async function recoverAllAtlasEntries() {
    const passphrase = elements.guildPassphraseInput.value.trim();
    if (!passphrase) {
      elements.guildPublishStatus.textContent = "Enter the Marshal passphrase.";
      return;
    }
    if (!isSupabaseConfigured()) {
      elements.guildPublishStatus.textContent = "Supabase anon key missing; cannot recover the archive.";
      return;
    }

    setGuildPublishBusy(true);
    elements.guildPublishStatus.textContent = "Recovering archived atlas entries...";
    try {
      const payload = await callSupabaseRpc("get_all_atlas_entries", {
        admin_passphrase: passphrase,
      });
      const imported = decodeStoredSharePayload(payload);
      const recoveredFeatures = markFeaturesAsPersonal(
        normalizeFeatures(imported.features.filter(isValidFeature), imported.map).filter((feature) => !isDefaultFeature(feature)),
      );
      if (!recoveredFeatures.length) {
        elements.guildPublishStatus.textContent = "The archive does not contain any entries yet.";
        return;
      }

      const summary = summarizeIncomingFeatures(recoveredFeatures);
      pushUndo("recover atlas archive");
      state.features = mergePersonalFeatures(state.features, recoveredFeatures);
      state.selectedId = null;
      state.selectedIds = [];
      resetViewFilters();
      saveState();
      renderAll();
      closeGuildPublishDialog();
      setStatus(`Recovered ${recoveredFeatures.length} archived entries${summary.duplicateCount ? `; ${summary.duplicateCount} already existed locally` : ""}`);
    } catch (error) {
      console.error(error);
      elements.guildPublishStatus.textContent = "Recovery failed. Check the passphrase and make sure the archive migration has run.";
    } finally {
      setGuildPublishBusy(false);
    }
  }

  function setGuildPublishBusy(busy) {
    elements.guildEntryList.querySelectorAll("input").forEach((input) => {
      input.disabled = busy;
    });
    elements.guildPassphraseInput.disabled = busy;
    elements.guildPublishConfirmBtn.disabled = busy || !elements.guildEntryList.querySelector(".guild-entry-checkbox:checked");
    elements.guildRecoverAllBtn.disabled = busy;
    elements.guildPublishCancelBtn.disabled = busy;
    elements.guildPublishKeepBtn.disabled = busy;
    elements.guildSelectAllBtn.disabled = busy;
    elements.guildSelectNoneBtn.disabled = busy;
  }

  async function fetchGuildAtlas(code) {
    const atlas = await callSupabaseRpc("get_guild_atlas", { atlas_code: code });
    if (!atlas || !atlas.payload) {
      throw new Error("Guild Atlas not found");
    }
    return atlas;
  }

  async function refreshOfficialGuildAtlas({ force = false } = {}) {
    if (!isSupabaseConfigured() || guildAtlasRefreshInFlight) {
      return;
    }
    if (!force && Date.now() - guildAtlasLastCheckedAt < GUILD_ATLAS_CHECK_COOLDOWN_MS) {
      return;
    }

    guildAtlasLastCheckedAt = Date.now();
    guildAtlasRefreshInFlight = true;
    try {
      const guildAtlas = await fetchGuildAtlas(GUILD_ATLAS_CODE);
      const remoteUpdatedAt = typeof guildAtlas.updated_at === "string" ? guildAtlas.updated_at : "";
      if (!force && remoteUpdatedAt && remoteUpdatedAt === state.guildAtlasUpdatedAt) {
        return;
      }
      if (!force && state.guildAtlasLocalChanges) {
        console.warn("Official GUILD Atlas changed while local official edits are waiting to be published.");
        return;
      }

      const guildFeatures = getGuildFeaturesFromResponse(guildAtlas);
      state.features = replaceGuildFeatures(state.features, guildFeatures);
      state.guildAtlasUpdatedAt = remoteUpdatedAt;
      state.guildAtlasLocalChanges = false;
      if (state.selectedId && !state.features.some((feature) => feature.id === state.selectedId)) {
        state.selectedId = null;
        state.selectedIds = [];
      }
      saveState();
      renderAll();
      updateMapDensity();
      void syncNativeTrailmarks(true);
      setStatus("Official GUILD Atlas updated");
    } catch (error) {
      console.warn("Could not refresh the official GUILD Atlas", error);
    } finally {
      guildAtlasRefreshInFlight = false;
    }
  }

  async function fetchSkyrimAtlas() {
    const response = await fetch(SKYRIM_ATLAS_DATA, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Skyrim Atlas data failed: ${response.status}`);
    }
    return response.json();
  }

  function getGuildFeaturesFromResponse(guildAtlas) {
    const imported = decodeStoredSharePayload(guildAtlas.payload);
    if (!Array.isArray(imported.features)) {
      throw new Error("Guild Atlas payload is missing features");
    }
    return markFeaturesAsGuild(normalizeFeatures(imported.features.filter(isValidFeature), imported.map).filter((feature) => !isDefaultFeature(feature)));
  }

  function getSkyrimFeaturesFromResponse(imported) {
    if (!Array.isArray(imported.features)) {
      throw new Error("Skyrim Atlas payload is missing features");
    }
    return markFeaturesAsCanon(normalizeFeatures(imported.features.filter(isValidFeature), imported.map));
  }

  function getGuildPublishFeatures() {
    return state.features.filter((feature) => !isDefaultFeature(feature) && !isCanonFeature(feature)).map(cloneFeature);
  }

  function getSelectedGuildPublishFeatures() {
    const selectedIds = new Set(
      Array.from(elements.guildEntryList.querySelectorAll(".guild-entry-checkbox:checked")).map((input) => input.value),
    );
    return getGuildPublishFeatures().filter((feature) => selectedIds.has(feature.id));
  }

  function setGuildEntryChecks(checked) {
    elements.guildEntryList.querySelectorAll(".guild-entry-checkbox").forEach((input) => {
      input.checked = checked;
    });
    updateGuildPublishDialogState();
  }

  function updateGuildPublishDialogState() {
    const selectedCount = elements.guildEntryList.querySelectorAll(".guild-entry-checkbox:checked").length;
    const totalCount = elements.guildEntryList.querySelectorAll(".guild-entry-checkbox").length;
    elements.guildPublishSummary.textContent = totalCount
      ? `${selectedCount} of ${totalCount} ${totalCount === 1 ? "entry" : "entries"} selected for official Guild Atlas ${GUILD_ATLAS_CODE}.`
      : "There are no non-default entries to publish.";
    elements.guildPublishConfirmBtn.disabled = selectedCount === 0;
  }

  function markFeaturesAsGuild(features) {
    return features.map((feature) => ({
      ...cloneFeature(feature),
      source: "guild",
    }));
  }

  function markFeaturesAsCanon(features) {
    return features.map((feature) => ({
      ...cloneFeature(feature),
      source: "canon",
    }));
  }

  function markFeaturesAsPersonal(features) {
    return features.map((feature) => ({
      ...cloneFeature(feature),
      source: "personal",
    }));
  }

  function replaceGuildFeatures(current, guildFeatures) {
    const guildIds = new Set(guildFeatures.map((feature) => feature.id));
    const preserved = current.filter((feature) => !isGuildFeature(feature) && !guildIds.has(feature.id));
    return applyDefaultFeatures(preserved.concat(guildFeatures));
  }

  function replaceCanonFeatures(current, canonFeatures) {
    const canonIds = new Set(canonFeatures.map((feature) => feature.id));
    const preserved = current.filter((feature) => !isCanonFeature(feature) && !canonIds.has(feature.id));
    return applyDefaultFeatures(preserved.concat(canonFeatures));
  }

  function summarizeIncomingFeatures(features) {
    const existingIds = new Set(state.features.map((feature) => feature.id));
    const customCount = state.features.filter(isPersonalFeature).length;
    const uniqueCreators = Array.from(new Set(features.map((feature) => feature.creator).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    const typeCounts = features.reduce(
      (counts, feature) => {
        counts[feature.type] = (counts[feature.type] || 0) + 1;
        return counts;
      },
      { marker: 0, route: 0, range: 0 },
    );
    const duplicateCount = features.filter((feature) => existingIds.has(feature.id)).length;
    return {
      customCount,
      duplicateCount,
      features,
      newCount: features.length - duplicateCount,
      typeCounts,
      uniqueCreators,
    };
  }

  function renderReceivePreview(summary) {
    const typeText = [
      `${summary.typeCounts.marker || 0} marks`,
      `${summary.typeCounts.route || 0} trails`,
      `${summary.typeCounts.range || 0} ranges`,
    ].join(", ");
    const creatorText = summary.uniqueCreators.length
      ? summary.uniqueCreators.slice(0, 4).join(", ") + (summary.uniqueCreators.length > 4 ? `, and ${summary.uniqueCreators.length - 4} more` : "")
      : "Unsigned";
    const sourceLabel = summary.isGuildCode ? "Official GUILD Atlas" : summary.isSkyrimCode ? "Skyrim Locations" : "Shared Atlas Code";
    const sourceNote = summary.isGuildCode
      ? "Official entries will be refreshed. Personal notes and Skyrim references will stay."
      : summary.isSkyrimCode
        ? "Skyrim reference markers will be refreshed. Ranger and GUILD entries will stay."
        : "Adding keeps your current entries. Replacing removes your personal entries first.";
    return `
      <div class="receive-preview-heading">
        <span>Preview ready</span>
        <strong>${escapeHtml(sourceLabel)}</strong>
      </div>
      <div class="receive-preview-facts">
        <span><strong>${summary.features.length}</strong> total</span>
        <span><strong>${summary.newCount}</strong> new</span>
        <span><strong>${summary.duplicateCount}</strong> already present</span>
      </div>
      <span class="receive-preview-detail">${escapeHtml(typeText)}</span>
      <span class="receive-preview-detail">Mapped by: ${escapeHtml(creatorText)}</span>
      <p>${escapeHtml(sourceNote)}</p>
    `;
  }

  function openReceiveDialog() {
    elements.receiveCodeInput.value = "";
    elements.receiveStatus.textContent = "";
    resetReceivePreview();
    elements.receiveDialog.showModal();
  }

  function closeReceiveDialog() {
    resetReceivePreview();
    elements.receiveDialog.close();
  }

  function resetReceivePreview() {
    state.pendingReceive = null;
    elements.receivePreview.hidden = true;
    elements.receivePreview.innerHTML = "";
    elements.receiveActions.hidden = true;
    elements.receiveActionHelp.textContent = "";
    elements.receiveMergeBtn.textContent = "Add to My Atlas";
    elements.receiveReplaceBtn.hidden = false;
    elements.receiveReplaceBtn.textContent = "Replace My Entries";
    elements.receiveMergeBtn.disabled = true;
    elements.receiveReplaceBtn.disabled = true;
    elements.receiveStatus.textContent = "";
  }

  function reviewGuildAtlasCode() {
    resetReceivePreview();
    reviewReceiveCode(GUILD_ATLAS_CODE);
  }

  function reviewSkyrimAtlasCode() {
    resetReceivePreview();
    reviewReceiveCode(SKYRIM_ATLAS_CODE);
  }

  async function reviewReceiveCode(sourceCode = "") {
    const code = sourceCode || elements.receiveCodeInput.value.trim();
    if (!code) {
      elements.receiveStatus.textContent = "Paste a share code first.";
      return;
    }

    setReceiveBusy(true);
    elements.receiveStatus.textContent = "Reading shared atlas...";
    try {
      const normalizedCode = normalizeRemoteShareCode(code);
      const isGuildCode = normalizedCode === GUILD_ATLAS_CODE;
      const isSkyrimCode = normalizedCode === SKYRIM_ATLAS_CODE || normalizedCode === "CANON";
      const imported = isGuildCode ? await fetchGuildAtlas(GUILD_ATLAS_CODE) : isSkyrimCode ? await fetchSkyrimAtlas() : await resolveShareInput(code);
      if (!isGuildCode && !Array.isArray(imported.features)) {
        throw new Error("Missing features array");
      }
      const nextFeatures = isGuildCode
        ? getGuildFeaturesFromResponse(imported)
        : isSkyrimCode
          ? getSkyrimFeaturesFromResponse(imported)
        : normalizeFeatures(imported.features.filter(isValidFeature), imported.map).filter((feature) => !isDefaultFeature(feature));
      if (!nextFeatures.length) {
        resetReceivePreview();
        elements.receiveStatus.textContent = isGuildCode
          ? "The Guild Atlas has no entries yet."
          : isSkyrimCode
            ? "The Skyrim reference atlas has no locations yet."
          : "That code has no custom entries to import.";
        return;
      }
      const summary = summarizeIncomingFeatures(nextFeatures);
      summary.isGuildCode = isGuildCode;
      summary.isSkyrimCode = isSkyrimCode;
      state.pendingReceive = {
        features: nextFeatures,
        isGuildCode,
        isSkyrimCode,
        summary,
        updatedAt: isGuildCode && typeof imported.updated_at === "string" ? imported.updated_at : "",
      };
      elements.receivePreview.hidden = false;
      elements.receivePreview.innerHTML = renderReceivePreview(summary);
      elements.receiveActions.hidden = false;
      elements.receiveMergeBtn.textContent = isGuildCode ? "Update Official Entries" : isSkyrimCode ? "Refresh Skyrim References" : "Add to My Atlas";
      elements.receiveReplaceBtn.hidden = isGuildCode || isSkyrimCode;
      elements.receiveMergeBtn.disabled = false;
      elements.receiveReplaceBtn.disabled = isGuildCode || isSkyrimCode;
      elements.receiveActionHelp.textContent = isGuildCode
        ? "This updates only entries from the official GUILD Atlas. Your own entries stay."
        : isSkyrimCode
          ? "This refreshes Skyrim reference markers without changing Ranger entries."
          : `Add keeps your current entries. Replace removes your ${summary.customCount} personal ${summary.customCount === 1 ? "entry" : "entries"} first.`;
      elements.receiveStatus.textContent = "";
    } catch (error) {
      console.error(error);
      resetReceivePreview();
      elements.receiveStatus.textContent = "That code could not be read. Check that every part was pasted correctly.";
    } finally {
      setReceiveBusy(false, true);
    }
  }

  async function receiveShareCode(replace) {
    if (!state.pendingReceive) {
      elements.receiveStatus.textContent = "Review the code before importing it.";
      return;
    }

    setReceiveBusy(true);
    elements.receiveStatus.textContent = replace ? "Replacing your custom entries..." : "Merging new entries...";

    try {
      const nextFeatures = state.pendingReceive.features;
      const summary = state.pendingReceive.summary;
      pushUndo(replace ? "receive code replace" : "receive code merge");
      if (state.pendingReceive.isGuildCode) {
        state.features = replaceGuildFeatures(state.features, nextFeatures);
        state.guildAtlasUpdatedAt = state.pendingReceive.updatedAt || state.guildAtlasUpdatedAt;
        state.guildAtlasLocalChanges = false;
        state.selectedId = null;
        state.selectedIds = [];
        resetViewFilters();
        saveState();
        renderAll();
        closeReceiveDialog();
        setStatus(`Loaded ${nextFeatures.length} official Guild Atlas entries`);
        return;
      }
      if (state.pendingReceive.isSkyrimCode) {
        state.features = replaceCanonFeatures(state.features, nextFeatures);
        state.selectedId = null;
        state.selectedIds = [];
        resetViewFilters();
        saveState();
        renderAll();
        closeReceiveDialog();
        setStatus(`Loaded ${nextFeatures.length} Skyrim reference locations`);
        return;
      }
      const personalIncoming = markFeaturesAsPersonal(nextFeatures);
      state.features = replace
        ? replacePersonalFeatures(state.features, personalIncoming)
        : mergePersonalFeatures(state.features, personalIncoming);
      state.selectedId = null;
      state.selectedIds = [];
      resetViewFilters();
      saveState();
      renderAll();
      closeReceiveDialog();
      setStatus(replace ? `Replaced personal entries with ${nextFeatures.length} received entries` : `Merged ${summary.newCount} new personal entries${summary.duplicateCount ? `; ${summary.duplicateCount} already present` : ""}`);
    } catch (error) {
      console.error(error);
      elements.receiveStatus.textContent = "That code could not be read. Check that every part was pasted correctly.";
    } finally {
      setReceiveBusy(false);
    }
  }

  function setReceiveBusy(busy, keepImportDisabled = false) {
    elements.receiveCodeInput.disabled = busy;
    elements.receiveGuildBtn.disabled = busy;
    elements.receiveSkyrimBtn.disabled = busy;
    elements.receiveReviewBtn.disabled = busy;
    elements.receiveMergeBtn.disabled = busy || (!state.pendingReceive && keepImportDisabled);
    elements.receiveReplaceBtn.disabled = busy || (!state.pendingReceive && keepImportDisabled);
    elements.receiveCancelBtn.disabled = busy;
  }

  function resetViewFilters() {
    state.search = "";
    state.creatorFilter = "";
    categories.forEach((category) => {
      state.filters[category.id] = true;
    });
    syncViewInputsFromState();
    renderFilters();
  }

  function syncViewInputsFromState() {
    elements.searchInput.value = state.search;
    elements.creatorFilterInput.value = state.creatorFilter;
  }

  function clearRestoredSearchInput() {
    if (state.search || document.activeElement === elements.searchInput) {
      return;
    }
    if (elements.searchInput.value) {
      elements.searchInput.value = "";
      renderAll();
    }
  }

  function shouldRejectSearchAutofill(value) {
    if (Date.now() > searchAutofillGuardUntil) {
      return false;
    }
    try {
      if (elements.searchInput.matches && elements.searchInput.matches(":-webkit-autofill")) {
        return true;
      }
    } catch (_error) {
      // Ignore unsupported autofill pseudo-selectors.
    }
    const searchValue = normalizeCreatorName(value).toLowerCase();
    const signedAs = normalizeCreatorName(state.creatorName).toLowerCase();
    return Boolean(searchValue && signedAs && searchValue === signedAs);
  }

  function hasActiveViewFilters() {
    return Boolean(
      state.search ||
        state.creatorFilter ||
        categories.some((category) => state.filters[category.id] === false),
    );
  }

  function openClearDialog() {
    elements.clearScopeInputs.forEach((input) => {
      input.checked = input.value === "custom";
    });
    renderClearCategories();
    elements.clearDialog.showModal();
  }

  function renderClearCategories() {
    const clearFeatures = getClearEligibleFeatures();
    const countsByCategory = clearFeatures.reduce((counts, feature) => {
      getFeatureCategories(feature).forEach((categoryId) => {
        counts[categoryId] = (counts[categoryId] || 0) + 1;
      });
      return counts;
    }, {});
    elements.clearCategoryList.innerHTML = "";
    categories
      .filter((category) => countsByCategory[category.id])
      .forEach((category) => {
        const label = document.createElement("label");
        label.className = "check-row";
        label.innerHTML = `
          <span>
            <i class="swatch" style="background:${category.color}" aria-hidden="true"></i>
            ${escapeHtml(category.label)} (${countsByCategory[category.id]})
          </span>
          <input class="clear-category-checkbox" type="checkbox" value="${escapeHtml(category.id)}" checked />
        `;
        elements.clearCategoryList.appendChild(label);
      });
    updateClearDialogState();
  }

  function clearAtlas() {
    const selectedCategories = getSelectedClearCategories();
    const clearScope = getClearScope();
    const featuresToRemove = state.features.filter(
      (feature) => shouldClearFeature(feature, clearScope) && featureHasAnyCategory(feature, selectedCategories),
    );
    if (!featuresToRemove.length) {
      return;
    }

    pushUndo(`scrape ${clearScope} categories`);
    state.features = state.features.filter(
      (feature) => !(shouldClearFeature(feature, clearScope) && featureHasAnyCategory(feature, selectedCategories)),
    );
    state.selectedId = null;
    state.selectedIds = [];
    saveState();
    renderAll();
    elements.clearDialog.close();
    setStatus(`${featuresToRemove.length} ${featuresToRemove.length === 1 ? "entry" : "entries"} scraped`);
  }

  function getSelectedClearCategories() {
    return new Set(
      Array.from(elements.clearCategoryList.querySelectorAll(".clear-category-checkbox:checked")).map((input) => input.value),
    );
  }

  function setClearCategoryChecks(checked) {
    elements.clearCategoryList.querySelectorAll(".clear-category-checkbox").forEach((input) => {
      input.checked = checked;
    });
    updateClearDialogState();
  }

  function updateClearDialogState() {
    const selectedCategories = getSelectedClearCategories();
    const clearScope = getClearScope();
    const selectedFeatures = state.features.filter(
      (feature) => shouldClearFeature(feature, clearScope) && featureHasAnyCategory(feature, selectedCategories),
    );
    const eligibleFeatures = getClearEligibleFeatures(clearScope);
    const categoryCount = selectedCategories.size;
    const scopeLabel = getClearScopeLabel(clearScope);
    elements.clearSummary.textContent = selectedFeatures.length
      ? `${selectedFeatures.length} ${scopeLabel} ${selectedFeatures.length === 1 ? "entry" : "entries"} across ${categoryCount} ${categoryCount === 1 ? "category" : "categories"} will be removed from this browser.`
      : eligibleFeatures.length
        ? "Select at least one category to scrape."
        : `No ${scopeLabel} entries are currently on this atlas.`;
    elements.clearConfirmBtn.textContent = selectedFeatures.length
      ? `Scrape ${selectedFeatures.length} ${selectedFeatures.length === 1 ? "Entry" : "Entries"}`
      : "Scrape Selected Categories";
    elements.clearConfirmBtn.disabled = selectedFeatures.length === 0;
  }

  function getClearScope() {
    const selected = elements.clearScopeInputs.find((input) => input.checked);
    return selected ? selected.value : "custom";
  }

  function getClearScopeLabel(scope = getClearScope()) {
    if (scope === "skyrim") {
      return "Skyrim reference";
    }
    if (scope === "all") {
      return "map";
    }
    return "custom/Guild";
  }

  function getClearEligibleFeatures(scope = getClearScope()) {
    return state.features.filter((feature) => shouldClearFeature(feature, scope));
  }

  function shouldClearFeature(feature, scope = getClearScope()) {
    if (scope === "skyrim") {
      return isCanonFeature(feature);
    }
    if (scope === "all") {
      return true;
    }
    return !isDefaultFeature(feature) && !isCanonFeature(feature);
  }

  function isSupabaseConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  async function uploadShareCode(features) {
    const payload = createCompactSharePayload(features);
    const code = await callSupabaseRpc("create_atlas_share", { share_payload: payload });
    if (typeof code !== "string" || !code.trim()) {
      throw new Error("Supabase did not return a share code");
    }
    return code.trim().toUpperCase();
  }

  async function resolveShareInput(input) {
    if (input.startsWith("{") || input.startsWith(SHARE_CODE_PREFIX) || input.startsWith(LEGACY_GUILD_SHARE_CODE_PREFIX) || input.startsWith(LEGACY_CORPS_SHARE_CODE_PREFIX)) {
      return decodeShareCodes(input);
    }

    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is not configured");
    }

    const shareCode = normalizeRemoteShareCode(input);
    if (!shareCode) {
      throw new Error("Invalid share code");
    }

    const payload = await callSupabaseRpc("get_atlas_share", { share_code: shareCode });
    if (!payload) {
      throw new Error("Share code not found");
    }
    return decodeStoredSharePayload(payload);
  }

  async function callSupabaseRpc(functionName, body) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let details = "";
      try {
        const payload = await response.json();
        details = payload.message || payload.error || payload.hint || "";
      } catch (error) {
        details = "";
      }
      throw new Error(details || `Supabase ${functionName} failed: ${response.status}`);
    }

    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  function getReadableError(error, fallback) {
    const message = error instanceof Error ? error.message.trim() : "";
    return message && message.length <= 180 ? message : fallback;
  }

  function normalizeRemoteShareCode(value) {
    const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^[A-Z0-9]{4,24}$/.test(normalized) ? normalized : "";
  }

  function encodeShareCodes(features) {
    const payload = createCompactSharePayload(features);
    const body = encodeBase64Url(JSON.stringify(payload));
    const singleCode = `${SHARE_CODE_PREFIX}${body}`;
    if (singleCode.length <= SHARE_CODE_MAX_LENGTH) {
      return [singleCode];
    }

    const chunks = [];
    for (let index = 0; index < body.length; index += SHARE_CODE_CHUNK_SIZE) {
      chunks.push(body.slice(index, index + SHARE_CODE_CHUNK_SIZE));
    }

    return chunks.map((chunk, index) => {
      const code = `${SHARE_CODE_PREFIX}${index.toString(36)}.${chunks.length.toString(36)}.${chunk}`;
      if (code.length > SHARE_CODE_MAX_LENGTH) {
        throw new Error("Share code chunk exceeded maximum length");
      }
      return code;
    });
  }

  function decodeShareCodes(input) {
    if (input.startsWith("{")) {
      return JSON.parse(input);
    }

    const codes = input
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!codes.length) {
      throw new Error("Missing share code");
    }

    if (codes.length === 1 && isLegacyShareCode(codes[0])) {
      return decodeLegacyShareCode(codes[0]);
    }

    const compactCodes = codes.filter((code) => code.startsWith(SHARE_CODE_PREFIX));
    if (compactCodes.length !== codes.length) {
      throw new Error("Mixed or unknown share code prefixes");
    }

    if (compactCodes.length === 1) {
      const parts = compactCodes[0].split(".");
      if (parts.length === 2) {
        return decodeCompactPayload(decodeBase64Url(parts[1]));
      }
    }

    const chunks = compactCodes.map((code) => {
      const parts = code.split(".");
      if (parts.length !== 4 || `${parts[0]}.` !== SHARE_CODE_PREFIX) {
        throw new Error("Invalid share code part");
      }
      return {
        body: parts[3],
        index: Number.parseInt(parts[1], 36),
        total: Number.parseInt(parts[2], 36),
      };
    });
    const total = chunks[0].total;
    const indexes = new Set(chunks.map((chunk) => chunk.index));
    if (!Number.isFinite(total) || chunks.some((chunk) => chunk.total !== total) || indexes.size !== total) {
      throw new Error("Missing share code parts");
    }

    const body = chunks
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((chunk) => chunk.body)
      .join("");
    return decodeCompactPayload(decodeBase64Url(body));
  }

  function isLegacyShareCode(code) {
    return code.startsWith(LEGACY_GUILD_SHARE_CODE_PREFIX) || code.startsWith(LEGACY_CORPS_SHARE_CODE_PREFIX);
  }

  function decodeLegacyShareCode(code) {
    const prefix = code.startsWith(LEGACY_GUILD_SHARE_CODE_PREFIX)
      ? LEGACY_GUILD_SHARE_CODE_PREFIX
      : code.startsWith(LEGACY_CORPS_SHARE_CODE_PREFIX)
        ? LEGACY_CORPS_SHARE_CODE_PREFIX
        : "";

    if (!prefix) {
      throw new Error("Unknown share code prefix");
    }

    return JSON.parse(decodeBase64Url(code.slice(prefix.length)));
  }

  function createCompactSharePayload(features) {
    return {
      v: 2,
      w: MAP_WIDTH,
      h: MAP_HEIGHT,
      f: features.map(encodeCompactFeature),
    };
  }

  function decodeStoredSharePayload(payload) {
    if (payload && payload.v === 2 && Array.isArray(payload.f)) {
      return decodeCompactPayloadObject(payload);
    }
    return payload;
  }

  function encodeBase64Url(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeBase64Url(value) {
    const body = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = body.padEnd(body.length + ((4 - (body.length % 4)) % 4), "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function encodeCompactFeature(feature) {
    return [
      encodeFeatureId(feature.id),
      typeCodes[feature.type] || feature.type,
      categoryCodes[feature.category] || feature.category,
      feature.title || "",
      confidenceCodes[feature.confidence] || feature.confidence || "s",
      feature.notes || "",
      flattenPoints(feature.points),
      encodeDate(feature.createdAt),
      encodeDate(feature.updatedAt),
      feature.creator || "",
      feature.updatedBy || "",
      feature.type === "range" || feature.type === "route" ? normalizeHexColor(feature.color) : "",
      getFeatureCategories(feature)
        .slice(1)
        .map((categoryId) => categoryCodes[categoryId] || categoryId),
    ];
  }

  function decodeCompactPayload(raw) {
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
      const point = feature.points[0];
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
