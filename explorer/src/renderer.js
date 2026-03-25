import { FlyControls } from "three/examples/jsm/controls/FlyControls.js";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";

const CANVAS_CLEAR_COLOR = 0x342920;
const FOG_LENGTH = 5000;

// WebSocket Configuration (replaces MQTT)
const WEBSOCKET_HOST = "www.beetlerank.com";
const WEBSOCKET_PORT = 3002;
const WEBSOCKET_URL = `wss://${WEBSOCKET_HOST}:${WEBSOCKET_PORT}`;

export default class AppRenderer {
  constructor(stats) {
    this.localReader = undefined;
    this._threeContext = {};
    this._mapMeshes = [];
    this._mapContext = undefined;
    this._renderOptions = undefined;
    this.stats = stats;

    // Player markers for WebSocket
    this._playerMarkers = {};
    this._wsClient = undefined;
    this._wsConnected = false;
    this._wsRoom = "";

    // Defaults
    this.fog = 25000;
    this.movementSpeed = 10000;
    this.lightIntensity = 1.25;
    this.loadedMapID = undefined;
    this.controllerType = "fly";

    this.webGLRendererOptions = {
      sortObjects: false,
      logarithmicDepthBuffer: true,
      stencil: false,
      premultipliedAlpha: false,
      antialiasing: true,
    };
  }

  /** PUBLIC methods */
  createLocalReader(file, callback) {
    this.localReader = T3D.getLocalReader(file, callback, "./static/t3dworker.js");
  }

  getMapList() {
    return this.localReader.getMapList();
  }

  scanArchiveForMaps() {
    return this.localReader.readFileList();
  }

  loadMap(mapId, renderOptions, callback) {
    if (this.loadedMapID) {
      this.cleanupMap();
    }

    this.loadedMapID = mapId;
    this._renderOptions = renderOptions;

    const renderers = [
      { renderClass: T3D.EnvironmentRenderer, settings: {} },
      { renderClass: T3D.TerrainRenderer, settings: {} },
    ];

    if (renderOptions.zone) {
      renderers.push({ renderClass: T3D.ZoneRenderer, settings: { visible: true } });
    }
    if (renderOptions.props) {
      renderers.push({ renderClass: T3D.PropertiesRenderer, settings: { visible: true } });
    }
    if (renderOptions.collisions) {
      renderers.push({ renderClass: T3D.HavokRenderer, settings: { visible: true } });
    }

    // Add custom markers renderer if CSV content is provided
    if (renderOptions.csvContent) {
      renderers.push({
        renderClass: T3D.CustomMarkersRenderer,
        settings: {
          csvContent: renderOptions.csvContent,
          sphereRadius: renderOptions.markerRadius || 15,
          labelOffset: renderOptions.labelOffset || 30,
        }
      });
    }

    T3D.renderMapContentsAsync(this.localReader, this.loadedMapID, renderers, (context) => {
      this._loadMapCallback(context, renderOptions, callback);
    });
  }

  setFogDistance(value) {
    this.fog = value;
    if (this._threeContext.scene && this._threeContext.scene.fog) {
      this._threeContext.scene.fog.near = this.fog;
      this._threeContext.scene.fog.far = this.fog + FOG_LENGTH;
    }
    if (this._threeContext.camera) {
      this._threeContext.camera.far = this.fog + FOG_LENGTH;
      this._threeContext.camera.updateProjectionMatrix();
    }
  }

  setMovementSpeed(value) {
    this.movementSpeed = value;
    if (this._threeContext.controls) {
      this._threeContext.controls.movementSpeed = value;
    }
  }

  move(x, y, z) {
    if (x) {
      this._threeContext.controls.object.position.x = x;
    }
    if (y) {
      this._threeContext.controls.object.position.y = y;
    }
    if (z) {
      this._threeContext.controls.object.position.z = z;
    }
  }

  rotate(rx, ry, rz) {
    if (rx) {
      this._threeContext.controls.object.rotation.x = rx;
    }
    if (ry) {
      this._threeContext.controls.object.rotation.y = ry;
    }
    if (rz) {
      this._threeContext.controls.object.rotation.z = rz;
    }
  }

