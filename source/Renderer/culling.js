import { aabbOutsideFrustum, frustumPlanes } from "./frustum.js";
import { boundsCorners, shapeBounds, transformedBounds } from "./debug_geometry.js";

// Rejects nodes whose glTF 2.1 bounding volume lies entirely outside the view.
//
// Only nodes that declare a bounding volume are considered. A node without one says
// nothing about where its geometry is, so it is always drawn — this never guesses from
// mesh bounds, because the point of the feature is to use what the asset states.
//
// A volume that fails to enclose its node hides geometry that should be visible. That is
// an authoring error rather than a renderer one, but it is invisible without help, which
// is why culling is a toggle and why the debug pass colours non-enclosing volumes.
function cullNodes(nodes, viewProjection, { fallbackDocument, isInstanced } = {}) {
    for (const node of nodes) {
        node.culled = false;
    }

    const planes = frustumPlanes(viewProjection);
    let culled = 0;
    for (const node of nodes) {
        if (node.boundingVolume === undefined) {
            continue;
        }
        // One node drawn at many transforms is not described by its own volume.
        if (node.instanceMatrices !== undefined || isInstanced?.(node)) {
            continue;
        }
        const gltf = node.ownerDocument ?? fallbackDocument;
        const shape = gltf?.shapes?.[node.boundingVolume.shape];
        if (shape === undefined) {
            continue;
        }
        const local = shapeBounds(gltf, shape);
        if (local === undefined) {
            continue;
        }
        const world = transformedBounds(
            boundsCorners(local),
            node.boundingVolume.getWorldTransform(node)
        );
        node.culled = aabbOutsideFrustum(planes, world.min, world.max);
        if (node.culled) {
            culled++;
        }
    }
    return culled;
}

export { cullNodes };
