import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lockFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets.lock.json");
const lock = JSON.parse(await readFile(lockFile, "utf8"));

for (const pin of [lock.sampleAssets, lock.environment]) {
    const output = execFileSync(
        "git",
        ["ls-remote", `https://github.com/${pin.repository}.git`, `refs/heads/${pin.branch}`],
        { encoding: "utf8" }
    );
    const commit = output.split(/\s/)[0];
    if (!/^[0-9a-f]{40}$/.test(commit)) {
        throw new Error(`Unexpected ls-remote output for ${pin.repository}: ${output}`);
    }
    console.log(
        `${pin.repository}@${pin.branch}: ${pin.commit.slice(0, 8)} -> ${commit.slice(0, 8)}`
    );
    pin.commit = commit;
}

await writeFile(lockFile, JSON.stringify(lock, undefined, 4) + "\n");
