import { readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/**
 * Compares two PNG files and writes a diff image.
 * @returns {Promise<{ diffPixels: number, diffRatio: number }>}
 */
export async function comparePngs(baselineFile, candidateFile, diffFile, threshold) {
    const baseline = PNG.sync.read(await readFile(baselineFile));
    const candidate = PNG.sync.read(await readFile(candidateFile));
    const { width, height } = baseline;
    if (candidate.width !== width || candidate.height !== height) {
        throw new Error(
            `size mismatch: baseline ${width}x${height}, candidate ${candidate.width}x${candidate.height}`
        );
    }
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(baseline.data, candidate.data, diff.data, width, height, {
        threshold
    });
    await writeFile(diffFile, PNG.sync.write(diff));
    return { diffPixels, diffRatio: diffPixels / (width * height) };
}
