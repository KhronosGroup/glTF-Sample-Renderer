// KHR_lights_punctual extension.
// see https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_lights_punctual
struct Light
{
    vec3 direction;
    float range;

    vec3 color;
    float intensity;

    vec3 position;
    float innerConeCos;

    float outerConeCos;
    int type;
};


const int LightType_Directional = 0;
const int LightType_Point = 1;
const int LightType_Spot = 2;


#ifdef USE_PUNCTUAL
uniform Light u_Lights[LIGHT_COUNT + 1]; //Array [0] is not allowed
#endif

#ifdef MATERIAL_VOLUME_SCATTER
uniform vec3 u_ScatterSamples[SCATTER_SAMPLES_COUNT];
uniform float u_MinRadius;
uniform ivec2 u_FramebufferSize;
#endif

// https://github.com/KhronosGroup/glTF/blob/master/extensions/2.0/Khronos/KHR_lights_punctual/README.md#range-property
float getRangeAttenuation(float range, float distance)
{
    if (range <= 0.0)
    {
        // negative range means unlimited
        return 1.0 / pow(distance, 2.0);
    }
    return max(min(1.0 - pow(distance / range, 4.0), 1.0), 0.0) / pow(distance, 2.0);
}


// https://github.com/KhronosGroup/glTF/blob/master/extensions/2.0/Khronos/KHR_lights_punctual/README.md#inner-and-outer-cone-angles
float getSpotAttenuation(vec3 pointToLight, vec3 spotDirection, float outerConeCos, float innerConeCos)
{
    float actualCos = dot(normalize(spotDirection), normalize(-pointToLight));
    if (actualCos > outerConeCos)
    {
        if (actualCos < innerConeCos)
        {
            float angularAttenuation = (actualCos - outerConeCos) / (innerConeCos - outerConeCos);
            return angularAttenuation * angularAttenuation;
        }
        return 1.0;
    }
    return 0.0;
}


vec3 getLighIntensity(Light light, vec3 pointToLight)
{
    float rangeAttenuation = 1.0;
    float spotAttenuation = 1.0;

    if (light.type != LightType_Directional)
    {
        rangeAttenuation = getRangeAttenuation(light.range, length(pointToLight));
    }
    if (light.type == LightType_Spot)
    {
        spotAttenuation = getSpotAttenuation(pointToLight, light.direction, light.outerConeCos, light.innerConeCos);
    }

    return rangeAttenuation * spotAttenuation * light.intensity * light.color;
}


vec3 getPunctualRadianceTransmission(vec3 normal, vec3 view, vec3 pointToLight, float alphaRoughness,
    vec3 baseColor, float ior)
{
    float transmissionRougness = applyIorToRoughness(alphaRoughness, ior);

    vec3 n = normalize(normal);           // Outward direction of surface point
    vec3 v = normalize(view);             // Direction from surface point to view
    vec3 l = normalize(pointToLight);
    vec3 l_mirror = normalize(l + 2.0*n*dot(-l, n));     // Mirror light reflection vector on surface
    vec3 h = normalize(l_mirror + v);            // Halfway vector between transmission light vector and v

    float D = D_GGX(clamp(dot(n, h), 0.0, 1.0), transmissionRougness);
    float Vis = V_GGX(clamp(dot(n, l_mirror), 0.0, 1.0), clamp(dot(n, v), 0.0, 1.0), transmissionRougness);

    // Transmission BTDF
    return baseColor * D * Vis;
}


vec3 getPunctualRadianceClearCoat(vec3 clearcoatNormal, vec3 v, vec3 l, vec3 h, float VdotH, vec3 f0, vec3 f90, float clearcoatRoughness)
{
    float NdotL = clampedDot(clearcoatNormal, l);
    float NdotV = clampedDot(clearcoatNormal, v);
    float NdotH = clampedDot(clearcoatNormal, h);
    return NdotL * BRDF_specularGGX(clearcoatRoughness * clearcoatRoughness, NdotL, NdotV, NdotH);
}


vec3 getPunctualRadianceSheen(vec3 sheenColor, float sheenRoughness, float NdotL, float NdotV, float NdotH)
{
    return NdotL * BRDF_specularSheen(sheenColor, sheenRoughness, NdotL, NdotV, NdotH);
}


// Compute attenuated light as it travels through a volume.
vec3 applyVolumeAttenuation(vec3 radiance, float transmissionDistance, vec3 attenuationColor, float attenuationDistance)
{
    if (attenuationDistance == 0.0)
    {
        // Attenuation distance is +∞ (which we indicate by zero), i.e. the transmitted color is not attenuated at all.
        return radiance;
    }
    else
    {
        // Compute light attenuation using Beer's law.
        vec3 transmittance = pow(attenuationColor, vec3(transmissionDistance / attenuationDistance));
        return transmittance * radiance;
    }
}


vec3 getVolumeTransmissionRay(vec3 n, vec3 v, float thickness, float ior, mat4 modelMatrix)
{
    // Direction of refracted light.
    vec3 refractionVector = refract(-v, normalize(n), 1.0 / ior);

    // Compute rotation-independant scaling of the model matrix.
    vec3 modelScale;
    modelScale.x = length(vec3(modelMatrix[0].xyz));
    modelScale.y = length(vec3(modelMatrix[1].xyz));
    modelScale.z = length(vec3(modelMatrix[2].xyz));

    // The thickness is specified in local space.
    return normalize(refractionVector) * thickness * modelScale;
}

