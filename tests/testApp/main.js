import { GltfView } from "./gltf-viewer.module.js";

const canvas = document.getElementById("canvas");
const context = canvas.getContext("webgl2", { antialias: true });
const view = new GltfView(context);
const resourceLoader = view.createResourceLoader();
const state = view.createState();

const update = () => {
    view.renderFrame(state, canvas.width, canvas.height);
    window.requestAnimationFrame(update);
};

// After this start executing animation loop.
window.requestAnimationFrame(update);

globalThis.resourceLoader = resourceLoader;
globalThis.state = state;
globalThis.view = view;
