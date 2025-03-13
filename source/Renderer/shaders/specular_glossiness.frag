precision highp float;


#include <tonemapping.glsl>
#include <textures.glsl>
#include <functions.glsl>
#include <brdf.glsl>
#include <punctual.glsl>
#include <ibl.glsl>
#include <material_info.glsl>


out vec4 g_finalColor;

// Specular Glossiness
uniform vec3 u_SpecularFactor;
uniform vec4 u_DiffuseFactor;
uniform float u_GlossinessFactor;


void main()
{
    vec4 baseColor = u_DiffuseFactor;

#if defined(HAS_DIFFUSE_MAP)
    baseColor *= texture(u_DiffuseSampler, getDiffuseUV());
#endif
    baseColor *= getVertexColor();

#if ALPHAMODE == ALPHAMODE_OPAQUE
    baseColor.a = 1.0;
#endif
    vec3 color = vec3(0);

    vec3 v = normalize(u_Camera - v_Position);
    NormalInfo normalInfo = getNormalInfo(v);
    vec3 n = normalInfo.n;

    float NdotV = clampedDot(n, v);

    MaterialInfo materialInfo;
    materialInfo.baseColor = baseColor.rgb;

    // Anything less than 2% is physically impossible and is instead considered to be shadowing. Compare to "Real-Time-Rendering" 4th editon on page 325.
    materialInfo.f90_dielectric = vec3(1.0);
    materialInfo.metallic = 0.0;

    vec3 specular = u_SpecularFactor;
    float glossiness = u_GlossinessFactor;

#ifdef HAS_SPECULAR_GLOSSINESS_MAP
    vec4 sgSample = texture(u_SpecularGlossinessSampler, getSpecularGlossinessUV());
    glossiness *= sgSample.a ; // glossiness to roughness
    specular *= sgSample.rgb; // specular
#endif // ! HAS_SPECULAR_GLOSSINESS_MAP

    materialInfo.perceptualRoughness = 1.0 - glossiness;
    materialInfo.f0_dielectric = min(specular, vec3(1.0)); // Use KHR_materials_specular calculation


    materialInfo.perceptualRoughness = clamp(materialInfo.perceptualRoughness, 0.0, 1.0);

    // Roughness is authored as perceptual roughness; as is convention,
    // convert to material roughness by squaring the perceptual roughness.
    materialInfo.alphaRoughness = materialInfo.perceptualRoughness * materialInfo.perceptualRoughness;


    // LIGHTING
    vec3 f_emissive = vec3(0.0);

    // Calculate lighting contribution from image based lighting source (IBL)

#ifdef USE_IBL

    vec3 f_diffuse = getDiffuseLight(n) * baseColor.rgb ;

    vec3 f_specular_dielectric = getIBLRadianceGGX(n, v, materialInfo.perceptualRoughness);

    // Calculate fresnel mix for IBL  
 
    vec3 f_dielectric_fresnel_ibl = getIBLGGXFresnel(n, v, materialInfo.perceptualRoughness, materialInfo.f0_dielectric, 1.0);
    vec3 f_dielectric_brdf_ibl = mix(f_diffuse, f_specular_dielectric,  f_dielectric_fresnel_ibl);

    color = f_dielectric_brdf_ibl;

#ifdef HAS_OCCLUSION_MAP
    float ao = 1.0;
    ao = texture(u_OcclusionSampler,  getOcclusionUV()).r;
    color = color * (1.0 + u_OcclusionStrength * (ao - 1.0)); 
#endif

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
        float VdotH = clampedDot(v, h);

        vec3 dielectric_fresnel = F_Schlick(materialInfo.f0_dielectric, materialInfo.f90_dielectric, abs(VdotH));
        
        vec3 lightIntensity = getLighIntensity(light, pointToLight);
        
        vec3 l_diffuse = lightIntensity * NdotL * BRDF_lambertian(baseColor.rgb);

        // Calculation of analytical light
        // https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#acknowledgments AppendixB
        vec3 intensity = getLighIntensity(light, pointToLight);


        vec3 l_specular_dielectric = intensity * NdotL * BRDF_specularGGX(materialInfo.alphaRoughness, NdotL, NdotV, NdotH);

        vec3 l_dielectric_brdf = mix(l_diffuse, l_specular_dielectric, dielectric_fresnel); // Do we need to handle vec3 fresnel here?

        color += l_dielectric_brdf;
    }
