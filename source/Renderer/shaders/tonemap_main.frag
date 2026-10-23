precision highp float;

// Final tonemapping pass.
// Applies tonemapping for mesh pixels, linearToSRGB for splat pixels,
// and mixes between them based on splatCoverage.
//
// The TONEMAP_* define is injected at compile time to match the selected tone mapper,
// mirroring what pbr.frag does.  The u_Exposure uniform is provided by tonemapping.glsl.

#include <tonemapping.glsl>

uniform sampler2D u_MainSampler;
uniform lowp usampler2D u_TonemapSampler;
uniform sampler2D u_WireframeSampler;

in vec2 v_uv;

out vec4 g_finalColor;

void main()
{
    uint splatCoverage = texture(u_TonemapSampler, v_uv).r;
    vec4  color          = texture(u_MainSampler, v_uv);

    if (splatCoverage == 2u) {
        color.rgb = toneMap(color.rgb);
    } else if (splatCoverage == 1u) {
        color.rgb = linearTosRGB(color.rgb);
    }

    // Draw wireframe lines as the inverted grayscale of the displayed color
    if (texture(u_WireframeSampler, v_uv).r > 0.5) {
        float luminance = dot(clamp(color.rgb, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
        color.rgb = vec3(1.0 - luminance);
    }
    g_finalColor = vec4(color.rgb, color.a);
}
