/**
 * Script based off of Babylon.js: https://github.com/BabylonJS/Babylon.js/blob/10428bb078689922ea643ec49c5240af38e05925/packages/dev/core/src/Meshes/Builders/capsuleBuilder.ts
 */

import { vec3 } from "gl-matrix";

export function createCapsuleVertexData(
    radiusTop = 0.25,
    radiusBottom = 0.25,
    height = 1,
    subdivisions = 2,
    tessellation = 16,
    capSubdivisions = 6
) {
    const capDetail = capSubdivisions;
    const radialSegments = tessellation;
    const heightSegments = subdivisions;

    const heightMinusCaps = height - (radiusTop + radiusBottom);

    const thetaStart = 0.0;
    const thetaLength = 2.0 * Math.PI;

    const capsTopSegments = capDetail;
    const capsBottomSegments = capDetail;

    const alpha = Math.acos((radiusBottom - radiusTop) / height);

    let indices = [];
    const vertices = [];

    let index = 0;
    const indexArray = [],
        halfHeight = heightMinusCaps * 0.5;
    const pi2 = Math.PI * 0.5;

    let x, y;

    const cosAlpha = Math.cos(alpha);
    const sinAlpha = Math.sin(alpha);

    for (y = 0; y <= capsTopSegments; y++) {
        const indexRow = [];

        const a = pi2 - alpha * (y / capsTopSegments);

        const cosA = Math.cos(a);
        const sinA = Math.sin(a);

        // calculate the radius of the current row
        const _radius = cosA * radiusTop;

        for (x = 0; x <= radialSegments; x++) {
            const u = x / radialSegments;
            const theta = u * thetaLength + thetaStart;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            // vertex
            vertices.push(_radius * sinTheta);
            vertices.push(halfHeight + sinA * radiusTop);
            vertices.push(_radius * cosTheta);

            // save index of vertex in respective row
            indexRow.push(index);
            // increase index
            index++;
        }
        // now save vertices of the row in our index array
        indexArray.push(indexRow);
    }

    const coneHeight =
        height - radiusTop - radiusBottom + cosAlpha * radiusTop - cosAlpha * radiusBottom;

    for (y = 1; y <= heightSegments; y++) {
        const indexRow = [];
        // calculate the radius of the current row
        const _radius = sinAlpha * ((y * (radiusBottom - radiusTop)) / heightSegments + radiusTop);
        for (x = 0; x <= radialSegments; x++) {
            const u = x / radialSegments;
            const theta = u * thetaLength + thetaStart;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            // vertex
            vertices.push(_radius * sinTheta);
            vertices.push(halfHeight + cosAlpha * radiusTop - (y * coneHeight) / heightSegments);
            vertices.push(_radius * cosTheta);

            // save index of vertex in respective row
            indexRow.push(index);
            // increase index
            index++;
        }
        // now save vertices of the row in our index array
        indexArray.push(indexRow);
    }

    for (y = 1; y <= capsBottomSegments; y++) {
        const indexRow = [];
        const a = pi2 - alpha - (Math.PI - alpha) * (y / capsBottomSegments);
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        // calculate the radius of the current row
        const _radius = cosA * radiusBottom;
        for (x = 0; x <= radialSegments; x++) {
            const u = x / radialSegments;
            const theta = u * thetaLength + thetaStart;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            // vertex
            vertices.push(_radius * sinTheta);
            vertices.push(-halfHeight + sinA * radiusBottom);
            vertices.push(_radius * cosTheta);

            // save index of vertex in respective row
            indexRow.push(index);
            // increase index
            index++;
        }
        // now save vertices of the row in our index array
        indexArray.push(indexRow);
    }
    // generate indices
    for (x = 0; x < radialSegments; x++) {
        for (y = 0; y < capsTopSegments + heightSegments + capsBottomSegments; y++) {
            // we use the index array to access the correct indices
            const i1 = indexArray[y][x];
            const i2 = indexArray[y + 1][x];
            const i3 = indexArray[y + 1][x + 1];
            const i4 = indexArray[y][x + 1];
            // face one
            indices.push(i1);
            indices.push(i2);
            indices.push(i4);
            // face two
            indices.push(i2);
            indices.push(i3);
            indices.push(i4);
        }
    }

    indices = indices.reverse();

    return { positions: new Float32Array(vertices), indices: new Uint8Array(indices) };
}

export function createCylinderVertexData(radiusTop, radiusBottom, height, numDivisions = 30) {
    const positions = [];
    for (let i = 0; i < numDivisions; i++) {
        const c = Math.cos((2 * Math.PI * i) / (numDivisions - 1));
        const s = Math.sin((2 * Math.PI * i) / (numDivisions - 1));
        positions.push(c * radiusTop);
        positions.push(0.5 * height);
        positions.push(s * radiusTop);

        positions.push(c * radiusBottom);
        positions.push(-0.5 * height);
        positions.push(s * radiusBottom);
    }
    const indices = Array.from(positions.keys());
    return { positions: new Float32Array(positions), indices: new Uint8Array(indices) };
}
