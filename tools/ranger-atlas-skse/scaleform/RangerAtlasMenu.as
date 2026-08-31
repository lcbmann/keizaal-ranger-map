import flash.external.ExternalInterface;

class RangerAtlasMenu
{
    private static var MAP_WIDTH:Number = 2048;
    private static var MAP_HEIGHT:Number = 1536;
    private static var ATLAS_WIDTH:Number = 8192;
    private static var ATLAS_HEIGHT:Number = 6144;

    private var host:MovieClip;
    private var rootClip:MovieClip;
    private var chromeLayer:MovieClip;
    private var mapMask:MovieClip;
    private var mapCanvas:MovieClip;
    private var mapImageLayer:MovieClip;
    private var mapHitTarget:MovieClip;
    private var routeLayer:MovieClip;
    private var markerLayer:MovieClip;
    private var rangerLayer:MovieClip;
    private var playerLayer:MovieClip;
    private var sidebarLayer:MovieClip;
    private var controlLayer:MovieClip;
    private var modalLayer:MovieClip;
    private var modalPanel:MovieClip;

    private var titleText:TextField;
    private var identityText:TextField;
    private var timeText:TextField;
    private var statusText:TextField;
    private var selectedTitle:TextField;
    private var selectedMeta:TextField;
    private var selectedNotes:TextField;
    private var nearestTitle:TextField;
    private var nearestMeta:TextField;
    private var nearestVisitors:TextField;
    private var actionStatusText:TextField;
    private var honorsText:TextField;
    private var activityText:TextField;
    private var syncText:TextField;
    private var layerSummary:TextField;
    private var zoomText:TextField;
    private var mapLoadText:TextField;
    private var modalEyebrow:TextField;
    private var modalTitle:TextField;
    private var modalHint:TextField;
    private var modalTitleLabel:TextField;
    private var modalTitleInput:TextField;
    private var modalBodyLabel:TextField;
    private var modalBodyInput:TextField;
    private var modalStatus:TextField;

    private var state:Object;
    private var selectedId:String;
    private var localSelected:Object;
    private var layerFilter:String;
    private var markerClips:Array;
    private var rangerClips:Array;
    private var markersById:Object;
    private var markerSignature:String;
    private var rangerSignature:String;
    private var routeSignature:String;
    private var modalMode:String;
    private var textInputActive:Boolean;
    private var nativeCallId:Number;

    private var viewX:Number;
    private var viewY:Number;
    private var viewWidth:Number;
    private var viewHeight:Number;
    private var fitScale:Number;
    private var mapScale:Number;
    private var mapX:Number;
    private var mapY:Number;
    private var dragging:Boolean;
    private var dragStartMouseX:Number;
    private var dragStartMouseY:Number;
    private var dragStartMapX:Number;
    private var dragStartMapY:Number;

    private var playerCurrentX:Number;
    private var playerCurrentY:Number;
    private var playerTargetX:Number;
    private var playerTargetY:Number;
    private var playerHeading:Number;
    private var mapTileCount:Number;
    private var surfaceStatusReported:Boolean;

    function RangerAtlasMenu(target:MovieClip)
    {
        host = target;
        state = {};
        selectedId = "";
        layerFilter = "all";
        markerClips = [];
        rangerClips = [];
        markersById = {};
        markerSignature = "";
        rangerSignature = "";
        routeSignature = "";
        modalMode = "";
        textInputActive = false;
        nativeCallId = 0;
        dragging = false;
        playerCurrentX = -1;
        playerCurrentY = -1;
        playerTargetX = -1;
        playerTargetY = -1;
        playerHeading = 0;
        mapTileCount = 0;
        surfaceStatusReported = false;

        Stage.scaleMode = "noScale";
        Stage.align = "TL";

        rootClip = host.createEmptyMovieClip("RangerAtlasMenu_mc", 100);
        _root.RangerAtlasMenu_mc = rootClip;
        rootClip.owner = this;
        rootClip.SetState = function(nextState:Object):Void
        {
            this.owner.setState(nextState);
        };
        rootClip.CloseModal = function():Void
        {
            this.owner.closeModal();
        };
        rootClip.IsModalOpen = function():Boolean
        {
            return this.owner.isModalOpen();
        };
        rootClip.onUnload = function():Void
        {
            this.owner.releaseTextInput();
        };

        chromeLayer = rootClip.createEmptyMovieClip("chrome", 1);
        mapMask = rootClip.createEmptyMovieClip("mapMask", 2);
        mapCanvas = rootClip.createEmptyMovieClip("mapCanvas", 3);
        mapCanvas.setMask(mapMask);
        mapImageLayer = mapCanvas.createEmptyMovieClip("mapImage", 1);
        attachMapTiles();
        mapHitTarget = mapCanvas.createEmptyMovieClip("mapHitTarget", 10);
        drawRect(mapHitTarget, 0, 0, MAP_WIDTH, MAP_HEIGHT, 0x0B1514, 1, 0, 0, 0);
        mapLoadText = createText(mapCanvas, "mapLoadText", 12, 0, MAP_HEIGHT * 0.5 - 20, MAP_WIDTH, 42, 22, 0xD17758, true, false);
        mapLoadText.text = mapTileCount == 6 ? "" : "ILLUSTRATED MAP ASSET INCOMPLETE";
        mapLoadText.autoSize = "center";
        mapLoadText._x = (MAP_WIDTH - mapLoadText._width) * 0.5;
        mapLoadText._visible = mapTileCount != 6;
        routeLayer = mapCanvas.createEmptyMovieClip("routes", 20);
        markerLayer = mapCanvas.createEmptyMovieClip("markers", 30);
        rangerLayer = mapCanvas.createEmptyMovieClip("rangers", 35);
        playerLayer = mapCanvas.createEmptyMovieClip("player", 40);
        sidebarLayer = rootClip.createEmptyMovieClip("sidebar", 50);
        controlLayer = rootClip.createEmptyMovieClip("controls", 60);
        modalLayer = rootClip.createEmptyMovieClip("modal", 80);

        createChromeText();
        createMapInteraction();
        createControls();
        createModal();
        installInputListeners();
        layout();
        updateChrome();

        var app:RangerAtlasMenu = this;
        rootClip.onEnterFrame = function():Void
        {
            app.advance();
        };
    }

    private function createChromeText():Void
    {
        titleText = createText(chromeLayer, "title", 10, 0, 0, 620, 32, 25, 0xF4E6C2, true, false);
        titleText.text = "THE RANGER CORPS  |  FIELD ATLAS";
        identityText = createText(chromeLayer, "identity", 11, 0, 0, 600, 22, 15, 0xBFA35B, false, false);
        timeText = createText(chromeLayer, "time", 12, 0, 0, 700, 22, 14, 0xD8D0B6, false, false);
        statusText = createText(chromeLayer, "status", 13, 0, 0, 700, 22, 14, 0x91C59E, false, false);

        selectedTitle = createText(sidebarLayer, "selectedTitle", 10, 0, 0, 300, 52, 22, 0xF4E6C2, true, true);
        selectedMeta = createText(sidebarLayer, "selectedMeta", 11, 0, 0, 300, 40, 13, 0xBFA35B, false, true);
        selectedNotes = createText(sidebarLayer, "selectedNotes", 12, 0, 0, 300, 185, 15, 0xD8D0B6, false, true);
        nearestTitle = createText(sidebarLayer, "nearestTitle", 13, 0, 0, 300, 42, 18, 0xF4E6C2, true, true);
        nearestMeta = createText(sidebarLayer, "nearestMeta", 14, 0, 0, 300, 42, 14, 0x91C59E, false, true);
        nearestVisitors = createText(sidebarLayer, "nearestVisitors", 15, 0, 0, 300, 92, 13, 0xB9B39F, false, true);
        actionStatusText = createText(sidebarLayer, "actionStatusText", 16, 0, 0, 300, 44, 12, 0xBFA35B, false, true);
        honorsText = createText(sidebarLayer, "honorsText", 17, 0, 0, 300, 54, 12, 0xD5B45A, false, true);
        activityText = createText(sidebarLayer, "activityText", 18, 0, 0, 300, 62, 14, 0xD8D0B6, true, true);
        syncText = createText(sidebarLayer, "syncText", 19, 0, 0, 300, 42, 12, 0xB9B39F, false, true);
        layerSummary = createText(sidebarLayer, "layerSummary", 20, 0, 0, 300, 62, 13, 0xB9B39F, false, true);
        zoomText = createText(controlLayer, "zoom", 10, 0, 0, 120, 22, 13, 0xD8D0B6, false, false);
    }

