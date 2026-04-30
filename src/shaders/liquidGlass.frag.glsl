#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_background;
uniform sampler2D u_blur;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_width;
uniform float u_height;
uniform float u_powerFactor;
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

float sdSuperellipse(vec2 p, float n, float r) {
  vec2 p_abs = abs(p);
  float numerator = pow(p_abs.x, n) + pow(p_abs.y, n) - pow(r, n);
  float den_x = pow(p_abs.x, 2.0 * n - 2.0);
  float den_y = pow(p_abs.y, 2.0 * n - 2.0);
  float denominator = n * sqrt(den_x + den_y) + 0.00001;
  return numerator / denominator;
}

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

  vec2 centered = v_uv - u_center;
  vec2 shapeSize = max(vec2(u_width, u_height), vec2(0.001));
  vec2 p = centered / (shapeSize / 20.0);
  float d = sdSuperellipse(p, u_powerFactor, 1.0);

  if (d > 0.0) {
    o_color = bg;
    return;
  }

  float dist = -d;
  vec2 sampleP = p * pow(f(dist), u_fPower);
  vec2 sampleUv = u_center + sampleP * (shapeSize / 20.0);
  sampleUv = clamp(sampleUv, 0.0, 1.0);

  vec4 blurColor = texture(u_blur, sampleUv);
  vec4 baseColor = mix(bg, blurColor, 0.82);
  vec4 noise = vec4(vec3(rand(gl_FragCoord.xy * 1e-3 + u_time * 0.015) - 0.5), 0.0);

  float lowEdge = min(u_glowEdge0, u_glowEdge1);
  float highEdge = max(u_glowEdge0, u_glowEdge1);
  float glowMask = smoothstep(lowEdge, highEdge, dist);
  float mul = Glow(v_uv) * u_glowWeight * glowMask + 1.0 + u_glowBias;

  vec3 glass = baseColor.rgb * mul + noise.rgb * u_noise;
  float edge = smoothstep(0.08, 0.0, abs(d));
  o_color = vec4(mix(bg.rgb, glass, edge), 1.0);
}
