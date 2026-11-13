import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
    resolve: {
        alias: {
            // The package declares `main` as a .ts file it does not publish, so
            // node-style resolution fails. Only its `browser` entry actually exists, and
            // that is what the browser bundle uses, so point straight at it.
            "@khronosgroup/gltf-interactivity-engine": fileURLToPath(
                new URL(
                    "./node_modules/@khronosgroup/gltf-interactivity-engine/build/index.js",
                    import.meta.url
                )
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