    private function attachMapTiles():Void
    {
        for (var row:Number = 0; row < 3; row++) {
            for (var column:Number = 0; column < 2; column++) {
                var linkage:String = "AtlasMapTile" + row + column;
                var tile:MovieClip = mapImageLayer.attachMovie(linkage, "tile" + row + column, row * 2 + column + 1);
                if (tile != undefined) {
                    tile._x = column * 1024;
                    tile._y = row * 512;
                    mapTileCount++;
                }
            }
        }
    }

    private function createMapInteraction():Void
    {
        if (mapHitTarget == undefined) {
            return;
        }
        mapHitTarget.owner = this;
        mapHitTarget.onPress = function():Void
        {
            this.owner.beginMapDrag();
        };
        mapHitTarget.onRelease = function():Void
        {
            this.owner.endMapDrag();
        };
        mapHitTarget.onReleaseOutside = mapHitTarget.onRelease;
    }

    private function createControls():Void
    {
        createButton(controlLayer, "normalMap", "NORMAL MAP", 20, 0, 118, 30, "native", "");
        createButton(controlLayer, "browserAtlas", "BROWSER ATLAS", 146, 0, 140, 30, "browser", "");
        createButton(controlLayer, "refresh", "REFRESH", 294, 0, 92, 30, "refresh", "");
        createButton(controlLayer, "travel", "TRAVEL VIEW", 400, 0, 110, 30, "travel", "");
        createButton(controlLayer, "fieldNotes", "FIELD NOTES", 518, 0, 116, 30, "clipboard", "");
        createButton(controlLayer, "openingMode", "M: ATLAS | F7: TRAVEL", 646, 0, 210, 30, "openingMode", "");
        createButton(controlLayer, "artCredit", "MAP ART: @ISLOR", 864, 0, 160, 30, "credit", "");

        createButton(sidebarLayer, "filterAll", "ALL", 0, 0, 62, 28, "filter", "all");
        createButton(sidebarLayer, "filterTrailmarks", "TRAILMARKS", 68, 0, 112, 28, "filter", "trailmark");
        createButton(sidebarLayer, "filterPlaces", "PLACES", 186, 0, 82, 28, "filter", "settlement");
        createButton(sidebarLayer, "filterMarks", "MARKS", 274, 0, 74, 28, "filter", "marker");
        createButton(sidebarLayer, "leaveDrop", "LEAVE FIELD DROP", 0, 0, 348, 30, "fieldDrop", "");
        createButton(sidebarLayer, "checkIn", "CHECK IN", 0, 0, 170, 30, "checkIn", "");
        createButton(sidebarLayer, "refreshVisitors", "REFRESH LOG", 178, 0, 170, 30, "refreshVisitors", "");
    }

    private function createModal():Void
    {
        modalLayer._visible = false;
        var backdrop:MovieClip = modalLayer.createEmptyMovieClip("backdrop", 1);
        modalPanel = modalLayer.createEmptyMovieClip("panel", 2);
        modalEyebrow = createText(modalPanel, "eyebrow", 10, 0, 0, 600, 22, 13, 0xBFA35B, true, false);
        modalTitle = createText(modalPanel, "title", 11, 0, 0, 600, 38, 26, 0xF4E6C2, true, false);
        modalHint = createText(modalPanel, "hint", 12, 0, 0, 600, 50, 14, 0xC9C1AA, false, true);
        modalTitleLabel = createText(modalPanel, "titleLabel", 13, 0, 0, 600, 20, 12, 0xBFA35B, true, false);
        modalTitleInput = createInput(modalPanel, "titleInput", 14, 0, 0, 624, 36, false, 120);
        modalBodyLabel = createText(modalPanel, "bodyLabel", 16, 0, 0, 600, 20, 12, 0xBFA35B, true, false);
        modalBodyInput = createInput(modalPanel, "bodyInput", 17, 0, 0, 624, 210, true, 3500);
        modalStatus = createText(modalPanel, "status", 19, 0, 0, 600, 38, 12, 0x91C59E, false, true);
        createButton(modalPanel, "cancel", "CANCEL", 0, 0, 106, 32, "modalCancel", "");
        createButton(modalPanel, "save", "SAVE NOTES", 0, 0, 126, 32, "modalSave", "");
        createButton(modalPanel, "mark", "MARK HERE", 0, 0, 126, 32, "modalMark", "");
        createButton(modalPanel, "send", "SEND", 0, 0, 164, 32, "modalSend", "");
    }

    private function installInputListeners():Void
    {
        var app:RangerAtlasMenu = this;
        var keyListener:Object = {};
        keyListener.onKeyDown = function():Void
        {
            app.onKeyDown(Key.getCode());
        };
        Key.addListener(keyListener);

        var mouseListener:Object = {};
        mouseListener.onMouseWheel = function(delta:Number):Void
        {
            app.onMouseWheel(delta);
        };
        mouseListener.onMouseMove = function():Void
        {
            app.onMouseMove();
        };
        mouseListener.onMouseUp = function():Void
        {
            app.endMapDrag();
        };
        Mouse.addListener(mouseListener);

        Stage.addListener(this);
    }

    function onResize():Void
    {
        layout();
    }

    private function layout():Void
    {
        var width:Number = Math.max(1280, Stage.width);
        var height:Number = Math.max(720, Stage.height);
        var headerHeight:Number = 68;
        var footerHeight:Number = 46;
        var sidebarWidth:Number = Math.min(420, Math.max(384, width * 0.215));

        clear(chromeLayer);
        drawRect(chromeLayer, 0, 0, width, height, 0x050706, 100, 0, 0);
        drawRect(chromeLayer, 0, 0, width, headerHeight, 0x090B08, 96, 0, 0);
        drawRect(chromeLayer, 0, height - footerHeight, width, footerHeight, 0x090B08, 96, 0, 0);
        drawRect(chromeLayer, width - sidebarWidth, headerHeight, sidebarWidth, height - headerHeight - footerHeight, 0x0A0C09, 94, 0, 0);
        drawLine(chromeLayer, 0, headerHeight, width, headerHeight, 0x9D762B, 75, 1);
        drawLine(chromeLayer, width - sidebarWidth, headerHeight, width - sidebarWidth, height - footerHeight, 0x9D762B, 70, 1);
        drawLine(chromeLayer, 0, height - footerHeight, width, height - footerHeight, 0x9D762B, 70, 1);

        titleText._x = 24;
        titleText._y = 8;
        identityText._x = 26;
        identityText._y = 39;
        timeText._x = Math.max(650, width - sidebarWidth - 720);
        timeText._y = 10;
        timeText._width = Math.max(320, width - timeText._x - sidebarWidth - 18);
        timeText.autoSize = "right";
        statusText._x = Math.max(650, width - sidebarWidth - 720);
        statusText._y = 39;
        statusText._width = Math.max(320, width - statusText._x - sidebarWidth - 18);
        statusText.autoSize = "right";

        viewX = 18;
        viewY = headerHeight + 14;
        viewWidth = width - sidebarWidth - 36;
        viewHeight = height - headerHeight - footerHeight - 28;
        clear(mapMask);
        drawRect(mapMask, viewX, viewY, viewWidth, viewHeight, 0xFFFFFF, 100, 0, 0);

        var oldFit:Number = fitScale;
        fitScale = Math.min(viewWidth / MAP_WIDTH, viewHeight / MAP_HEIGHT);
        if (isNaN(mapScale) || mapScale <= 0 || isNaN(oldFit)) {
            mapScale = fitScale;
            mapX = viewX + (viewWidth - MAP_WIDTH * mapScale) * 0.5;
            mapY = viewY + (viewHeight - MAP_HEIGHT * mapScale) * 0.5;
        } else if (Math.abs(mapScale - oldFit) < 0.001) {
            mapScale = fitScale;
            mapX = viewX + (viewWidth - MAP_WIDTH * mapScale) * 0.5;
            mapY = viewY + (viewHeight - MAP_HEIGHT * mapScale) * 0.5;
        }
        applyMapTransform();

        sidebarLayer._x = width - sidebarWidth + 18;
        sidebarLayer._y = headerHeight + 16;
        var sidebarContentWidth:Number = sidebarWidth - 36;
        var sidebarHeight:Number = height - headerHeight - footerHeight - 32;
        var compactSidebar:Boolean = height < 850;
        clear(sidebarLayer);
        sidebarLayer.filterAll._y = 0;
        sidebarLayer.filterTrailmarks._y = 0;
        sidebarLayer.filterPlaces._y = 0;
        sidebarLayer.filterMarks._y = 0;

        selectedTitle._x = 0;
        selectedTitle._y = 52;
        selectedTitle._width = sidebarContentWidth;
        selectedMeta._x = 0;
        selectedMeta._y = 109;
        selectedMeta._width = sidebarContentWidth;
        selectedNotes._x = 0;
        selectedNotes._y = 154;
        selectedNotes._width = sidebarContentWidth;

        var dividerY:Number = compactSidebar ? 225 : Math.min(370, height * 0.39);
        selectedNotes._height = Math.max(58, dividerY - selectedNotes._y - 12);
        drawLine(sidebarLayer, 0, dividerY, sidebarContentWidth, dividerY, 0x9D762B, 55, 1);
        nearestTitle._x = 0;
        nearestTitle._y = dividerY + 14;
        nearestTitle._width = sidebarContentWidth;
        nearestMeta._x = 0;
        nearestMeta._y = dividerY + 53;
        nearestMeta._width = sidebarContentWidth;
        nearestVisitors._x = 0;
        nearestVisitors._y = dividerY + 91;
        nearestVisitors._width = sidebarContentWidth;
        nearestVisitors._height = compactSidebar ? 48 : 78;
        sidebarLayer.leaveDrop._x = 0;
        sidebarLayer.leaveDrop._y = dividerY + (compactSidebar ? 143 : 174);
        sidebarLayer.checkIn._x = 0;
        sidebarLayer.checkIn._y = dividerY + (compactSidebar ? 178 : 209);
        sidebarLayer.refreshVisitors._x = 178;
        sidebarLayer.refreshVisitors._y = sidebarLayer.checkIn._y;
        actionStatusText._x = 0;
        actionStatusText._y = dividerY + (compactSidebar ? 216 : 247);
        actionStatusText._width = sidebarContentWidth;
        honorsText._x = 0;
        honorsText._y = sidebarHeight - 286;
        honorsText._width = sidebarContentWidth;
        honorsText._visible = !compactSidebar;
        activityText._x = 0;
        activityText._y = compactSidebar ? sidebarHeight - 100 : sidebarHeight - 210;
        activityText._width = sidebarContentWidth;
        syncText._x = 0;
        syncText._y = sidebarHeight - 153;
        syncText._width = sidebarContentWidth;
        syncText._visible = !compactSidebar;
        layerSummary._x = 0;
        layerSummary._y = compactSidebar ? sidebarHeight - 48 : sidebarHeight - 106;
        layerSummary._width = sidebarContentWidth;

        controlLayer._x = 0;
        controlLayer._y = height - footerHeight + 8;
        var mapFooterRight:Number = width - sidebarWidth;
        controlLayer.artCredit._visible = mapFooterRight >= 1240;
        controlLayer.artCredit._x = mapFooterRight - 170;
        zoomText._x = width - 104;
        zoomText._width = 84;
        zoomText._y = 4;
        layoutModal(width, height);
        updateZoomText();
    }

