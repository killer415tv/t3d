# Prompt: Implementación de seguimiento de jugador en tiempo real via MQTT para T3D Explorer

## Descripción de la función
Implementar un sistema de seguimiento de jugador en tiempo real para el T3D Explorer usando:
- MumbleLink para leer la posición del jugador desde Guild Wars 2
- MQTT para transmitir los datos de posición
- Visualización de un marcador 3D en el explorador

## Requisitos previos
- Python 3.6+
- Navegador compatible con WebGL 2
- Acceso a internet para conectarse a un broker MQTT público

## Pasos de implementación

### Paso 1: Crear el script Python para leer datos de MumbleLink y publicar via MQTT

Crea un archivo `gw2_mqtt_telemetry.py` en la carpeta `telemetry_sender_ingame` con el siguiente código:

```python
#!/usr/bin/env python3
import json
import time
import paho.mqtt.client as mqtt
from mumblelink import MumbleLink
from datetime import datetime

# MQTT Settings
MQTT_BROKER = "www.beetlerank.com"
MQTT_PORT = 1883
MQTT_TOPIC = "gw2/players/position"
MQTT_CLIENT_ID = f"gw2_player_{int(time.time())}"
MIN_UPDATE_INTERVAL = 0.5

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"Connected to MQTT broker {MQTT_BROKER}:{MQTT_PORT}")
    else:
        print(f"Failed to connect to MQTT broker, return code {rc}")

def on_disconnect(client, userdata, rc):
    print(f"Disconnected from MQTT broker with result code {rc}")

def on_publish(client, userdata, mid):
    pass

def main():
    print("Starting GW2 MQTT Telemetry Client")
    print(f"MQTT Broker: {MQTT_BROKER}:{MQTT_PORT}")
    print(f"Topic: {MQTT_TOPIC}")
    print(f"Min Update Interval: {MIN_UPDATE_INTERVAL}s")
    print("-" * 50)
    
    client = mqtt.Client(client_id=MQTT_CLIENT_ID)
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_publish = on_publish
    
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
    except Exception as e:
        print(f"Failed to connect to MQTT broker: {e}")
        return
    
    client.loop_start()
    
    print("Connected to MQTT broker. Waiting for Guild Wars 2...")
    
    try:
        ml = MumbleLink()
        print("Successfully initialized MumbleLink connection")
    except Exception as e:
        print(f"Failed to initialize MumbleLink: {e}")
        client.loop_stop()
        client.disconnect()
        return
    
    last_position = None
    last_update_time = 0
    update_count = 0
    
    try:
        while True:
            ml.read()
            
            identity_str = ml.data.identity.rstrip('\x00')
            try:
                identity_data = json.loads(identity_str)
                character_name = identity_data.get("name", "Unknown")
            except (json.JSONDecodeError, AttributeError):
                character_name = "Unknown"
            
            position_data = {
                'x': int(ml.data.fAvatarPosition[0]),
                'y': int(ml.data.fAvatarPosition[1]),
                'z': int(ml.data.fAvatarPosition[2]),
                'mapId': ml.context.mapId,
                'playerX': ml.context.playerX,
                'playerY': ml.context.playerY,
                'mapCenterX': ml.context.mapCenterX,
                'mapCenterY': ml.context.mapCenterY,
                'mapScale': ml.context.mapScale,
                'name': character_name,
                'timestamp': datetime.now().isoformat()
            }
            
            position_changed = False
            if last_position is None:
                position_changed = True
            elif (position_data['x'] != last_position['x'] or
                  position_data['y'] != last_position['y'] or
                  position_data['z'] != last_position['z']):
                position_changed = True
            
            current_time = time.time()
            time_since_last_update = current_time - last_update_time
            can_update = time_since_last_update >= MIN_UPDATE_INTERVAL
            
            if position_changed and can_update:
                payload = json.dumps({
                    'x': position_data['x'],
                    'y': position_data['y'],
                    'z': position_data['z'],
                    'mapId': position_data['mapId'],
                    'playerX': position_data.get('playerX'),
                    'playerY': position_data.get('playerY'),
                    'mapCenterX': position_data.get('mapCenterX'),
                    'mapCenterY': position_data.get('mapCenterY'),
                    'mapScale': position_data.get('mapScale'),
                    'name': position_data['name'],
                    'color': 0x00ff00,
                    'timestamp': position_data['timestamp']
                })
                
                result = client.publish(MQTT_TOPIC, payload)
                
                if result.rc == mqtt.MQTT_ERR_SUCCESS:
                    update_count += 1
                    if update_count % 10 == 0:
                        print(f"Published position update #{update_count}: "
                              f"({position_data['x']}, {position_data['y']}, {position_data['z']}) "
                              f"[{position_data['name']}]")
                else:
                    print(f"Failed to publish message: {result.rc}")
                
                last_position = position_data.copy()
                last_update_time = current_time
            
            time.sleep(0.05)
            
    except KeyboardInterrupt:
        print("\nShutting down...")
    except Exception as e:
        print(f"\nUnexpected error: {e}")
    finally:
        ml.close()
        client.loop_stop()
        client.disconnect()
        print("Disconnected from MQTT broker. Goodbye!")

if __name__ == "__main__":
    main()
```

