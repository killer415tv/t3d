import * as THREE from "three";
import DataRenderer from "./DataRenderer";

import type LocalReader from "../LocalReader/LocalReader";
import type Logger from "../Logger";

/**
 * Custom renderer for displaying markers from CSV data
 * Creates spheres at specified positions with labels
 *
 * @class CustomMarkersRenderer
 * @constructor
 * @extends DataRenderer
 */
export default class CustomMarkersRenderer extends DataRenderer {
    static rendererName = "CustomMarkersRenderer";

    constructor(localReader: LocalReader, settings: any, context: any, logger: typeof Logger) {
        super(localReader, settings, context, logger, "CustomMarkersRenderer");
    }

    /**
     * Parse CSV string into array of marker objects
     * @param {string} csvContent - CSV content string
     * @returns {Array} Array of marker objects
     */
    private parseCSV(csvContent: string): any[] {
        const lines = csvContent.trim().split('\n');
        const markers = [];

        // Skip header line
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Parse CSV line (handling commas within values)
            const parts = this.parseCSVLine(line);

            // Expected format: STEP,STEPNAME,X,Y,Z,RADIUS
            // Handle both old format (5 columns) and new format (6 columns)
            if (parts.length >= 5) {
                const marker: any = {
                    step: parseInt(parts[0], 10),
                    stepName: parts[1],
                    x: parseFloat(parts[2]),
                    y: parseFloat(parts[3]),
                    z: parseFloat(parts[4]),
                    radius: undefined
                };
                // If there's a 6th column and it's a valid number, it's the radius
                if (parts.length >= 6 && parts[5] !== undefined && parts[5] !== '') {
                    const parsedRadius = parseFloat(parts[5]);
                    if (!isNaN(parsedRadius)) {
                        marker.radius = parsedRadius;
                    }
                }
                markers.push(marker);
            }
        }

        return markers;
    }

    /**
     * Parse a single CSV line handling quoted values
     * @param {string} line - CSV line
     * @returns {string[]} Array of values
     */
    private parseCSVLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());

        return result;
    }

    renderAsync(callback: Function): void {
        const self = this;
        const meshes: any[] = [];
        const labels: any[] = [];

        // Get CSV content from settings
        const csvContent = this.settings.csvContent;

        if (!csvContent) {
            self.getOutput().meshes = [];
            self.getOutput().labels = [];
            return callback();
        }

        console.log("[CustomMarkersRenderer] Using direct coordinates from CSV");
        console.log("[CustomMarkersRenderer] CSV loaded, parsing...");

        // Parse CSV
        const markers = this.parseCSV(csvContent);

        // Create meshes for each marker
        for (const marker of markers) {
        // Get CSV scale from settings (default 39.4)
        const COORD_SCALE = this.settings.csvScale || 39.37;
        
        // Radius comes from CSV already in game units, convert to 3D units
        // Default radius: 15 units in CSV = 15 * 39.37 = 591 in 3D units
        const defaultRadius = 15 * COORD_SCALE;
        const markerRadius = marker.radius ? marker.radius * COORD_SCALE : defaultRadius;
        
        // Apply coordinate transformation from CSV to Three.js
        // Height is NOT inverted (Y stays positive)
        const pos = new THREE.Vector3(
            marker.x * COORD_SCALE,
            marker.y * COORD_SCALE,
            -marker.z * COORD_SCALE
        );
        
            console.log("[CustomMarkersRenderer] Marker", marker.step, "CSV:", marker.x, marker.y, marker.z, "R:", marker.radius, "→ T3D:", pos.x.toFixed(1), pos.y.toFixed(1), pos.z.toFixed(1), "radius:", markerRadius.toFixed(1));

            // Determine color based on step name
            let color = 0x0000ff; // Default blue for *
            if (marker.stepName === 'start') {
                color = 0x00ff00; // Green
            } else if (marker.stepName === 'reset') {
                color = 0xffaa00; // Orange/Yellow for reset
            } else if (marker.stepName === 'end') {
                color = 0xff0000; // Red
            } else if (marker.stepName === '*') {
                color = 0x0088ff; // Blue for *
            }

            // Create sphere geometry with the radius from CSV
            const geometry = new THREE.SphereGeometry(markerRadius, 32, 32);
            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.5
            });
            const sphere = new THREE.Mesh(geometry, material);

            // Position the sphere
            sphere.position.set(pos.x, pos.y, pos.z);

            // Store marker data
            sphere.userData = {
                step: marker.step,
                stepName: marker.stepName,
                csvX: marker.x,
                csvY: marker.y,
                csvZ: marker.z,
                x: pos.x,
                y: pos.y,
                z: pos.z,
                radius: markerRadius
            };

            meshes.push(sphere);

            // Create label (using sprite for text) - positioned at sphere edge + offset
            const labelSprite = this.createTextSprite(marker.step.toString());
            labelSprite.position.set(pos.x, pos.y + markerRadius + 50, pos.z);
            labels.push(labelSprite);
        }

        self.getOutput().meshes = meshes;
        self.getOutput().labels = labels;
        callback();
    }

    /**
     * Create a sprite with text label
     * @param {string} text - Text to display
     * @param {number} offset - Offset above sphere
     * @returns {THREE.Sprite} Sprite object
     */
    private createTextSprite(text: string): any {
        // Create canvas for text
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;

        const fontSize = 72;
        context.font = "bold " + fontSize + "px Arial, sans-serif";
        
        // Measure text AFTER setting font
        const textWidth = context.measureText(text).width;
        canvas.width = Math.max(textWidth + 40, 100);
        canvas.height = fontSize + 40;

        // Set font again after canvas resize
        context.font = "bold " + fontSize + "px Arial, sans-serif";
        context.fillStyle = '#ffffff';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        // Draw border/background
        context.strokeStyle = '#000000';
        context.lineWidth = 4;
        context.strokeText(text, canvas.width / 2, canvas.height / 2);
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);

        // Create sprite material
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true
        });

        // Create sprite - make it bigger
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(canvas.width / canvas.height * 200, 200, 1);

        return sprite;
    }
}