    private function layoutModal(width:Number, height:Number):Void
    {
        var panelWidth:Number = 680;
        var panelHeight:Number = 510;
        clear(modalLayer.backdrop);
        drawRect(modalLayer.backdrop, 0, 0, width, height, 0x020403, 88, 0, 0, 0);
        modalPanel._x = (width - panelWidth) * 0.5;
        modalPanel._y = (height - panelHeight) * 0.5;
        clear(modalPanel);
        drawRect(modalPanel, 0, 0, panelWidth, panelHeight, 0x0B0D09, 100, 0xA47B2F, 95, 2);
        modalEyebrow._x = 28;
        modalEyebrow._y = 22;
        modalTitle._x = 28;
        modalTitle._y = 48;
        modalHint._x = 28;
        modalHint._y = 88;
        modalHint._width = 624;
        modalTitleLabel._x = 28;
        modalTitleLabel._y = 143;
        modalPanel.titleInputFrame._x = 28;
        modalPanel.titleInputFrame._y = 166;
        clear(modalPanel.titleInputFrame);
        drawRect(modalPanel.titleInputFrame, 0, 0, 624, 36, 0x070A07, 100, 0x7A642F, 90, 1);
        modalTitleInput._x = 38;
        modalTitleInput._y = 172;
        modalTitleInput._width = 604;
        modalTitleInput._height = 24;
        modalBodyLabel._x = 28;
        modalBodyLabel._y = modalMode == "clipboard" ? 215 : 145;
        modalPanel.bodyInputFrame._x = 28;
        modalPanel.bodyInputFrame._y = modalMode == "clipboard" ? 238 : 168;
        clear(modalPanel.bodyInputFrame);
        drawRect(modalPanel.bodyInputFrame, 0, 0, 624, modalMode == "clipboard" ? 176 : 240, 0x070A07, 100, 0x7A642F, 90, 1);
        modalBodyInput._x = 38;
        modalBodyInput._y = modalMode == "clipboard" ? 244 : 174;
        modalBodyInput._width = 604;
        modalBodyInput._height = modalMode == "clipboard" ? 164 : 228;
        modalStatus._x = 28;
        modalStatus._y = 414;
        modalStatus._width = 624;
        modalPanel.cancel._x = 28;
        modalPanel.cancel._y = 460;
        modalPanel.save._x = 146;
        modalPanel.save._y = 460;
        modalPanel.mark._x = 284;
        modalPanel.mark._y = 460;
        modalPanel.send._x = 488;
        modalPanel.send._y = 460;
    }

    function setState(nextState:Object):Void
    {
        if (nextState == undefined) {
            return;
        }
        state = nextState;
        var rangerSelectionActive:Boolean = localSelected != undefined
            && localSelected.kind == "ranger"
            && selectedId.indexOf("overwatch:") == 0;
        if (!rangerSelectionActive && state.selectedId != undefined && String(state.selectedId).length > 0) {
            selectedId = String(state.selectedId);
        }

        var nextMarkerSignature:String = buildMarkerSignature(state.markers);
        if (nextMarkerSignature != markerSignature) {
            markerSignature = nextMarkerSignature;
            rebuildMarkers();
        }

        var nextRangerSignature:String = buildRangerSignature(state.rangers);
        if (nextRangerSignature != rangerSignature) {
            rangerSignature = nextRangerSignature;
            rebuildRangers();
        }

        var nextRouteSignature:String = buildRouteSignature(state.routes);
        if (nextRouteSignature != routeSignature) {
            routeSignature = nextRouteSignature;
            rebuildRoutes();
        }

        updatePlayerTarget();
        updateChrome();
        updateDetails();
        refreshMarkerSelection();
        refreshRangerSelection();
    }

    private function buildMarkerSignature(markers:Array):String
    {
        if (markers == undefined) {
            return "0";
        }
        var signature:String = layerFilter + ":" + markers.length;
        for (var index:Number = 0; index < markers.length; index++) {
            var marker:Object = markers[index];
            signature += "|" + marker.id + ":" + Math.round(marker.x) + ":" + Math.round(marker.y) + ":" + marker.kind + ":" + marker.headquarters;
        }
        return signature;
    }

    private function buildRouteSignature(routes:Array):String
    {
        if (routes == undefined || layerFilter == "marker" || layerFilter == "settlement") {
            return layerFilter + ":0";
        }
        var signature:String = layerFilter + ":" + routes.length;
        for (var index:Number = 0; index < routes.length; index++) {
            var route:Object = routes[index];
            var points:Array = route.points;
            signature += "|" + route.id + ":" + route.color + ":" + (points == undefined ? 0 : points.length);
            if (points != undefined && points.length > 0) {
                signature += ":" + Math.round(points[0].x) + ":" + Math.round(points[0].y);
                signature += ":" + Math.round(points[points.length - 1].x) + ":" + Math.round(points[points.length - 1].y);
            }
        }
        return signature;
    }

    private function buildRangerSignature(rangers:Array):String
    {
        if (state.overwatchEnabled != true || rangers == undefined) {
            return "off";
        }
        var signature:String = "on:" + rangers.length;
        for (var index:Number = 0; index < rangers.length; index++) {
            var ranger:Object = rangers[index];
            signature += "|" + ranger.id + ":" + Math.round(ranger.x) + ":" + Math.round(ranger.y)
                + ":" + Math.round(ranger.heading) + ":" + ranger.activity;
        }
        return signature;
    }

    private function atlasToMapX(value:Number):Number
    {
        return Number(value) * MAP_WIDTH / ATLAS_WIDTH;
    }

    private function atlasToMapY(value:Number):Number
    {
        // Atlas coordinates increase northward; Flash stage coordinates increase downward.
        return MAP_HEIGHT - Number(value) * MAP_HEIGHT / ATLAS_HEIGHT;
    }

