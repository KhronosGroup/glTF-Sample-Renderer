import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, styleText } from "node:util";
import { chromium } from "@playwright/test";

import { comparePngs } from "./compare.js";
import { fetchEnvironment, fetchModels } from "./fetch_assets.js";
import { startServer } from "./server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(here, "../..");
const outputRoot = path.join(rendererRoot, "regression");
const renderingsRoot = path.join(outputRoot, "renderings");
const summaryFile = path.join(renderingsRoot, "summary.json");

const SAMPLE_INTERVAL_MS = 250;
const MAX_FRAMES = 40;
const LOAD_TIMEOUT_MS = 120_000;
const CAPTURE_TIMEOUT_MS = 30_000;
const MAX_CONSOLE_ERRORS = 20;

const { values: args } = parseArgs({
    options: {
        baseline: { type: "boolean", default: false },
        compare: { type: "boolean", default: false },
        models: { type: "string" },
        width: { type: "string", default: "1920" },
        height: { type: "string", default: "1080" },
        threshold: { type: "string", default: "0.1" },
        "max-diff-ratio": { type: "string", default: "0.001" },
        headed: { type: "boolean", default: false }
    }
});

if (args.baseline === args.compare) {
    console.error(
        "Usage: node tests/regression/run.js --baseline | --compare [--models A,B] [--width 1920]\n" +
            "       [--height 1080] [--threshold 0.1] [--max-diff-ratio 0.001] [--headed]"
    );
    process.exit(2);
}

const kind = args.baseline ? "baseline" : "candidate";
const width = Number(args.width);
const height = Number(args.height);
const threshold = Number(args.threshold);
const maxDiffRatio = Number(args["max-diff-ratio"]);

const BADGES = {
    baseline: ["cyan", "DONE"],
    pass: ["green", "PASS"],
    fail: ["red", "FAIL"],
    "missing-baseline": ["yellow", "MISSING"],
    error: ["magenta", "ERROR"]
};
const badge = (status) => {
    const [color, label] = BADGES[status];
    return styleText([color, "bold"], label.padEnd(7));
};
const dim = (text) => styleText("dim", text);
const percent = (ratio) => `${(ratio * 100).toFixed(3)}%`;

const frameFile = (name, timeMs, type) =>
    `${name}/t${String(timeMs).padStart(5, "0")}ms.${type}.png`;

function timepointsMs(durationSec) {
    const durationMs = Math.round(durationSec * 1000);
    const count = Math.min(MAX_FRAMES, Math.floor(durationMs / SAMPLE_INTERVAL_MS) + 1);
    return Array.from({ length: count }, (_, i) => i * SAMPLE_INTERVAL_MS);
}

function withTimeout(promise, ms, what) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function rendererRevision() {
    const git = (...gitArgs) =>
        execFileSync("git", gitArgs, { cwd: rendererRoot, encoding: "utf8" }).trim();
    try {
        return {
            branch: git("rev-parse", "--abbrev-ref", "HEAD"),
            commit: git("rev-parse", "HEAD"),
            dirty: git("status", "--porcelain", "--", "source") !== ""
        };
    } catch {
        return undefined;
    }
}

async function loadSummary(lock) {
    const fresh = {
        sampleAssets: lock.sampleAssets,
        environment: lock.environment,
        resolution: { width, height },
        runs: {},
        models: {}
    };
    if (!existsSync(summaryFile)) {
        return fresh;
    }
    const summary = JSON.parse(await readFile(summaryFile, "utf8"));
    const compatible =
        summary.sampleAssets?.commit === lock.sampleAssets.commit &&
        summary.sampleAssets?.variant === lock.sampleAssets.variant &&
        summary.environment?.commit === lock.environment.commit &&
        summary.environment?.file === lock.environment.file &&
        summary.resolution?.width === width &&
        summary.resolution?.height === height;
    if (compatible) {
        return summary;
    }
    if (kind === "candidate") {
        console.error(
            styleText(
                "red",
                "The baseline was rendered with a different asset pin or resolution. Run --baseline first."
            )
        );
        process.exit(2);
    }
    await rm(renderingsRoot, { recursive: true, force: true });
    return fresh;
}

