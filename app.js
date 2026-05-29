(function () {
  "use strict";

  const MAP_IMAGE = "SR-map-Skyrim.jpg";
  const MAP_WIDTH = 8192;
  const MAP_HEIGHT = 6144;
  const STORAGE_KEY = "keizaal-ranger-map-state-v1";
  const DEFAULT_FEATURES_VERSION = 2;

  const categories = [
    { id: "city", label: "City", color: "#2f5878", icon: "city" },
    { id: "town", label: "Town", color: "#3f6f78", icon: "town" },
    { id: "cache", label: "Cache", color: "#9a6424" },
    { id: "contact", label: "Contact", color: "#466f75" },
    { id: "threat", label: "Threat", color: "#8e332b" },
    { id: "camp", label: "Camp", color: "#5f7038" },
    { id: "range", label: "Range", color: "#2f6548" },
    { id: "route", label: "Trail", color: "#68472e" },
    { id: "post", label: "Ranger Post", color: "#6d5a32" },
    { id: "landmark", label: "Landmark", color: "#5d5950" },
  ];

  const categoryById = Object.fromEntries(categories.map((category) => [category.id, category]));
  const categoryAliases = {
    danger: "threat",
    guild: "post",
    loot: "cache",
    npc: "contact",
    other: "landmark",
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
    selectedId: null,
    mode: "select",
    drawPoints: [],
    draftLayer: null,
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
    finishDrawBtn: document.getElementById("finishDrawBtn"),
    cancelDrawBtn: document.getElementById("cancelDrawBtn"),
    exportBtn: document.getElementById("exportBtn"),
    importInput: document.getElementById("importInput"),
    clearBtn: document.getElementById("clearBtn"),
    searchInput: document.getElementById("searchInput"),
    categoryFilters: document.getElementById("categoryFilters"),
    featureList: document.getElementById("featureList"),
    statusBar: document.getElementById("statusBar"),
    emptySelection: document.getElementById("emptySelection"),
    editorForm: document.getElementById("editorForm"),
    featureId: document.getElementById("featureId"),
    titleInput: document.getElementById("titleInput"),
    categoryInput: document.getElementById("categoryInput"),
    confidenceInput: document.getElementById("confidenceInput"),
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

    elements.finishDrawBtn.addEventListener("click", finishDrawing);
    elements.cancelDrawBtn.addEventListener("click", cancelDrawing);
    elements.exportBtn.addEventListener("click", exportState);
    elements.importInput.addEventListener("change", importState);
    elements.clearBtn.addEventListener("click", clearAtlas);

    elements.searchInput.addEventListener("input", (event) => {
      state.search = event.target.value.trim().toLowerCase();
      renderAll();
    });

    elements.editorForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveSelectedFeature();
    });

    elements.deleteFeatureBtn.addEventListener("click", deleteSelectedFeature);

    map.on("click", handleMapClick);
    map.on("dragend", () => {
      lastDragEndedAt = Date.now();
    });
    map.on("zoomstart zoom zoomend", () => {
      if (!map.dragging.enabled()) {
        map.dragging.enable();
      }
    });
    map.on("dblclick", () => {
      if (state.mode === "route" || state.mode === "range") {
        finishDrawing();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (state.drawPoints.length) {
          cancelDrawing();
        } else {
          selectFeature(null);
        }
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
      features: state.features,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function setMode(mode) {
    state.mode = mode;
    if (mode !== "route" && mode !== "range") {
      cancelDrawing(false);
    }

    elements.toolButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    });

    const statusByMode = {
      select: "Select features or drag the map",
      marker: "Click the map to place a field mark",
      route: "Click points for a trail",
      range: "Click points for a range boundary",
    };
    setStatus(statusByMode[mode] || "Ready");
  }

  function handleMapClick(event) {
    if (Date.now() - lastDragEndedAt < 140) {
      return;
    }

    const point = clampPoint(event.latlng);

    if (state.mode === "marker") {
      const feature = createFeature({
        type: "marker",
        category: "landmark",
        title: "New mark",
        points: [point],
      });
      state.features.push(feature);
      saveState();
      renderAll();
      selectFeature(feature.id);
      setMode("select");
      return;
    }

    if (state.mode === "route" || state.mode === "range") {
      state.drawPoints.push(point);
      renderDraft();
      updateDrawButtons();
      setStatus(`${state.drawPoints.length} point${state.drawPoints.length === 1 ? "" : "s"} placed`);
    }
  }

  function createFeature(input) {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `feature-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: input.type,
      category: input.category,
      title: input.title,
      confidence: "scouted",
      notes: "",
      points: input.points,
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
          html: `<div class="poi-marker marker-${escapeHtml(feature.category)}${selected ? " is-selected" : ""}" style="--marker-color:${category.color}">${getCategoryIcon(feature.category)}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        }),
      });
      marker.on("click", () => selectFeature(feature.id));
      marker.bindTooltip(feature.title || category.label, { direction: "top", offset: [0, -24] });
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
    layer.bindTooltip(feature.title || category.label);
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
      layer.bindTooltip(feature.title || category.label);
    });
    return group;
  }

  function renderDraft() {
    draftLayer.clearLayers();

    if (!state.drawPoints.length) {
      state.draftLayer = null;
      return;
    }

    const category = state.mode === "range" ? categoryById.range : categoryById.route;
    const latLngs = state.drawPoints.map((point) => [point.y, point.x]);

    state.drawPoints.forEach((point) => {
      L.circleMarker([point.y, point.x], {
        radius: 5,
        color: "#3c2816",
        weight: 1.5,
        fillColor: category.color,
        fillOpacity: 0.82,
      }).addTo(draftLayer);
    });

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

  function finishDrawing() {
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

    state.features.push(feature);
    saveState();
    cancelDrawing(false);
    renderAll();
    selectFeature(feature.id);
    setMode("select");
  }

  function cancelDrawing(showStatus = true) {
    state.drawPoints = [];
    state.draftLayer = null;
    draftLayer.clearLayers();
    updateDrawButtons();
    if (showStatus) {
      setStatus("Drawing canceled");
    }
  }

  function updateDrawButtons() {
    const drawing = state.drawPoints.length > 0;
    elements.finishDrawBtn.disabled = !drawing;
    elements.cancelDrawBtn.disabled = !drawing;
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
      .sort((a, b) => a.title.localeCompare(b.title))
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
          </span>
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
    elements.notesInput.value = feature ? feature.notes : "";

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

    feature.title = elements.titleInput.value.trim() || "Untitled";
    feature.category = elements.categoryInput.value;
    feature.confidence = elements.confidenceInput.value;
    feature.notes = elements.notesInput.value.trim();
    feature.updatedAt = new Date().toISOString();

    saveState();
    renderAll();
    setStatus("Saved");
  }

  function deleteSelectedFeature() {
    const feature = getSelectedFeature();
    if (!feature) {
      return;
    }

    const confirmed = window.confirm(`Delete "${feature.title}"?`);
    if (!confirmed) {
      return;
    }

    state.features = state.features.filter((item) => item.id !== feature.id);
    state.selectedId = null;
    saveState();
    renderAll();
    setStatus("Deleted");
  }

  function exportState() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      map: {
        image: MAP_IMAGE,
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
      },
      features: state.features,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ranger-corps-field-atlas-skyrim-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Exported atlas");
  }

  function importState(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result));
        if (!Array.isArray(imported.features)) {
          throw new Error("Missing features array");
        }

        const nextFeatures = normalizeFeatures(imported.features.filter(isValidFeature), imported.map);
        const replace = window.confirm("Replace the current atlas? Choose Cancel to merge instead.");
        state.features = replace ? nextFeatures : mergeFeatures(state.features, nextFeatures);
        state.selectedId = null;
        saveState();
        renderAll();
        setStatus(`Imported ${nextFeatures.length} entries`);
      } catch (error) {
        console.error(error);
        window.alert("This file does not look like a Ranger's Corps Field Atlas export.");
      } finally {
        elements.importInput.value = "";
      }
    };
    reader.readAsText(file);
  }

  function clearAtlas() {
    if (!state.features.length) {
      setStatus("Atlas already empty");
      return;
    }

    const confirmed = window.confirm("Clear all local map entries?");
    if (!confirmed) {
      return;
    }

    state.features = [];
    state.selectedId = null;
    saveState();
    renderAll();
    setStatus("Atlas cleared");
  }

  function getVisibleFeatures() {
    return state.features.filter((feature) => {
      const categoryVisible = state.filters[feature.category] !== false;
      if (!categoryVisible) {
        return false;
      }

      if (!state.search) {
        return true;
      }

      const haystack = [feature.title, feature.category, feature.confidence, feature.notes]
        .join(" ")
        .toLowerCase();
      return haystack.includes(state.search);
    });
  }

  function getSelectedFeature() {
    return state.features.find((feature) => feature.id === state.selectedId) || null;
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

  function mergeFeatures(current, incoming) {
    const byId = new Map(current.map((feature) => [feature.id, feature]));
    incoming.forEach((feature) => {
      byId.set(feature.id, feature);
    });
    return Array.from(byId.values());
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
      return {
        ...rest,
        category,
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

  function getCategoryIcon(category) {
    const icons = {
      cache: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14v10H5z"/><path d="M7 9l2-4h6l2 4"/><path d="M9 13h6"/></svg>',
      camp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19 12 5l8 14z"/><path d="M12 5v14"/><path d="M7 19h10"/></svg>',
      city: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V8l3 2 4-4 4 4 3-2v12z"/><path d="M9 20v-5h6v5"/><path d="M8 12h1M15 12h1"/></svg>',
      contact: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M6 20c1-4 11-4 12 0"/></svg>',
      landmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 19 20H5z"/><path d="M9 20h6"/></svg>',
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
