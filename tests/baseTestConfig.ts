import {test as base} from "@playwright/test";

export type TestOptions = {
    testRepoURL: string;
    downloadFolder: string;
}

export const test = base.extend<TestOptions>({
    testRepoURL: ["test", {option: true}],
    downloadFolder: ["testAssetDownload", {option: true}],
});