    private function rebuildMarkers():Void
    {
        markerLayer.removeMovieClip();
        markerLayer = mapCanvas.createEmptyMovieClip("markers", 30);
        markerClips = [];
        markersById = {};
        var markers:Array = state.markers;
        if (markers == undefined) {
            return;
        }

        var depth:Number = 1;
        for (var index:Number = 0; index < markers.length; index++) {
            var marker:Object = markers[index];
            if (layerFilter != "all" && marker.kind != layerFilter) {
                continue;
            }
            var clip:MovieClip = markerLayer.createEmptyMovieClip("marker" + depth, depth++);
            clip.markerData = marker;
            clip.owner = this;
            clip._x = atlasToMapX(marker.x);
            clip._y = atlasToMapY(marker.y);
            clip.onRollOver = function():Void
            {
                this.owner.showMarkerLabel(this, true);
            };
            clip.onRollOut = function():Void
            {
                this.owner.showMarkerLabel(this, this.markerData.id == this.owner.selectedId);
            };
            clip.onRelease = function():Void
            {
                this.owner.selectMarker(this.markerData, true);
            };
            markerClips.push(clip);
            markersById[String(marker.id)] = marker;
            drawMarker(clip, marker, String(marker.id) == selectedId);
        }
        resizeMapSymbols();
    }

    private function rebuildRoutes():Void
    {
        routeLayer.removeMovieClip();
        routeLayer = mapCanvas.createEmptyMovieClip("routes", 20);
        if (layerFilter == "marker" || layerFilter == "settlement") {
            return;
        }
        var routes:Array = state.routes;
        if (routes == undefined) {
            return;
        }
        for (var index:Number = 0; index < routes.length; index++) {
            var route:Object = routes[index];
            var points:Array = route.points;
            if (points == undefined || points.length < 2) {
                continue;
            }
            var clip:MovieClip = routeLayer.createEmptyMovieClip("route" + index, index + 1);
            var color:Number = parseColor(String(route.color), 0xBF973A);
            clip.lineStyle(Math.max(1.25, 2.4 / mapScale), color, 82);
            clip.moveTo(atlasToMapX(points[0].x), atlasToMapY(points[0].y));
            for (var pointIndex:Number = 1; pointIndex < points.length; pointIndex++) {
                clip.lineTo(atlasToMapX(points[pointIndex].x), atlasToMapY(points[pointIndex].y));
            }
        }
    }

    private function rebuildRangers():Void
    {
        rangerLayer.removeMovieClip();
        rangerLayer = mapCanvas.createEmptyMovieClip("rangers", 35);
        rangerClips = [];
        var rangers:Array = state.rangers;
        if (state.overwatchEnabled != true || rangers == undefined) {
            return;
        }
        for (var index:Number = 0; index < rangers.length; index++) {
            var ranger:Object = rangers[index];
            var clip:MovieClip = rangerLayer.createEmptyMovieClip("ranger" + index, index + 1);
            clip.rangerData = ranger;
            clip.owner = this;
            clip._x = atlasToMapX(ranger.x);
            clip._y = atlasToMapY(ranger.y);
            clip.onRollOver = function():Void
            {
                this.labelLayer._visible = true;
            };
            clip.onRollOut = function():Void
            {
                this.labelLayer._visible = this.owner.selectedId == "overwatch:" + this.rangerData.id;
            };
            clip.onRelease = function():Void
            {
                this.owner.selectRanger(this.rangerData);
            };
            rangerClips.push(clip);
            drawRanger(clip, ranger, selectedId == "overwatch:" + ranger.id);
        }
        resizeMapSymbols();
    }

    private function drawRanger(clip:MovieClip, ranger:Object, selected:Boolean):Void
    {
        if (clip.arrow != undefined) clip.arrow.removeMovieClip();
        if (clip.labelLayer != undefined) clip.labelLayer.removeMovieClip();
        clear(clip);
        if (selected) {
            drawCircle(clip, 0, 0, 15, 0x000000, 0, 0xFFF1BE, 100, 2);
        }
        var arrow:MovieClip = clip.createEmptyMovieClip("arrow", 1);
        arrow.beginFill(0x77D4B0, 100);
        arrow.lineStyle(2, 0x10241B, 100);
        arrow.moveTo(0, -14);
        arrow.lineTo(9, 11);
        arrow.lineTo(0, 6);
        arrow.lineTo(-9, 11);
        arrow.lineTo(0, -14);
        arrow.endFill();
        arrow._rotation = Number(ranger.heading) || 0;
        var labelLayer:MovieClip = clip.createEmptyMovieClip("labelLayer", 3);
        var label:TextField = createText(labelLayer, "text", 2, 7, -9, 250, 22, 13, 0xDDFBEA, true, false);
        label.text = truncate(String(ranger.title), 34);
        label.autoSize = "left";
        drawRect(labelLayer, 2, -9, label._width + 12, 22, 0x07100B, 94, 0x58AF8A, 90, 1);
        label.swapDepths(3);
        labelLayer._x = 13;
        labelLayer._visible = selected;
    }

    private function refreshRangerSelection():Void
    {
        for (var index:Number = 0; index < rangerClips.length; index++) {
            var clip:MovieClip = rangerClips[index];
            drawRanger(clip, clip.rangerData, selectedId == "overwatch:" + clip.rangerData.id);
        }
        resizeMapSymbols();
    }

    private function drawMarker(clip:MovieClip, marker:Object, selected:Boolean):Void
    {
        clear(clip);
        var color:Number = markerColor(marker);
        var radius:Number = marker.headquarters == true ? 11 : marker.kind == "trailmark" ? 8 : marker.kind == "settlement" ? 7 : 6;
        if (marker.headquarters == true) {
            drawCircle(clip, 0, 0, radius + 5, 0xD5A93A, 18, 0xE4BF62, 92, 2);
            drawCircle(clip, 0, 0, radius + 2, 0x0A0C09, 0, 0xF4D071, 82, 1);
        }
        if (selected) {
            drawCircle(clip, 0, 0, radius + 3, 0x000000, 0, 0xFFF1BE, 100, 2);
        }
        drawCircle(clip, 0, 0, radius, color, 98, 0x17140B, 100, 1.5);
        drawMarkerGlyph(clip, marker, radius);

        var labelLayer:MovieClip = clip.createEmptyMovieClip("labelLayer", 4);
        var label:TextField = createText(labelLayer, "text", 2, 7, -9, 280, 22, 13, 0xF4E6C2, true, false);
        label.text = truncate(String(marker.title), 38);
        label.autoSize = "left";
        drawRect(labelLayer, 2, -9, label._width + 12, 22, 0x090B08, 90, 0x9D762B, 75, 1);
        label.swapDepths(3);
        labelLayer._x = radius + 4;
        labelLayer._visible = selected;
    }

    private function drawMarkerGlyph(clip:MovieClip, marker:Object, radius:Number):Void
    {
        var glyphColor:Number = 0xFFF6D8;
        clip.lineStyle(1.5, glyphColor, 100);

        if (marker.headquarters == true) {
            var headquartersText:TextField = createText(clip, "glyph", 2, -radius, -6, radius * 2, 14, 8, glyphColor, true, false);
            headquartersText.text = "HQ";
            headquartersText.autoSize = "center";
            headquartersText._x = -headquartersText._width * 0.5;
            headquartersText._y = -6;
            return;
        }
        if (marker.kind == "trailmark") {
            clip.moveTo(-4, -5);
            clip.lineTo(4, -5);
            clip.moveTo(0, -5);
            clip.lineTo(0, 5);
            clip.moveTo(-4, 0);
            clip.lineTo(4, 0);
            clip.moveTo(-3, 5);
            clip.lineTo(3, 5);
            return;
        }
        if (marker.kind == "settlement") {
            clip.moveTo(-4.5, -1);
            clip.lineTo(0, -5);
            clip.lineTo(4.5, -1);
            clip.moveTo(-3.5, -1);
            clip.lineTo(-3.5, 4);
            clip.lineTo(3.5, 4);
            clip.lineTo(3.5, -1);
            clip.moveTo(0, 4);
            clip.lineTo(0, 0.5);
            return;
        }

        var category:String = String(marker.category);
        if (category == "threat") {
            clip.moveTo(0, -4);
            clip.lineTo(0, 2);
            drawCircle(clip, 0, 4.5, 1, glyphColor, 100, glyphColor, 100, 0);
        } else if (category == "cache") {
            drawRect(clip, -4, -3, 8, 7, 0x000000, 0, glyphColor, 100, 1.3);
            drawLine(clip, -4, -1, 4, -1, glyphColor, 100, 1.3);
        } else if (category == "contact") {
            drawCircle(clip, 0, -2.5, 2, 0x000000, 0, glyphColor, 100, 1.2);
            clip.moveTo(-4, 4);
            clip.curveTo(0, 0, 4, 4);
        } else if (category == "camp") {
            clip.moveTo(-5, 4);
            clip.lineTo(0, -5);
            clip.lineTo(5, 4);
            clip.moveTo(-2, 4);
            clip.lineTo(2, 4);
        } else if (category == "ore") {
            clip.moveTo(0, -5);
            clip.lineTo(4, -1);
            clip.lineTo(2, 5);
            clip.lineTo(-3, 4);
            clip.lineTo(-5, -1);
            clip.lineTo(0, -5);
        } else if (category == "hunting") {
            clip.moveTo(-4, -4);
            clip.lineTo(4, 4);
            clip.moveTo(4, -4);
            clip.lineTo(-4, 4);
        } else {
            clip.moveTo(-4, 0);
            clip.lineTo(4, 0);
            clip.moveTo(0, -4);
            clip.lineTo(0, 4);
        }
    }

