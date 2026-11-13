import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
    resolve: {
        alias: {
            // Resolve the engine entry through Node's module resolution so the alias
            // follows npm workspace hoisting (the package lives in the repo root's
            // node_modules, not the renderer's). The package's `exports` only defines
            // an "import" condition, which import.meta.resolve honours.
            "@khronosgroup/gltf-interactivity-engine": fileURLToPath(
                import.meta.resolve("@khronosgroup/gltf-interactivity-engine")
            )
        }
    },
    test: {
        // Unit tests cover parsing and container logic only; anything needing a GL
        // context belongs in the sample viewer's Playwright suite.
        environment: "node",
        include: ["tests/unit/**/*.test.js"],
        deps: {
            optimizer: {
                ssr: {
                    enabled: true,
                    // Pre-bundling resolves the package's extensionless internal imports
                    // and sidesteps the .js.map files it references but does not publish.
                    include: ["@khronosgroup/gltf-interactivity-engine"]
                }
            }
        }
    }
});
