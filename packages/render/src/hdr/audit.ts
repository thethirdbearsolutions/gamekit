// Finds custom shaders that will fight a linear-HDR pipeline: the usual
// FALLS-49 suspects. Run it once in development and fix what it reports.
import * as THREE from 'three';

export interface ShaderFinding {
  object: string;
  material: string;
  issue: 'manual-gamma' | 'manual-tonemap' | 'clamped-output' | 'encodes-output' | 'tonemapped-flag';
  detail: string;
}

const CHECKS: [ShaderFinding['issue'], RegExp, string][] = [
  ['manual-gamma', /pow\s*\([^;]*(1\.0\s*\/\s*2\.2|0\.454|2\.2\s*\))/, 'gamma applied in-shader: the pipeline encodes sRGB once at the end, so this double-encodes (washed out, flat)'],
  ['manual-tonemap', /(ACESFilmic|Uncharted|Reinhard|\/\s*\(\s*(\w+|vec3\s*\(\s*1\.0\s*\))\s*\+\s*(vec3\s*\(\s*1\.0\s*\)|1\.0|\w+)\s*\))/, 'tone mapping in-shader: tone map once in the final pass, or bright values never reach bloom'],
  ['clamped-output', /gl_FragColor\s*=\s*(clamp|saturate|min)\s*\(|FragColor\s*=\s*(clamp|saturate)\s*\(/, 'output clamped to [0,1]: HDR highlights are cut off before bloom and tone mapping'],
  ['encodes-output', /LinearTosRGB|linearToOutputTexel|sRGBTransferOETF/, 'encodes to sRGB itself: write scene-linear color and let the pipeline encode'],
];

/** Scan every ShaderMaterial / RawShaderMaterial under `root`. */
export function auditShaders(root: THREE.Object3D): ShaderFinding[] {
  const out: ShaderFinding[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mats = [(o as THREE.Mesh).material].flat().filter(Boolean) as THREE.Material[];
    for (const m of mats) {
      if (seen.has(m) || !(m as THREE.ShaderMaterial).isShaderMaterial) continue;
      seen.add(m);
      const fs = (m as THREE.ShaderMaterial).fragmentShader;
      const name = o.name || o.type;
      for (const [issue, re, detail] of CHECKS) if (re.test(fs)) out.push({ object: name, material: m.name || m.type, issue, detail });
    }
  });
  return out;
}
