import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Unit tests cover parsing and container logic only; anything needing a GL
        // context belongs in the sample viewer's Playwright suite.
        environment: "node",
        include: ["tests/unit/**/*.test.js"]
    }
});
