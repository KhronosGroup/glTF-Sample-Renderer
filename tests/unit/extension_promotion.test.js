import { describe, expect, it } from "vitest";

import { gltfMaterial } from "../../source/gltf/material.js";
import { gltfNode } from "../../source/gltf/node.js";

// glTF 2.1 promotes KHR_materials_emissive_strength and KHR_node_visibility into core.
// Both spellings have to keep working and, because they are bound to one
// AnimatableProperty, a write through either has to be visible through the other.

describe("material.emissiveStrength", () => {
    it("reads the core property", () => {
        const material = new gltfMaterial();
        material.fromJson({ emissiveStrength: 5 });

        expect(material.emissiveStrength).toBe(5);
        expect(material.hasEmissiveStrength).toBe(true);
    });

    it("adopts the extension value when no core property is present", () => {
        const material = new gltfMaterial();
        material.fromJson({
            extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } }
        });

        expect(material.emissiveStrength).toBe(3);
        expect(material.hasEmissiveStrength).toBe(true);
    });

    it("propagates writes from the extension property to the core property", () => {
        const material = new gltfMaterial();
        material.fromJson({
            extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } }
        });

        material.extensions.KHR_materials_emissive_strength.emissiveStrength = 7;

        expect(material.emissiveStrength).toBe(7);
    });

    it("propagates writes from the core property to the extension property", () => {
        const material = new gltfMaterial();
        material.fromJson({
            extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } }
        });

        material.emissiveStrength = 9;

        expect(material.extensions.KHR_materials_emissive_strength.emissiveStrength).toBe(9);
    });

    it("prefers the core property when an asset specifies both", () => {
        const material = new gltfMaterial();
        material.fromJson({
            emissiveStrength: 2,
            extensions: { KHR_materials_emissive_strength: { emissiveStrength: 8 } }
        });

        expect(material.emissiveStrength).toBe(2);
    });

    it("defaults to 1.0 and stays out of the shader when unspecified", () => {
        const material = new gltfMaterial();
        material.fromJson({});

        expect(material.emissiveStrength).toBe(1.0);
        expect(material.hasEmissiveStrength).toBe(false);
    });
});

describe("node.visible", () => {
    it("reads the core property", () => {
        const node = new gltfNode();
        node.fromJson({ visible: false });

        expect(node.visible).toBe(false);
    });

    it("adopts the extension value when no core property is present", () => {
        const node = new gltfNode();
        node.fromJson({ extensions: { KHR_node_visibility: { visible: false } } });

        expect(node.visible).toBe(false);
    });

    it("propagates writes from the extension property to the core property", () => {
        const node = new gltfNode();
        node.fromJson({ extensions: { KHR_node_visibility: { visible: false } } });

        node.extensions.KHR_node_visibility.visible = true;

        expect(node.visible).toBe(true);
    });

    it("propagates writes from the core property to the extension property", () => {
        const node = new gltfNode();
        node.fromJson({ extensions: { KHR_node_visibility: { visible: true } } });

        node.visible = false;

        expect(node.extensions.KHR_node_visibility.visible).toBe(false);
    });

    it("prefers the core property when an asset specifies both", () => {
        const node = new gltfNode();
        node.fromJson({ visible: true, extensions: { KHR_node_visibility: { visible: false } } });

        expect(node.visible).toBe(true);
    });

    it("defaults to visible", () => {
        const node = new gltfNode();
        node.fromJson({});

        expect(node.visible).toBe(true);
    });
});
