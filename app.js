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
    receiveDialog: document.getElementById("receiveDialog"),
    receiveCodeInput: document.getElementById("receiveCodeInput"),
    receivePreview: document.getElementById("receivePreview"),
    receiveStatus: document.getElementById("receiveStatus"),
    receiveReviewBtn: document.getElementById("receiveReviewBtn"),
    receiveMergeBtn: document.getElementById("receiveMergeBtn"),
    receiveReplaceBtn: document.getElementById("receiveReplaceBtn"),
    receiveCancelBtn: document.getElementById("receiveCancelBtn"),
    clearDialog: document.getElementById("clearDialog"),
    clearSummary: document.getElementById("clearSummary"),
    clearConfirmBtn: document.getElementById("clearConfirmBtn"),
    clearCancelBtn: document.getElementById("clearCancelBtn"),
    clearKeepBtn: document.getElementById("clearKeepBtn"),
    undoBtn: document.getElementById("undoBtn"),
    guildLoadBtn: document.getElementById("guildLoadBtn"),
    guildPublishBtn: document.getElementById("guildPublishBtn"),
    guildPublishDialog: document.getElementById("guildPublishDialog"),
    guildPublishSummary: document.getElementById("guildPublishSummary"),
    guildPassphraseInput: document.getElementById("guildPassphraseInput"),
    guildPublishStatus: document.getElementById("guildPublishStatus"),
    guildPublishConfirmBtn: document.getElementById("guildPublishConfirmBtn"),
    guildPublishCancelBtn: document.getElementById("guildPublishCancelBtn"),
    guildPublishKeepBtn: document.getElementById("guildPublishKeepBtn"),
    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    clearBtn: document.getElementById("clearBtn"),
    creatorInput: document.getElementById("creatorInput"),
    shareScopeInput: document.getElementById("shareScopeInput"),
    searchInput: document.getElementById("searchInput"),
    creatorFilterInput: document.getElementById("creatorFilterInput"),
    categoryFilters: document.getElementById("categoryFilters"),
    featureList: document.getElementById("featureList"),
    statusBar: document.getElementById("statusBar"),
    emptySelection: document.getElementById("emptySelection"),
    editorForm: document.getElementById("editorForm"),
    featureId: document.getElementById("featureId"),
    titleInput: document.getElementById("titleInput"),
    categoryInput: document.getElementById("categoryInput"),
    confidenceInput: document.getElementById("confidenceInput"),
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

  init();

  function init() {
    loadState();
    renderFilters();
    renderAll();
    bindEvents();
    setStatus("Ready");
  }

  function bindEvents() {
    elements.toolButtons.forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    elements.aboutBtn.addEventListener("click", () => elements.aboutDialog.showModal());
    elements.aboutCloseBtn.addEventListener("click", () => elements.aboutDialog.close());
    closeDialogOnBackdrop(elements.aboutDialog);

    elements.undoBtn.addEventListener("click", undoLastAction);
    elements.guildLoadBtn.addEventListener("click", loadGuildAtlas);
    elements.guildPublishBtn.addEventListener("click", openGuildPublishDialog);
    elements.guildPublishConfirmBtn.addEventListener("click", publishGuildAtlas);
    elements.guildPublishCancelBtn.addEventListener("click", () => closeGuildPublishDialog());
    elements.guildPublishKeepBtn.addEventListener("click", () => closeGuildPublishDialog());
    closeDialogOnBackdrop(elements.guildPublishDialog);
    elements.exportBtn.addEventListener("click", copyShareCode);
    elements.importBtn.addEventListener("click", openReceiveDialog);
    elements.receiveCancelBtn.addEventListener("click", () => closeReceiveDialog());
    elements.receiveCodeInput.addEventListener("input", resetReceivePreview);
    elements.receiveReviewBtn.addEventListener("click", reviewReceiveCode);
    elements.receiveMergeBtn.addEventListener("click", () => receiveShareCode(false));
    elements.receiveReplaceBtn.addEventListener("click", () => receiveShareCode(true));
    closeDialogOnBackdrop(elements.receiveDialog);
    elements.clearBtn.addEventListener("click", openClearDialog);
    elements.clearConfirmBtn.addEventListener("click", clearAtlas);
    elements.clearCancelBtn.addEventListener("click", () => elements.clearDialog.close());
    elements.clearKeepBtn.addEventListener("click", () => elements.clearDialog.close());
    closeDialogOnBackdrop(elements.clearDialog);

    elements.creatorInput.addEventListener("input", (event) => {
      state.creatorName = normalizeCreatorName(event.target.value);
      saveState();
    });

    elements.searchInput.addEventListener("input", (event) => {
      state.search = event.target.value.trim().toLowerCase();
      renderAll();
    });

    elements.creatorFilterInput.addEventListener("change", (event) => {
      state.creatorFilter = event.target.value;
      renderAll();
    });

    [elements.titleInput, elements.categoryInput, elements.confidenceInput, elements.notesInput].forEach((element) => {
      element.addEventListener("input", syncDraftFromEditor);
      element.addEventListener("change", syncDraftFromEditor);
    });

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
      points: feature.points.map((point) => ({ ...point })),
    };
  }

  function renderAll() {
    renderCreatorFilter();
    featureLayer.clearLayers();

    getVisibleFeatures().forEach((feature) => {
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
    const selected = feature.id === state.selectedId;

    if (feature.type === "marker") {
      const point = feature.points[0];
      const marker = L.marker([point.y, point.x], {
        icon: L.divIcon({
          className: "",
          html: `<div class="poi-marker marker-${escapeHtml(feature.category)}${isGuildFeature(feature) ? " is-guild" : ""}${selected ? " is-selected" : ""}" style="--marker-color:${category.color}">${getCategoryIcon(feature.category)}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        }),
      });
      marker.on("click", () => selectFeature(feature.id));
      marker.bindTooltip(getFeatureTooltip(feature, category), { direction: "top", offset: [0, -24] });
      return marker;
    }

    const latLngs = feature.points.map((point) => [point.y, point.x]);
    if (feature.type === "route") {
      return createRouteLayer(latLngs, category, selected, feature);
    }

    const layer = L.polygon(latLngs, {
      color: category.color,
      weight: selected ? 4 : 2.5,
      opacity: selected ? 0.95 : 0.78,
      fillColor: category.color,
      fillOpacity: selected ? 0.18 : 0.12,
      lineCap: "round",
      lineJoin: "round",
    });
    layer.on("click", () => selectFeature(feature.id));
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
      layer.on("click", () => selectFeature(feature.id));
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
          .filter((feature) => !isDefaultFeature(feature) && feature.creator)
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
        button.className = `feature-card${feature.id === state.selectedId ? " is-selected" : ""}`;
        button.type = "button";
        button.innerHTML = `
          <strong>${escapeHtml(feature.title || category.label)}</strong>
          <span class="feature-meta">
            <i class="swatch" style="background:${category.color}" aria-hidden="true"></i>
            ${escapeHtml(category.label)}
            ${isGuildFeature(feature) ? '<span class="source-badge">Guild</span>' : ""}
            <span>${escapeHtml(getFeatureFreshnessLabel(feature))}</span>
          </span>
          ${feature.creator ? `<span class="feature-creator">Mapped by ${escapeHtml(feature.creator)}</span>` : ""}
          ${feature.updatedBy ? `<span class="feature-creator">Updated by ${escapeHtml(feature.updatedBy)}</span>` : ""}
          ${feature.notes ? `<span class="feature-note">${escapeHtml(truncate(feature.notes, 90))}</span>` : ""}
        `;
        button.addEventListener("click", () => {
          selectFeature(feature.id);
          zoomToFeature(feature);
        });
        elements.featureList.appendChild(button);
      });
  }

  function renderEditor() {
    const feature = getSelectedFeature();
    const disabled = !feature;

    elements.editorForm.hidden = disabled;
    elements.emptySelection.hidden = !disabled;
    elements.featureId.value = feature ? feature.id : "";
    elements.titleInput.value = feature ? feature.title : "";
    elements.categoryInput.value = feature ? feature.category : "landmark";
    elements.confidenceInput.value = feature ? feature.confidence : "scouted";
    elements.creatorMeta.innerHTML = feature ? getAttributionHtml(feature) : "";
    elements.creatorMeta.hidden = !feature || !elements.creatorMeta.innerHTML;
    elements.notesInput.value = feature ? feature.notes : "";

    const isDraft = Boolean(feature && state.draftFeature && feature.id === state.draftFeature.id);
    elements.saveFeatureBtn.textContent = isDraft ? "Create Mark" : "Save";
    elements.deleteFeatureBtn.textContent = isDraft ? "Discard" : "Delete";

    [
      elements.titleInput,
      elements.categoryInput,
      elements.confidenceInput,
      elements.notesInput,
      elements.saveFeatureBtn,
      elements.deleteFeatureBtn,
    ].forEach((element) => {
      element.disabled = disabled;
    });
  }

  function selectFeature(id) {
    state.selectedId = id;
    renderAll();
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
    saveState();
    renderAll();
    setStatus("Deleted");
  }

  async function copyShareCode() {
    const shareFeatures = getShareFeatures();
    if (!shareFeatures.length) {
      setStatus("No entries match the current share scope");
      return;
    }
    let code = "";
    let status = "";

    if (isSupabaseConfigured()) {
      try {
        code = await uploadShareCode(shareFeatures);
        status = `Copied short share code ${code} (${shareFeatures.length} custom entries)`;
      } catch (error) {
        console.error("Could not upload share code", error);
        const codes = encodeShareCodes(shareFeatures);
        code = codes.join("\n");
        const partText = codes.length === 1 ? "1 fallback code" : `${codes.length} fallback codes`;
        status = `Supabase upload failed; copied ${partText}`;
      }
    } else {
      const codes = encodeShareCodes(shareFeatures);
      code = codes.join("\n");
      const partText = codes.length === 1 ? "1 fallback code" : `${codes.length} fallback codes`;
      status = `Supabase anon key missing; copied ${partText}`;
    }

    try {
      await navigator.clipboard.writeText(code);
      setStatus(status);
    } catch (error) {
      window.prompt("Copy this atlas code.", code);
      setStatus(status.replace("Copied", "Atlas code ready to copy"));
    }
  }

  function getShareFeatures() {
    const selected = getSelectedFeature();
    if (elements.shareScopeInput.value === "selected") {
      return selected && isPersonalFeature(selected) ? [selected] : [];
    }
    if (elements.shareScopeInput.value === "visible") {
      return getVisibleFeatures().filter(isPersonalFeature);
    }
    return state.features.filter(isPersonalFeature);
  }

  async function loadGuildAtlas() {
    if (!isSupabaseConfigured()) {
      setStatus("Supabase anon key missing; cannot load Guild Atlas");
      return;
    }

    setGuildButtonsBusy(true);
    setStatus(`Loading Guild Atlas ${GUILD_ATLAS_CODE}...`);
    try {
      const guildAtlas = await fetchGuildAtlas(GUILD_ATLAS_CODE);
      const guildFeatures = getGuildFeaturesFromResponse(guildAtlas);
      pushUndo("guild atlas refresh");
      state.features = replaceGuildFeatures(state.features, guildFeatures);
      state.selectedId = null;
      saveState();
      renderAll();
      const updatedAt = guildAtlas.updated_at || guildAtlas.updatedAt;
      const updatedText = updatedAt ? `, updated ${formatRelativeDate(updatedAt)}` : "";
      setStatus(`Loaded ${guildFeatures.length} official Guild Atlas entries${updatedText}`);
    } catch (error) {
      console.error(error);
      setStatus(error.message === "Guild Atlas not found" ? "No official Guild Atlas has been published yet" : "Could not load Guild Atlas");
    } finally {
      setGuildButtonsBusy(false);
    }
  }

  function openGuildPublishDialog() {
    const publishFeatures = getGuildPublishFeatures();
    elements.guildPassphraseInput.value = "";
    elements.guildPublishStatus.textContent = "";
    elements.guildPublishConfirmBtn.disabled = !publishFeatures.length;
    elements.guildPublishSummary.textContent = publishFeatures.length
      ? `This will replace Guild Atlas ${GUILD_ATLAS_CODE} with ${publishFeatures.length} non-default ${publishFeatures.length === 1 ? "entry" : "entries"} from this atlas.`
      : "There are no non-default entries to publish.";
    elements.guildPublishDialog.showModal();
    window.setTimeout(() => elements.guildPassphraseInput.focus(), 0);
  }

  function closeGuildPublishDialog() {
    elements.guildPublishDialog.close();
    elements.guildPassphraseInput.value = "";
    elements.guildPublishStatus.textContent = "";
  }

  async function publishGuildAtlas() {
    const passphrase = elements.guildPassphraseInput.value.trim();
    const publishFeatures = getGuildPublishFeatures();
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

  function setGuildButtonsBusy(busy) {
    elements.guildLoadBtn.disabled = busy;
    elements.guildPublishBtn.disabled = busy;
  }

  function setGuildPublishBusy(busy) {
    elements.guildPassphraseInput.disabled = busy;
    elements.guildPublishConfirmBtn.disabled = busy;
    elements.guildPublishCancelBtn.disabled = busy;
    elements.guildPublishKeepBtn.disabled = busy;
    setGuildButtonsBusy(busy);
  }

  async function fetchGuildAtlas(code) {
    const atlas = await callSupabaseRpc("get_guild_atlas", { atlas_code: code });
    if (!atlas || !atlas.payload) {
      throw new Error("Guild Atlas not found");
    }
    return atlas;
  }

  function getGuildFeaturesFromResponse(guildAtlas) {
    const imported = decodeStoredSharePayload(guildAtlas.payload);
    if (!Array.isArray(imported.features)) {
      throw new Error("Guild Atlas payload is missing features");
    }
    return markFeaturesAsGuild(normalizeFeatures(imported.features.filter(isValidFeature), imported.map).filter((feature) => !isDefaultFeature(feature)));
  }

  function getGuildPublishFeatures() {
    return state.features.filter((feature) => !isDefaultFeature(feature)).map(cloneFeature);
  }

  function markFeaturesAsGuild(features) {
    return features.map((feature) => ({
      ...cloneFeature(feature),
      source: "guild",
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

  function summarizeIncomingFeatures(features) {
    const existingIds = new Set(state.features.map((feature) => feature.id));
    const customCount = state.features.filter((feature) => !isDefaultFeature(feature)).length;
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
    return `
      <strong>${summary.features.length} received entries</strong>
      <span>${escapeHtml(typeText)}</span>
      <span>${escapeHtml(summary.newCount)} new, ${escapeHtml(summary.duplicateCount)} already on your atlas</span>
      <span>Mapped by: ${escapeHtml(creatorText)}</span>
      <span>Replace would remove ${escapeHtml(summary.customCount)} current custom ${summary.customCount === 1 ? "entry" : "entries"} first.</span>
    `;
  }

  function openReceiveDialog() {
    elements.receiveCodeInput.value = "";
    elements.receiveStatus.textContent = "";
    resetReceivePreview();
    elements.receiveDialog.showModal();
    window.setTimeout(() => elements.receiveCodeInput.focus(), 0);
  }

  function closeReceiveDialog() {
    resetReceivePreview();
    elements.receiveDialog.close();
  }

  function resetReceivePreview() {
    state.pendingReceive = null;
    elements.receivePreview.hidden = true;
    elements.receivePreview.innerHTML = "";
    elements.receiveMergeBtn.disabled = true;
    elements.receiveReplaceBtn.disabled = true;
    elements.receiveStatus.textContent = "";
  }

  async function reviewReceiveCode() {
    const code = elements.receiveCodeInput.value.trim();
    if (!code) {
      elements.receiveStatus.textContent = "Paste a share code first.";
      return;
    }

    setReceiveBusy(true);
    elements.receiveStatus.textContent = "Reading shared atlas...";
    try {
      const imported = await resolveShareInput(code);
      if (!Array.isArray(imported.features)) {
        throw new Error("Missing features array");
      }
      const nextFeatures = normalizeFeatures(imported.features.filter(isValidFeature), imported.map).filter(
        (feature) => !isDefaultFeature(feature),
      );
      if (!nextFeatures.length) {
        resetReceivePreview();
        elements.receiveStatus.textContent = "That code has no custom entries to import.";
        return;
      }
      const summary = summarizeIncomingFeatures(nextFeatures);
      state.pendingReceive = { features: nextFeatures, summary };
      elements.receivePreview.hidden = false;
      elements.receivePreview.innerHTML = renderReceivePreview(summary);
      elements.receiveMergeBtn.disabled = false;
      elements.receiveReplaceBtn.disabled = false;
      elements.receiveStatus.textContent = "Review the entries, then merge or replace.";
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
      const personalIncoming = markFeaturesAsPersonal(nextFeatures);
      state.features = replace
        ? replacePersonalFeatures(state.features, personalIncoming)
        : mergePersonalFeatures(state.features, personalIncoming);
      state.selectedId = null;
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
    elements.receiveReviewBtn.disabled = busy;
    elements.receiveMergeBtn.disabled = busy || (!state.pendingReceive && keepImportDisabled);
    elements.receiveReplaceBtn.disabled = busy || (!state.pendingReceive && keepImportDisabled);
    elements.receiveCancelBtn.disabled = busy;
  }

  function openClearDialog() {
    const customFeatures = state.features.filter((feature) => !isDefaultFeature(feature));
    if (!customFeatures.length) {
      state.features = applyDefaultFeatures(state.features);
      saveState();
      renderAll();
      setStatus("No custom entries to scrape");
      return;
    }

    elements.clearSummary.textContent = `${customFeatures.length} custom ${customFeatures.length === 1 ? "entry" : "entries"} will be removed from this browser. Default cities and towns will stay on the atlas.`;
    elements.clearConfirmBtn.textContent = `Scrape ${customFeatures.length} Custom ${customFeatures.length === 1 ? "Entry" : "Entries"}`;
    elements.clearDialog.showModal();
  }

  function clearAtlas() {
    pushUndo("clear");
    state.features = defaultFeatures.map(cloneFeature);
    state.selectedId = null;
    saveState();
    renderAll();
    elements.clearDialog.close();
    setStatus("Custom entries scraped; default settlements kept");
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
    return /^[A-Z0-9]{6,12}$/.test(normalized) ? normalized : "";
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
    return {
      id: decodeFeatureId(value[0]),
      type: typesByCode[value[1]] || value[1],
      category: categoryIdsByCode[value[2]] || value[2],
      title: value[3] || "Untitled",
      confidence: confidencesByCode[value[4]] || value[4] || "scouted",
      notes: value[5] || "",
      points: expandPoints(Array.isArray(value[6]) ? value[6] : []),
      createdAt: decodeDate(value[7]),
      updatedAt: decodeDate(value[8] || value[7]),
      creator: normalizeCreatorName(value[9] || ""),
      updatedBy: normalizeCreatorName(value[10] || ""),
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
      const categoryVisible = state.filters[feature.category] !== false;
      if (!categoryVisible) {
        return false;
      }

      if (state.creatorFilter && feature.creator !== state.creatorFilter) {
        return false;
      }

      if (!state.search) {
        return true;
      }

      const haystack = [feature.title, feature.category, feature.confidence, feature.creator, feature.notes]
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
    feature.confidence = elements.confidenceInput.value;
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
    if (aDefault !== bDefault) {
      return aDefault ? 1 : -1;
    }
    if (aDefault && bDefault) {
      return a.title.localeCompare(b.title);
    }
    const aTime = Date.parse(a.createdAt || "") || 0;
    const bTime = Date.parse(b.createdAt || "") || 0;
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return a.title.localeCompare(b.title);
  }

  function isDefaultFeature(feature) {
    return feature.source === "default" || feature.id.startsWith("default-");
  }

  function isGuildFeature(feature) {
    return feature.source === "guild";
  }

  function isPersonalFeature(feature) {
    return !isDefaultFeature(feature) && !isGuildFeature(feature);
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
      const category = categoryById[rest.category] ? rest.category : categoryAliases[rest.category] || "landmark";
      const source = rest.source === "guild" ? "guild" : rest.id && rest.id.startsWith("default-") ? "default" : "personal";
      return {
        ...rest,
        category,
        creator: normalizeCreatorName(rest.creator || ""),
        updatedBy: normalizeCreatorName(rest.updatedBy || ""),
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

  function getFeatureTooltip(feature, category) {
    const title = escapeHtml(feature.title || category.label);
    return [title, getAttributionHtml(feature), `<span class="tooltip-meta">${escapeHtml(getFeatureFreshnessLabel(feature))}</span>`]
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
      threat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 21 20H3z"/><path d="M12 9v5"/><path d="M12 17h.01"/></svg>',
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
