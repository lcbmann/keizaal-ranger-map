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
    search: "",
    creatorFilter: "",
    selectedId: null,
    selectedIds: [],
    mode: "select",
    creatorName: "",
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

  const featureLayer = L.layerGroup().addTo(map);
  const draftLayer = L.layerGroup().addTo(map);

  const elements = {
    toolButtons: Array.from(document.querySelectorAll(".tool-button")),
    aboutBtn: document.getElementById("aboutBtn"),
    aboutDialog: document.getElementById("aboutDialog"),
    aboutCloseBtn: document.getElementById("aboutCloseBtn"),
    helpBtn: document.getElementById("helpBtn"),
    helpDialog: document.getElementById("helpDialog"),
    helpCloseBtn: document.getElementById("helpCloseBtn"),
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
    guildPassphraseInput: document.getElementById("guildPassphraseInput"),
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
    editorForm: document.getElementById("editorForm"),
    featureId: document.getElementById("featureId"),
    titleInput: document.getElementById("titleInput"),
    categoryInput: document.getElementById("categoryInput"),
    additionalCategoriesField: document.getElementById("additionalCategoriesField"),
    additionalCategoriesInput: document.getElementById("additionalCategoriesInput"),
    confidenceInput: document.getElementById("confidenceInput"),
    rangeColorField: document.getElementById("rangeColorField"),
    rangeColorInput: document.getElementById("rangeColorInput"),
    creatorMeta: document.getElementById("creatorMeta"),
    notesInput: document.getElementById("notesInput"),
    saveFeatureBtn: document.getElementById("saveFeatureBtn"),
    deleteFeatureBtn: document.getElementById("deleteFeatureBtn"),
  };

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.label;
    elements.categoryInput.appendChild(option);
  });

  let lastDragEndedAt = 0;
  let suppressNextClickUntil = 0;
  let searchAutofillGuardUntil = Date.now() + 5000;

  init();

  function init() {
    prepareSearchInputAgainstAutofill();
    loadState();
    renderFilters();
    renderAll();
    bindEvents();
    updateMapDensity();
    syncViewInputsFromState();
    [0, 100, 500, 1500, 3000].forEach((delay) => window.setTimeout(clearRestoredSearchInput, delay));
    setStatus("Ready");
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
    elements.toolButtons.forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    elements.aboutBtn.addEventListener("click", () => elements.aboutDialog.showModal());
    elements.aboutCloseBtn.addEventListener("click", () => elements.aboutDialog.close());
    closeDialogOnBackdrop(elements.aboutDialog);
    elements.helpBtn.addEventListener("click", () => elements.helpDialog.showModal());
    elements.helpCloseBtn.addEventListener("click", () => elements.helpDialog.close());
    closeDialogOnBackdrop(elements.helpDialog);

    elements.undoBtn.addEventListener("click", undoLastAction);
    elements.guildAdminBtn.addEventListener("click", openGuildPublishDialog);
    elements.guildPublishConfirmBtn.addEventListener("click", publishGuildAtlas);
    elements.guildRecoverAllBtn.addEventListener("click", recoverAllAtlasEntries);
    elements.guildPublishCancelBtn.addEventListener("click", () => closeGuildPublishDialog());
    elements.guildPublishKeepBtn.addEventListener("click", () => closeGuildPublishDialog());
    elements.guildSelectAllBtn.addEventListener("click", () => setGuildEntryChecks(true));
    elements.guildSelectNoneBtn.addEventListener("click", () => setGuildEntryChecks(false));
    elements.guildEntryList.addEventListener("change", updateGuildPublishDialogState);
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
      state.creatorName = normalizeCreatorName(event.target.value);
      saveState();
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
    elements.categoryInput.addEventListener("change", () => {
      const additionalCategories = getAdditionalCategoryIds();
      renderAdditionalCategoryInputs(additionalCategories, false);
      syncDraftFromEditor();
    });
    elements.additionalCategoriesInput.addEventListener("change", syncDraftFromEditor);

    elements.editorForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveSelectedFeature();
    });

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
        if (state.drawPoints.length) {
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
      state.creatorName = normalizeCreatorName(saved.creatorName || "");
      elements.creatorInput.value = state.creatorName;
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
      creatorName: state.creatorName,
      features: state.features,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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

  function setMode(mode) {
    if (state.mode !== mode) {
      cancelDrawing(false, false);
    }
    state.mode = mode;
    map.dragging[mode === "route" || mode === "range" ? "disable" : "enable"]();
    map.getContainer().classList.toggle("is-drawing", mode === "route" || mode === "range");

    updateModeButtons();
    updateDrawButtons();

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

    const point = clampPoint(event.latlng);

    if (state.mode === "marker") {
      pushUndo("draft mark placement");
      state.draftFeature = createFeature({
        type: "marker",
        category: "landmark",
        title: "New mark",
        points: [point],
      });
      state.drawPoints = state.draftFeature.points.map((draftPoint) => ({ ...draftPoint }));
      state.selectedId = state.draftFeature.id;
      state.selectedIds = [state.draftFeature.id];
      updateDrawButtons();
      renderAll();
      renderDraft();
      setStatus("Draft mark placed. Add details, then use the checkmark beside it to save");
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

    addDrawPoint(clampPoint(event.latlng), 7);
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

    getVisibleFeatures()
      .slice()
      .sort(compareFeaturesForMap)
      .forEach((feature) => {
        const layer = createLayer(feature);
        if (layer) {
          featureLayer.addLayer(layer);
        }
      });

    renderFeatureList();
    renderEditor();
  }

  function createLayer(feature) {
    const category = categoryById[feature.category] || categoryById.landmark;
    const selected = isFeatureSelected(feature.id);

    if (feature.type === "marker") {
      const point = feature.points[0];
      const marker = L.marker([point.y, point.x], {
        zIndexOffset: getFeatureZIndexOffset(feature, selected),
        icon: L.divIcon({
          className: "",
          html: `<div class="poi-marker marker-${escapeHtml(feature.category)}${isGuildFeature(feature) ? " is-guild" : ""}${isCanonFeature(feature) ? " is-canon" : ""}${selected ? " is-selected" : ""}" style="--marker-color:${category.color}">${getCategoryIcon(feature.category)}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        }),
      });
      marker.on("click", (event) => selectFeature(feature.id, isAdditiveSelectionEvent(event.originalEvent)));
      marker.bindTooltip(getFeatureTooltip(feature, category), { direction: "top", offset: [0, -24] });
      return marker;
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
    return layer;
  }

  function createRouteLayer(latLngs, category, selected, feature) {
    const underlay = L.polyline(latLngs, {
      color: "#efe3c2",
      weight: selected ? 10 : 8,
      opacity: 0.55,
      lineCap: "round",
      lineJoin: "round",
    });
    const ink = L.polyline(latLngs, {
      color: category.color,
      weight: selected ? 4 : 3,
      opacity: selected ? 0.96 : 0.84,
      dashArray: "18 16 4 16",
      lineCap: "round",
      lineJoin: "round",
    });
    const group = L.layerGroup([underlay, ink]);
    [underlay, ink].forEach((layer) => {
      layer.on("click", (event) => selectFeature(feature.id, isAdditiveSelectionEvent(event.originalEvent)));
      layer.bindTooltip(getFeatureTooltip(feature, category));
    });
    return group;
  }

  function renderDraft() {
    draftLayer.clearLayers();

    if (!state.drawPoints.length && !state.draftFeature) {
      state.draftLayer = null;
      return;
    }

    const category = state.mode === "range" ? categoryById.range : categoryById.route;
    const latLngs = state.drawPoints.map((point) => [point.y, point.x]);

    if (state.mode === "marker") {
      const draft = getDraftFeature();
      const markerCategory = categoryById[draft.category] || categoryById.landmark;
      const point = draft.points[0];
      L.marker([point.y, point.x], {
        icon: L.divIcon({
          className: "",
          html: `<div class="poi-marker marker-${escapeHtml(draft.category)} is-draft" style="--marker-color:${markerCategory.color}">${getCategoryIcon(draft.category)}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        }),
      }).addTo(draftLayer);
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
      const layer =
        state.mode === "range"
          ? L.polygon(latLngs, {
              color: category.color,
              weight: 2.5,
              fillColor: category.color,
              fillOpacity: 0.14,
              dashArray: "8 10",
              lineCap: "round",
              lineJoin: "round",
            })
          : createRouteLayer(latLngs, category, true, {
              id: "draft",
              title: "Draft trail",
              category: "route",
            });
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
    if (state.mode === "marker") {
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
    if (state.mode === "marker") {
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
            <i class="swatch" style="background:${category.color}" aria-hidden="true"></i>
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

    elements.editorForm.hidden = disabled;
    elements.emptySelection.hidden = !disabled;
    elements.emptySelection.textContent =
      selectedFeatures.length > 1
        ? `${selectedFeatures.length} entries selected. Ctrl-click, Cmd-click, or Shift-click entries to adjust the selection.`
        : "Choose a mark, trail, or range from the map or ledger.";
    elements.featureId.value = feature ? feature.id : "";
    elements.titleInput.value = feature ? feature.title : "";
    elements.categoryInput.value = feature ? feature.category : "landmark";
    renderAdditionalCategoryInputs(feature ? getFeatureCategories(feature).slice(1) : [], disabled);
    elements.confidenceInput.value = feature ? feature.confidence : "scouted";
    const showRangeColor = Boolean(feature && feature.type === "range");
    elements.rangeColorField.hidden = !showRangeColor;
    elements.rangeColorInput.value = feature ? getFeatureColor(feature, categoryById[feature.category] || categoryById.range) : categoryById.range.color;
    elements.creatorMeta.innerHTML = feature ? getAttributionHtml(feature) : "";
    elements.creatorMeta.hidden = !feature || !elements.creatorMeta.innerHTML;
    elements.notesInput.value = feature ? feature.notes : "";

    const isDraft = Boolean(feature && state.draftFeature && feature.id === state.draftFeature.id);
    elements.saveFeatureBtn.textContent = isDraft ? "Create Mark" : "Save";
    elements.deleteFeatureBtn.textContent = isDraft ? "Discard" : "Delete";

    [
      elements.titleInput,
      elements.categoryInput,
      elements.additionalCategoriesField,
      elements.confidenceInput,
      elements.rangeColorInput,
      elements.notesInput,
      elements.saveFeatureBtn,
      elements.deleteFeatureBtn,
    ].forEach((element) => {
      element.disabled = disabled;
    });
  }

  function renderAdditionalCategoryInputs(selectedCategoryIds, disabled) {
    const primaryCategory = elements.categoryInput.value || "landmark";
    const selected = new Set(selectedCategoryIds);
    elements.additionalCategoriesInput.innerHTML = "";

    categories
      .filter((category) => category.id !== primaryCategory)
      .forEach((category) => {
        const label = document.createElement("label");
        label.className = "additional-category-option";
        label.innerHTML = `
          <input type="checkbox" value="${escapeHtml(category.id)}"${selected.has(category.id) ? " checked" : ""} />
          <i class="swatch" style="background:${category.color}" aria-hidden="true"></i>
          <span>${escapeHtml(category.label)}</span>
        `;
        elements.additionalCategoriesInput.appendChild(label);
      });

    elements.additionalCategoriesField.disabled = disabled;
  }

  function getAdditionalCategoryIds() {
    return Array.from(elements.additionalCategoriesInput.querySelectorAll('input[type="checkbox"]:checked')).map(
      (input) => input.value,
    );
  }

  function selectFeature(id, additive = false) {
    if (!id) {
      state.selectedIds = [];
      state.selectedId = null;
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

    renderAll();
    const selectedFeatures = getSelectedFeatures();
    if (selectedFeatures.length > 1) {
      setStatus(`${selectedFeatures.length} entries selected`);
      return;
    }
    const feature = getSelectedFeature();
    setStatus(feature ? `Selected: ${feature.title}` : "Selection cleared");
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
    const feature = getSelectedFeature();
    if (!feature) {
      return;
    }

    if (state.draftFeature && feature.id === state.draftFeature.id) {
      cancelDrawing(true);
      renderAll();
      return;
    }

    const confirmed = window.confirm(`Delete "${feature.title}"?`);
    if (!confirmed) {
      return;
    }

    pushUndo(`${feature.title} delete`);
    state.features = state.features.filter((item) => item.id !== feature.id);
    state.selectedId = null;
    state.selectedIds = [];
    saveState();
    renderAll();
    setStatus("Deleted");
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
    ctx.restore();
  }

  function drawExportRoute(ctx, feature, category, bounds, width, height, scale) {
    const points = feature.points.map((point) => mapPointToExport(point, bounds, width, height));
    if (points.length < 2) {
      return;
    }

    ctx.save();
    drawExportPath(ctx, points);
    ctx.strokeStyle = "#efe3c2";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = (isFeatureSelected(feature.id) ? 10 : 8) * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    drawExportPath(ctx, points);
    ctx.strokeStyle = category.color;
    ctx.globalAlpha = isFeatureSelected(feature.id) ? 0.96 : 0.84;
    ctx.lineWidth = (isFeatureSelected(feature.id) ? 4 : 3) * scale;
    ctx.setLineDash([18 * scale, 16 * scale, 4 * scale, 16 * scale]);
    ctx.stroke();
    ctx.restore();
  }

  function drawExportMarker(ctx, feature, category, bounds, width, height, scale) {
    const point = mapPointToExport(feature.points[0], bounds, width, height);
    const selected = isFeatureSelected(feature.id);
    const radius = (isDefaultFeature(feature) ? 6 : selected ? 11 : 9) * scale;
    const labelVisible = (!isDefaultFeature(feature) && !isCanonFeature(feature)) || selected || map.getZoom() >= -0.75;

    ctx.save();
    ctx.shadowColor = "rgba(24, 15, 7, 0.34)";
    ctx.shadowBlur = 5 * scale;
    ctx.shadowOffsetY = 2 * scale;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = category.color;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = (selected ? 3 : 2) * scale;
    ctx.strokeStyle = selected ? "#fff4d7" : "#efe3c2";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(2.5 * scale, radius * 0.36), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 246, 222, 0.76)";
    ctx.fill();

    if (labelVisible) {
      drawExportLabel(ctx, feature.title || category.label, point.x + radius + 5 * scale, point.y, scale);
    }
    ctx.restore();
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
    const labelY = y - height / 2;

    ctx.fillStyle = "rgba(246, 235, 208, 0.86)";
    ctx.strokeStyle = "rgba(72, 45, 17, 0.42)";
    ctx.lineWidth = 1 * scale;
    drawRoundedRectPath(ctx, x, labelY, width, height, 3 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#24190f";
    ctx.fillText(label, x + paddingX, labelY + paddingY + fontSize * 0.78);
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
              <i class="swatch" style="background:${category.color}" aria-hidden="true"></i>
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
              <i class="swatch" style="background:${category.color}" aria-hidden="true"></i>
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
      elements.guildPublishStatus.textContent = "Enter the senior ranger passphrase.";
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
      elements.guildPublishStatus.textContent = "Enter the senior ranger passphrase.";
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
      state.pendingReceive = { features: nextFeatures, isGuildCode, isSkyrimCode, summary };
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
      throw new Error(`Supabase ${functionName} failed: ${response.status}`);
    }

    return response.json();
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
      feature.type === "range" ? normalizeHexColor(feature.color) : "",
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
    feature.category = elements.categoryInput.value;
    feature.categories = [feature.category, ...getAdditionalCategoryIds()];
    feature.confidence = elements.confidenceInput.value;
    if (feature.type === "range") {
      feature.color = normalizeHexColor(elements.rangeColorInput.value) || categoryById.range.color;
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
        color: rest.type === "range" ? normalizeHexColor(rest.color) : "",
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
    return {
      x: Math.max(0, Math.min(MAP_WIDTH, Math.round(latlng.lng))),
      y: Math.max(0, Math.min(MAP_HEIGHT, Math.round(latlng.lat))),
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
    if (feature.type === "range") {
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
