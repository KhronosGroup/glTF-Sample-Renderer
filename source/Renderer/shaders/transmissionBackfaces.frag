precision highp float;

#include <functions.glsl>
#include <textures.glsl>
#include <material_info.glsl>


layout(location = 0) out vec4 frontColor;

void main()
{
    frontColor = vec4(0.0, 0.0, 0.0, 0.0);
#ifdef MATERIAL_TRANSMISSION

    frontColor = getBaseColor();
#endif

#ifdef MATERIAL_DIFFUSE_TRANSMISSION
    MaterialInfo materialInfo;
    materialInfo = getDiffuseTransmissionInfo(materialInfo);
    frontColor += vec4(materialInfo.diffuseTransmissionColorFactor, 1.0);
#endif
}
