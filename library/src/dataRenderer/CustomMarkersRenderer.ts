import * as THREE from "three";
import DataRenderer from "./DataRenderer";

import type LocalReader from "../LocalReader/LocalReader";
import type Logger from "../Logger";
import type { Mesh, Sprite, SphereGeometry, MeshBasicMaterial, SpriteMaterial, CanvasTexture, AxesHelper } from "three";

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

            if (parts.length >= 5) {
                markers.push({
                    step: parseInt(parts[0], 10),
                    stepName: parts[1],
                    x: parseFloat(parts[2]),
                    y: parseFloat(parts[3]),
                    z: parseFloat(parts[4])
                });
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
        const sphereRadius = this.settings.sphereRadius || 15;
        const labelOffset = this.settings.labelOffset || 30;

        if (!csvContent) {
            self.getOutput().meshes = [];
            self.getOutput().labels = [];
            return callback();
        }

        // Get map bounds from TerrainRenderer to calculate correct offset
        let mapBounds = null;
        let propPositions: number[] = [];
        
        try {
            mapBounds = T3D.getContextValue(this.context, T3D.TerrainRenderer, "bounds", null);
            console.log("[CustomMarkersRenderer] Map bounds:", mapBounds);
            
            // Get some prop positions to compare
            const propMeshes = T3D.getContextValue(this.context, T3D.PropertiesRenderer, "meshes", null);
            if (propMeshes && propMeshes.length > 0) {
                // Get first 3 prop positions for reference
                let count = 0;
                for (const mesh of propMeshes) {
                    if (count >= 3) break;
                    propPositions.push(mesh.position.x, mesh.position.y, mesh.position.z);
                    console.log("[CustomMarkersRenderer] Sample prop position (T3D coords):", mesh.position.x, mesh.position.y, mesh.position.z);
                    count++;
                }
            }
        } catch (e) {
            console.log("[CustomMarkersRenderer] No map bounds available");
        }

        console.log("[CustomMarkersRenderer] Using direct coordinates from CSV");

        console.log("[CustomMarkersRenderer] CSV loaded, parsing...");

        // Parse CSV
        const markers = this.parseCSV(csvContent);

        // Create meshes for each marker
        for (const marker of markers) {
        // Get CSV scale from settings (default 39.4)
        const COORD_SCALE = this.settings.csvScale || 39.4;
        
        // Apply coordinate transformation from CSV to Three.js
        // Height is NOT inverted (Y stays positive)
        const pos = new THREE.Vector3(
            marker.x * COORD_SCALE,
            marker.y * COORD_SCALE,
            -marker.z * COORD_SCALE
        );
        
            console.log("[CustomMarkersRenderer] Marker", marker.step, "CSV:", marker.x, marker.y, marker.z, "→ T3D:", pos.x.toFixed(1), pos.y.toFixed(1), pos.z.toFixed(1));

            // Determine color based on step name
            let color = 0x00ff00; // Green for regular points
            if (marker.stepName === 'start') {
                color = 0x00ff00; // Green
            } else if (marker.stepName === 'reset') {
                color = 0xffaa00; // Orange
            } else if (marker.stepName === 'end') {
                color = 0xff0000; // Red
            } else if (marker.stepName === '*') {
                color = 0xffff00; // Yellow
            }

            // Create sphere geometry
            const geometry = new THREE.SphereGeometry(sphereRadius, 16, 16);
            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.8
            });
            const sphere = new THREE.Mesh(geometry, material);

            // Position the sphere
            sphere.position.set(pos.x, pos.y, pos.z);

            // Store marker data for label creation
            sphere.userData = {
                step: marker.step,
                stepName: marker.stepName,
                csvX: marker.x,
                csvY: marker.y,
                csvZ: marker.z,
                x: pos.x,
                y: pos.y,
                z: pos.z
            };

            meshes.push(sphere);

            // Add axis as child of sphere for debugging
            const axisHelper = new THREE.AxesHelper(200);
            sphere.add(axisHelper);

            // Create vertical line from ground to sky (debugging aid)
            const lineGeometry = new THREE.BufferGeometry();
            const linePoints = [
                pos.x, pos.y - 5000, pos.z,  // Start below ground
                pos.x, pos.y + 5000, pos.z   // Go 5000 units up
            ];
            lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
            const lineMaterial = new THREE.LineBasicMaterial({ color: color });
            const line = new THREE.Line(lineGeometry, lineMaterial);
            meshes.push(line);

            // Create label (using sprite for text)
            const labelSprite = this.createTextSprite(
                marker.step.toString(),
                labelOffset
            );
            labelSprite.position.set(pos.x, pos.y + labelOffset, pos.z);
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
    private createTextSprite(text: string, offset: number): any {
        // Create canvas for text
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;

        canvas.width = 128;
        canvas.height = 64;

        // Draw background
        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Draw border
        context.strokeStyle = '#ffffff';
        context.lineWidth = 2;
        context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

        // Draw text
        context.font = 'bold 36px Arial';
        context.fillStyle = '#ffffff';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);

        // Create sprite material
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true
        });

        // Create sprite
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(40, 20, 1);

        return sprite;
    }
}
