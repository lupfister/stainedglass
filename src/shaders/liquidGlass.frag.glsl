#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_background;
uniform sampler2D u_blur;
uniform sampler2D u_mask;
uniform vec2 u_resolution;
uniform float u_a;
uniform float u_b;
uniform float u_c;
uniform float u_d;
uniform float u_fPower;
uniform float u_noise;
uniform float u_glowWeight;
uniform float u_glowBias;
uniform float u_glowEdge0;
uniform float u_glowEdge1;
uniform float u_time;

#define EPSILON1 (0.0000000000001)
#define EPSILON2 (0.0001)

const float M_E = 2.718281828459045;

float f(float x) {
  return 1.0 - u_b * pow(u_c * M_E, -u_d * x - u_a);
}

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

float Glow(vec2 uv) {
  return sin(atan(uv.y * 2.0 - 1.0, uv.x * 2.0 - 1.0) - 0.5);
}

void main() {
  vec4 bg = texture(u_background, v_uv);
  float mask = texture(u_mask, v_uv).r;
  if (mask <= 0.001) {
    o_color = bg;
    return;
  }

  vec2 texel = 1.0 / u_resolution;
  float gx = texture(u_mask, v_uv + vec2(texel.x, 0.0)).r - texture(u_mask, v_uv - vec2(texel.x, 0.0)).r;
  float gy = texture(u_mask, v_uv + vec2(0.0, texel.y)).r - texture(u_mask, v_uv - vec2(0.0, texel.y)).r;
  vec2 normalOffset = vec2(gx, gy);

  float dist = clamp(mask, 0.0, 1.0);
  vec2 sampleUv = clamp(v_uv - normalOffset * pow(f(dist), u_fPower), 0.0, 1.0);

  vec4 blurColor = texture(u_blur, sampleUv);
  vec4 baseColor = mix(bg, blurColor, 0.82);
  vec4 noise = vec4(vec3(rand(gl_FragCoord.xy * 1e-3 + u_time * 0.015) - 0.5), 0.0);

  float lowEdge = min(u_glowEdge0, u_glowEdge1);
  float highEdge = max(u_glowEdge0, u_glowEdge1);
  float glowMask = smoothstep(lowEdge, highEdge, dist);
  float mul = Glow(v_uv) * u_glowWeight * glowMask + 1.0 + u_glowBias;

  vec3 glass = baseColor.rgb * mul + noise.rgb * u_noise;
  float edge = smoothstep(0.02, 0.2, mask);
  o_color = vec4(mix(bg.rgb, glass, edge), 1.0);
}