  setLightIntensity(value) {
    this.lightIntensity = value;
    if (this._threeContext.sceneLights) {
      for (const light of this._threeContext.sceneLights) {
        light.intensity = value;
      }
    }
  }

  takeScreenShot() {
    const newWindow = window.open("", "");
    newWindow.document.title = "T3D Explorer Screenshot";
    const image = new Image();

    this._threeContext.renderer.clear();
    // Render first skyCamera
    this._threeContext.renderer.render(this._threeContext.skyScene, this._threeContext.skyCamera);
    this._threeContext.renderer.render(this._threeContext.scene, this._threeContext.camera);
    image.src = this._threeContext.renderer.domElement.toDataURL();
    newWindow.document.body.appendChild(image);
  }

  setupController(controllerType = "fly") {
    if (this._threeContext.controls) {
      this._threeContext.controls.dispose();
    }

    if (controllerType === "orbital") {
      this._threeContext.controls = new MapControls(this._threeContext.camera, this._threeContext.renderer.domElement);
    } else if (controllerType === "fly") {
      this._threeContext.controls = new FlyControls(this._threeContext.camera, this._threeContext.renderer.domElement);

      this._threeContext.controls.movementSpeed = this.movementSpeed;
      this._threeContext.controls.rollSpeed = Math.PI / 6;
      this._threeContext.controls.autoForward = false;
      this._threeContext.controls.dragToLook = true;
    } else {
      throw new Error("Invalid controller type");
    }

    this.controllerType = controllerType;
  }

  cleanupMap() {
    this._mapContext = undefined;
    this._renderOptions = undefined;
    this.loadedMapID = undefined;
    this._clearAllPlayerMarkers();
    for (const mesh of this._mapMeshes) {
      this._threeContext.scene.remove(mesh);
    }
    for (const skyBox of this._threeContext.skyScene.children) {
      this._threeContext.skyScene.remove(skyBox);
    }
    this._mapMeshes = [];
  }

  setupScene() {
    const { _threeContext: context } = this;

    context.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
    context.skyCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
    context.scene = new THREE.Scene();
    context.skyScene = new THREE.Scene();
    context.clock = new THREE.Clock();

    context.ambientLight = new THREE.AmbientLight(0x555555);
    context.scene.add(context.ambientLight);

    context.sceneLights = [
      new THREE.DirectionalLight(0xffffff, this.lightIntensity),
      new THREE.DirectionalLight(0xffffff, this.lightIntensity),
      new THREE.DirectionalLight(0xffffff, this.lightIntensity),
    ];
    context.sceneLights[0].position.set(0, 0, 1);
    context.sceneLights[0].position.set(0, 1, 0);
    context.sceneLights[0].position.set(1, 0, 0);
    for (const light of context.sceneLights) {
      context.scene.add(light);
    }

    context.scene.fog = new THREE.Fog(0xffffff, this.fog, this.fog + FOG_LENGTH);
    context.camera.far = this.fog + FOG_LENGTH;
    context.camera.updateProjectionMatrix();

    this.setupWebGLRenderer(true);
    this.setupController();
    // WebSocket connection will be set up via UI buttons, not automatic
    this._render();
  }

  onWindowResize() {
    const { _threeContext: context } = this;
    if (context.renderer && context.camera && context.skyCamera) {
      context.camera.aspect = window.innerWidth / window.innerHeight;
      context.camera.updateProjectionMatrix();
      context.renderer.setSize(window.innerWidth, window.innerHeight);
      context.skyCamera.aspect = window.innerWidth / window.innerHeight;
      context.skyCamera.updateProjectionMatrix();
    }
  }

