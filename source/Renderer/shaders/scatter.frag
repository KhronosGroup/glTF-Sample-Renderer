// This fragment shader accumulates the diffuse light contribution for subsurface scattering in two color attachments for ibl and punctual lighting.
// Light passing the surface is modulated by diffuseTransmissionColorFactor
// diffuseTransmissionFactor defines the ratio of diffuse light passing the surface
// Light which is scattered at the surface is modulated by the single scatter color, while diffuse transmission is additionally modulated by the absorption ratio (1 - singleScatter).

precision highp float;

#include <textures.glsl>
#include <functions.glsl>
#include <brdf.glsl>
#include <punctual.glsl>
#include <ibl.glsl>
#include <material_info.glsl>


layout(location = 0) out vec4 frontColor;

uniform int u_MaterialID;


void main()
{
    frontColor = vec4(0.0, 0.0, 0.0, float(u_MaterialID) / 255.0);
    vec4 baseColor = getBaseColor();
    baseColor.a = 1.0;
    vec3 color = vec3(0);
    vec3 v = normalize(u_Camera - v_Position);
    NormalInfo normalInfo = getNormalInfo(v);
    vec3 n = normalInfo.n;
    vec3 t = normalInfo.t;
    vec3 b = normalInfo.b;

    float NdotV = clampedDot(n, v);
    float TdotV = clampedDot(t, v);
    float BdotV = clampedDot(b, v);

    MaterialInfo materialInfo;
    materialInfo.baseColor = baseColor.rgb;
    
    // The default index of refraction of 1.5 yields a dielectric normal incidence reflectance of 0.04.
    materialInfo.ior = 1.5;
    materialInfo.f0_dielectric = vec3(0.04);
    materialInfo.specularWeight = 1.0;

    // Anything less than 2% is physically impossible and is instead considered to be shadowing. Compare to "Real-Time-Rendering" 4th editon on page 325.
    materialInfo.f90 = vec3(1.0);
    materialInfo.f90_dielectric = materialInfo.f90;

#ifdef MATERIAL_IOR
    materialInfo = getIorInfo(materialInfo);
#endif

#ifdef MATERIAL_METALLICROUGHNESS
    materialInfo = getMetallicRoughnessInfo(materialInfo);
#endif

#ifdef MATERIAL_SHEEN
    materialInfo = getSheenInfo(materialInfo);
#endif

#ifdef MATERIAL_SPECULAR
    materialInfo = getSpecularInfo(materialInfo);
#endif

#ifdef MATERIAL_TRANSMISSION
    materialInfo = getTransmissionInfo(materialInfo);
#endif

#ifdef MATERIAL_VOLUME
    materialInfo = getVolumeInfo(materialInfo);
#endif

#ifdef MATERIAL_DIFFUSE_TRANSMISSION
    materialInfo = getDiffuseTransmissionInfo(materialInfo);
#endif

    materialInfo = getVolumeScatterInfo(materialInfo);

#ifdef MATERIAL_VOLUME_SCATTER
    // The single scatter color defines the ratio of scattering. 1 - singleScatter is the ratio of absorption.
    vec3 singleScatter = multiToSingleScatter(materialInfo.multiscatterColor);
#endif

    materialInfo.perceptualRoughness = clamp(materialInfo.perceptualRoughness, 0.0, 1.0);

    // Roughness is authored as perceptual roughness; as is convention,
    // convert to material roughness by squaring the perceptual roughness.
    materialInfo.alphaRoughness = materialInfo.perceptualRoughness * materialInfo.perceptualRoughness;


    // LIGHTING
    vec3 f_specular_dielectric = vec3(0.0);
    vec3 f_diffuse = vec3(0.0);
    vec3 f_dielectric_brdf_ibl = vec3(0.0);
    float albedoSheenScaling = 1.0;

    float diffuseTransmissionThickness = 1.0;

#ifdef MATERIAL_DIFFUSE_TRANSMISSION
#ifdef MATERIAL_VOLUME
    diffuseTransmissionThickness = materialInfo.thickness *
        (length(vec3(u_ModelMatrix[0].xyz)) + length(vec3(u_ModelMatrix[1].xyz)) + length(vec3(u_ModelMatrix[2].xyz))) / 3.0;
#endif
#endif

    // Calculate lighting contribution from image based lighting source (IBL)

#if defined(USE_IBL) || defined(MATERIAL_TRANSMISSION)

#ifdef MATERIAL_DIFFUSE_TRANSMISSION
    f_diffuse = getDiffuseLight(n) * materialInfo.diffuseTransmissionColorFactor;
    vec3 diffuseTransmissionIBL = getDiffuseLight(-n) * materialInfo.diffuseTransmissionColorFactor;
#ifdef MATERIAL_VOLUME
        diffuseTransmissionIBL = applyVolumeAttenuation(diffuseTransmissionIBL, diffuseTransmissionThickness, materialInfo.attenuationColor, materialInfo.attenuationDistance);
#endif
    f_diffuse += diffuseTransmissionIBL * (1.0 -singleScatter) * singleScatter;
    f_diffuse *= materialInfo.diffuseTransmissionFactor;
#endif

#ifdef MATERIAL_SHEEN
    albedoSheenScaling = 1.0 - max3(materialInfo.sheenColorFactor) * albedoSheenScalingLUT(NdotV, materialInfo.sheenRoughnessFactor);
#endif
    // Calculate fresnel mix for IBL  
 
    vec3 f_dielectric_fresnel_ibl = getIBLGGXFresnel(n, v, materialInfo.perceptualRoughness, materialInfo.f0_dielectric, materialInfo.specularWeight);
    frontColor += vec4(mix(f_diffuse, f_specular_dielectric,  f_dielectric_fresnel_ibl), 0.0) * albedoSheenScaling * materialInfo.multiscatterColor;

#endif //end USE_IBL

#ifdef USE_PUNCTUAL
    for (int i = 0; i < LIGHT_COUNT; ++i)
    {
        Light light = u_Lights[i];

        vec3 pointToLight;
        if (light.type != LightType_Directional)
        {
            pointToLight = light.position - v_Position;
        }
        else
        {
            pointToLight = -light.direction;
        }

        // BSTF
        vec3 l = normalize(pointToLight);   // Direction from surface point to light
        vec3 h = normalize(l + v);          // Direction of the vector between l and v, called halfway vector
        float NdotL = clampedDot(n, l);
        float NdotV = clampedDot(n, v);
        float NdotH = clampedDot(n, h);
        float LdotH = clampedDot(l, h);
        float VdotH = clampedDot(v, h);

        vec3 dielectric_fresnel = F_Schlick(materialInfo.f0_dielectric * materialInfo.specularWeight, materialInfo.f90_dielectric, abs(VdotH));
        
        vec3 lightIntensity = getLighIntensity(light, pointToLight);
        
        vec3 l_diffuse = vec3(0.0);
        vec3 l_specular_dielectric = vec3(0.0);
        vec3 l_dielectric_brdf = vec3(0.0);

        
#ifdef MATERIAL_DIFFUSE_TRANSMISSION
        l_diffuse = lightIntensity * NdotL * BRDF_lambertian(materialInfo.diffuseTransmissionColorFactor);
        if (dot(n, l) < 0.0) {
            float diffuseNdotL = clampedDot(-n, l);
            vec3 diffuse_btdf = lightIntensity * diffuseNdotL * BRDF_lambertian(materialInfo.diffuseTransmissionColorFactor);

            vec3 l_mirror = normalize(l + 2.0 * n * dot(-l, n)); // Mirror light reflection vector on surface
            float diffuseVdotH = clampedDot(v, normalize(l_mirror + v));
            dielectric_fresnel = F_Schlick(materialInfo.f0_dielectric * materialInfo.specularWeight, materialInfo.f90_dielectric, abs(diffuseVdotH));

#ifdef MATERIAL_VOLUME
            diffuse_btdf = applyVolumeAttenuation(diffuse_btdf, diffuseTransmissionThickness, materialInfo.attenuationColor, materialInfo.attenuationDistance);
#endif
            l_diffuse += diffuse_btdf * (1.0 - singleScatter) * singleScatter;
        }
        l_diffuse *= materialInfo.diffuseTransmissionFactor;
        
#endif // MATERIAL_DIFFUSE_TRANSMISSION

// We need to multiply with sheen scaling, since we aggregate all lights in one texture, for IBL this can be done in the normal PBR shader
#ifdef MATERIAL_SHEEN
        albedoSheenScaling = min(1.0 - max3(materialInfo.sheenColorFactor) * albedoSheenScalingLUT(NdotV, materialInfo.sheenRoughnessFactor),
            1.0 - max3(materialInfo.sheenColorFactor) * albedoSheenScalingLUT(NdotL, materialInfo.sheenRoughnessFactor));
#endif

        l_dielectric_brdf = mix(l_diffuse, l_specular_dielectric, dielectric_fresnel);
        color += l_dielectric_brdf * albedoSheenScaling;
    }
    
    frontColor += vec4(color.rgb * materialInfo.multiscatterColor, 0.0);
#endif // USE_PUNCTUAL
}
