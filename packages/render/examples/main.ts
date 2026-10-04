// Curved road beside a Gerstner sea, lanterns that bloom selectively, all
// through the linear-HDR pipeline. Keys: T tone map, B bloom mode, C curve,
// ↑/↓ exposure. The water shading here is a placeholder until the sailing
// lab's and waterfall-falls' water are extracted (see README).
import * as THREE from 'three';
import { FixedStepLoop, InputMap } from '@gamekit/core';
import { CurvedWorld, HdrPipeline, WaveSet, wavesGlsl, waveUniforms, type BloomMode, type ToneMap } from '@gamekit/render';

const curved = CurvedWorld.install({ samples: 65, step: 3 });
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const skyTop = new THREE.Color().setRGB(0.18, 0.32, 0.62, THREE.LinearSRGBColorSpace);
scene.background = skyTop;
scene.fog = new THREE.Fog(new THREE.Color().setRGB(0.55, 0.62, 0.72, THREE.LinearSRGBColorSpace), 60, 220);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);
camera.position.set(0, 6, 12);
camera.lookAt(0, 1, -20);

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(-20, 30, 10);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, new THREE.HemisphereLight(0xbfd4ff, 0x3a3020, 0.8));

// Road and roadside, laid out straight down -z; the bend draws them curved.
const road = new THREE.Mesh(new THREE.PlaneGeometry(8, 400, 1, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x555a60 }));
road.position.set(0, 0, -190);
road.receiveShadow = true;
scene.add(road);
const lanternMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.55, 0.2), emissiveIntensity: 12 });
const postMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a });
const hdr = new HdrPipeline(renderer, scene, camera, { toneMapping: 'agx', bloom: { mode: 'selective', strength: 0.8 } });
for (let z = -6; z > -380; z -= 12) {
  for (const x of [-5, 5]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), postMat);
    post.position.set(x, 1.5, z);
    post.castShadow = true;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), lanternMat);
    lamp.position.set(x, 3.2, z);
    hdr.selectBloom(lamp);
    scene.add(post, lamp);
  }
}

// Sea: a displaced grid using the shared wave function.
const waves = WaveSet.wind({ direction: 0.3, wavelength: 22, amplitude: 0.7, count: 6, seed: 7 });
const wu = waveUniforms(waves);
const water = new THREE.Mesh(new THREE.PlaneGeometry(160, 400, 200, 400).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
  uniforms: { ...wu, uDeep: { value: new THREE.Color().setRGB(0.01, 0.06, 0.09, THREE.LinearSRGBColorSpace) },
    uSky: { value: skyTop }, uSun: { value: new THREE.Vector3().copy(sun.position).normalize() } },
  vertexShader: wavesGlsl() + /* glsl */ `
    varying vec3 vN; varying vec3 vW;
    void main() {
      vec4 w = modelMatrix * vec4( position, 1.0 );
      w.xyz += gkWaveDisplace( w.xz, uWaveTime );
      vN = gkWaveNormal( ( modelMatrix * vec4( position, 1.0 ) ).xz, uWaveTime );
      w = bendWorld( w ); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
    void main() {
      vec3 v = normalize( cameraPosition - vW );
      float f = 0.02 + 0.98 * pow( 1.0 - max( dot( vN, v ), 0.0 ), 5.0 );
      float spec = pow( max( dot( reflect( -uSun, vN ), v ), 0.0 ), 400.0 ) * 40.0; // HDR glint: blooms in 'both'
      gl_FragColor = vec4( mix( uDeep, uSky, f ) + spec, 1.0 ); // scene-linear, no tone map, no gamma
    }`,
}));
water.position.set(-86, -0.4, -190);
scene.add(water);

const input = new InputMap({ tone: ['KeyT'], bloom: ['KeyB'], curve: ['KeyC'], brighter: ['ArrowUp'], darker: ['ArrowDown'] });
input.attach(window);
const tones: ToneMap[] = ['agx', 'aces', 'neutral', 'none'];
const blooms: BloomMode[] = ['selective', 'both', 'threshold', 'off'];
let curve = 1;
const setCurve = () => {
  curved.path.fromCurvature((s) => curve * (0.025 * Math.sin(s / 35) + (s > 60 && s < 110 ? 0.02 : 0)));
  curved.path.drop = curve * 0.0004;
  curved.sync();
};
setCurve();

const hud = document.getElementById('hud')!;
const loop = new FixedStepLoop({
  hz: 60,
  step: (dt, tick) => {
    const f = input.sample(tick);
    if (f.pressed('tone')) hdr.toneMapping = tones[(tones.indexOf(hdr.toneMapping) + 1) % tones.length];
    if (f.pressed('bloom')) hdr.bloomMode = blooms[(blooms.indexOf(hdr.bloomMode) + 1) % blooms.length];
    if (f.pressed('curve')) { curve = curve ? 0 : 1; setCurve(); }
    if (f.held('brighter')) hdr.exposure *= 1 + dt;
    if (f.held('darker')) hdr.exposure /= 1 + dt;
    wu.uWaveTime.value = tick * dt;
  },
  render: () => {
    scene.updateMatrixWorld();
    curved.updateBounds(scene);
    hdr.render();
    hud.textContent = `tone ${hdr.toneMapping} (T)  bloom ${hdr.bloomMode} (B)  curve ${curve ? 'on' : 'off'} (C)  exposure ${hdr.exposure.toFixed(2)} (↑/↓)`;
  },
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  hdr.setSize(innerWidth, innerHeight);
});

declare global { interface Window { __game: unknown } }
window.__game = {
  state: () => ({ tick: loop.tick, tone: hdr.toneMapping, bloom: hdr.bloomMode, curve, exposure: hdr.exposure, calls: renderer.info.render.calls }),
  actions: { tone: ['KeyT'], bloom: ['KeyB'], curve: ['KeyC'], brighter: ['ArrowUp'], darker: ['ArrowDown'] },
  step: (n = 1) => { loop.runSteps(n); loop.redraw(); },
  pause: () => loop.stop(),
  resume: () => loop.start(),
};
if (new URLSearchParams(location.search).get('paused') !== '1') loop.start();
