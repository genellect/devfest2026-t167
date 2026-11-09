"use client";
import { useEffect, useRef } from "react";
import type * as THREE_NS from "three";

/**
 * LP の WebGL の場面（Three.js）。three は画面に入ってから読み込む。
 * - NotesScene：奥行きのある空間に学生の付箋が浮かび、スクロールで1枚が黄色く光って手前に来る（まだ話されていない論点）
 * - RoomsScene：教室が地平線まで並び、引いていくと中央から外へ付箋が灯っていく（すべての教室に）
 * 進み具合は、いちばん近い [data-scene] の節のスクロール量から求める。
 * 画面の外では描画を止め、動きを減らす設定では最後の状態を1枚だけ描く。WebGL が使えなければ何も描かない。
 */

type Three = typeof THREE_NS;

const YELLOW = 0xffd84d;
const PASTELS = [0x9ad4f5, 0xf7b3c8, 0xb9e3c6, 0xd5c8f2];

function rand(i: number, k: number) { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); }
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

function sceneProgress(el: HTMLElement) {
  const sec = el.closest<HTMLElement>("[data-scene]");
  if (!sec) return 0;
  const r = sec.getBoundingClientRect();
  return clamp01(-r.top / Math.max(1, r.height - window.innerHeight));
}

/** 付箋の形（右下だけ大きく丸めた紙）と、書かれた行の灰色の線を描いたテクスチャ */
function noteTexture(THREE: Three, lines: boolean) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 192;
  const g = c.getContext("2d")!;
  const r = [10, 10, 44, 10]; // 左上・右上・右下・左下
  g.beginPath(); g.roundRect(4, 4, 248, 184, r); g.fillStyle = "#fff"; g.fill();
  if (lines) { g.fillStyle = "rgba(0,0,0,.16)"; g.beginPath(); g.roundRect(32, 56, 170, 16, 8); g.roundRect(32, 92, 120, 16, 8); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** 光のにじみ（黄色の付箋の後ろに足す） */
function glowTexture(THREE: Three) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,216,77,.9)"); grad.addColorStop(.35, "rgba(255,216,77,.35)"); grad.addColorStop(1, "rgba(255,216,77,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/** 黄色の付箋の文字（白地に書き、色はマテリアルで掛ける） */
async function foundTexture(THREE: Three, label: string, lines: string[]) {
  await document.fonts?.ready;
  const c = document.createElement("canvas"); c.width = 1024; c.height = 640;
  const g = c.getContext("2d")!;
  g.beginPath(); g.roundRect(8, 8, 1008, 624, [24, 24, 120, 24]); g.fillStyle = "#fff"; g.fill();
  g.fillStyle = "rgba(58,46,0,.7)"; g.font = '700 46px "Noto Sans JP", "Hiragino Sans", sans-serif'; g.fillText(label, 80, 150);
  g.fillStyle = "#3a2e00"; g.font = '900 84px "Noto Sans JP", "Hiragino Sans", sans-serif';
  lines.forEach((l, i) => g.fillText(l, 80, 300 + i * 118));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** 共通：three の読み込み・描画先・大きさの追従・画面外での停止・後片付け */
function useStage(setup: (THREE: Three, ctx: { host: HTMLDivElement; renderer: THREE_NS.WebGLRenderer; reduce: boolean }) => Promise<{ frame: (t: number) => void; resize: (w: number, h: number) => void; dispose: () => void }>) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stop = () => {};
    let cancelled = false;
    (async () => {
      const THREE = await import("three");
      if (cancelled) return;
      let renderer: THREE_NS.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); } catch { return; }
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 1);
      el.appendChild(renderer.domElement);
      const s = await setup(THREE, { host: el, renderer, reduce });
      if (cancelled) { s.dispose(); renderer.dispose(); renderer.domElement.remove(); return; }
      const size = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); s.resize(w, h); };
      size();
      const ro = new ResizeObserver(() => { size(); if (reduce) s.frame(0); });
      ro.observe(el);
      let visible = true, raf = 0;
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
      io.observe(el);
      const loop = (t: number) => { raf = requestAnimationFrame(loop); if (visible) s.frame(t / 1000); };
      if (reduce) s.frame(0); else raf = requestAnimationFrame(loop);
      el.classList.add("is-ready");
      stop = () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); s.dispose(); renderer.dispose(); renderer.domElement.remove(); };
    })();
    return () => { cancelled = true; stop(); };
  }, [setup]);
  return host;
}