  // This function is safe to be called whenever the active webgl context is not rendering on screen
  setupWebGLRenderer(hidden) {
    const { _threeContext: context } = this;
    const oldRenderer = context.renderer;
    context.renderer = new THREE.WebGLRenderer(this.webGLRendererOptions);
    context.renderer.autoClear = false;
    context.renderer.setSize(window.innerWidth, window.innerHeight);
    context.renderer.setClearColor(CANVAS_CLEAR_COLOR);
    if (hidden) {
      $(context.renderer.domElement).hide();
    }
    if (oldRenderer) {
      $(oldRenderer.domElement).remove();
    }
    $("#explorer").append(context.renderer.domElement);
  }

  getUrlData() {
    const controls = this._threeContext.controls;
    const pos = controls.object.position;
    const rot = controls.object.rotation;
    return {
      map: this.loadedMapID,
      x: Math.round(pos.x * 1000) / 1000,
      y: Math.round(pos.y * 1000) / 1000,
      z: Math.round(pos.z * 1000) / 1000,
      rx: Math.round(rot.x * 10000) / 10000,
      ry: Math.round(rot.y * 10000) / 10000,
      rz: Math.round(rot.z * 10000) / 10000,
      cameraType: this.controllerType,
      loadZone: !!this._renderOptions.zone,
      loadProp: !!this._renderOptions.props,
      showHavok: !!this._renderOptions.collisions,
      fog: this.fog,
    };
  }

  /** PRIVATE methods */
  _render() {
    this.stats.update();
    window.requestAnimationFrame(() => this._render());
    this._threeContext.controls.update(this._threeContext.clock.getDelta());

    this._threeContext.renderer.clear();

    // Render first skyCamera
    this._threeContext.skyCamera.quaternion.copy(this._threeContext.camera.quaternion);
    this._threeContext.renderer.render(this._threeContext.skyScene, this._threeContext.skyCamera);

    this._threeContext.renderer.render(this._threeContext.scene, this._threeContext.camera);
  }

  _loadMapCallback(context, renderOptions, externalCallback) {
    this._mapContext = context;

    // Add all the data from the context to the threejs scene
    for (const tile of T3D.getContextValue(context, T3D.TerrainRenderer, "terrainTiles")) {
      this._threeContext.scene.add(tile);
      this._mapMeshes.push(tile);
    }
    const water = T3D.getContextValue(context, T3D.TerrainRenderer, "water");
    this._threeContext.scene.add(water);
    this._mapMeshes.push(water);

    const skyBox = T3D.getContextValue(context, T3D.EnvironmentRenderer, "skyBox");
    this._threeContext.skyScene.add(skyBox);
    const hazeColor = T3D.getContextValue(context, T3D.EnvironmentRenderer, "hazeColor");
    if (hazeColor) {
      this._threeContext.renderer.setClearColor(
        new THREE.Color(hazeColor[2] / 255, hazeColor[1] / 255, hazeColor[0] / 255)
      );
    }

    if (renderOptions.zone) {
      for (const zoneModel of T3D.getContextValue(context, T3D.ZoneRenderer, "meshes")) {
        this._threeContext.scene.add(zoneModel);
        this._mapMeshes.push(zoneModel);
      }
    }
    if (renderOptions.props) {
      for (const propModel of T3D.getContextValue(context, T3D.PropertiesRenderer, "meshes")) {
        this._threeContext.scene.add(propModel);
        this._mapMeshes.push(propModel);
      }
    }
    if (renderOptions.collisions) {
      for (const collModel of T3D.getContextValue(context, T3D.HavokRenderer, "meshes")) {
        this._threeContext.scene.add(collModel);
        this._mapMeshes.push(collModel);
      }
    }

    // Add custom markers from CSV
    if (renderOptions.csvContent) {
      const markerMeshes = T3D.getContextValue(context, T3D.CustomMarkersRenderer, "meshes");
      const markerLabels = T3D.getContextValue(context, T3D.CustomMarkersRenderer, "labels");
      
      if (markerMeshes) {
        for (const marker of markerMeshes) {
          this._threeContext.scene.add(marker);
          this._mapMeshes.push(marker);
        }
      }
      if (markerLabels) {
        for (const label of markerLabels) {
          this._threeContext.scene.add(label);
          this._mapMeshes.push(label);
        }
      }
    }

    // Move camera
    const bounds = T3D.getContextValue(context, T3D.TerrainRenderer, "bounds");
    this._resetCameraLocation(bounds);

    // If set fog is too small to see the map we increase it
    if (this.fog < bounds.y2 * 1.5) {
      this.setFogDistance(bounds.y2 * 2);
    }

    return externalCallback();
  }

