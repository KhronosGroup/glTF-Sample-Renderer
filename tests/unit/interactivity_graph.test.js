import { describe, expect, it } from "vitest";

import { installWebGlConstants } from "../helpers/webgl_constants.js";
import { GraphController } from "../../source/gltf/interactivity.js";

installWebGlConstants();

describe("GraphController resetGraph", () => {
    it("clears the engine without rejecting an empty graph", () => {
        const controller = new GraphController();

        // With no world attached, resetGraph clears the engine and returns early.
        // It must not feed the engine a shaped-but-empty graph, which the schema
        // (minItems: 1) rejects with GraphRejectedError.
        expect(() => controller.decorator.resetGraph()).not.toThrow();
    });
});
