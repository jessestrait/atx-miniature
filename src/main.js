import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { City, makeUniforms } from './city.js';
import { Life } from './life.js';
import { Rig } from './camera.js';
import { eraAt, FIRST_YEAR, LAST_YEAR } from './era.js';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight('#e4ecf4', '#a89a7c', .9);
const sun = new THREE.DirectionalLight('#fff2dd', 2.4);
sun.castShadow = true; sun.shadow.bias = -4e-4; sun.shadow.normalBias = 1.2;
scene.add(hemi, sun, sun.target);

// ---------------------------------------------------------------- model
const uniforms = makeUniforms();
const model = await (await fetch(Q.get('model') || 'data/downtown.json')).json();
const city = new City(model, uniforms, 1.6);
scene.add(city.group);
const life = new Life(model, city, { density: Q.has('light') ? .45 : 1 });
scene.add(life.group);

const rig = new Rig(canvas, city.halfW, city.halfH);
let camera = rig.setMode('mini');
rig.frameAll();

const YMIN = model.years ? model.years.min : FIRST_YEAR;
const YMAX = model.years ? model.years.max : LAST_YEAR;
$('yr').min = YMIN; $('yr').max = YMAX; $('yr').value = YMAX;

/* Where a run should start. The slider still reaches 1847, but only six of
 * 3,346 buildings predate 1870, so a linear run from the earliest one opens
 * on twenty seconds of empty prairie. Start a few years before the point
 * where half a percent of the city is standing. */
const SORTED_YEARS = model.buildings.map(b => b.y).sort((a, b) => a - b);
const RUN_START = Math.max(YMIN, SORTED_YEARS[Math.floor(SORTED_YEARS.length * 0.005)] - 8);

