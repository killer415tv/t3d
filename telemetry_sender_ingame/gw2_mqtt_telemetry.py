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
