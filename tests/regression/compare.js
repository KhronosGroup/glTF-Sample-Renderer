import { readFile, writeFile } from "node:fs/promises";
import { decode, encode } from "fast-png";
import pixelmatch from "pixelmatch";

// Chromium's canvas.toDataURL always writes 8-bit RGBA, which is what pixelmatch expects.
async function readRgba8(file) {
    const png = decode(await readFile(file));
    if (png.channels !== 4 || png.depth !== 8) {
        throw new Error(
            `${file}: expected 8-bit RGBA, got ${png.channels} channels, ${png.depth} bit`
        );
    }
    return png;
}

/**
 * Compares two PNG files and writes a diff image.
 * @returns {Promise<{ diffPixels: number, diffRatio: number }>}
 */
export async function comparePngs(baselineFile, candidateFile, diffFile, threshold) {
    const baseline = await readRgba8(baselineFile);
    const candidate = await readRgba8(candidateFile);
    const { width, height } = baseline;
    if (candidate.width !== width || candidate.height !== height) {
        throw new Error(
            `size mismatch: baseline ${width}x${height}, candidate ${candidate.width}x${candidate.height}`
        );
    }
    const diff = new Uint8Array(width * height * 4);
    const diffPixels = pixelmatch(baseline.data, candidate.data, diff, width, height, {
        threshold
    });
    await writeFile(diffFile, encode({ width, height, data: diff, depth: 8, channels: 4 }));
    return { diffPixels, diffRatio: diffPixels / (width * height) };
}
