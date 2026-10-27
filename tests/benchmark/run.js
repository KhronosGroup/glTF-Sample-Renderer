import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, styleText } from "node:util";
import { chromium } from "@playwright/test";

import { fetchEnvironment, fetchModels } from "../regression/fetch_assets.js";
import { startServer } from "../regression/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(here, "../..");
const regressionDir = path.resolve(here, "../regression");
const outputRoot = path.join(rendererRoot, "regression");
const resultsRoot = path.join(outputRoot, "benchmarks");

const { values: args } = parseArgs({
    options: {
        models: {
            type: "string",
            default: "ABeautifulGame,NodePerformanceTest,Sponza,BrainStem,VirtualCity"
        },
        frames: { type: "string", default: "120" },
        rounds: { type: "string", default: "3" },
        width: { type: "string", default: "1920" },
        height: { type: "string", default: "1080" },
        label: { type: "string" },
        against: { type: "string" },
        headed: { type: "boolean", default: false }
    }
});

const git = (...gitArgs) =>
    execFileSync("git", gitArgs, { cwd: rendererRoot, encoding: "utf8" }).trim();
const label = args.label ?? git("rev-parse", "--short", "HEAD");
const resultFile = (name) => path.join(resultsRoot, `${name}.json`);

async function main() {
    if (!existsSync(path.join(rendererRoot, "dist", "gltf-viewer.module.js"))) {
        console.error(styleText("red", "dist/ is missing. Run `npm run build` first."));
        process.exit(2);
    }
    const against = args.against
        ? JSON.parse(await readFile(resultFile(args.against), "utf8"))
        : undefined;

    const lock = JSON.parse(await readFile(path.join(regressionDir, "assets.lock.json"), "utf8"));
    const environment = await fetchEnvironment(lock, outputRoot);
    const models = await fetchModels(lock, outputRoot, args.models.split(","));

    const server = await startServer(
        {
            "/dist/": path.join(rendererRoot, "dist"),
            "/libs/": path.join(rendererRoot, "dist", "libs"),
            "/assets/images/": path.join(rendererRoot, "assets", "images"),
            "/node_modules/": path.join(rendererRoot, "node_modules"),
            "/models/": path.join(outputRoot, "models"),
            "/environments/": path.join(outputRoot, "environments")
        },
        path.join(here, "page", "index.html")
    );
    const browser = await chromium.launch({
        channel: "chromium",
        headless: !args.headed,
        args: ["--ignore-gpu-blocklist", "--enable-gpu"]
    });

    const width = Number(args.width);
    const height = Number(args.height);
    const results = { label, width, height, models: {} };
    console.log(
        styleText("bold", `Benchmark ${label}`) +
            styleText("dim", `  ${width}x${height}, ${args.frames} frames x ${args.rounds}`)
    );
    console.log(
        styleText(
            "dim",
            `  ${"model".padEnd(22)} ${"cpu ms".padStart(8)} ${"frame ms".padStart(9)}` +
                (against ? `   ${"cpu".padStart(7)} ${"frame".padStart(7)}` : "")
        )
    );

    try {
        for (const model of models) {
            if (model.error) {
                console.log(`  ${model.name.padEnd(22)} ${styleText("magenta", model.error)}`);
                continue;
            }
            const page = await browser.newPage({
                viewport: { width, height },
                deviceScaleFactor: 1
            });
            const query = new URLSearchParams({
                model: `/${model.url}`,
                environment: `/${environment}`,
                width,
                height
            });
            await page.goto(`${server.url}/?${query}`);
            const result = await page.evaluate(
                async ([frames, rounds]) => {
                    const benchmark = await window.benchmark;
                    return { gpu: benchmark.gpu, ...(await benchmark.measure(frames, rounds)) };
                },
                [Number(args.frames), Number(args.rounds)]
            );
            await page.close();
            results.gpu = result.gpu;
            results.models[model.name] = { cpuMs: result.cpuMs, frameMs: result.frameMs };

            let line = `  ${model.name.padEnd(22)} ${result.cpuMs.toFixed(2).padStart(8)} ${result.frameMs.toFixed(2).padStart(9)}`;
            const previous = against?.models[model.name];
            if (previous) {
                const change = (now, before) => {
                    const ratio = now / before - 1;
                    const text = `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(0)}%`.padStart(7);
                    return styleText(ratio <= 0 ? "green" : "red", text);
                };
                line += `   ${change(result.cpuMs, previous.cpuMs)} ${change(result.frameMs, previous.frameMs)}`;
            }
            console.log(line);
        }
    } finally {
        await browser.close();
        await server.close();
    }

    await mkdir(resultsRoot, { recursive: true });
    await writeFile(resultFile(label), JSON.stringify(results, null, 4));
    console.log(
        styleText("dim", `${results.gpu}\nSaved ${path.relative(rendererRoot, resultFile(label))}`)
    );
}

await main();
