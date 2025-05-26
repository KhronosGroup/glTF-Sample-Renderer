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

vec3 getSubsurfaceScattering(vec3 v_Position, mat4 modelMatrix, mat4 viewMatrix, mat4 projectionMatrix, float attenuationDistance, sampler scatterLUT, vec3 baseColor) {
    vec2 uv = (projMatrix * viewMatrix * vec4(v_Position, 1.0)).xy;
    float centerDepth = texture(u_ScatterDepthFramebuffer, uv).x;
    vec4 centerSample = texture(scatterLUT, uv);
    vec2 texelSize = 1.0 / vec2(textureSize(u_ScatterDepthFramebuffer, 0));
    vec2 centerVector = uv * centerDepth;
    vec2 cornerVector = (uv + 0.5 * texelSize) * centerDepth;
    vec2 pixelPerM = abs(cornerVector - centerVector) * 2.0;
    mat4 inverseProjectionMatrix = inverse(projectionMatrix);
    mat4 inverseViewMatrix = inverse(viewMatrix);
    vec3 totalWeight = vec3(0.0);
    vec3 totalDiffuse = vec3(0.0);
    for (int i = 0; i < u_ScatterSamplesCount; i++) {
        vec3 scatterSample = u_ScatterSamples[i];
        float fabAngle = scatterSample.x;
        float r = scatterSample.y * attenuationDistance;
        float rcpPdf = scatterSample.z;
        vec2 samplePos = vec2(cos(fabAngle), sin(fabAngle));
        samplePos = uv + round(r * pixelPerM) * samplePos;
        vec4 textureSample = texture(scatterLUT, samplePos);
        float sampleDepth = texture(u_ScatterDepthFramebuffer, samplePos).x;
        if (centerSample.w == textureSample.w) {
            vec4 realSampleDepth = inverseViewMatrix * inverseProjectionMatrix * vec4(0.0 , 0.0, sampleDepth, 1.0);
            vec4 realCenterDepth = inverseViewMatrix * inverseProjectionMatrix * vec4(0.0 , 0.0, centerDepth, 1.0);
            float b = realSampleDepth.z - realCenterDepth.z;
            float c = sqrt(r * r + b * b);

            vec3 exp_13 = exp2(((1.4426950408889634 * (-1.0/3.0)) * c) * u_MultiScatterColor); 
            vec3 expSum = exp_13 * (1.0 + exp_13 * exp_13);        

            vec3 weight = (u_MultiScatterColor / ((8.0 * PI))) * expSum * rcpPdf; 
            totalWeight += weight;
            totalDiffuse += weight * textureSample.rgb;
        }
    }
    totalWeight = max(totalWeight, vec3(0.0001)); // Avoid division by zero
    return centerSample.xyz + baseColor * (totalDiffuse / totalWeight);
}