    private function showMarkerLabel(clip:MovieClip, visible:Boolean):Void
    {
        if (clip != undefined && clip.labelLayer != undefined) {
            clip.labelLayer._visible = visible;
        }
    }

    private function refreshMarkerSelection():Void
    {
        for (var index:Number = 0; index < markerClips.length; index++) {
            var clip:MovieClip = markerClips[index];
            drawMarker(clip, clip.markerData, String(clip.markerData.id) == selectedId);
        }
        resizeMapSymbols();
    }

    private function updatePlayerTarget():Void
    {
        var player:Object = state.player;
        if (player == undefined || Number(player.x) < 0 || Number(player.y) < 0) {
            playerTargetX = -1;
            playerTargetY = -1;
            playerLayer._visible = false;
            return;
        }
        playerTargetX = atlasToMapX(player.x);
        playerTargetY = atlasToMapY(player.y);
        playerHeading = Number(player.heading);
        if (playerCurrentX < 0 || playerCurrentY < 0) {
            playerCurrentX = playerTargetX;
            playerCurrentY = playerTargetY;
        }
        playerLayer._visible = true;
        drawPlayer(player.stale == true);
    }

    private function drawPlayer(stale:Boolean):Void
    {
        clear(playerLayer);
        playerLayer.beginFill(stale ? 0xB8B4A8 : 0xF3E3AA, 100);
        playerLayer.lineStyle(2, 0x1A211B, 100);
        playerLayer.moveTo(0, -15);
        playerLayer.lineTo(9, 12);
        playerLayer.lineTo(0, 7);
        playerLayer.lineTo(-9, 12);
        playerLayer.lineTo(0, -15);
        playerLayer.endFill();
        playerLayer._rotation = playerHeading;
        resizePlayer();
    }

    private function advance():Void
    {
        if (!surfaceStatusReported) {
            surfaceStatusReported = true;
            callNative("ReportAtlasSurfaceStatus", [mapTileCount, MAP_WIDTH, MAP_HEIGHT]);
        }
        if (playerTargetX >= 0 && playerTargetY >= 0) {
            playerCurrentX += (playerTargetX - playerCurrentX) * 0.22;
            playerCurrentY += (playerTargetY - playerCurrentY) * 0.22;
            playerLayer._x = playerCurrentX;
            playerLayer._y = playerCurrentY;
        }
    }

    function selectMarker(marker:Object, notifyBrowser:Boolean):Void
    {
        if (marker == undefined) {
            return;
        }
        selectedId = String(marker.id);
        localSelected = marker;
        refreshMarkerSelection();
        updateDetails();
        if (notifyBrowser) {
            callNative("SelectAtlasEntry", [selectedId]);
        }
    }

    function selectRanger(ranger:Object):Void
    {
        if (ranger == undefined) {
            return;
        }
        selectedId = "overwatch:" + String(ranger.id);
        localSelected = {
            id: selectedId,
            title: valueOr(ranger.title, "Unknown Ranger"),
            category: "Overwatch Ranger",
            kind: "ranger",
            notes: "Live Overwatch position updated " + valueOr(ranger.activity, "recently") + ".",
            x: ranger.x,
            y: ranger.y
        };
        refreshMarkerSelection();
        refreshRangerSelection();
        updateDetails();
    }

    private function updateChrome():Void
    {
        var rangerName:String = valueOr(state.rangerName, "Unnamed Ranger");
        var rank:String = valueOr(state.rank, "Ranger");
        identityText.text = rangerName.toUpperCase() + "  |  " + rank.toUpperCase();
        timeText.text = valueOr(state.skyrimTime, "Skyrim time unavailable");

        var browserReady:Boolean = state.browserReady == true;
        var gameReady:Boolean = state.ready == true;
        var awakeCount:Number = Number(state.awakeRangerCount);
        var discordCount:Number = Number(state.discordOnlineCount);
        var gameCount:Number = Number(state.inSkyrimCount);
        var connection:String = browserReady ? (gameReady ? "ATLAS LINKED" : "BROWSER LINKED") : "OPEN BROWSER ATLAS TO SYNC";
        if (!isNaN(discordCount) && discordCount >= 0) {
            connection += "  |  " + discordCount + " DISCORD";
        }
        if (!isNaN(gameCount) && gameCount >= 0) {
            connection += "  |  " + gameCount + " IN SKYRIM";
        }
        statusText.textColor = gameReady ? 0x91C59E : browserReady ? 0xD2B15D : 0xD17758;
        statusText.text = connection;

        var mapKeyOpensAtlas:Boolean = state.mapKeyOpensAtlas != false;
        setButtonLabel(
            controlLayer.openingMode,
            mapKeyOpensAtlas ? "M: ATLAS | F7: TRAVEL" : "M: NORMAL | F7: ATLAS");

        if (!isNaN(gameCount) && gameCount >= 0 && !isNaN(discordCount) && discordCount >= 0) {
            activityText.text = "RANGERS ACTIVE\n" + gameCount + " in Skyrim  |  " + discordCount + " on Discord";
            activityText.textColor = 0x91C59E;
        } else if (!isNaN(awakeCount) && awakeCount >= 0) {
            activityText.text = "RANGERS ACTIVE\n" + awakeCount + " other Ranger" + (awakeCount == 1 ? "" : "s") + " in Skyrim";
            activityText.textColor = 0x91C59E;
        } else {
            activityText.text = "RANGER PRESENCE\nAwaiting Wayfinder activity data";
            activityText.textColor = 0xBFA35B;
        }
        var rangers:Array = state.rangers;
        if (state.overwatchEnabled == true) {
            var overwatchCount:Number = rangers == undefined ? 0 : rangers.length;
            activityText.text += "\nOVERWATCH ACTIVE  |  " + overwatchCount + " position" + (overwatchCount == 1 ? "" : "s");
            activityText.textColor = 0x77D4B0;
        }
        var honors:Array = state.honors;
        if (honors == undefined || honors.length == 0) {
            honorsText.text = "";
        } else {
            var visibleHonors:Array = honors.slice(0, 3);
            honorsText.text = "HONORS\n" + visibleHonors.join("  |  ")
                + (honors.length > visibleHonors.length ? "  |  +" + (honors.length - visibleHonors.length) + " more" : "");
        }
        var calibrationVersion:Number = Number(state.calibrationVersion);
        var trailmarkRevision:Number = Number(state.trailmarkRevision);
        var settlementRevision:Number = Number(state.settlementRevision);
        syncText.text = "Calibration v" + (isNaN(calibrationVersion) ? 0 : calibrationVersion)
            + "  |  Trailmarks r" + (isNaN(trailmarkRevision) ? 0 : trailmarkRevision)
            + "  |  Places r" + (isNaN(settlementRevision) ? 0 : settlementRevision);
    }

