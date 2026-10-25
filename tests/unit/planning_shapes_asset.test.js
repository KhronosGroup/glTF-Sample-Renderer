import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { glTF } from "../../source/gltf/gltf.js";

installWebGlConstants();

// Validates the hand-authored shapes asset. It lives outside both repos, in the planning
// folder, so this skips when that checkout is not present.

const here = dirname(fileURLToPath(import.meta.url));
const assetPath = join(here, "..", "..", "..", "..", "planning", "shapes_all.gltf");
const available = existsSync(assetPath);
const describeIfAvailable = available ? describe : describe.skip;

let warnings;
let errors;
beforeEach(() => {
    warnings = [];
    errors = [];
    vi.spyOn(console, "warn").mockImplementation((...args) => warnings.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args.join(" ")));
});
afterEach(() => {
    vi.restoreAllMocks();
});

function load() {
    const gltf = new glTF(assetPath);
    gltf.fromJson(JSON.parse(readFileSync(assetPath, "utf8")));
    return gltf;
}

describeIfAvailable("planning/shapes_all.gltf", () => {
    it("parses without warnings or errors", () => {
        load();

        expect(warnings).toEqual([]);
        expect(errors).toEqual([]);
    });

    it("covers every shape type the 2.1 schema defines", () => {
        const gltf = load();

        expect(new Set(gltf.shapes.map((shape) => shape.type))).toEqual(
            new Set(["box", "sphere", "cylinder", "capsule", "plane", "mesh", "convexMesh"])
        );
    });

    it("resolves every bounding volume to a shape that exists", () => {
        const gltf = load();
        const withVolumes = gltf.nodes.filter((node) => node.boundingVolume !== undefined);

        expect(withVolumes.length).toBeGreaterThan(0);
        for (const node of withVolumes) {
            expect(
                gltf.shapes[node.boundingVolume.shape],
                `${node.name} references a missing shape`
            ).toBeDefined();
        }
    });

    it("resolves every mesh shape to a mesh that exists", () => {
        const gltf = load();

        for (const shape of gltf.shapes) {
            const params = shape.parameters();
            if (params?.mesh !== undefined) {
                expect(gltf.meshes[params.mesh], `${shape.name}`).toBeDefined();
            }
        }
    });

    it("includes shapes that rely on the 2.1 defaults", () => {
        const gltf = load();
        const defaulted = gltf.shapes.filter((shape) => shape.parameters() === undefined);

        // A debug renderer that hardcodes the old KHR_implicit_shapes defaults draws
        // these at the wrong size, so the asset has to exercise them.
        expect(defaulted.map((shape) => shape.type).sort()).toEqual([
            "box",
            "capsule",
            "cylinder",
            "plane",
            "sphere"
        ]);
    });

    it("includes a bounding volume with a transform of its own", () => {
        const gltf = load();
        const transformed = gltf.nodes.find(
            (node) =>
                node.boundingVolume !== undefined &&
                Array.from(node.boundingVolume.translation).some((value) => value !== 0)
        );

        expect(transformed, "no node exercises the bounding volume TRS").toBeDefined();
        expect(Array.from(transformed.boundingVolume.scale)).not.toEqual([1, 1, 1]);
    });
});
