#ifdef USE_CLIPPING
#extension GL_ANGLE_clip_cull_distance : require
#endif

uniform mat4 u_ViewProjectionMatrix;
uniform mat4 u_ModelMatrix;
uniform float u_DepthBias;

#ifdef USE_CLIPPING
uniform vec4 u_ClippingPlanes[6];
#endif

in vec3 a_position;

void main()
{
    vec4 world = u_ModelMatrix * vec4(a_position, 1.0);
#ifdef USE_CLIPPING
    gl_ClipDistance[0] = dot(world, u_ClippingPlanes[0]);
    gl_ClipDistance[1] = dot(world, u_ClippingPlanes[1]);
    gl_ClipDistance[2] = dot(world, u_ClippingPlanes[2]);
    gl_ClipDistance[3] = dot(world, u_ClippingPlanes[3]);
    gl_ClipDistance[4] = dot(world, u_ClippingPlanes[4]);
    gl_ClipDistance[5] = dot(world, u_ClippingPlanes[5]);
#endif
    vec4 clip = u_ViewProjectionMatrix * world;
    // Pull coincident debug shapes towards the viewer so they draw in front of the
    // geometry they describe. Polygon offset is unreliable for line primitives on some
    // drivers, so bias in clip space instead, where it applies to every primitive type.
    clip.z -= u_DepthBias * clip.w;
    gl_Position = clip;
}