    private function updateDetails():Void
    {
        var nearest:Object = state.nearest;
        var selectedMarker:Object = markersById[selectedId];
        var selected:Object = state.selected;
        if (selected == undefined || String(selected.id) != selectedId) {
            selected = selectedMarker;
        }
        if (selected == undefined) {
            selected = localSelected;
        }

        if (selected == undefined) {
            selectedTitle.text = "Select an Atlas mark";
            selectedMeta.text = "Hover for names. Select a symbol for field details.";
            selectedNotes.text = "The illustrated surface follows the same calibrated coordinates, official Trailmarks, settlements, routes, and personal marks as the browser Atlas.";
        } else {
            selectedTitle.text = valueOr(selected.title, "Atlas entry");
            var category:String = valueOr(selected.category, valueOr(selected.kind, "landmark"));
            var meta:String = category.toUpperCase();
            if (selected.headquarters == true) {
                meta = "RANGER HEADQUARTERS  |  " + meta;
            }
            var distance:Number = Number(selected.distanceMeters);
            if (distance >= 0) {
                meta += "  |  " + formatDistance(distance);
            }
            selectedMeta.text = meta;
            var notes:String = valueOr(selected.notes, "");
            if (notes.length == 0 && selectedMarker != undefined) {
                notes = valueOr(selectedMarker.notes, "");
            }
            if (notes.length == 0 && nearest != undefined && String(nearest.id) == String(selected.id)) {
                notes = valueOr(nearest.notes, "");
            }
            selectedNotes.text = notes.length > 0 ? notes : "No field notes recorded for this entry.";
        }

        if (nearest == undefined) {
            nearestTitle.text = "Nearest Trailmark unavailable";
            nearestMeta.text = "Link the browser Atlas and Skyrim position.";
            nearestVisitors.text = "";
            setButtonEnabled(sidebarLayer.leaveDrop, false);
            setButtonEnabled(sidebarLayer.checkIn, false);
            setButtonEnabled(sidebarLayer.refreshVisitors, false);
        } else {
            nearestTitle.text = valueOr(nearest.title, "Nearest Trailmark");
            var nearestDistance:Number = Number(nearest.distanceMeters);
            nearestMeta.text = nearest.withinRange == true
                ? "WITHIN REACH  |  " + formatDistance(nearestDistance)
                : "NEAREST TRAILMARK  |  " + formatDistance(nearestDistance);
            nearestMeta.textColor = nearest.withinRange == true ? 0x91C59E : 0xBFA35B;
            var visitors:Array = nearest.visitorLines;
            nearestVisitors.text = visitors == undefined || visitors.length == 0
                ? "No recent arrivals recorded."
                : truncate(visitors.slice(0, 3).join("\n"), 230);
            setButtonEnabled(sidebarLayer.leaveDrop, nearest.canLeaveDrop == true);
            setButtonEnabled(sidebarLayer.checkIn, nearest.canCheckIn == true);
            setButtonEnabled(sidebarLayer.refreshVisitors, true);
        }

        var browserStatus:String = valueOr(state.actionStatus, "");
        if (browserStatus.length > 0 && browserStatus != "Ready") {
            actionStatusText.text = browserStatus;
            actionStatusText.textColor = 0x91C59E;
        } else if (nearest == undefined) {
            actionStatusText.text = "Trailmark actions require the linked browser Atlas.";
            actionStatusText.textColor = 0xBFA35B;
        } else if (nearest.withinRange != true) {
            actionStatusText.text = "Check-in and field drops unlock within 20 metres.";
            actionStatusText.textColor = 0xBFA35B;
        } else if (nearest.discordLinked != true) {
            actionStatusText.text = "Link Discord in the browser Atlas to leave a field drop.";
            actionStatusText.textColor = 0xD17758;
        } else if (nearest.visitsEnabled != true) {
            actionStatusText.text = "Field drops ready. Enable Record visits for manual check-in.";
            actionStatusText.textColor = 0x91C59E;
        } else {
            actionStatusText.text = "Trailmark field actions are ready.";
            actionStatusText.textColor = 0x91C59E;
        }

        var markers:Array = state.markers;
        var routes:Array = state.routes;
        var trailmarks:Number = 0;
        var settlements:Number = 0;
        var marks:Number = 0;
        if (markers != undefined) {
            for (var index:Number = 0; index < markers.length; index++) {
                if (markers[index].kind == "trailmark") trailmarks++;
                else if (markers[index].kind == "settlement") settlements++;
                else marks++;
            }
        }
        var rangerCount:Number = state.rangers == undefined ? 0 : state.rangers.length;
        layerSummary.text = trailmarks + " Trailmarks  |  " + settlements + " settlements\n" + marks + " field marks  |  "
            + (routes == undefined ? 0 : routes.length) + " routes"
            + (state.overwatchEnabled == true ? "  |  " + rangerCount + " Rangers" : "");
    }

    private function setLayerFilter(filter:String):Void
    {
        if (layerFilter == filter) {
            return;
        }
        layerFilter = filter;
        markerSignature = "";
        routeSignature = "";
        rebuildMarkers();
        rebuildRoutes();
        updateFilterButtons();
    }

    private function updateFilterButtons():Void
    {
        var buttons:Array = [sidebarLayer.filterAll, sidebarLayer.filterTrailmarks, sidebarLayer.filterPlaces, sidebarLayer.filterMarks];
        for (var index:Number = 0; index < buttons.length; index++) {
            var button:MovieClip = buttons[index];
            var active:Boolean = button.actionArg == layerFilter;
            button.label.textColor = active ? 0xFFF1BE : 0xC9C1AA;
            button._alpha = active ? 100 : 72;
        }
    }

    private function handleAction(action:String, argument:String):Void
    {
        if (action == "native") {
            callNative("CloseAtlasOverlay", []);
        } else if (action == "browser") {
            callNative("OpenBrowserAtlas", []);
        } else if (action == "refresh") {
            callNative("RefreshAtlas", []);
        } else if (action == "credit") {
            callNative("OpenArtworkCredit", []);
        } else if (action == "travel") {
            actionStatusText.text = "Opening nonblocking Travel View...";
            callNative("OpenTravelView", []);
        } else if (action == "openingMode") {
            var mapKeyOpensAtlas:Boolean = state.mapKeyOpensAtlas != false;
            state.mapKeyOpensAtlas = !mapKeyOpensAtlas;
            setButtonLabel(
                controlLayer.openingMode,
                state.mapKeyOpensAtlas ? "M: ATLAS | F7: TRAVEL" : "M: NORMAL | F7: ATLAS");
            actionStatusText.text = state.mapKeyOpensAtlas
                ? "Saved: M opens the Atlas; F7 opens Travel View."
                : "Saved: M opens Skyrim's map; F7 opens the Atlas.";
            callNative("SetMapKeyBehavior", [state.mapKeyOpensAtlas]);
        } else if (action == "clipboard") {
            openClipboardModal();
        } else if (action == "fieldDrop") {
            openFieldDropModal();
        } else if (action == "checkIn") {
            actionStatusText.text = "Check-in sent to the browser Atlas...";
            callNative("CheckInTrailmark", []);
        } else if (action == "refreshVisitors") {
            actionStatusText.text = "Refreshing the Trailmark visitor log...";
            callNative("RefreshTrailmarkVisitors", []);
        } else if (action == "modalCancel") {
            closeModal();
        } else if (action == "modalSave") {
            saveModalClipboard();
        } else if (action == "modalMark") {
            createModalFieldMark();
        } else if (action == "modalSend") {
            sendModalFieldDrop();
        } else if (action == "filter") {
            setLayerFilter(argument);
        }
    }

    private function openFieldDropModal():Void
    {
        var nearest:Object = state.nearest;
        if (nearest == undefined || nearest.canLeaveDrop != true) {
            actionStatusText.text = "Reach a Trailmark with Discord linked before leaving a field drop.";
            actionStatusText.textColor = 0xD17758;
            return;
        }
        modalMode = "fieldDrop";
        modalEyebrow.text = "TRAILMARK FIELD DROP";
        modalTitle.text = valueOr(nearest.title, "Nearby Trailmark");
        modalHint.text = "Send an in-character note from this Trailmark through Wayfinder.";
        modalTitleInput.text = "";
        modalBodyInput.text = "";
        modalStatus.text = "Within reach. Message limit: 1,800 characters.";
        configureModal();
        modalLayer._visible = true;
        beginTextInput(modalBodyInput);
    }

    private function openClipboardModal():Void
    {
        modalMode = "clipboard";
        var clipboard:Object = state.clipboard;
        modalEyebrow.text = "RANGER ATLAS";
        modalTitle.text = "Field Notes";
        modalHint.text = "Keep local notes, mark your current outdoor position, or send the page at a nearby Trailmark.";
        modalTitleInput.text = clipboard == undefined ? "Field notes" : valueOr(clipboard.title, "Field notes");
        modalBodyInput.text = clipboard == undefined ? "" : valueOr(clipboard.body, "");
        modalStatus.text = "Changes save through the linked browser Atlas.";
        configureModal();
        modalLayer._visible = true;
        beginTextInput(modalBodyInput);
    }

