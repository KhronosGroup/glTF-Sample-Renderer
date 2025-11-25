#include <animation.glsl>


uniform mat4 u_ViewProjectionMatrix;
uniform mat4 u_ModelMatrix;
uniform mat4 u_NormalMatrix;


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

    gl_Position = u_ViewProjectionMatrix * pos;
}
