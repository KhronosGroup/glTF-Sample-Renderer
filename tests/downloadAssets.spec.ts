import { expect } from "@playwright/test";
import { test } from "./baseTestConfig";
import fs from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("download assets", async ({ testRepoURL, downloadFolder }) => {
    if (
        fs.existsSync(`${__dirname}/testAssetDownloads/${downloadFolder}`) &&
        process.env.REDOWNLOAD_ASSETS !== "true"
    ) {
        console.log(
            `Assets already downloaded in testAssetDownloads/${downloadFolder}, skipping download. Set REDOWNLOAD_ASSETS=true to force re-download.`
        );
        return;
    }
    console.log(`Downloading assets to testAssetDownloads/${downloadFolder}`);
    const response = await fetch(testRepoURL);
    expect(response.ok).toBeTruthy();
    const data = await response.json();
    const parentUrl = testRepoURL.substring(0, testRepoURL.lastIndexOf("/"));
    for (const asset of data) {
        const path = `${asset.name}/glTF-Binary/${asset.variants?.["glTF-Binary"]}`;
        const assetResponse = await fetch(`${parentUrl}/${path}`);
        console.log(`Downloading ${parentUrl}/${path}`);
        expect(assetResponse.ok).toBeTruthy();
        const arrayBuffer = await assetResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.mkdirSync(
            `${__dirname}/testAssetDownloads/${downloadFolder}/${asset.name}/glTF-Binary`,
            { recursive: true }
        );
        fs.writeFileSync(`${__dirname}/testAssetDownloads/${downloadFolder}/${path}`, buffer);
        asset.path = `${__dirname}/testAssetDownloads/${downloadFolder}/${path}`;
    }
    fs.writeFileSync(
        `${__dirname}/testAssetDownloads/${downloadFolder}/test-index.json`,
        JSON.stringify(data)
    );
});