### Paso 2: Instalar dependencias Python
Ejecuta el siguiente comando para instalar las librerías necesarias:

```bash
pip install paho-mqtt mumblelink
```

### Paso 3: Modificar el T3D Explorer para recibir y visualizar los datos

Modifica el archivo `explorer/src/renderer.js` para agregar:

#### 1. Constantes de configuración MQTT
Agrega estas constantes al principio del archivo:

```javascript
const MQTT_BROKER = "www.beetlerank.com";
const MQTT_PORT = 9001;
const MQTT_USE_SSL = true;
const PLAYER_TOPIC_PREFIX = "gw2/players";
```

#### 2. Propiedad para almacenar marcadores de jugador
Agrega esta propiedad al constructor de AppRenderer:

```javascript
this._playerMarkers = {};
this._mqttClient = undefined;
```

#### 3. Método para crear el badge de estado MQTT
Agrega este método a la clase AppRenderer:

```javascript
_createMqttStatusBadge() {
    const badge = document.createElement("div");
    badge.id = "mqtt-status-badge";
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
    indicator.id = "mqtt-indicator";
    indicator.style.cssText = `
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #666;
    `;
    
    const text = document.createElement("span");
    text.id = "mqtt-text";
    text.textContent = "MQTT: Connecting...";
    
    badge.appendChild(indicator);
    badge.appendChild(text);
    document.body.appendChild(badge);
    
    this._mqttBadge = { badge, indicator, text };
}

_updateMqttStatus(status) {
    if (!this._mqttBadge) return;
    
    const { indicator, text } = this._mqttBadge;
    
    switch (status) {
        case "connected":
            indicator.style.background = "#00ff00";
            text.textContent = "MQTT: Connected";
            break;
        case "error":
            indicator.style.background = "#ff0000";
            text.textContent = "MQTT: Error";
            break;
        case "disconnected":
            indicator.style.background = "#ffaa00";
            text.textContent = "MQTT: Disconnected";
            break;
        default:
            indicator.style.background = "#666";
            text.textContent = "MQTT: " + status;
    }
}
```

#### 4. Método para configurar la conexión MQTT
Agrega este método para manejar la conexión:

