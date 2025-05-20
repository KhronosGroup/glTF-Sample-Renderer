//
// This fragment shader defines a reference implementation for Physically Based Shading of
// a microfacet surface material defined by a glTF model.
//
// References:
// [1] Real Shading in Unreal Engine 4
//     http://blog.selfshadow.com/publications/s2013-shading-course/karis/s2013_pbs_epic_notes_v2.pdf
// [2] Physically Based Shading at Disney
//     http://blog.selfshadow.com/publications/s2012-shading-course/burley/s2012_pbs_disney_brdf_notes_v3.pdf
// [3] README.md - Environment Maps
//     https://github.com/KhronosGroup/glTF-WebGL-PBR/#environment-maps
// [4] "An Inexpensive BRDF Model for Physically based Rendering" by Christophe Schlick
//     https://www.cs.virginia.edu/~jdl/bib/appearance/analytic%20models/schlick94b.pdf
// [5] "KHR_materials_clearcoat"
//     https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_clearcoat

precision highp float;

#include <textures.glsl>
#include <functions.glsl>
#include <brdf.glsl>
#include <punctual.glsl>
#include <ibl.glsl>
#include <material_info.glsl>


layout(location = 0) out vec4 frontColor;
layout(location = 1) out vec4 frontIBLColor;


void main()
{
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

    materialInfo.perceptualRoughness = clamp(materialInfo.perceptualRoughness, 0.0, 1.0);

    // Roughness is authored as perceptual roughness; as is convention,
    // convert to material roughness by squaring the perceptual roughness.
    materialInfo.alphaRoughness = materialInfo.perceptualRoughness * materialInfo.perceptualRoughness;


    // LIGHTING
    vec3 f_specular_dielectric = vec3(0.0);
    vec3 f_diffuse = vec3(0.0);
    vec3 f_dielectric_brdf_ibl = vec3(0.0);

    float diffuseTransmissionThickness = 1.0;

#ifdef MATERIAL_DIFFUSE_TRANSMISSION
#ifdef MATERIAL_VOLUME
    diffuseTransmissionThickness = materialInfo.thickness *
        (length(vec3(u_ModelMatrix[0].xyz)) + length(vec3(u_ModelMatrix[1].xyz)) + length(vec3(u_ModelMatrix[2].xyz))) / 3.0;
#endif
#endif

    // Calculate lighting contribution from image based lighting source (IBL)

#if defined(USE_IBL) || defined(MATERIAL_TRANSMISSION)

    f_diffuse = getDiffuseLight(n) * baseColor.rgb ;
#ifdef MATERIAL_DIFFUSE_TRANSMISSION
    vec3 diffuseTransmissionIBL = getDiffuseLight(-n) * materialInfo.diffuseTransmissionColorFactor;
#ifdef MATERIAL_VOLUME
        diffuseTransmissionIBL = applyVolumeAttenuation(diffuseTransmissionIBL, diffuseTransmissionThickness, materialInfo.attenuationColor, materialInfo.attenuationDistance);
#endif
    f_diffuse = mix(f_diffuse, diffuseTransmissionIBL, materialInfo.diffuseTransmissionFactor);
#endif


#if defined(MATERIAL_TRANSMISSION)
    vec3 f_specular_transmission = getIBLVolumeRefraction(
        n, v,
        materialInfo.perceptualRoughness,
        baseColor.rgb, v_Position, u_ModelMatrix, u_ViewMatrix, u_ProjectionMatrix,
        materialInfo.ior, materialInfo.thickness, materialInfo.attenuationColor, materialInfo.attenuationDistance, materialInfo.dispersion);
    f_diffuse = mix(f_diffuse, f_specular_transmission, materialInfo.transmissionFactor);
#endif

    // Calculate fresnel mix for IBL  
 
    vec3 f_dielectric_fresnel_ibl = getIBLGGXFresnel(n, v, materialInfo.perceptualRoughness, materialInfo.f0_dielectric, materialInfo.specularWeight);
    frontIBLColor = vec4(mix(f_diffuse, f_specular_dielectric,  f_dielectric_fresnel_ibl), 1.0);

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
        
        vec3 l_diffuse = lightIntensity * NdotL * BRDF_lambertian(baseColor.rgb);
        vec3 l_specular_dielectric = vec3(0.0);
        vec3 l_dielectric_brdf = vec3(0.0);

        
#ifdef MATERIAL_DIFFUSE_TRANSMISSION
        l_diffuse = l_diffuse * (1.0 - materialInfo.diffuseTransmissionFactor);
        if (dot(n, l) < 0.0) {
            float diffuseNdotL = clampedDot(-n, l);
            vec3 diffuse_btdf = lightIntensity * diffuseNdotL * BRDF_lambertian(materialInfo.diffuseTransmissionColorFactor);

            vec3 l_mirror = normalize(l + 2.0 * n * dot(-l, n)); // Mirror light reflection vector on surface
            float diffuseVdotH = clampedDot(v, normalize(l_mirror + v));
            dielectric_fresnel = F_Schlick(materialInfo.f0_dielectric * materialInfo.specularWeight, materialInfo.f90_dielectric, abs(diffuseVdotH));

#ifdef MATERIAL_VOLUME
            diffuse_btdf = applyVolumeAttenuation(diffuse_btdf, diffuseTransmissionThickness, materialInfo.attenuationColor, materialInfo.attenuationDistance);
#endif
            l_diffuse += diffuse_btdf * materialInfo.diffuseTransmissionFactor;
        }
        
#endif // MATERIAL_DIFFUSE_TRANSMISSION

        // BTDF (Bidirectional Transmittance Distribution Function)
#ifdef MATERIAL_TRANSMISSION
        // If the light ray travels through the geometry, use the point it exits the geometry again.
        // That will change the angle to the light source, if the material refracts the light ray.
        vec3 transmissionRay = getVolumeTransmissionRay(n, v, materialInfo.thickness, materialInfo.ior, u_ModelMatrix);
        pointToLight -= transmissionRay;
        l = normalize(pointToLight);

        vec3 transmittedLight = lightIntensity * getPunctualRadianceTransmission(n, v, l, materialInfo.alphaRoughness, baseColor.rgb, materialInfo.ior);

#ifdef MATERIAL_VOLUME
        transmittedLight = applyVolumeAttenuation(transmittedLight, length(transmissionRay), materialInfo.attenuationColor, materialInfo.attenuationDistance);
#endif
        l_diffuse = mix(l_diffuse, transmittedLight, materialInfo.transmissionFactor);
#endif
        l_dielectric_brdf = mix(l_diffuse, l_specular_dielectric, dielectric_fresnel); // Do we need to handle vec3 fresnel here?
        color += l_dielectric_brdf;
    }
    
    frontColor = vec4(color.rgb, baseColor.a);
#endif // USE_PUNCTUAL
}