// Candidate and diff files of a previous compare run are stale once a new run starts.
async function removeRenderings(name, types) {
    const dir = path.join(renderingsRoot, name);
    const files = await readdir(dir).catch(() => []);
    await Promise.all(
        files
            .filter((file) => types.some((type) => file.endsWith(`.${type}.png`)))
            .map((file) => rm(path.join(dir, file)))
    );
}

async function renderModel(page, serverUrl, environment, model, previous) {
    const query = new URLSearchParams({
        model: `/${model.file}`,
        environment: `/${environment}`,
        width,
        height
    });
    await page.goto(`${serverUrl}/?${query}`);
    const info = await withTimeout(
        page.evaluate(async () => (await window.regression).info),
        LOAD_TIMEOUT_MS,
        "loading"
    );

    const baselines = new Map(
        (previous?.frames ?? []).filter((f) => f.baseline).map((f) => [f.timeMs, f.baseline])
    );
    await mkdir(path.join(renderingsRoot, model.name), { recursive: true });

    const frames = [];
    for (const timeMs of timepointsMs(info.durationSec)) {
        const dataUrl = await withTimeout(
            page.evaluate(async (t) => (await window.regression).capture(t), timeMs / 1000),
            CAPTURE_TIMEOUT_MS,
            `capture at ${timeMs} ms`
        );
        const file = frameFile(model.name, timeMs, kind);
        const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
        await writeFile(path.join(renderingsRoot, file), png);

        if (kind === "baseline") {
            frames.push({ timeMs, baseline: file });
            continue;
        }
        const baseline = baselines.get(timeMs);
        baselines.delete(timeMs);
        if (baseline === undefined) {
            frames.push({ timeMs, candidate: file, status: "missing-baseline" });
            continue;
        }
        const diff = frameFile(model.name, timeMs, "diff");
        const result = await comparePngs(
            path.join(renderingsRoot, baseline),
            path.join(renderingsRoot, file),
            path.join(renderingsRoot, diff),
            threshold
        );
        frames.push({
            timeMs,
            baseline,
            candidate: file,
            diff,
            ...result,
            status: result.diffRatio > maxDiffRatio ? "fail" : "pass"
        });
    }
    // Baseline frames the candidate no longer reaches, e.g. because the animation got shorter.
    for (const [timeMs, baseline] of baselines) {
        frames.push({ timeMs, baseline, status: "fail", error: "no candidate frame" });
    }
    frames.sort((a, b) => a.timeMs - b.timeMs);

    return { durationMs: Math.round(info.durationSec * 1000), frames, gpu: info.gpu };
}

function modelStatus(frames) {
    if (kind === "baseline") {
        return "baseline";
    }
    if (frames.some((f) => f.status === "fail")) {
        return "fail";
    }
    if (frames.some((f) => f.status === "missing-baseline")) {
        return "missing-baseline";
    }
    return "pass";
}

function printModel(name, entry, nameWidth) {
    const count = `${entry.frames.length} frame${entry.frames.length === 1 ? "" : "s"}`;
    let detail = dim(count.padEnd(10));
    if (entry.error) {
        detail += styleText("magenta", entry.error);
    } else if (entry.maxDiffRatio !== undefined) {
        const text = `max diff ${percent(entry.maxDiffRatio)}`;
        detail += entry.status === "fail" ? styleText("red", text) : dim(text);
    }
    if (entry.consoleErrors?.length) {
        detail += styleText("yellow", `  ${entry.consoleErrors.length} console error(s)`);
    }
    console.log(`  ${badge(entry.status)} ${name.padEnd(nameWidth)}  ${detail}`);
}