    private function configureModal():Void
    {
        var clipboardMode:Boolean = modalMode == "clipboard";
        modalTitleLabel.text = "TITLE";
        modalBodyLabel.text = clipboardMode ? "NOTES" : "MESSAGE";
        modalTitleLabel._visible = clipboardMode;
        modalTitleInput._visible = clipboardMode;
        modalPanel.titleInputFrame._visible = clipboardMode;
        modalPanel.save._visible = clipboardMode;
        modalPanel.mark._visible = clipboardMode;
        setButtonLabel(modalPanel.send, clipboardMode ? "SEND AT TRAILMARK" : "SEND FIELD DROP");
        var nearest:Object = state.nearest;
        setButtonEnabled(modalPanel.send, nearest != undefined && nearest.canLeaveDrop == true);
        setButtonEnabled(modalPanel.mark, state.ready == true);
        layoutModal(Math.max(1280, Stage.width), Math.max(720, Stage.height));
    }

    private function closeModal():Void
    {
        Selection.setFocus(null);
        modalLayer._visible = false;
        modalMode = "";
        setTextInputActive(false);
    }

    private function beginTextInput(field:TextField):Void
    {
        Selection.setFocus(field);
        Selection.setSelection(field.text.length, field.text.length);
        setTextInputActive(true);
    }

    private function setTextInputActive(active:Boolean):Void
    {
        if (textInputActive == active) {
            return;
        }
        textInputActive = active;
        callNative(active ? "BeginTextEntry" : "EndTextEntry", []);
    }

    private function isModalOpen():Boolean
    {
        return modalLayer != undefined && modalLayer._visible == true;
    }

    function releaseTextInput():Void
    {
        setTextInputActive(false);
    }

    private function saveModalClipboard():Void
    {
        if (modalMode != "clipboard") {
            return;
        }
        var title:String = trimText(modalTitleInput.text);
        var body:String = modalBodyInput.text;
        if (title.length == 0) {
            title = "Field notes";
            modalTitleInput.text = title;
        }
        callNative("SaveFieldClipboard", [title, body]);
        state.clipboard = { title: title, body: body };
        modalStatus.text = "Saved through the browser Atlas.";
        modalStatus.textColor = 0x91C59E;
        actionStatusText.text = "Field notes saved.";
    }

    private function createModalFieldMark():Void
    {
        if (modalMode != "clipboard" || state.ready != true) {
            modalStatus.text = "Connect the browser Atlas to Skyrim outdoors before marking here.";
            modalStatus.textColor = 0xD17758;
            return;
        }
        var title:String = trimText(modalTitleInput.text);
        if (title.length == 0) {
            modalStatus.text = "Give this field mark a title first.";
            modalStatus.textColor = 0xD17758;
            Selection.setFocus(modalTitleInput);
            return;
        }
        var notes:String = modalBodyInput.text;
        callNative("SaveFieldClipboard", [title, notes]);
        callNative("CreateFieldMark", [title, notes]);
        actionStatusText.text = "Field mark queued at your current outdoor position.";
        actionStatusText.textColor = 0x91C59E;
        closeModal();
    }

    private function sendModalFieldDrop():Void
    {
        var nearest:Object = state.nearest;
        if (nearest == undefined || nearest.canLeaveDrop != true) {
            modalStatus.text = "This Trailmark is not currently available for a field drop.";
            modalStatus.textColor = 0xD17758;
            return;
        }
        var body:String = trimText(modalBodyInput.text);
        var message:String = body;
        if (modalMode == "clipboard") {
            var title:String = trimText(modalTitleInput.text);
            message = title.length > 0 && body.length > 0 ? title + "\n\n" + body : title + body;
            callNative("SaveFieldClipboard", [title.length > 0 ? title : "Field notes", modalBodyInput.text]);
        }
        if (message.length == 0) {
            modalStatus.text = "Write a message before sending it.";
            modalStatus.textColor = 0xD17758;
            Selection.setFocus(modalBodyInput);
            return;
        }
        if (message.length > 1800) {
            message = message.substr(0, 1800);
        }
        callNative("SubmitTrailmarkDrop", [String(nearest.id), message]);
        actionStatusText.text = "Field drop queued through Wayfinder...";
        actionStatusText.textColor = 0x91C59E;
        closeModal();
    }

    private function onKeyDown(code:Number):Void
    {
        if (modalLayer._visible) {
            if (code == 27) {
                closeModal();
            }
            return;
        }
        if (code == 9) {
            callNative("CloseAtlasOverlay", []);
        } else if (code == 118) {
            if (state.mapKeyOpensAtlas != false) {
                callNative("OpenTravelView", []);
            } else {
                callNative("CloseAtlasMap", []);
            }
        } else if (code == 27 || code == 77) {
            callNative("CloseAtlasMap", []);
        } else if (code == 82) {
            callNative("RefreshAtlas", []);
        } else if (code == 187 || code == 107) {
            zoomAt(1.16, Stage.width * 0.5, Stage.height * 0.5);
        } else if (code == 189 || code == 109) {
            zoomAt(0.86, Stage.width * 0.5, Stage.height * 0.5);
        } else if (code == 36) {
            resetMapView();
        }
    }

    private function beginMapDrag():Void
    {
        dragging = true;
        dragStartMouseX = _root._xmouse;
        dragStartMouseY = _root._ymouse;
        dragStartMapX = mapX;
        dragStartMapY = mapY;
    }

    private function endMapDrag():Void
    {
        dragging = false;
    }

    private function onMouseMove():Void
    {
        if (!dragging) {
            return;
        }
        mapX = dragStartMapX + (_root._xmouse - dragStartMouseX);
        mapY = dragStartMapY + (_root._ymouse - dragStartMouseY);
        clampMapPosition();
        applyMapTransform();
    }

    private function onMouseWheel(delta:Number):Void
    {
        var mouseX:Number = _root._xmouse;
        var mouseY:Number = _root._ymouse;
        if (mouseX < viewX || mouseY < viewY || mouseX > viewX + viewWidth || mouseY > viewY + viewHeight) {
            return;
        }
        zoomAt(delta > 0 ? 1.12 : 0.89, mouseX, mouseY);
    }

    private function zoomAt(factor:Number, screenX:Number, screenY:Number):Void
    {
        var oldScale:Number = mapScale;
        var nextScale:Number = Math.max(fitScale, Math.min(fitScale * 4.5, mapScale * factor));
        if (Math.abs(nextScale - oldScale) < 0.0001) {
            return;
        }
        var imageX:Number = (screenX - mapX) / oldScale;
        var imageY:Number = (screenY - mapY) / oldScale;
        mapScale = nextScale;
        mapX = screenX - imageX * mapScale;
        mapY = screenY - imageY * mapScale;
        clampMapPosition();
        applyMapTransform();
        rebuildRoutes();
    }

    private function resetMapView():Void
    {
        mapScale = fitScale;
        mapX = viewX + (viewWidth - MAP_WIDTH * mapScale) * 0.5;
        mapY = viewY + (viewHeight - MAP_HEIGHT * mapScale) * 0.5;
        applyMapTransform();
        rebuildRoutes();
    }

    private function clampMapPosition():Void
    {
        var scaledWidth:Number = MAP_WIDTH * mapScale;
        var scaledHeight:Number = MAP_HEIGHT * mapScale;
        if (scaledWidth <= viewWidth) {
            mapX = viewX + (viewWidth - scaledWidth) * 0.5;
        } else {
            mapX = Math.max(viewX + viewWidth - scaledWidth, Math.min(viewX, mapX));
        }
        if (scaledHeight <= viewHeight) {
            mapY = viewY + (viewHeight - scaledHeight) * 0.5;
        } else {
            mapY = Math.max(viewY + viewHeight - scaledHeight, Math.min(viewY, mapY));
        }
    }

    private function applyMapTransform():Void
    {
        mapCanvas._x = mapX;
        mapCanvas._y = mapY;
        mapCanvas._xscale = mapScale * 100;
        mapCanvas._yscale = mapScale * 100;
        resizeMapSymbols();
        updateZoomText();
    }

    private function resizeMapSymbols():Void
    {
        var inverse:Number = 100 / mapScale;
        for (var index:Number = 0; index < markerClips.length; index++) {
            markerClips[index]._xscale = inverse;
            markerClips[index]._yscale = inverse;
        }
        for (var rangerIndex:Number = 0; rangerIndex < rangerClips.length; rangerIndex++) {
            rangerClips[rangerIndex]._xscale = inverse;
            rangerClips[rangerIndex]._yscale = inverse;
        }
        resizePlayer();
    }