// Subsurface scattering based on the blender implementation of the Burley model.
#ifdef MATERIAL_VOLUME_SCATTER
// glTF specification for converting multi-scatter color to single scatter color.
vec3 multiToSingleScatter(vec3 multiScatterColor) {
    vec3 s = 4.09712 + 4.20863 * multiScatterColor - sqrt(9.59217 + 41.6808 * multiScatterColor + 17.7126 * multiScatterColor * multiScatterColor);
    return 1.0 - s*s;
}

vec3 burley_setup(vec3 radius, vec3 albedo) {
    float m_1_pi = 0.318309886183790671538;
    vec3 s = 1.9 - albedo + 3.5 * ((albedo - 0.8) * (albedo - 0.8));
    vec3 l = 0.25 * m_1_pi * radius;
    return l / s;
}

vec3 burley_eval(vec3 d, float r)
{
  vec3 exp_r_3_d = exp(-r / (3.0 * d));
  vec3 exp_r_d = exp_r_3_d * exp_r_3_d * exp_r_3_d;
  return (exp_r_d + exp_r_3_d) / (4.0 * d);
}


vec3 getSubsurfaceScattering(vec3 position, mat4 projectionMatrix, float attenuationDistance, sampler2D scatterLUT, vec3 diffuseColor, vec3 multiscatterColor) {
    vec3 scatterDistance = attenuationDistance * multiscatterColor; // Scale the attenuation distance by the multi-scatter color
    float maxColor = max3(scatterDistance);
    vec3 vMaxColor = max(vec3(maxColor), vec3(0.00001));
    vec2 texelSize = 1.0 / vec2(textureSize(u_ScatterDepthFramebufferSampler, 0));
    mat4 inverseProjectionMatrix = inverse(projectionMatrix);
    vec2 uv = gl_FragCoord.xy * (1.0 / vec2(u_FramebufferSize));
    vec4 centerSample = textureLod(scatterLUT, uv, 0.0); // Sample the LUT at the current UV coordinates
    float centerDepth = textureLod(u_ScatterDepthFramebufferSampler, uv, 0.0).r; // Get depth from the framebuffer
    centerDepth = centerDepth * 2.0 - 1.0; // Convert to normalized device coordinates
    vec2 clipUV = uv * 2.0 - 1.0; // Convert to clip space coordinates
    vec4 clipSpacePosition = vec4(clipUV.x, clipUV.y, centerDepth, 1.0);
    vec4 upos = inverseProjectionMatrix * clipSpacePosition; // Convert to view space coordinates
    vec3 fragViewPosition = upos.xyz / upos.w; // Normalize the coordinates
    upos = inverseProjectionMatrix * vec4(clipUV.x + texelSize.x, clipUV.y, centerDepth, 1.0); // Get position of the next texel to the right
    vec3 offsetViewPosition = upos.xyz / upos.w;
    float mPerPixel = distance(fragViewPosition, offsetViewPosition);
    float maxRadiusPixels = maxColor / mPerPixel; // Calculate the maximum radius in pixels
    if (maxRadiusPixels <= 1.0) {
        return centerSample.rgb; // If the maximum radius is less than or equal to the pixel size, the pixel itself defines the scatter color
    }

    centerDepth = fragViewPosition.z; // Extract the depth value
    vec3 totalWeight = vec3(0.0);
    vec3 totalDiffuse = vec3(0.0);

    vec3 clampedScatterDistance = max(vec3(u_MinRadius), scatterDistance / maxColor) * maxColor;
    vec3 d = burley_setup(clampedScatterDistance, diffuseColor); // Setup the Burley model parameters

    for (int i = 0; i < SCATTER_SAMPLES_COUNT; i++) {
        vec3 scatterSample = u_ScatterSamples[i];
        float fabAngle = scatterSample.x;
        float r = scatterSample.y * maxRadiusPixels * texelSize.x;
        float rcpPdf = scatterSample.z;
        vec2 sampleCoords = vec2(cos(fabAngle) * r, sin(fabAngle) * r);
        vec2 sampleUV = uv + sampleCoords; // + (randomTheta * 2.0 - 1.0) * 0.01;
        vec4 textureSample = textureLod(scatterLUT, sampleUV, 0.0);

        // Check if sample originates from same mesh/material
        if (centerSample.w == textureSample.w) {
            float sampleDepth = textureLod(u_ScatterDepthFramebufferSampler, sampleUV, 0.0).r;
            sampleDepth = sampleDepth * 2.0 - 1.0; // Convert to normalized device coordinates
            vec2 sampleClipUV = sampleUV * 2.0 - 1.0; // Convert to clip space coordinates
            vec4 sampleUpos = inverseProjectionMatrix * vec4(sampleClipUV.x, sampleClipUV.y, sampleDepth, 1.0);
            vec3 sampleViewPosition = sampleUpos.xyz / sampleUpos.w; // Normalize the coordinates

            // Distance between center and sample in comparison to maximum radius is used for weighting the scattering contribution
            float sampleDistance = distance(sampleViewPosition, fragViewPosition);
            vec3 weight = burley_eval(d, sampleDistance) * rcpPdf;

            totalWeight += weight;
            totalDiffuse += weight * textureSample.rgb;
        }
    }
    totalWeight = max(totalWeight, vec3(0.0001)); // Avoid division by zero
    return totalDiffuse / totalWeight * diffuseColor;
}
#endif // MATERIAL_VOLUME_SCATTER
