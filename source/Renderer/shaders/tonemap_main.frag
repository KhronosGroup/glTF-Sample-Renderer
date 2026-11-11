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
uniform vec2 u_TextureSize;

out vec4 g_finalColor;

void main()
{
    // Sample the render target in framebuffer space: gl_FragCoord is relative to
    // the framebuffer, so it maps 1:1 onto the full-size textures even when this
    // pass draws into a letterboxed viewport.
    vec2 uv = gl_FragCoord.xy / u_TextureSize;

    uint splatCoverage = texture(u_TonemapSampler, uv).r;
    vec4  color          = texture(u_MainSampler, uv);

    if (splatCoverage == 2u) {
        color.rgb = toneMap(color.rgb);
    } else if (splatCoverage == 1u) {
        color.rgb = linearTosRGB(color.rgb);
    }
    g_finalColor = vec4(color.rgb, color.a);
}
