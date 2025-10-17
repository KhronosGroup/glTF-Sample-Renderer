import { expect } from "@playwright/test";
import { test } from "./baseTestConfig";
import { ResourceLoader } from "../source/ResourceLoader/resource_loader";
import { GltfState } from "../source/GltfState/gltf_state";
import { GltfView } from "../source/GltfView/gltf_view";
import fs from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

declare global {
    interface Window {
        resourceLoader: ResourceLoader;
        state: GltfState;
        view: GltfView;
        TEST_TIME: number;
        TEST_RESULT: boolean;
        passTestData: (input: number | boolean) => void;
    }
}

const directories = fs.readdirSync(`${__dirname}/testAssetDownloads`);
for (const dir of directories) {
    const configFile = `${__dirname}/testAssetDownloads/${dir}/test-index.json`;
    if (fs.existsSync(configFile)) {
        const fileContents = fs.readFileSync(configFile, "utf-8");
        const testAssets = JSON.parse(fileContents);
        for (const asset of testAssets) {
            if (asset.path) {
                const path = asset.path;
                const file = new Uint8Array(fs.readFileSync(path));
                const testName = path.substring(path.lastIndexOf("/testAssetDownloads/") + 19);
                test(`Testing asset ${testName}`, async ({ page }) => {
                    await page.goto("");
                    let testDuration : number | undefined = undefined;
                    let testResult : boolean | undefined = undefined;
                    const fun = (input: number | boolean) => {
                        if (typeof input === "number") {
                            testDuration = input;
                        } else if (typeof input === "boolean") {
                            testResult = input;
                        }
                    }
                    await page.exposeFunction("passTestData", fun);
                    const success = await page.evaluate(async (file) => {
                        const resourceLoader = window.resourceLoader as ResourceLoader;
                        const state = window.state as GltfState;
                        const glTF = await resourceLoader.loadGltf(file.buffer);
                        state.gltf = glTF;
                        const defaultScene = state.gltf.scene;
                        state.sceneIndex = defaultScene === undefined ? 0 : defaultScene;
                        state.cameraNodeIndex = undefined;
                        state.graphController.addCustomEventListener("test/onStart", (event) => {
                            window.passTestData(event.detail.expectedDuration);
                            window.TEST_TIME = event.detail.expectedDuration;
                        });
                        state.graphController.addCustomEventListener("test/onSuccess", () => {
                            window.passTestData(true);
                            window.TEST_RESULT = true;
                        });
                        state.graphController.addCustomEventListener("test/onFailed", () => {
                            window.passTestData(false);
                            window.TEST_RESULT = false;
                        });
                        state.animationTimer.start();
                        if (state.gltf?.extensions?.KHR_interactivity?.graphs !== undefined) {
                            state.graphController.initializeGraphs(state);
                            const graphIndex = state.gltf.extensions.KHR_interactivity.graph ?? 0;
                            state.graphController.startGraph(graphIndex);
                            state.graphController.resumeGraph();
                        } else {
                            state.graphController.stopGraphEngine();
                        }
                        return true;
                    }, file);
                    expect(success).toBeTruthy();
                    await page.waitForFunction(() => {
                        return window.TEST_TIME !== undefined;
                    }, {timeout: 2000});
                    if (testDuration! > 0) {
                        console.log("Test duration (s): ", testDuration);
                    }
                    await page.waitForFunction(() => {
                        return window.TEST_RESULT !== undefined;
                    }, {timeout: testDuration! * 1000 + 1000});
                    if (testResult === false) {
                        console.log(await page.consoleMessages());
                    }
                    expect(testResult).toBe(true);
                });
            }
        }
    }
}