  _resetCameraLocation(bounds) {
    if (this.controllerType === "fly") {
      this._threeContext.camera.position.x = 0;
      this._threeContext.camera.position.y = bounds ? bounds.y2 : 0;
      this._threeContext.camera.position.z = 0;
      this._threeContext.camera.rotation.x = (-90 * Math.PI) / 180;
    } else {
      this._threeContext.camera.position.x = 0;
      this._threeContext.camera.position.y = bounds ? bounds.y2 : 0;
      this._threeContext.camera.position.z = 0;
    }
  }

  /** WebSocket Methods (replaces MQTT) */
  _createWsStatusBadge() {
    const badge = document.createElement("div");
    badge.id = "ws-status-badge";
    badge.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        z-index: 10000;
        padding: 8px 12px;
        background: #333;
        color: white;
        font-family: Arial, sans-serif;
        font-size: 12px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    `;

    const indicator = document.createElement("span");
    indicator.id = "ws-indicator";
    indicator.style.cssText = `
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #666;
    `;

    const text = document.createElement("span");
    text.id = "ws-text";
    text.textContent = "WebSocket: Disconnected";

    badge.appendChild(indicator);
    badge.appendChild(text);
    document.body.appendChild(badge);

    this._wsBadge = { badge, indicator, text };
  }

  _updateWsStatus(status) {
    if (!this._wsBadge) return;

    const { indicator, text } = this._wsBadge;

    switch (status) {
      case "connected":
        indicator.style.background = "#00ff00";
        text.textContent = "WebSocket: Connected";
        break;
      case "error":
        indicator.style.background = "#ff0000";
        text.textContent = "WebSocket: Error";
        break;
      case "disconnected":
        indicator.style.background = "#ffaa00";
        text.textContent = "WebSocket: Disconnected";
        break;
      default:
        indicator.style.background = "#666";
        text.textContent = "WebSocket: " + status;
    }
  }

  /**
   * Connect to WebSocket server
   * @param {string} room - Room/event code to subscribe to (optional, empty for global)
   */
  connectWebSocket(room = "") {
    if (this._wsClient) {
      console.log("WebSocket already connected");
      return;
    }

    console.log(`Connecting to WebSocket at ${WEBSOCKET_URL}...`);
    this._createWsStatusBadge();
    this._updateWsStatus("connecting");
    this._wsRoom = room;

    try {
      this._wsClient = new WebSocket(WEBSOCKET_URL);

      this._wsClient.onopen = () => {
        console.log("WebSocket connected!");
        this._updateWsStatus("connected");
        this._wsConnected = true;

        // Subscribe to room if provided
        if (room) {
          const subscribeMsg = {
            type: "subscribe",
            room: room
          };
          this._wsClient.send(JSON.stringify(subscribeMsg));
          console.log("Subscribed to room:", room);
        }
      };

      this._wsClient.onmessage = (event) => {
        this._handleWsMessage(event.data);
      };

      this._wsClient.onerror = (error) => {
        console.error("WebSocket error:", error);
        this._updateWsStatus("error");
      };

      this._wsClient.onclose = (closeEvent) => {
        console.log("WebSocket closed:", closeEvent.code, closeEvent.reason);
        this._updateWsStatus("disconnected");
        this._wsConnected = false;
        this._wsClient = undefined;
      };
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
      this._updateWsStatus("error");
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnectWebSocket() {
    if (this._wsClient) {
      this._wsClient.close();
      this._wsClient = undefined;
      this._wsConnected = false;
      this._updateWsStatus("disconnected");
      console.log("WebSocket disconnected");
    }
  }

  /**
   * Handle WebSocket messages (snapshots with all players)
   */
  _handleWsMessage(message) {
    try {
      const data = JSON.parse(message);

      // Check if it's a snapshot message with users array
      if (data.type === "snapshot" && data.users) {
        console.log("📨 Received snapshot with", data.users.length, "users");

        for (const userData of data.users) {
          // Only process position messages
          if (userData.option === "position" && userData.user) {
            this._processPlayerData(userData);
          }
        }
      }
    } catch (err) {
      console.error("Error parsing WebSocket message:", err);
    }
  }

  /**
   * Process individual player data from WebSocket
   */
  _processPlayerData(playerData) {
    const { user, x, y, z, color } = playerData;

    if (user === undefined || x === undefined || y === undefined || z === undefined) {
      console.warn("⚠️ Invalid player data - missing fields");
      return;
    }

    console.log("✅ Processing player:", user, "at position:", x, y, z);

    const METERS_TO_INCHES = 39.3701;
    const t3dPosition = new THREE.Vector3(
      x * METERS_TO_INCHES,
      y * METERS_TO_INCHES,
      -z * METERS_TO_INCHES
    );

    // Convert hex color string to number (e.g., "#FF5733" -> 0xFF5733)
    let colorValue = 0x00ff00; // default green
    if (color) {
      if (typeof color === "string" && color.startsWith("#")) {
        colorValue = parseInt(color.slice(1), 16);
      } else if (typeof color === "number") {
        colorValue = color;
      }
    }

    this._updatePlayerMarker(user, t3dPosition, colorValue);
  }

  _updatePlayerMarker(playerName, position, colorValue) {
    console.log("🎯 Creating marker for", playerName);
    console.log("  Scene exists:", !!this._threeContext.scene);
    console.log("  Position:", position);

    if (!this._threeContext.scene) {
      console.warn("⚠️ Scene not ready, cannot add marker");
      return;
    }

    if (this._playerMarkers[playerName]) {
      this._removePlayerMarker(playerName);
    }

    const markerGroup = new THREE.Group();
    markerGroup.position.copy(position);

    const color = new THREE.Color(colorValue);

    const lineHeight = 15000;
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, lineHeight, 0),
    ]);
    const lineMaterial = new THREE.LineBasicMaterial({ color: color });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    markerGroup.add(line);

    const sphereGeometry = new THREE.SphereGeometry(50, 16, 16);
    const sphereMaterial = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8 });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.y = 25;
    markerGroup.add(sphere);

    const nameSprite = this._createTextSprite(playerName, color.getHexString());
    nameSprite.position.y = 100;
    markerGroup.add(nameSprite);

    this._threeContext.scene.add(markerGroup);

    this._playerMarkers[playerName] = {
      group: markerGroup,
      line: line,
      sprite: nameSprite,
    };
  }

  _createTextSprite(text, colorHex) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    const fontSize = 24;
    context.font = "bold " + fontSize + "px Arial, sans-serif";
    const textWidth = context.measureText(text).width;
    canvas.width = textWidth + 20;
    canvas.height = fontSize + 20;

    context.font = "bold " + fontSize + "px Arial, sans-serif";
    context.fillStyle = "#" + colorHex;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    context.strokeStyle = "#000000";
    context.lineWidth = 3;
    context.strokeText(text, canvas.width / 2, canvas.height / 2);
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);

    const scaleFactor = 50;
    sprite.scale.set(canvas.width / canvas.height * scaleFactor, scaleFactor, 1);

    return sprite;
  }

  _removePlayerMarker(playerName) {
    const marker = this._playerMarkers[playerName];
    if (marker) {
      this._threeContext.scene.remove(marker.group);

      if (marker.line) {
        marker.line.geometry.dispose();
        marker.line.material.dispose();
      }
      if (marker.sprite) {
        marker.sprite.material.map.dispose();
        marker.sprite.material.dispose();
      }

      delete this._playerMarkers[playerName];
    }
  }

  _clearAllPlayerMarkers() {
    for (const playerName of Object.keys(this._playerMarkers)) {
      this._removePlayerMarker(playerName);
    }
  }
}