    private function resizePlayer():Void
    {
        if (playerLayer == undefined || mapScale <= 0) {
            return;
        }
        var inverse:Number = 100 / mapScale;
        playerLayer._xscale = inverse;
        playerLayer._yscale = inverse;
    }

    private function updateZoomText():Void
    {
        if (zoomText != undefined && fitScale > 0) {
            zoomText.text = Math.round(mapScale / fitScale * 100) + "%";
        }
    }

    private function callNative(method:String, args:Array):Void
    {
        if (!ExternalInterface.available) {
            return;
        }
        var callArgs:Array = args.concat();
        callArgs.unshift(method, nativeCallId++);
        ExternalInterface.call.apply(null, callArgs);
    }

    private function createButton(parent:MovieClip, name:String, label:String, x:Number, y:Number, width:Number, height:Number, action:String, argument:String):MovieClip
    {
        var clip:MovieClip = parent.createEmptyMovieClip(name, parent.getNextHighestDepth());
        clip.owner = this;
        clip.actionName = action;
        clip.actionArg = argument;
        clip.buttonWidth = width;
        clip.actionEnabled = true;
        clip.isPrimaryAction = action == "native" || action == "fieldDrop" || action == "modalSend";
        clip._x = x;
        clip._y = y;
        drawRect(
            clip,
            0,
            0,
            width,
            height,
            clip.isPrimaryAction ? 0x294A32 : 0x151811,
            clip.isPrimaryAction ? 100 : 92,
            clip.isPrimaryAction ? 0x9BC38F : 0x9D762B,
            clip.isPrimaryAction ? 100 : 75,
            clip.isPrimaryAction ? 2 : 1);
        var text:TextField = createText(
            clip,
            "label",
            2,
            0,
            5,
            width,
            height - 6,
            13,
            clip.isPrimaryAction ? 0xFFF1BE : 0xC9C1AA,
            true,
            false);
        text.text = label;
        text.autoSize = "center";
        text._x = (width - text._width) * 0.5;
        clip.onRollOver = function():Void
        {
            if (this.actionEnabled == false) return;
            this._alpha = 100;
            this.label.textColor = 0xFFF1BE;
        };
        clip.onRollOut = function():Void
        {
            if (this.actionEnabled == false) return;
            var active:Boolean = this.isPrimaryAction || this.actionArg == this.owner.layerFilter;
            this._alpha = active ? 100 : 82;
            this.label.textColor = active ? 0xFFF1BE : 0xC9C1AA;
        };
        clip.onRelease = function():Void
        {
            if (this.actionEnabled == false) return;
            this.owner.handleAction(this.actionName, this.actionArg);
        };
        return clip;
    }

    private function setButtonEnabled(button:MovieClip, enabled:Boolean):Void
    {
        if (button == undefined) {
            return;
        }
        button.actionEnabled = enabled;
        button._alpha = enabled ? (button.isPrimaryAction ? 100 : 82) : 34;
        button.label.textColor = enabled
            ? (button.isPrimaryAction ? 0xFFF1BE : 0xC9C1AA)
            : 0x77746E;
    }

    private function setButtonLabel(button:MovieClip, label:String):Void
    {
        if (button == undefined || button.label == undefined) {
            return;
        }
        button.label.text = label;
        button.label.autoSize = "center";
        button.label._x = (button.buttonWidth - button.label._width) * 0.5;
    }

    private function createInput(parent:MovieClip, name:String, depth:Number, x:Number, y:Number, width:Number, height:Number, multiline:Boolean, maxChars:Number):TextField
    {
        var frame:MovieClip = parent.createEmptyMovieClip(name + "Frame", depth);
        frame._x = x;
        frame._y = y;
        drawRect(frame, 0, 0, width, height, 0x070A07, 100, 0x7A642F, 90, 1);
        parent.createTextField(name, depth + 1, x + 10, y + 6, width - 20, height - 12);
        var field:TextField = parent[name];
        var format:TextFormat = new TextFormat("$EverywhereFont", 15, 0xF4E6C2, false);
        field.setNewTextFormat(format);
        field.type = "input";
        field.noTranslate = true;
        field.selectable = true;
        field.multiline = multiline;
        field.wordWrap = multiline;
        field.maxChars = maxChars;
        field.embedFonts = false;
        field.textColor = 0xF4E6C2;
        return field;
    }

    private function createText(parent:MovieClip, name:String, depth:Number, x:Number, y:Number, width:Number, height:Number, size:Number, color:Number, bold:Boolean, wrap:Boolean):TextField
    {
        parent.createTextField(name, depth, x, y, width, height);
        var field:TextField = parent[name];
        var format:TextFormat = new TextFormat("$EverywhereFont", size, color, bold);
        field.setNewTextFormat(format);
        field.selectable = false;
        field.multiline = wrap;
        field.wordWrap = wrap;
        field.embedFonts = false;
        field.textColor = color;
        return field;
    }

    private function markerColor(marker:Object):Number
    {
        if (marker.headquarters == true) return 0x9F7A2C;
        if (marker.kind == "trailmark") return 0x4E6E3D;
        if (marker.kind == "settlement") return 0x3E7180;
        var category:String = String(marker.category);
        if (category == "threat") return 0xA94C3E;
        if (category == "cache") return 0xA87835;
        if (category == "contact") return 0x4F8491;
        if (category == "camp") return 0x71864B;
        if (category == "ore") return 0x77746E;
        if (category == "hunting") return 0x8D7440;
        return 0x776C54;
    }

    private function formatDistance(distance:Number):String
    {
        if (isNaN(distance) || distance < 0) return "DISTANCE UNKNOWN";
        if (distance < 1000) return Math.round(distance) + " M";
        return (Math.round(distance / 100) / 10) + " KM";
    }

    private function valueOr(value:Object, fallback:String):String
    {
        if (value == undefined || value == null || String(value).length == 0) return fallback;
        return String(value);
    }

    private function truncate(value:String, limit:Number):String
    {
        if (value == undefined) return "";
        return value.length <= limit ? value : value.substr(0, limit - 1) + "...";
    }

    private function trimText(value:String):String
    {
        var text:String = String(value == undefined ? "" : value);
        var start:Number = 0;
        var end:Number = text.length - 1;
        while (start <= end && text.charCodeAt(start) <= 32) start++;
        while (end >= start && text.charCodeAt(end) <= 32) end--;
        return start > end ? "" : text.substring(start, end + 1);
    }

    private function parseColor(value:String, fallback:Number):Number
    {
        if (value == undefined || value.length != 7 || value.charAt(0) != "#") return fallback;
        var result:Number = parseInt(value.substr(1), 16);
        return isNaN(result) ? fallback : result;
    }

    private function clear(clip:MovieClip):Void
    {
        if (clip != undefined) clip.clear();
    }

    private function drawRect(clip:MovieClip, x:Number, y:Number, width:Number, height:Number, fillColor:Number, fillAlpha:Number, lineColor:Number, lineAlpha:Number, lineWidth:Number):Void
    {
        if (lineWidth > 0) clip.lineStyle(lineWidth, lineColor, lineAlpha);
        clip.beginFill(fillColor, fillAlpha);
        clip.moveTo(x, y);
        clip.lineTo(x + width, y);
        clip.lineTo(x + width, y + height);
        clip.lineTo(x, y + height);
        clip.lineTo(x, y);
        clip.endFill();
    }

    private function drawLine(clip:MovieClip, x1:Number, y1:Number, x2:Number, y2:Number, color:Number, alpha:Number, width:Number):Void
    {
        clip.lineStyle(width, color, alpha);
        clip.moveTo(x1, y1);
        clip.lineTo(x2, y2);
    }

    private function drawCircle(clip:MovieClip, x:Number, y:Number, radius:Number, fillColor:Number, fillAlpha:Number, lineColor:Number, lineAlpha:Number, lineWidth:Number):Void
    {
        var control:Number = radius * 0.5522848;
        clip.lineStyle(lineWidth, lineColor, lineAlpha);
        clip.beginFill(fillColor, fillAlpha);
        clip.moveTo(x + radius, y);
        clip.curveTo(x + radius, y + control, x + control, y + radius);
        clip.curveTo(x, y + radius, x - control, y + radius);
        clip.curveTo(x - radius, y + control, x - radius, y);
        clip.curveTo(x - radius, y - control, x - control, y - radius);
        clip.curveTo(x, y - radius, x + control, y - radius);
        clip.curveTo(x + radius, y - control, x + radius, y);
        clip.endFill();
    }
}