// ---------------------------------------------------------------- post
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.18 }, vig: { value: .3 },
              warm: { value: 0 }, haze: { value: .09 }, hazeCol: { value: new THREE.Color('#e9e2d3') } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, vig, warm, haze; uniform vec3 hazeCol; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(.299,.587,.114));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.14, 1.02, .82) + vec3(.05,.025,0.), warm);
      c.rgb = mix(c.rgb, hazeCol, haze);
      float d = distance(vUv, vec2(.5));
      c.rgb *= 1.0 - vig * smoothstep(.38, .98, d);
      gl_FragColor = c;
    }`
};
let composer, bokeh, hTilt, vTilt, grade;
function makeComposer() {
  const s = renderer.getSize(new THREE.Vector2()).multiplyScalar(renderer.getPixelRatio());
  const rt = new THREE.WebGLRenderTarget(Math.max(2, s.x), Math.max(2, s.y), { type: THREE.HalfFloatType, samples: 4 });
  if (composer) composer.dispose();
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bokeh = new BokehPass(scene, camera, { focus: 2000, aperture: 3e-5, maxblur: .012 });
  composer.addPass(bokeh);
  hTilt = new ShaderPass(HorizontalTiltShiftShader); vTilt = new ShaderPass(VerticalTiltShiftShader);
  composer.addPass(hTilt); composer.addPass(vTilt);
  grade = new ShaderPass(GradeShader); composer.addPass(grade);
  composer.addPass(new OutputPass());
  applyBlur();
}
function applyBlur(dist) {
  const v = $('blur').value / 100, iso = rig.isOrtho;
  const d = dist ?? (rig.camera.position.distanceTo(rig.controls.target) || 2000);
  // The miniature illusion needs a shallow field relative to the *model*, so
  // the aperture eases off as you fly in — otherwise a street-level shot is
  // blurred end to end and reads as a smear rather than a model.
  const near = Math.min(1, Math.max(.22, d / 2200));
  bokeh.enabled = !iso && v > .01;
  bokeh.uniforms.aperture.value = 7e-5 * v * near;
  bokeh.uniforms.maxblur.value = (.004 + .010 * v) * near;
  hTilt.enabled = vTilt.enabled = iso && v > .01;
  const s = renderer.getSize(new THREE.Vector2()).multiplyScalar(renderer.getPixelRatio());
  hTilt.uniforms.h.value = 3.5 * v / Math.max(1, s.x);
  vTilt.uniforms.v.value = 3.5 * v / Math.max(1, s.y);
  hTilt.uniforms.r.value = vTilt.uniforms.r.value = .5;
}

function setQuality(q) {
  sun.shadow.mapSize.set(q, q);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}
setQuality(Q.has('light') ? 2048 : 4096);

function setSun() {
  const az = $('sun').value * Math.PI / 180, el = 48 * Math.PI / 180, R = 5000;
  sun.position.set(Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R);
  const s = sun.shadow.camera, span = Math.max(city.halfW, city.halfH) * 1.5;
  s.left = -span; s.right = span; s.top = span; s.bottom = -span; s.near = 500; s.far = 11000;
  s.updateProjectionMatrix();
}

function frame() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  rig.resize(w, h);
  if (composer) { composer.setSize(w, h); applyBlur(); }
}

// ---------------------------------------------------------------- timeline
let timeline = false, playing = false, year = YMAX, rate = 10;   // years per second
let revealT = 1;

function setTimeline(on) {
  timeline = on;
  uniforms.uMode.value = on ? 1 : 0;
  $('tlRow').style.display = on ? '' : 'none';
  $('btnTime').classList.toggle('on', on);
  $('btnPop').classList.toggle('on', !on);
  if (on) { year = RUN_START; $('yr').value = year; playing = true; $('play').textContent = '❚❚'; }
  else { revealT = 0; playing = false; }
  syncYear();
}
function syncYear() {
  uniforms.uYear.value = year;
  const y = Math.round(year);
  $('yrLabel').textContent = y;
  const e = eraAt(timeline ? year : LAST_YEAR);
  $('eraLabel').textContent = timeline ? e.label : '';
  scene.background = e.cSky;
  sun.color.copy(e.cSun); hemi.color.copy(e.cSky); hemi.groundColor.copy(e.cAmb);
  if (grade) {
    grade.uniforms.sat.value = e.sat; grade.uniforms.vig.value = e.vig;
    grade.uniforms.warm.value = e.warm; grade.uniforms.haze.value = e.haze;
    grade.uniforms.hazeCol.value.copy(e.cSky);
  }
  if (timeline) {
    const n = model.buildings.filter(b => b.y <= year).length;
    $('count').textContent = `${n.toLocaleString()} standing`;
  } else $('count').textContent = `${model.buildings.length.toLocaleString()} buildings`;
}

// ---------------------------------------------------------------- ui
$('btnPop').onclick = () => setTimeline(false);
$('btnTime').onclick = () => setTimeline(true);
$('viewMini').onclick = () => { camera = rig.setMode('mini'); markView(); makeComposer(); frame(); };
$('viewIso').onclick = () => { camera = rig.setMode('iso'); markView(); makeComposer(); frame(); };
function markView() { $('viewMini').classList.toggle('on', !rig.isOrtho); $('viewIso').classList.toggle('on', rig.isOrtho); }
$('blur').oninput = applyBlur;
$('sun').oninput = setSun;
$('yr').oninput = () => { year = +$('yr').value; playing = false; $('play').textContent = '▶'; syncYear(); };
$('play').onclick = () => { if (!timeline) setTimeline(true); else { playing = !playing; if (playing && year >= YMAX - .5) year = RUN_START; $('play').textContent = playing ? '❚❚' : '▶'; } };
$('speed').oninput = () => { rate = +$('speed').value; $('speedLabel').textContent = rate + ' yr/s'; };
$('replay').onclick = () => { if (timeline) { year = RUN_START; playing = true; $('play').textContent = '❚❚'; syncYear(); } else revealT = 0; };
$('life').onchange = () => life.setVisible($('life').checked);
$('frameAll').onclick = () => rig.frameAll();

canvas.addEventListener('dblclick', ev => {
  const p = rig.pickGround(ev, [city.buildingMesh, city.group.children[0]].filter(Boolean));
  if (p) rig.flyTo(p, Math.max(220, camera.position.distanceTo(rig.controls.target) * .45));
});
addEventListener('keydown', e => {
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
  if (e.key === 'h' || e.key === 'H') $('ui').classList.toggle('hidden');
  if (e.key === 't' || e.key === 'T') setTimeline(!timeline);
});
addEventListener('resize', frame);

function runLength() { return timeline ? (YMAX - RUN_START) / rate + 2.2 : 10; }

/** Start the reveal from the top, with the scripted camera move. */
function startFilm(hideUi) {
  if (hideUi) $('ui').classList.add('hidden');
  $('orbit').checked = false;
  if (timeline) { year = RUN_START; playing = true; $('play').textContent = '❚❚'; syncYear(); }
  else revealT = 0;
  rig.startFilm(runLength());
}
$('film').onclick = () => startFilm(false);

let recorder = null;
$('rec').onclick = () => {
  if (recorder) { recorder.stop(); return; }
  const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) { $('rec').textContent = 'no recorder'; return; }
  recorder = new MediaRecorder(canvas.captureStream(60), { mimeType: type, videoBitsPerSecond: 14e6 });
  const chunks = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    $('dl').href = URL.createObjectURL(new Blob(chunks, { type }));
    $('dl').style.display = 'inline'; $('rec').textContent = '● Record'; recorder = null;
    $('ui').classList.remove('hidden');
  };
  $('rec').textContent = '■ Stop'; $('dl').style.display = 'none';
  startFilm(true);
  recorder.start();
  setTimeout(() => recorder && recorder.stop(), (runLength() + 1.2) * 1000);
};

makeComposer(); setSun(); markView(); frame(); syncYear();
setTimeline(Q.has('pop') ? false : true);
$('load').classList.add('gone');

window.atx = { scene, city, life, rig, model, uniforms, get year() { return year; }, set year(v) { year = v; $('yr').value = v; syncYear(); } };

// ---------------------------------------------------------------- loop
let last = performance.now(), acc = 0, fps = 60;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  fps += ((1 / Math.max(dt, 1e-3)) - fps) * .05;

  if (timeline) {
    if (playing) {
      year += rate * dt;
      if (year >= YMAX) { year = YMAX; playing = false; $('play').textContent = '▶'; }
      $('yr').value = year;
      acc += dt;
      if (acc > .08) { acc = 0; syncYear(); }
      else uniforms.uYear.value = year;
    }
  } else {
    revealT = Math.min(1, revealT + dt / 9);
    uniforms.uReveal.value = revealT;
  }

  rig.controls.autoRotate = $('orbit').checked;
  rig.update(dt);
  if (life.group.visible) life.update(dt, year, timeline);
  if (!rig.isOrtho) {
    const d = camera.position.distanceTo(rig.controls.target);
    // Keep the clip range tight around the subject: the depth-of-field pass
    // reads the depth buffer, and a 5..60000 range leaves it no precision.
    const near = Math.max(1, d * 0.03), far = Math.max(near + 10, d * 5 + city.maxR);
    if (Math.abs(camera.near - near) > near * 0.12 || Math.abs(camera.far - far) > far * 0.12) {
      camera.near = near; camera.far = far; camera.updateProjectionMatrix();
      bokeh.materialBokeh.uniforms.nearClip.value = near;
      bokeh.materialBokeh.uniforms.farClip.value = far;
    }
    bokeh.uniforms.focus.value = d;
    applyBlur(d);
  }
  composer.render();
}
requestAnimationFrame(tick);