```javascript
_setupMqttConnection() {
    if (typeof Paho === "undefined" && typeof mqtt === "undefined") {
        console.warn("No MQTT library loaded, skipping MQTT connection");
        return;
    }
    
    if (typeof Paho !== "undefined") {
        this._setupPahoMqtt();
    } else {
        this._setupMqttJs();
    }
}

_setupPahoMqtt() {
    console.log(`Attempting Paho MQTT connection to ${MQTT_BROKER}:${MQTT_PORT} with SSL: ${MQTT_USE_SSL}...`);
    
    this._createMqttStatusBadge();
    this._updateMqttStatus("connecting");
    
    try {
        const clientId = "t3d-explorer-" + Math.floor(Math.random() * 10000);
        
        this._mqttClient = new Paho.MQTT.Client('www.beetlerank.com',9001,'/', clientId);
        
        const options = {
            timeout: 2000,
            useSSL: MQTT_USE_SSL,
            cleanSession: false,
            onSuccess: () => {
                console.log("Connected to MQTT broker");
                this._updateMqttStatus("connected");
                this._mqttClient.subscribe(PLAYER_TOPIC_PREFIX + "/#");
            },
            onFailure: (err) => {
                console.error("MQTT connection failed:", err);
                this._updateMqttStatus("error");
            },
        };
        
        this._mqttClient.onMessageArrived = (message) => {
            console.log("📨 MQTT message received!");
            console.log("  Topic:", message.destinationName);
            console.log("  Payload:", message.payloadString);
            this._handlePlayerMessage(message.destinationName, message.payloadString);
        };
        
        this._mqttClient.onConnectionLost = (err) => {
            console.log("MQTT connection lost:", err.errorMessage);
            this._updateMqttStatus("disconnected");
        };
        
        this._mqttClient.connect(options);
    } catch (err) {
        console.error("Failed to create Paho MQTT client:", err);
        this._updateMqttStatus("error");
    }
}

_setupMqttJs() {
    const protocol = MQTT_USE_SSL ? "wss://" : "ws://";
    console.log(`Attempting MQTT connection to ${protocol}${MQTT_BROKER}:${MQTT_PORT}...`);
    
    setTimeout(() => {
        this._connectToMqtt(protocol);
    }, 1000);
}

_connectToMqtt(protocol) {
    try {
        this._mqttClient = mqtt.connect(`${protocol}${MQTT_BROKER}:${MQTT_PORT}`, {
            clientId: `t3d-explorer-${Math.random().toString(16).slice(2, 10)}`,
            keepalive: 60,
            clean: true,
            connectTimeout: 10000,
            reconnectPeriod: 5000,
            rejectUnauthorized: false,
        });
        
        this._createMqttStatusBadge();
        
        this._mqttClient.on("connect", () => {
            console.log(`Connected to MQTT broker on port ${MQTT_PORT}`);
            this._updateMqttStatus("connected");
            this._mqttClient.subscribe(`${PLAYER_TOPIC_PREFIX}/#`, (err) => {
                if (err) {
                    console.error("MQTT subscription error:", err);
                } else {
                    console.log("Subscribed to player positions");
                }
            });
        });
        
        this._mqttClient.on("message", (topic, message) => {
            this._handlePlayerMessage(topic, message);
        });
        
        this._mqttClient.on("error", (err) => {
            console.error("MQTT error:", err.message);
            this._updateMqttStatus("error");
        });
        
        this._mqttClient.on("close", () => {
            console.log("MQTT connection closed");
            this._updateMqttStatus("disconnected");
        });
        
        this._mqttClient.on("offline", () => {
            console.log("MQTT client offline");
        });
    } catch (err) {
        console.error("Failed to setup MQTT:", err);
    }
}
```

#### 5. Método para manejar mensajes MQTT y convertir coordenadas
Agrega este método para procesar los mensajes y convertir coordenadas:

```javascript
_handlePlayerMessage(topic, message) {
    console.log("📩 Processing message from topic:", topic);
    
    if (this._threeContext.camera) {
        const camPos = this._threeContext.camera.position;
        console.log("📷 Camera position:", camPos.x, camPos.y, camPos.z);
    }
    
    try {
        const playerData = JSON.parse(message.toString());
        const { x, y, z, name, color, mapId } = playerData;

        if (name === undefined || x === undefined || y === undefined || z === undefined) {
            console.warn("⚠️ Invalid player data - missing fields");
            return;
        }

        console.log("✅ Creating marker for player:", name, "at position:", x, y, z, "mapId:", mapId);

        const METERS_TO_INCHES = 39.3701;
        const t3dPosition = new THREE.Vector3(
            x * METERS_TO_INCHES,
            -y * METERS_TO_INCHES,
            z * METERS_TO_INCHES
        );
        
        console.log("🔄 Final T3D position (meters to inches):", t3dPosition.x, t3dPosition.y, t3dPosition.z);
        
        this._updatePlayerMarker(name, t3dPosition, color || 0x00ff00);
    } catch (err) {
        console.error("Error parsing player message:", err);
    }
}
```

#### 6. Método para crear y actualizar el marcador del jugador
Agrega este método para renderizar el marcador:

```javascript
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
        new THREE.Vector3(0, lineHeight, 0)
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
        sprite: nameSprite
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
```

#### 7. Llamar a _setupMqttConnection en el constructor o en setupScene
Agrega una llamada en el método `setupScene()` de AppRenderer:

```javascript
this._setupMqttConnection();
```

### Paso 4: Modificar el UI para manejar la limpieza de marcadores
Agrega una llamada a `_clearAllPlayerMarkers()` en el método `cleanupMap()` para eliminar los marcadores cuando se cambia de mapa:

```javascript
_cleanupMap() {
    // ... existing code ...
    this._clearAllPlayerMarkers();
}
```

### Paso 5: Actualizar el index.html para incluir bibliotecas MQTT
Asegúrate de que el archivo `index.html` de la carpeta `explorer` incluya la librería Paho MQTT:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/paho-mqtt/1.0.2/mqttws31.min.js"></script>
```

### Paso 6: Construir y probar
1. Construye el proyecto usando `build.bat`
2. Inicia el servidor local del explorador:
   ```bash
   cd explorer
   npm run serve
   ```
3. Ejecuta el script Python:
   ```bash
   python telemetry_sender_ingame/gw2_mqtt_telemetry.py
   ```
4. Abre el explorador en `http://localhost:8000`
5. Inicia Guild Wars 2 y verifica que el marcador se muestre correctamente

## Solución de problemas
- Si no se muestra el marcador: Verifica la consola del navegador para errores
- Si el script Python no detecta GW2: Asegúrate de que el juego esté ejecutándose
- Si no se conecta al broker MQTT: Verifica tu conexión a internet

## Explicación de la conversión de coordenadas
Las coordenadas del jugador en GW2 se reciben en metros. Para convertirlas al sistema de coordenadas de T3D:
1. Multiplicamos por 39.3701 para convertir de metros a pulgadas (factor de conversión)
2. Invertimos el eje Y para ajustarse a la orientación de Three.js

## Notas importantes
- El sistema usa un broker MQTT público gratuito (`www.beetlerank.com`)
- El script Python debe estar ejecutándose mientras se usa el explorador
- GW2 debe estar en modo de juego (no en menú principal) para que MumbleLink funcione

## Archivos modificados/creados
1. `telemetry_sender_ingame/gw2_mqtt_telemetry.py` (nuevo)
2. `explorer/src/renderer.js` (modificado)
3. `explorer/index.html` (modificado)