#endif // USE_PUNCTUAL

    f_emissive = u_EmissiveFactor;
#ifdef MATERIAL_EMISSIVE_STRENGTH
    f_emissive *= u_EmissiveStrength;
#endif
#ifdef HAS_EMISSIVE_MAP
    f_emissive *= texture(u_EmissiveSampler, getEmissiveUV()).rgb;
#endif


#ifdef MATERIAL_UNLIT
    color = baseColor.rgb;
#elif defined(NOT_TRIANGLE) && !defined(HAS_NORMAL_VEC3)
    //Points or Lines with no NORMAL attribute SHOULD be rendered without lighting and instead use the sum of the base color value and the emissive value.
    color = f_emissive + baseColor.rgb;
#else
    color = f_emissive + color;
#endif

#if DEBUG == DEBUG_NONE

#if ALPHAMODE == ALPHAMODE_MASK
    // Late discard to avoid sampling artifacts. See https://github.com/KhronosGroup/glTF-Sample-Viewer/issues/267
    if (baseColor.a < u_AlphaCutoff)
    {
        discard;
    }
    baseColor.a = 1.0;
#endif

#ifdef LINEAR_OUTPUT
    g_finalColor = vec4(color.rgb, baseColor.a);
#else
    g_finalColor = vec4(toneMap(color), baseColor.a);
#endif

#else
    // In case of missing data for a debug view, render a checkerboard.
    g_finalColor = vec4(1.0);
    {
        float frequency = 0.02;
        float gray = 0.9;

        vec2 v1 = step(0.5, fract(frequency * gl_FragCoord.xy));
        vec2 v2 = step(0.5, vec2(1.0) - fract(frequency * gl_FragCoord.xy));
        g_finalColor.rgb *= gray + v1.x * v1.y + v2.x * v2.y;
    }
#endif

    // Debug views:

    // Generic:
#if DEBUG == DEBUG_UV_0 && defined(HAS_TEXCOORD_0_VEC2)
    g_finalColor.rgb = vec3(v_texcoord_0, 0);
#endif
#if DEBUG == DEBUG_UV_1 && defined(HAS_TEXCOORD_1_VEC2)
    g_finalColor.rgb = vec3(v_texcoord_1, 0);
#endif
#if DEBUG == DEBUG_NORMAL_TEXTURE && defined(HAS_NORMAL_MAP)
    g_finalColor.rgb = (normalInfo.ntex + 1.0) / 2.0;
#endif
#if DEBUG == DEBUG_NORMAL_SHADING
    g_finalColor.rgb = (n + 1.0) / 2.0;
#endif
#if DEBUG == DEBUG_NORMAL_GEOMETRY
    g_finalColor.rgb = (normalInfo.ng + 1.0) / 2.0;
#endif
#if DEBUG == DEBUG_TANGENT
    g_finalColor.rgb = (normalInfo.t + 1.0) / 2.0;
#endif
#if DEBUG == DEBUG_BITANGENT
    g_finalColor.rgb = (normalInfo.b + 1.0) / 2.0;
#endif
#if DEBUG == DEBUG_ALPHA
    g_finalColor.rgb = vec3(baseColor.a);
#endif
#if DEBUG == DEBUG_OCCLUSION && defined(HAS_OCCLUSION_MAP)
    g_finalColor.rgb = vec3(ao);
#endif
#if DEBUG == DEBUG_EMISSIVE
    g_finalColor.rgb = linearTosRGB(f_emissive);
#endif

    // MR:

#if DEBUG == DEBUG_METALLIC
    g_finalColor.rgb = vec3(materialInfo.metallic);
#endif
#if DEBUG == DEBUG_ROUGHNESS
    g_finalColor.rgb = vec3(materialInfo.perceptualRoughness);
#endif
#if DEBUG == DEBUG_BASE_COLOR
    g_finalColor.rgb = linearTosRGB(materialInfo.baseColor);
#endif

}
