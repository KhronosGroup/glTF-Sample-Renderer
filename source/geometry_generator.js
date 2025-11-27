/**
 * Script based off of Babylon.js: https://github.com/BabylonJS/Babylon.js/blob/10428bb078689922ea643ec49c5240af38e05925/packages/dev/core/src/Meshes/Builders/capsuleBuilder.ts
 */

import { vec3, quat } from "gl-matrix";

export function createCapsuleVertexData(
    radiusTop = 0.25,
    radiusBottom = 0.25,
    height = 1,
    scale = vec3.fromValues(1, 1, 1),
    scaleAxis = quat.create(),
    subdivisions = 2,
    tessellation = 16,
    capSubdivisions = 6
) {
    const capDetail = capSubdivisions;
    const radialSegments = tessellation;
    const heightSegments = subdivisions;

    const totalHeight = height + radiusTop + radiusBottom;
    const heightMinusCaps = height;

    const thetaStart = 0.0;
    const thetaLength = 2.0 * Math.PI;

    const capsTopSegments = capDetail;
    const capsBottomSegments = capDetail;

    const alpha = Math.acos((radiusBottom - radiusTop) / totalHeight);

    let indices = [];
    const vertices = [];

    let index = 0;
    const indexArray = [],
        halfHeight = heightMinusCaps * 0.5;
    const pi2 = Math.PI * 0.5;

    let x, y;

    const cosAlpha = Math.cos(alpha);
    const sinAlpha = Math.sin(alpha);

    const tmpVec = vec3.create();

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
            vec3.transformQuat(
                tmpVec,
                vec3.fromValues(
                    _radius * sinTheta,
                    halfHeight + sinA * radiusTop,
                    _radius * cosTheta
                ),
                scaleAxis
            );
            vertices.push(tmpVec[0] * scale[0]);
            vertices.push(tmpVec[1] * scale[1]);
            vertices.push(tmpVec[2] * scale[2]);

            // save index of vertex in respective row
            indexRow.push(index);
            // increase index
            index++;
        }
        // now save vertices of the row in our index array
        indexArray.push(indexRow);
    }

    const coneHeight =
        totalHeight - radiusTop - radiusBottom + cosAlpha * radiusTop - cosAlpha * radiusBottom;

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

            vec3.transformQuat(
                tmpVec,
                vec3.fromValues(
                    _radius * sinTheta,
                    halfHeight + cosAlpha * radiusTop - (y * coneHeight) / heightSegments,
                    _radius * cosTheta
                ),
                scaleAxis
            );
            vertices.push(tmpVec[0] * scale[0]);
            vertices.push(tmpVec[1] * scale[1]);
            vertices.push(tmpVec[2] * scale[2]);

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

            vec3.transformQuat(
                tmpVec,
                vec3.fromValues(
                    _radius * sinTheta,
                    -halfHeight + sinA * radiusBottom,
                    _radius * cosTheta
                ),
                scaleAxis
            );
            vertices.push(tmpVec[0] * scale[0]);
            vertices.push(tmpVec[1] * scale[1]);
            vertices.push(tmpVec[2] * scale[2]);

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

    return { vertices: new Float32Array(vertices), indices: new Uint8Array(indices) };
}

export function createCylinderVertexData(
    radiusTop,
    radiusBottom,
    height,
    scale = vec3.fromValues(1, 1, 1),
    scaleAxis = quat.create(),
    numDivisions = 30
) {
    const positions = [];
    const tempVec = vec3.create();
    for (let i = 0; i < numDivisions; i++) {
        const c = Math.cos((2 * Math.PI * i) / (numDivisions - 1));
        const s = Math.sin((2 * Math.PI * i) / (numDivisions - 1));
        vec3.transformQuat(
            tempVec,
            vec3.fromValues(c * radiusTop, 0.5 * height, s * radiusTop),
            scaleAxis
        );
        positions.push(tempVec[0] * scale[0]);
        positions.push(tempVec[1] * scale[1]);
        positions.push(tempVec[2] * scale[2]);

        vec3.transformQuat(
            tempVec,
            vec3.fromValues(c * radiusBottom, -0.5 * height, s * radiusBottom),
            scaleAxis
        );
        positions.push(tempVec[0] * scale[0]);
        positions.push(tempVec[1] * scale[1]);
        positions.push(tempVec[2] * scale[2]);
    }
    const indices = Array.from(positions.keys());
    return { vertices: new Float32Array(positions), indices: new Uint8Array(indices) };
}

export function createBoxVertexData(
    width,
    height,
    depth,
    scale = vec3.fromValues(1, 1, 1),
    scaleAxis = quat.create()
) {
    const hw = width / 2;
    const hh = height / 2;
    const hd = depth / 2;

    const positions = [];
    const tempVec = vec3.create();

    // prettier-ignore
    const boxVertices = [
        -hw, -hh,  hd,
         hw, -hh,  hd,
         hw,  hh,  hd,
        -hw,  hh,  hd,
        -hw, -hh, -hd,
        -hw,  hh, -hd,
         hw,  hh, -hd,
         hw, -hh, -hd,
    ];

    for (let i = 0; i < boxVertices.length; i += 3) {
        vec3.transformQuat(
            tempVec,
            vec3.fromValues(boxVertices[i], boxVertices[i + 1], boxVertices[i + 2]),
            scaleAxis
        );
        positions.push(tempVec[0] * scale[0]);
        positions.push(tempVec[1] * scale[1]);
        positions.push(tempVec[2] * scale[2]);
    }

    // prettier-ignore
    const indices = [
        0, 1, 2, 0, 2, 3, // front
        4, 6, 5, 4, 7, 6, // back
        4, 5, 1, 4, 1, 0, // bottom
        3, 2, 6, 3, 6, 7, // top
        1, 5, 6, 1, 6, 2, // right
        4, 0, 3, 4, 3, 7, // left
    ];

    return { vertices: new Float32Array(positions), indices: new Uint8Array(indices) };
}
