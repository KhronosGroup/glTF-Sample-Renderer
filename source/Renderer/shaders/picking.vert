#ifdef USE_CLIPPING
#extension GL_ANGLE_clip_cull_distance : require
#endif

#include <animation.glsl>


uniform mat4 u_ViewProjectionMatrix;
uniform mat4 u_ModelMatrix;
uniform mat4 u_NormalMatrix;

#ifdef USE_CLIPPING
// Six half spaces forming a cuboid, each pointing at the part that is kept.
uniform vec4 u_ClippingPlanes[6];
#endif


in vec3 a_position;


vec4 getPosition()
{
    vec4 pos = vec4(a_position, 1.0);

#ifdef USE_MORPHING
    pos += getTargetPosition(gl_VertexID);
#endif

#ifdef USE_SKINNING
    pos = getSkinningMatrix() * pos;
#endif

    return pos;
}


void main()
{
    gl_PointSize = 1.0f;
    vec4 pos = u_ModelMatrix * getPosition();

#ifdef USE_CLIPPING
    vec4 clipPosition = vec4(pos.xyz, 1.0);
    gl_ClipDistance[0] = dot(clipPosition, u_ClippingPlanes[0]);
    gl_ClipDistance[1] = dot(clipPosition, u_ClippingPlanes[1]);
    gl_ClipDistance[2] = dot(clipPosition, u_ClippingPlanes[2]);
    gl_ClipDistance[3] = dot(clipPosition, u_ClippingPlanes[3]);
    gl_ClipDistance[4] = dot(clipPosition, u_ClippingPlanes[4]);
    gl_ClipDistance[5] = dot(clipPosition, u_ClippingPlanes[5]);
#endif

    gl_Position = u_ViewProjectionMatrix * pos;
}