export function NotesScene({ label, lines }: { label: string; lines: string[] }) {
  const host = useStage(setupNotes(label, lines));
  return <div ref={host} className="gl gl--notes" aria-hidden="true" />;
}

const setupNotesCache = new Map<string, Parameters<typeof useStage>[0]>();
function setupNotes(label: string, lines: string[]) {
  const key = label + lines.join("");
  const hit = setupNotesCache.get(key);
  if (hit) return hit;
  const fn: Parameters<typeof useStage>[0] = async (THREE, { host, renderer, reduce }) => {
    const small = window.innerWidth < 768;
    const N = small ? 150 : 280;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 10, 46);
    const camera = new THREE.PerspectiveCamera(small ? 55 : 40, 1, 0.1, 100);

    const tex = noteTexture(THREE, true);
    const geo = new THREE.PlaneGeometry(1.6, 1.2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 1 });
    const notes = new THREE.InstancedMesh(geo, mat, N);
    const base = Array.from({ length: N }, (_, i) => ({
      x: (rand(i, 1) - .5) * (small ? 18 : 34), y: (rand(i, 2) - .5) * (small ? 26 : 18), z: -rand(i, 3) * 40 + 1,
      r: (rand(i, 4) - .5) * .5, ph: rand(i, 5) * Math.PI * 2, s: .8 + rand(i, 6) * .5,
    })).filter((b) => Math.hypot(b.x, b.y + .3) > 2.2 || b.z < -16); // 黄色の付箋の通り道をあける
    notes.count = base.length;
    const color = new THREE.Color();
    base.forEach((_, i) => {
      const pastel = rand(i, 7) < .22;
      color.set(pastel ? PASTELS[i % 4] : 0xe8eaf0).multiplyScalar(pastel ? .8 : .62);
      notes.setColorAt(i, color);
    });
    scene.add(notes);

    const found = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), new THREE.MeshBasicMaterial({ map: await foundTexture(THREE, label, lines), transparent: true }));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: glowTexture(THREE), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(glow, found);
    const start = new THREE.Vector3(small ? 1.4 : 3.6, small ? -3 : -1.6, -18), end = new THREE.Vector3(0, small ? .2 : .1, small ? .2 : 1.4);
    const dim = new THREE.Color(0x7c7f86), lit = new THREE.Color(YELLOW);

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const pointer = { x: 0, y: 0 };
    const onMove = (ev: PointerEvent) => { pointer.x = ev.clientX / window.innerWidth - .5; pointer.y = ev.clientY / window.innerHeight - .5; };
    window.addEventListener("pointermove", onMove, { passive: true });

    const frame = (t: number) => {
      const p = reduce ? 1 : sceneProgress(host);
      const f = ease((p - .12) / .55);
      base.forEach((b, i) => {
        e.set(0, 0, b.r + Math.sin(t * .4 + b.ph) * .04);
        q.setFromEuler(e);
        v.set(b.x, b.y + Math.sin(t * .5 + b.ph) * .18, b.z);
        sc.setScalar(b.s);
        notes.setMatrixAt(i, m.compose(v, q, sc));
      });
      notes.instanceMatrix.needsUpdate = true;
      mat.opacity = 1 - f * .65;
      found.position.lerpVectors(start, end, f);
      found.rotation.z = (1 - f) * .18;
      const fs = 1 + f * (small ? .05 : .1);
      found.scale.setScalar(fs);
      (found.material as THREE_NS.MeshBasicMaterial).color.copy(dim).lerp(lit, f);
      glow.position.copy(found.position).setZ(found.position.z - .4);
      (glow.material as THREE_NS.MeshBasicMaterial).opacity = f;
      camera.position.x += (pointer.x * 1.2 - camera.position.x) * .04;
      camera.position.y += (-pointer.y * .8 - camera.position.y) * .04;
      camera.position.z = 9 - p * 1.5;
      camera.lookAt(0, 0, -6);
      renderer.render(scene, camera);
    };
    return {
      frame,
      resize: (w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); },
      dispose: () => { window.removeEventListener("pointermove", onMove); geo.dispose(); mat.dispose(); tex.dispose(); found.geometry.dispose(); (found.material as THREE_NS.MeshBasicMaterial).map?.dispose(); glow.geometry.dispose(); },
    };
  };
  setupNotesCache.set(key, fn);
  return fn;
}

