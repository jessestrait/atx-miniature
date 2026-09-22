import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* A camera rig that can be flown as well as orbited.
 *  - drag orbits, right-drag or two-finger drags the ground, wheel zooms
 *  - W/A/S/D (and the arrows) slide the target over the ground, screen-relative
 *  - Q/E drop and raise the camera, R/F change the tilt
 *  - double-click flies to whatever is under the cursor
 *  - +/- zoom without a wheel, 0 reframes the whole model
 * Keyboard motion is velocity based with damping, so a tap nudges and a hold
 * accelerates. Speed scales with how far out you are, so it feels the same
 * at street level and at model level. */
export class Rig {
  constructor(canvas, halfW, halfH) {
    this.canvas = canvas;
    this.halfW = halfW; this.halfH = halfH;
    this.span = Math.max(halfW, halfH);

    this.persp = new THREE.PerspectiveCamera(26, 1, 5, 60000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -30000, 60000);
    this.camera = this.persp;

    this.controls = new OrbitControls(this.persp, canvas);
    const c = this.controls;
    c.enableDamping = true; c.dampingFactor = .07;
    c.screenSpacePanning = false;          // pan across the ground, not the screen plane
    c.panSpeed = 1.1; c.zoomSpeed = 1.15; c.rotateSpeed = .85;
    c.maxPolarAngle = Math.PI * .495; c.minDistance = 60; c.maxDistance = 14000;
    c.autoRotateSpeed = .35;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.keys = {};                            // we drive the keyboard ourselves

    this.keys = new Set();
    this.vel = new THREE.Vector3();
    this.zoomVel = 0; this.tiltVel = 0;
    this.flight = null;

    this._onKeyDown = e => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.has(k) || k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') e.preventDefault();
      this.keys.add(k);
      if (k === '0') this.frameAll();
    };
    this._onKeyUp = e => this.keys.delete(e.key.toLowerCase());
    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    addEventListener('blur', () => this.keys.clear());
  }

  get isOrtho() { return this.camera === this.ortho; }

  setMode(kind) {
    const target = this.controls.target.clone();
    const wasDist = this.camera.position.distanceTo(target);
    this.camera = kind === 'iso' ? this.ortho : this.persp;
    if (kind === 'iso') {
      // true isometric: equal x/z, y such that the vertical axis foreshortens correctly
      const d = Math.max(wasDist, this.span * 1.4);
      this.camera.position.set(target.x + d, target.y + d * Math.SQRT2 * Math.tan(35.264 * Math.PI / 180) * Math.SQRT2, target.z + d);
      this.ortho.zoom = this.ortho.zoom || 1;
    } else {
      const d = Math.max(wasDist, this.span * .9);
      this.camera.position.set(target.x - d * .45, target.y + d * .78, target.z + d * .72);
    }
    this.camera.lookAt(target);
    this.controls.object = this.camera;
    this.controls.target.copy(target);
    this.controls.update();
    return this.camera;
  }

  frameAll() {
    this.flyTo(new THREE.Vector3(0, 0, 0), this.span * 1.9);
  }

  /** Smoothly move the orbit target and distance. */
  flyTo(target, dist) {
    const cur = this.controls.target.clone();
    const curDist = this.camera.position.distanceTo(cur);
    this.flight = { t: 0, from: cur, to: target.clone(), d0: curDist, d1: dist ?? curDist };
  }

  /** A single scripted move: wide and high, pushing in and swinging round,
   *  landing on the skyline. Written as a spherical sweep rather than a path
   *  so it reads the same at any model size. */
  startFilm(seconds) {
    this.flight = null; this.vel.set(0, 0, 0);
    const c = this.controls;
    this.film = {
      t: 0, dur: Math.max(4, seconds),
      t0: new THREE.Vector3(0, 0, 0),
      t1: new THREE.Vector3(-this.halfW * .08, 0, this.halfH * .12),
      az0: -0.62, az1: 0.78,
      po0: 0.44, po1: 0.98,
      d0: this.span * 2.35, d1: this.span * 0.62,
    };
    if (this.isOrtho) return false;
    return true;
  }
  stopFilm() { this.film = null; }

  /** Ground point under a screen position, for double-click focus. */
  pickGround(ev, meshes) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? hit.point : null;
  }

  resize(w, h) {
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    const span = (this.halfW + this.halfH) * .78, a = w / h;
    this.ortho.left = -span * Math.max(a, 1); this.ortho.right = span * Math.max(a, 1);
    this.ortho.top = span / Math.min(a, 1); this.ortho.bottom = -span / Math.min(a, 1);
    this.ortho.updateProjectionMatrix();
  }

  update(dt) {
    const c = this.controls, cam = this.camera;
    const dist = cam.position.distanceTo(c.target);
    const scale = this.isOrtho ? this.span / this.ortho.zoom : dist;

    // --- keyboard: screen-relative ground movement
    const k = this.keys;
    const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const boost = k.has('shift') ? 2.6 : 1;
    if ((fwd || side) && this.film) this.film = null;
    if (fwd || side) {
      const f = new THREE.Vector3().subVectors(c.target, cam.position); f.y = 0;
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
      f.normalize();
      const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
      this.vel.addScaledVector(f, fwd * scale * 1.9 * boost * dt)
              .addScaledVector(r, side * scale * 1.9 * boost * dt);
      this.flight = null;
    }
    this.vel.multiplyScalar(Math.pow(0.0016, dt));
    if (this.vel.lengthSq() > 1e-8) {
      const d = this.vel.clone().multiplyScalar(dt);
      c.target.add(d); cam.position.add(d);
      // keep the target over the model so you cannot lose the thing
      const lim = 1.35;
      c.target.x = THREE.MathUtils.clamp(c.target.x, -this.halfW * lim, this.halfW * lim);
      c.target.z = THREE.MathUtils.clamp(c.target.z, -this.halfH * lim, this.halfH * lim);
    }

    // --- zoom keys and height keys
    const zk = (k.has('=') || k.has('+') ? 1 : 0) - (k.has('-') || k.has('_') ? 1 : 0);
    if (zk) this.zoomVel += zk * 2.4 * dt;
    this.zoomVel *= Math.pow(0.002, dt);
    if (Math.abs(this.zoomVel) > 1e-4) {
      if (this.isOrtho) {
        this.ortho.zoom = THREE.MathUtils.clamp(this.ortho.zoom * (1 + this.zoomVel * dt * 6), .15, 24);
        this.ortho.updateProjectionMatrix();
      } else {
        const dir = new THREE.Vector3().subVectors(cam.position, c.target);
        const nd = THREE.MathUtils.clamp(dir.length() * (1 - this.zoomVel * dt * 6), c.minDistance, c.maxDistance);
        cam.position.copy(c.target).add(dir.setLength(nd));
      }
    }
    const tk = (k.has('r') ? 1 : 0) - (k.has('f') ? 1 : 0);
    const hk = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
    if (tk || hk) {
      this.tiltVel += (tk * .9 + hk * .9) * dt;
      this.flight = null;
    }
    this.tiltVel *= Math.pow(0.002, dt);
    if (Math.abs(this.tiltVel) > 1e-4 && !this.isOrtho) {
      const off = new THREE.Vector3().subVectors(cam.position, c.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.phi = THREE.MathUtils.clamp(sph.phi - this.tiltVel * dt * 2.2, .06, Math.PI * .495);
      cam.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
    }

    // --- film: a scripted push-in, for recording
    if (this.film) {
      const f = this.film;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t * f.t * (3 - 2 * f.t);                      // smoothstep
      const az = f.az0 + (f.az1 - f.az0) * e;
      const po = f.po0 + (f.po1 - f.po0) * e;
      // ease the distance on its own curve so the push-in lands late
      const de = 1 - Math.pow(1 - f.t, 2.4);
      const d = f.d0 + (f.d1 - f.d0) * de;
      const sph = new THREE.Spherical(d, po, az);
      c.target.lerpVectors(f.t0, f.t1, e);
      cam.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
      if (f.t >= 1) this.film = null;
      c.update();
      return;
    }

    // --- scripted flight
    if (this.flight) {
      const fl = this.flight;
      fl.t = Math.min(1, fl.t + dt / 1.1);
      const s = fl.t * fl.t * (3 - 2 * fl.t);
      const tgt = fl.from.clone().lerp(fl.to, s);
      const d = fl.d0 + (fl.d1 - fl.d0) * s;
      const dir = new THREE.Vector3().subVectors(cam.position, c.target).normalize();
      c.target.copy(tgt);
      cam.position.copy(tgt).add(dir.multiplyScalar(d));
      if (fl.t >= 1) this.flight = null;
    }

    c.update();
  }
}
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '=', '-', '+', '_', '0', ' ']);
