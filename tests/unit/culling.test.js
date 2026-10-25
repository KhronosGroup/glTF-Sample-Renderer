import { describe, expect, it } from "vitest";
import { mat4 } from "gl-matrix";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { cullNodes } from "../../source/Renderer/culling.js";
import { gltfBoundingVolume } from "../../source/gltf/bounding_volume.js";
import { gltfShape } from "../../source/gltf/shape.js";

installWebGlConstants();

// Correct culling is invisible by definition: whatever it removes was off screen. So
// these assert the decision directly rather than through pixels.

const viewProjection = mat4.multiply(
    mat4.create(),
    mat4.perspective(mat4.create(), Math.PI / 4, 1, 0.1, 100),
    mat4.lookAt(mat4.create(), [0, 0, 0], [0, 0, -1], [0, 1, 0])
);

function shapeOf(json) {
    const shape = new gltfShape();
    shape.fromJson(json);
    return shape;
}

function documentOf(shapes) {
    return { shapes: shapes.map(shapeOf) };
}

function nodeAt(translation, { shape = 0, document, ...rest } = {}) {
    const boundingVolume = new gltfBoundingVolume();
    boundingVolume.fromJson({ shape });
    return {
        boundingVolume,
        ownerDocument: document,
        worldTransform: mat4.fromTranslation(mat4.create(), translation),
        ...rest
    };
}

const UNIT_BOX = documentOf([{ type: "box", box: { size: [1, 1, 1] } }]);

describe("culling by bounding volume", () => {
    it("keeps a node in view and rejects one behind the camera", () => {
        const inView = nodeAt([0, 0, -5], { document: UNIT_BOX });
        const behind = nodeAt([0, 0, 20], { document: UNIT_BOX });

        const culled = cullNodes([inView, behind], viewProjection);

        expect(inView.culled).toBe(false);
        expect(behind.culled).toBe(true);
        expect(culled).toBe(1);
    });

    it("leaves a node without a bounding volume alone", () => {
        // No volume says nothing about where the geometry is, so it must still draw.
        const node = { worldTransform: mat4.fromTranslation(mat4.create(), [0, 0, 500]) };

        cullNodes([node], viewProjection, { fallbackDocument: UNIT_BOX });

        expect(node.culled).toBe(false);
    });

    it("applies the volume's own transform, not just the node's", () => {
        // The node is in view but its volume is pushed far behind the camera.
        const node = nodeAt([0, 0, -5], { document: UNIT_BOX });
        node.boundingVolume.translation = [0, 0, 100];

        cullNodes([node], viewProjection);

        expect(node.culled).toBe(true);
    });

    it("never rejects an infinite plane, whose extent is unknown", () => {
        const node = nodeAt([0, 0, 500], { document: documentOf([{ type: "plane" }]) });

        cullNodes([node], viewProjection);

        expect(node.culled).toBe(false);
    });

    it("never rejects a node drawn as part of an instanced group", () => {
        // The group is one draw call covering several transforms, so one member's volume
        // cannot speak for it.
        const node = nodeAt([0, 0, 500], { document: UNIT_BOX });

        cullNodes([node], viewProjection, { isInstanced: () => true });

        expect(node.culled).toBe(false);
    });

    it("never rejects a GPU-instanced node", () => {
        const node = nodeAt([0, 0, 500], {
            document: UNIT_BOX,
            instanceMatrices: [mat4.create()]
        });

        cullNodes([node], viewProjection);

        expect(node.culled).toBe(false);
    });

    it("resolves the shape against the node's own document", () => {
        // Index 0 means different shapes in different documents. Resolving against the
        // wrong one would measure the wrong volume.
        const tiny = documentOf([{ type: "box", box: { size: [0.1, 0.1, 0.1] } }]);
        const huge = documentOf([{ type: "box", box: { size: [1000, 1000, 1000] } }]);
        const withTiny = nodeAt([0, 0, 60], { document: tiny });
        const withHuge = nodeAt([0, 0, 60], { document: huge });

        cullNodes([withTiny, withHuge], viewProjection, { fallbackDocument: tiny });

        expect(withTiny.culled).toBe(true);
        expect(withHuge.culled).toBe(false);
    });

    it("leaves a node whose shape index does not resolve", () => {
        const node = nodeAt([0, 0, 500], { shape: 7, document: UNIT_BOX });

        cullNodes([node], viewProjection);

        expect(node.culled).toBe(false);
    });

    it("clears a stale decision when the node comes back into view", () => {
        const node = nodeAt([0, 0, 20], { document: UNIT_BOX });
        cullNodes([node], viewProjection);
        expect(node.culled).toBe(true);

        node.worldTransform = mat4.fromTranslation(mat4.create(), [0, 0, -5]);
        cullNodes([node], viewProjection);

        expect(node.culled).toBe(false);
    });
});