const setupRooms: Parameters<typeof useStage>[0] = async (THREE, { host, renderer, reduce }) => {
  const small = window.innerWidth < 768;
  const G = small ? 17 : 19, GAP = 2.3;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 18, 70);
  const camera = new THREE.PerspectiveCamera(small ? 60 : 42, 1, 0.1, 200);

  const roomTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d")!;
    g.beginPath(); g.roundRect(6, 6, 244, 244, 36); g.fillStyle = "#fff"; g.fill();
    const t = new THREE.CanvasTexture(c); return t;
  })();
  const rooms = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 1.4), new THREE.MeshBasicMaterial({ map: roomTex, transparent: true, depthWrite: false }), G * G);
  const noteTex = noteTexture(THREE, false);
  const PER = 6;
  const notes = new THREE.InstancedMesh(new THREE.PlaneGeometry(.42, .3), new THREE.MeshBasicMaterial({ map: noteTex, transparent: true, depthWrite: false }), G * G * PER);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const half = (G - 1) / 2;
  const dist: number[] = [];
  const hue: number[] = [];
  for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
    const i = r * G + c, x = (c - half) * GAP, z = (r - half) * GAP * .82;
    rooms.setMatrixAt(i, m.compose(v.set(x, 0, z), q, one));
    dist[i] = Math.hypot(c - half, r - half);
    for (let k = 0; k < PER; k++) {
      const nx = x - .58 + (k % 3) * .58, nz = z - .25 + Math.floor(k / 3) * .5;
      notes.setMatrixAt(i * PER + k, m.compose(v.set(nx, .01, nz), q, one));
      hue[i * PER + k] = rand(i * PER + k, 8) > .9 ? YELLOW : PASTELS[Math.floor(rand(i * PER + k, 9) * 4)];
    }
  }
  rooms.renderOrder = 0; notes.renderOrder = 1; // 付箋を教室の板より後に描く（同じ高さで重なるため）
  scene.add(rooms, notes);
  const off = new THREE.Color(0x1d1d20), roomOff = new THREE.Color(0x111113), roomOn = new THREE.Color(0x2a2a2e), cc = new THREE.Color(), on = new THREE.Color();
  const maxD = Math.hypot(half, half);
  let last = -1;
  const frame = (t: number) => {
    const p = reduce ? 1 : sceneProgress(host);
    const g = ease(p / .7);
    if (Math.abs(p - last) > .0005) {
      last = p;
      const front = g * (maxD + 3);
      for (let i = 0; i < G * G; i++) {
        const l = clamp01((front - dist[i]) / 2.5);
        rooms.setColorAt(i, cc.copy(roomOff).lerp(roomOn, l));
        for (let k = 0; k < PER; k++) notes.setColorAt(i * PER + k, cc.copy(off).lerp(on.set(hue[i * PER + k]), l));
      }
      rooms.instanceColor!.needsUpdate = true; notes.instanceColor!.needsUpdate = true;
    }
    const drift = reduce ? 0 : Math.sin(t * .15) * .6;
    camera.position.set(drift, 2.6 + g * (small ? 30 : 24), 2.2 + g * (small ? 14 : 20));
    camera.lookAt(0, 0, -g * 2 + (small ? 8 * g : 0)); // 縦長の画面では手前を見下ろし、上の空きをなくす
    renderer.render(scene, camera);
  };
  return {
    frame,
    resize: (w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose: () => { rooms.geometry.dispose(); notes.geometry.dispose(); roomTex.dispose(); noteTex.dispose(); },
  };
};

export function RoomsScene() {
  const host = useStage(setupRooms);
  return <div ref={host} className="gl gl--rooms" aria-hidden="true" />;
}
