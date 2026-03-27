export default class UI {
  constructor(appRenderer) {
    this.appRenderer = appRenderer;

    this.showingProgress = false;
    this.archiveLoaded = false;
    this.mapFileList = [];
    this.autoLoad = undefined;
    this.shouldUpdateUrl = false;
    this.csvContent = undefined;  // Store CSV content for markers

    this.urlUpdateInterval = setInterval(() => this.updateUrl(), 100);
    this.lastUrlData = "";
  }

  init() {
    this.appRenderer.setupScene();

    T3D.Logger.logFunctions[T3D.Logger.TYPE_PROGRESS] = (name, value) => {
      console.log(name, value);
      if (this.showingProgress) {
        $("#loadingName").text(name);
        $("#loadingValue").text(`${value}%`);
      }
    };

    T3D.Logger.logFunctions[T3D.Logger.TYPE_ERROR] = (error) => {
      console.error(error);
      // If we receive an error before the archive is loaded that means that parsing the archive failed
      if (!this.archiveLoaded) {
        $("#intro").fadeIn();
      }
    };

    this.setupIntro();
    this.setupMapChoice();
    this.setupMapExplorer();

    this.appRenderer.setMovementSpeed(parseInt($("#mvntSpeedRange").val(), 10));
    this.appRenderer.setFogDistance(parseInt($("#fogRange").val(), 10));
    this.appRenderer.renderHook = (data) => this.updateUrl(data);

    $("canvas").on("wheel", (event) => this.onMouseWheel(event));

    // Setup custom markers system
    this._setupCustomMarkersUI();

    this.checkAutoLoad();
  }

  _setupCustomMarkersUI() {
    // Create toggle container (top right)
    const toggleContainer = document.createElement("div");
    toggleContainer.id = "marker-toggle-container";
    toggleContainer.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 1000;
      background: rgba(0,0,0,0.8);
      padding: 10px;
      border-radius: 4px;
      font-family: Arial, sans-serif;
      font-size: 12px;
      display: none;  /* Hidden initially - shown when map is loaded */
      flex-direction: column;
      gap: 8px;
    `;

    // Row with checkbox and buttons
    const controlsRow = document.createElement("div");
    controlsRow.style.cssText = "display: flex; align-items: center; gap: 10px;";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "marker-mode-toggle";

    const label = document.createElement("label");
    label.htmlFor = "marker-mode-toggle";
    label.textContent = "Checkpoint mode";
    label.style.cssText = "cursor: pointer; color: white;";

    controlsRow.appendChild(checkbox);
    controlsRow.appendChild(label);

    // Info button
    const infoBtn = document.createElement("button");
    infoBtn.textContent = "Info";
    infoBtn.style.cssText = `
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      background: #444;
      color: white;
      border: 1px solid #666;
      border-radius: 3px;
    `;
    infoBtn.onclick = () => {
      alert("CHECKPOINT PLACEMENT CONTROLS:\n\n" +
        "1. Activate mode with checkbox\n" +
        "2. Move mouse over terrain - green preview shows placement\n" +
        "3. Press C to create checkpoint at preview position\n" +
        "4. Click on a checkpoint to select it\n" +
        "5. Move selected checkpoint:\n" +
        "   - A/D: X axis\n" +
        "   - W/S: Z axis\n" +
        "   - Up/Down arrows: Y axis\n" +
        "6. Resize selected checkpoint:\n" +
        "   - Left/Right arrows: decrease/increase radius\n" +
        "7. Press X to delete selected checkpoint\n\n" +
        "CSV output: ID, X/39.37, Y/39.37, Z/39.37, R/39.37");
    };

    // Download CSV button
    const downloadBtn = document.createElement("button");
    downloadBtn.textContent = "Download CSV";
    downloadBtn.id = "download-csv-btn";
    downloadBtn.style.cssText = `
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      background: #444;
      color: white;
      border: 1px solid #666;
      border-radius: 3px;
    `;
    downloadBtn.onclick = () => {
      const csv = this.appRenderer.getMarkersCSV();
      if (!csv || csv === "ID,X,Y,Z,R\n") {
        alert("No checkpoints to download!");
        return;
      }
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "checkpoints.csv";
      a.click();
      URL.revokeObjectURL(url);
    };

    controlsRow.appendChild(infoBtn);
    controlsRow.appendChild(downloadBtn);

    toggleContainer.appendChild(controlsRow);

    // Markers panel (below controls)
    const markersPanel = document.createElement("div");
    markersPanel.id = "markers-panel";
    markersPanel.style.cssText = `
      background: rgba(0,0,0,0.9);
      padding: 10px;
      border-radius: 4px;
      color: white;
      font-family: monospace;
      font-size: 11px;
      overflow: auto;
      display: none;
      max-height: 200px;
    `;
    
    const title = document.createElement("div");
    title.textContent = "=== CHECKPOINTS ===";
    title.style.cssText = "font-weight: bold; margin-bottom: 5px; color: #00ff00;";
    markersPanel.appendChild(title);
    
    const csvContent = document.createElement("pre");
    csvContent.id = "markers-csv";
    csvContent.style.cssText = "margin: 0; white-space: pre-wrap;";
    markersPanel.appendChild(csvContent);

    toggleContainer.appendChild(markersPanel);
    document.body.appendChild(toggleContainer);

    // Handle toggle change
    $("#marker-mode-toggle").on("change", (event) => {
      const enabled = $(event.target).is(":checked");
      this.appRenderer.setCustomMarkerMode(enabled);
      
      // Show/hide markers panel based on mode or if there are markers
      if (enabled || this.appRenderer.customMarkers.length > 0) {
        $("#markers-panel").show();
      } else {
        $("#markers-panel").hide();
      }
    });

    // Set up marker list update callback
    this.appRenderer.onMarkerListUpdate = (csv) => {
      $("#markers-csv").text(csv);
      
      // Show panel if there are markers
      if (this.appRenderer.customMarkers.length > 0) {
        $("#markers-panel").show();
      }
    };

    // Mouse move handler for preview
    $("canvas").on("mousemove", (event) => {
      if (this.appRenderer.customMarkerMode) {
        this.appRenderer.updatePreviewPosition(event.clientX, event.clientY);
      }
    });

    // Click handler for selecting markers
    $("canvas").on("click", (event) => {
      // Allow selecting markers when there are markers and not in placement mode
      // Or allow selection even in placement mode but not when clicking on preview
      if (!this.appRenderer.customMarkerMode && this.appRenderer.customMarkers.length > 0) {
        // Allow selecting markers when not in placement mode
        this.appRenderer.selectMarker(event.clientX, event.clientY);
      } else if (this.appRenderer.customMarkerMode && this.appRenderer.customMarkers.length > 0) {
        // Try to select a marker even in placement mode
        this.appRenderer.selectMarker(event.clientX, event.clientY);
      }
    });

    // Keyboard handler for all marker operations
    $(document).on("keydown", (event) => {
      const key = event.key.toLowerCase();
      
      // C - Create marker (only in marker mode)
      if (key === "c" && this.appRenderer.customMarkerMode) {
        const marker = this.appRenderer.createMarker();
        if (marker) {
          $("#markers-csv").text(this.appRenderer.getMarkersCSV());
          $("#markers-panel").show();
        }
        return false;
      }
      
      // X - Delete selected marker
      if (key === "x" && this.appRenderer.selectedMarker) {
        this.appRenderer.deleteSelectedMarker();
        $("#markers-csv").text(this.appRenderer.getMarkersCSV());
        return false;
      }
      
      // AD - Move along X axis
      if (key === "a" && this.appRenderer.selectedMarker) {
        this.appRenderer.moveSelectedMarker("x", -1);
        return false;
      }
      if (key === "d" && this.appRenderer.selectedMarker) {
        this.appRenderer.moveSelectedMarker("x", 1);
        return false;
      }
      
      // WS - Move along Z axis
      if (key === "w" && this.appRenderer.selectedMarker) {
        this.appRenderer.moveSelectedMarker("z", -1);
        return false;
      }
      if (key === "s" && this.appRenderer.selectedMarker) {
        this.appRenderer.moveSelectedMarker("z", 1);
        return false;
      }
      
      // Arrow keys - Move along Y axis
      if (event.key === "ArrowUp" && this.appRenderer.selectedMarker) {
        this.appRenderer.moveSelectedMarker("y", 1);
        return false;
      }
      if (event.key === "ArrowDown" && this.appRenderer.selectedMarker) {
        this.appRenderer.moveSelectedMarker("y", -1);
        return false;
      }
      
      // ArrowLeft/ArrowRight - Change marker radius
      if (event.key === "ArrowLeft" && this.appRenderer.selectedMarker) {
        this.appRenderer.moveSelectedMarker("r", -1);
        return false;
      }
      if (event.key === "ArrowRight" && this.appRenderer.selectedMarker) {
        this.appRenderer.moveSelectedMarker("r", 1);
        return false;
      }
    });
  }

  /*
   * SETUPS
   */
  setupIntro() {
    $("#filePickerInput").on("change", (event) => this.onFileSelected(event));
    $("#filePickerButton").on("click", () => $("#filePickerInput").trigger("click"));
  }
  setupMapChoice() {
    $("#categorySelect").on("change", () => this.genMapSelect());
    $("#mapLoadButton").on("click", () => this.onMapLoadClick());
    $("#scanMapLink").on("click", () => this.onScanMapClick());
    $("#csvFileInput").on("change", (event) => this.onCSVFileSelected(event));
    // WebSocket buttons
    $("#wsConnectButton").on("click", () => this.onWsConnectClick());
    $("#wsDisconnectButton").on("click", () => this.onWsDisconnectClick());
  }
  setupMapExplorer() {
    $("#switchControllerType").on("click", () => {
      if (this.appRenderer.controllerType === "fly") {
        this.appRenderer.setupController("orbital");
      } else {
        this.appRenderer.setupController("fly");
      }
    });
    $("#goToMapSelectButton").on("click", () => this.onBackToMapSelect());
    $("#takeScreenshot").on("click", () => this.appRenderer.takeScreenShot());
    $("#mvntSpeedRange").on("change", (event) => this.appRenderer.setMovementSpeed(event.target.valueAsNumber));
    $("#fogRange").on("change", (event) => this.appRenderer.setFogDistance(event.target.valueAsNumber));

    window.addEventListener("resize", () => this.appRenderer.onWindowResize());
  }

  /*
   * HANDLERS
   */
  onFileSelected(event) {
    const file = event.target.files[0];
    $("#intro").slideUp(() => {
      this.appRenderer.createLocalReader(file, async () => {
        this.archiveLoaded = true;
        this.mapFileList = await this.appRenderer.getMapList();
        this.fillMapChoiceSelect();
        // User might enter an non-existant ID so we only trigger autoload if we find the map
        if (this.autoLoad && this.mapFileList.find((i) => i.baseId === this.autoLoad.map)) {
          return this.onAutoLoad();
        }
        $("#choose-map").fadeIn();
      });
    });
  }

  onAutoLoad() {
    const mapId = this.autoLoad.map;
    this.currentMapId = mapId;  // Store for CSV scale slider
    const renderOptions = {
      zone: this.autoLoad.loadZone === undefined ? false : this.autoLoad.loadZone,
      props: this.autoLoad.loadProp === undefined ? true : this.autoLoad.loadProp,
      collisions: this.autoLoad.showHavok === undefined ? false : this.autoLoad.showHavok,
      csvContent: this.csvContent,
    };
    this.showingProgress = true;
    $("#loading-ui").fadeIn();
    this.appRenderer.loadMap(mapId, renderOptions, () => {
      this.appRenderer.setupController(this.autoLoad.cameraType || "orbital");
      this.appRenderer.move(this.autoLoad.x, this.autoLoad.y, this.autoLoad.z);
      this.appRenderer.rotate(this.autoLoad.rx, this.autoLoad.ry, this.autoLoad.rz);
      // Don't forget to cleanup autoLoad, if not it might break map choice UI
      this.autoLoad = undefined;
      this.onMapLoaded();
    });
  }

  onCSVFileSelected(event) {
    const file = event.target.files[0];
    if (!file) {
      this.csvContent = undefined;
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      this.csvContent = e.target.result;
      console.log("CSV file loaded, lines:", this.csvContent.split('\n').length);
    };
    reader.readAsText(file);
  }

  onWsConnectClick() {
    const eventCode = $("#eventCodeInput").val().trim();
    console.log("Connecting to WebSocket with room:", eventCode || "(global)");
    
    this.appRenderer.connectWebSocket(eventCode);
    
    // Update button states
    $("#wsConnectButton").prop("disabled", true);
    $("#wsDisconnectButton").prop("disabled", false);
  }

  onWsDisconnectClick() {
    console.log("Disconnecting from WebSocket");
    
    this.appRenderer.disconnectWebSocket();
    
    // Update button states
    $("#wsConnectButton").prop("disabled", false);
    $("#wsDisconnectButton").prop("disabled", true);
    
    // Clear all player markers
    this.appRenderer._clearAllPlayerMarkers();
  }

  onMapLoadClick() {
    // Anti aliasing option can only be enabled when creating the webgl context
    // So we update that first if needed
    const aaEnabled = $("#enableAA").is(":checked");
    if (this.appRenderer.webGLRendererOptions.antialiasing !== aaEnabled) {
      this.appRenderer.webGLRendererOptions.antialiasing = aaEnabled;
      this.appRenderer.setupWebGLRenderer(true);
    }

    const mapId = $("#mapSelect").val();
    this.currentMapId = mapId;  // Store for CSV scale slider
    const renderOptions = {
      zone: $("#loadZone").is(":checked"),
      props: $("#loadProps").is(":checked"),
      collisions: $("#loadColl").is(":checked"),
      csvContent: this.csvContent,
    };
    $("#choose-map").slideUp(() => {
      this.showingProgress = true;
      $("#loading-ui").fadeIn();
    });
    this.appRenderer.loadMap(mapId, renderOptions, () => {
      // Reset the position of the camera if we already loaded a previous map
      this.appRenderer.setupController("orbital");
      this.onMapLoaded();
    });
  }

  onMapLoaded() {
    this.showingProgress = false;
    $("#loading-ui").slideUp(() => {
      $("canvas").fadeIn();
      $("#controls").fadeIn();
      $("#loadingName").text("Loading...");
      $("#loadingValue").text("");
      // Show the checkpoint mode toggle when map is loaded
      $("#marker-toggle-container").show();
    });
    // Sync the input ranges with their value in the appRenderer
    $("#fogRange").val(this.appRenderer.fog);
    $("#mvntSpeedRange").val(this.appRenderer.movementSpeed);
    this.shouldUpdateUrl = true;
  }

  onBackToMapSelect() {
    $("#controls").slideUp(() => {
      $("canvas").hide(0);
      $("#choose-map").fadeIn();
      // Hide the checkpoint mode toggle when going back to map selection
      $("#marker-toggle-container").hide();
      this.appRenderer.cleanupMap();
      this.updateUrl(true);
      this.shouldUpdateUrl = false;
    });
  }

  onFileScanDone() {
    this.showingProgress = false;
    $("#loading-ui").slideUp(() => {
      $("#choose-map").fadeIn();
      $("#loadingName").text("Loading...");
      $("#loadingValue").text("");
    });
  }

  onScanMapClick() {
    $("#choose-map").slideUp(() => {
      $("#loadingName").text("Scanning...");
      this.showingProgress = true;
      $("#loading-ui").fadeIn(async () => {
        await this.appRenderer.scanArchiveForMaps();
        this.mapFileList = await this.appRenderer.getMapList();
        this.fillMapChoiceSelect();
        this.onFileScanDone();
      });
    });
  }

  onMouseWheel(event) {
    const newSpeed =
      event.originalEvent.deltaY < 0
        ? Math.min(this.appRenderer.movementSpeed + 100, 10000)
        : Math.max(this.appRenderer.movementSpeed - 100, 500);

    this.appRenderer.setMovementSpeed(newSpeed);
    $("#mvntSpeedRange").val(newSpeed);
  }

  /* UTILS */

  /**
   * This function generates the content of the map selector
   * and NOT the category one
   */
  genMapSelect() {
    const category = $("#categorySelect").val();
    $("#mapSelect").empty();
    for (const map of this.mapFileList) {
      if (map.category === category) {
        const opt = document.createElement("option");
        opt.value = map.baseId;
        opt.innerHTML = map.name;
        $("#mapSelect").append(opt);
      }
    }
  }

  /**
   * This function generates the content of the category selector
   * and NOT the map one
   */
  fillMapChoiceSelect() {
    const categoryList = this.mapFileList
      .sort((a, b) => a.categoryIndex - b.categoryIndex)
      .reduce((categories, map) => {
        if (categories.indexOf(map.category) === -1) {
          categories.push(map.category);
        }
        return categories;
      }, []);
    for (const category of categoryList) {
      const opt = document.createElement("option");
      opt.value = category;
      opt.innerHTML = category;
      $("#categorySelect").append(opt);
    }
    this.genMapSelect();
  }

  updateUrl(shouldClear = false) {
    if (this.shouldUpdateUrl) {
      if (shouldClear) {
        window.location.hash = "";
      } else {
        const urlData = $.param(this.appRenderer.getUrlData());
        if (this.lastUrlData !== urlData) {
          window.location.hash = urlData;
          this.lastUrlData = urlData;
        }
      }
    }
  }

  checkAutoLoad() {
    const urlData = getParsedUrl();
    if (urlData.map) {
      this.autoLoad = urlData;
    }
  }
}

function getParsedUrl() {
  const data = deparam(window.location.hash.slice(1));
  data.map = data.map ? parseInt(data.map) : undefined;
  data.x = data.x ? parseInt(data.x) : undefined;
  data.y = data.y ? parseInt(data.y) : undefined;
  data.z = data.z ? parseInt(data.z) : undefined;
  data.rx = data.rx ? parseFloat(data.rx) : undefined;
  data.ry = data.ry ? parseFloat(data.ry) : undefined;
  data.rz = data.rz ? parseFloat(data.rz) : undefined;
  data.loadZone = data.loadZone ? data.loadZone === "true" : undefined;
  data.loadProp = data.loadProp ? data.loadProp === "true" : undefined;
  data.showHavok = data.showHavok ? data.showHavok === "true" : undefined;
  data.fog = data.fog ? parseInt(data.fog) : undefined;

  // Backward compatibility with Tyria3DApp
  if (data.pitch && data.yaw) {
    const pitch = parseFloat(data.pitch);
    const yaw = parseFloat(data.yaw);
    // convert pitch yaw to xyz rotations:
    data.rx = -Math.cos(yaw) * Math.cos(pitch);
    data.ry = Math.sin(yaw) * Math.cos(pitch);
    data.rz = -Math.sin(pitch);
  }

  return data;
}

function deparam(queryString) {
  try {
    const parameters = {};
    const chunks = queryString.split("&");
    for (const chunk of chunks) {
      const [key, value] = chunk.split("=");
      parameters[decodeURIComponent(key)] = decodeURIComponent(value);
    }
    return parameters;
  } catch (error) {
    console.error(error);
    return {};
  }
}