async function main() {
    if (!existsSync(path.join(rendererRoot, "dist", "gltf-viewer.module.js"))) {
        console.error(styleText("red", "dist/ is missing. Run `npm run build` first."));
        process.exit(2);
    }

    const lock = JSON.parse(await readFile(path.join(here, "assets.lock.json"), "utf8"));
    const names = args.models ? args.models.split(",").map((n) => n.trim()) : lock.models;
    const summary = await loadSummary(lock);
    await mkdir(renderingsRoot, { recursive: true });

    console.log(
        styleText("bold", `Regression ${args.baseline ? "baseline" : "compare"}`) +
            dim(
                `  ${width}x${height}, assets ${lock.sampleAssets.commit.slice(0, 8)}` +
                    (kind === "candidate"
                        ? `, threshold ${threshold}, max diff ${percent(maxDiffRatio)}`
                        : "")
            )
    );

    console.log(dim("Fetching assets…"));
    const environment = await fetchEnvironment(lock, outputRoot);
    const models = await fetchModels(lock, outputRoot, names, ({ name, downloaded }) => {
        if (downloaded) {
            console.log(dim(`  downloaded ${name}`));
        }
    });

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

    const run = {
        startedAt: new Date().toISOString(),
        renderer: rendererRevision(),
        browser: `chromium ${browser.version()}`,
        gpu: undefined
    };
    summary.runs[kind] = run;
    summary.tolerance = { threshold, maxDiffRatio };

    const nameWidth = Math.max(...models.map((m) => m.name.length));
    const statuses = [];
    try {
        // One page for all models; navigating per model drops the previous WebGL context and heap.
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        let consoleErrors = [];
        page.on("console", (message) => {
            // Reported with its URL by the response handler below.
            if (
                message.type() === "error" &&
                !message.text().startsWith("Failed to load resource")
            ) {
                consoleErrors.push(message.text());
            }
        });
        page.on("response", (response) => {
            if (response.status() >= 400) {
                consoleErrors.push(`HTTP ${response.status()} ${response.url()}`);
            }
        });
        page.on("pageerror", (error) => consoleErrors.push(error.message));

        console.log(dim("Rendering…"));
        for (const model of models) {
            const previous = summary.models[model.name];
            consoleErrors = [];
            if (kind === "baseline") {
                await rm(path.join(renderingsRoot, model.name), { recursive: true, force: true });
            } else {
                await removeRenderings(model.name, ["candidate", "diff"]);
            }

            let entry = {
                label: model.label,
                tags: model.tags,
                file: model.file
            };
            try {
                if (model.error) {
                    throw new Error(model.error);
                }
                const result = await renderModel(page, server.url, environment, model, previous);
                run.gpu ??= result.gpu;
                const diffRatios = result.frames
                    .map((f) => f.diffRatio)
                    .filter((r) => r !== undefined);
                entry = {
                    ...entry,
                    status: modelStatus(result.frames),
                    animated: result.durationMs > 0,
                    durationMs: result.durationMs,
                    timepointsMs: result.frames.map((f) => f.timeMs),
                    maxDiffRatio: diffRatios.length ? Math.max(...diffRatios) : undefined,
                    frames: result.frames
                };
            } catch (error) {
                // Keep the baseline frames so a later compare run still finds them.
                const frames =
                    kind === "candidate"
                        ? (previous?.frames ?? [])
                              .filter((f) => f.baseline)
                              .map(({ timeMs, baseline }) => ({ timeMs, baseline }))
                        : [];
                entry = {
                    ...entry,
                    status: "error",
                    error: error.message.split("\n")[0],
                    timepointsMs: frames.map((f) => f.timeMs),
                    frames
                };
            }
            if (consoleErrors.length) {
                entry.consoleErrors = consoleErrors.slice(0, MAX_CONSOLE_ERRORS);
            }
            summary.models[model.name] = entry;
            statuses.push([model.name, entry.status]);
            printModel(model.name, entry, nameWidth);
            await writeFile(summaryFile, JSON.stringify(summary, undefined, 4));
        }
    } finally {
        await browser.close();
        await server.close();
    }

    run.finishedAt = new Date().toISOString();
    const totals = {};
    for (const [, status] of statuses) {
        totals[status] = (totals[status] ?? 0) + 1;
    }
    run.totals = totals;
    await writeFile(summaryFile, JSON.stringify(summary, undefined, 4));

    if (/swiftshader|llvmpipe|software/i.test(run.gpu ?? "")) {
        console.log(styleText("yellow", `Warning: rendered without GPU acceleration (${run.gpu})`));
    }
    console.log(
        "\n" +
            Object.entries(totals)
                .map(([status, count]) => `${badge(status).trim()} ${count}`)
                .join("  ") +
            dim(`  ${run.gpu ?? ""}`)
    );
    const failed = statuses.filter(([, status]) => status === "fail" || status === "error");
    if (failed.length) {
        console.log(styleText("red", `Failed: ${failed.map(([name]) => name).join(", ")}`));
    }
    console.log(dim(`Summary: ${path.relative(process.cwd(), summaryFile)}`));
    process.exitCode = failed.length ? 1 : 0;
}

await main();
