import * as THREE from 'three';
import type { AABBObstacle } from '../systems/PlayerController';

export type FlickerLight = {
  light: THREE.PointLight;
  baseIntensity: number;
  /** Random phase offset so lights don't flicker in sync */
  phase: number;
};

export type Level = {
  root: THREE.Group;
  obstacles: AABBObstacle[];
  spawn: THREE.Vector3;
  playerSpawn: THREE.Vector3;
  playerHeight: number;
  enemyRig: THREE.Object3D;
  exit: THREE.Vector3;
  exitMarker: THREE.Object3D;
  /** Room name → center position, used by WatchSystem for navigation hints */
  roomCenters: Map<string, THREE.Vector3>;
  /** Key pickup object */
  keyObj: THREE.Object3D;
  keyPos: THREE.Vector3;
  /** Locked door */
  doorObj: THREE.Object3D;
  doorPos: THREE.Vector3;
  doorObstacle: AABBObstacle;
  /** Lights that flicker */
  flickerLights: FlickerLight[];
  /** Enemy patrol waypoints */
  patrolPoints: THREE.Vector3[];
};

function makeBoxObstacle(min: THREE.Vector3, max: THREE.Vector3): AABBObstacle {
  return { min: min.clone(), max: max.clone() };
}

// ── Procedural texture generators ──

function makeCanvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // Expose canvas for normal map generation
  (tex as any)._sourceCanvas = canvas;
  return tex;
}

/** Generate a normal map from a canvas texture using Sobel filter on luminance heightmap */
function makeNormalMap(sourceTexture: THREE.CanvasTexture, strength: number): THREE.CanvasTexture {
  const srcCanvas = (sourceTexture as any)._sourceCanvas as HTMLCanvasElement;
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const srcCtx = srcCanvas.getContext('2d')!;
  const srcData = srcCtx.getImageData(0, 0, w, h).data;

  // Build grayscale heightmap
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = srcData[i * 4];
    const g = srcData[i * 4 + 1];
    const b = srcData[i * 4 + 2];
    height[i] = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  const outImg = outCtx.createImageData(w, h);

  const sample = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel operator
      const tl = sample(x - 1, y - 1);
      const t  = sample(x,     y - 1);
      const tr = sample(x + 1, y - 1);
      const l  = sample(x - 1, y);
      const r  = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b  = sample(x,     y + 1);
      const br = sample(x + 1, y + 1);

      const dX = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dY = (bl + 2 * b + br) - (tl + 2 * t + tr);

      // Normal vector
      const nx = -dX * strength;
      const ny = -dY * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      const idx = (y * w + x) * 4;
      outImg.data[idx]     = ((nx / len) * 0.5 + 0.5) * 255;
      outImg.data[idx + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      outImg.data[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      outImg.data[idx + 3] = 255;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  const tex = new THREE.CanvasTexture(outCanvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.copy(sourceTexture.repeat);
  return tex;
}

/** Generate a procedural roughness variation map */
function makeRoughnessMap(
  w: number, h: number,
  baseRoughness: number, variation: number,
  repeat: THREE.Vector2
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Fill with base roughness value (mapped to 0-255)
  const baseVal = Math.round(baseRoughness * 255);
  ctx.fillStyle = `rgb(${baseVal},${baseVal},${baseVal})`;
  ctx.fillRect(0, 0, w, h);

  // Add noise variation
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const offset = (Math.random() - 0.5) * variation * 255;
    const v = Math.max(0, Math.min(255, Math.round(baseVal + offset)));
    ctx.fillStyle = `rgba(${v},${v},${v},0.15)`;
    ctx.fillRect(x, y, 3, 3);
  }

  // Wet/shiny patches (lower roughness = shinier)
  for (let i = 0; i < 4; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 10 + Math.random() * 25;
    const shinyVal = Math.round((baseRoughness - variation * 0.7) * 255);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${shinyVal},${shinyVal},${shinyVal},0.4)`);
    grad.addColorStop(1, `rgba(${shinyVal},${shinyVal},${shinyVal},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.copy(repeat);
  return tex;
}

// Texture resolution — 512 for desktop, 256 fallback for low-end
const TEX_RES = (navigator.hardwareConcurrency ?? 4) >= 4 ? 512 : 256;
const S = TEX_RES / 256; // scale factor for drawing ops

function makeWallTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(TEX_RES, TEX_RES, (ctx) => {
    // Base: dirty beige plaster
    ctx.fillStyle = '#8a7e6b';
    ctx.fillRect(0, 0, TEX_RES, TEX_RES);
    // Noise grain
    for (let i = 0; i < 3000 * S; i++) {
      const x = Math.random() * TEX_RES;
      const y = Math.random() * TEX_RES;
      const v = Math.floor(120 + Math.random() * 30);
      ctx.fillStyle = `rgba(${v},${v - 10},${v - 20},0.15)`;
      ctx.fillRect(x, y, 2 * S, 2 * S);
    }
    // Stain patches
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * TEX_RES;
      const y = Math.random() * TEX_RES;
      const r = (20 + Math.random() * 40) * S;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(60,50,40,0.25)');
      grad.addColorStop(1, 'rgba(60,50,40,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Cracks
    ctx.strokeStyle = 'rgba(40,35,30,0.3)';
    ctx.lineWidth = 1 * S;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      let cx = Math.random() * TEX_RES, cy = Math.random() * TEX_RES;
      ctx.moveTo(cx, cy);
      for (let s = 0; s < 8; s++) {
        cx += (Math.random() - 0.5) * 30 * S;
        cy += Math.random() * 20 * S;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
  });
}

function makeFloorTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(TEX_RES, TEX_RES, (ctx) => {
    // Dark tile pattern
    ctx.fillStyle = '#2a2a2e';
    ctx.fillRect(0, 0, TEX_RES, TEX_RES);
    // Tile grid
    const tileSize = 64 * S;
    ctx.strokeStyle = 'rgba(20,20,22,0.6)';
    ctx.lineWidth = 2 * S;
    for (let x = 0; x <= TEX_RES; x += tileSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TEX_RES); ctx.stroke();
    }
    for (let y = 0; y <= TEX_RES; y += tileSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TEX_RES, y); ctx.stroke();
    }
    // Tile color variation
    const tiles = Math.round(TEX_RES / tileSize);
    for (let tx = 0; tx < tiles; tx++) {
      for (let ty = 0; ty < tiles; ty++) {
        const v = Math.floor(Math.random() * 15);
        ctx.fillStyle = `rgba(${v},${v},${v + 2},0.2)`;
        ctx.fillRect(tx * tileSize + 2 * S, ty * tileSize + 2 * S, tileSize - 4 * S, tileSize - 4 * S);
      }
    }
    // Dirt spots
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * TEX_RES;
      const y = Math.random() * TEX_RES;
      const r = (5 + Math.random() * 15) * S;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(15,12,10,0.3)');
      grad.addColorStop(1, 'rgba(15,12,10,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

function makeCeilingTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(TEX_RES, TEX_RES, (ctx) => {
    // Stained ceiling panels
    ctx.fillStyle = '#555550';
    ctx.fillRect(0, 0, TEX_RES, TEX_RES);
    // Panel seams
    const panelSize = 128 * S;
    ctx.strokeStyle = 'rgba(30,30,28,0.5)';
    ctx.lineWidth = 2 * S;
    for (let x = 0; x <= TEX_RES; x += panelSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TEX_RES); ctx.stroke();
    }
    for (let y = 0; y <= TEX_RES; y += panelSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TEX_RES, y); ctx.stroke();
    }
    // Water stains
    for (let i = 0; i < 4; i++) {
      const x = Math.random() * TEX_RES;
      const y = Math.random() * TEX_RES;
      const r = (15 + Math.random() * 30) * S;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(70,60,40,0.2)');
      grad.addColorStop(0.7, 'rgba(70,60,40,0.1)');
      grad.addColorStop(1, 'rgba(70,60,40,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

export function loadLevel(scene: THREE.Scene): Level {
  const root = new THREE.Group();
  scene.add(root);
  return createKindergartenLevel(root);
}

/* =========================================================================
   Покинутий Садок — Abandoned Kindergarten Level
   ========================================================================= */

function createKindergartenLevel(root: THREE.Group): Level {
  const obstacles: AABBObstacle[] = [];
  const roomCenters = new Map<string, THREE.Vector3>();

  // ── Dimensions ──
  const CEIL_H = 2.8;
  const WALL_T = 0.25; // wall thickness
  const CORR_HALF = 1.35; // corridor half-width (X: -1.35 to 1.35)

  // Overall bounds
  const X_MIN = -12;
  const X_MAX = 12;
  const Z_MIN = -10;
  const Z_MAX = 10;

  // Room dividers (Z positions of horizontal walls separating rooms)
  const Z_DIV1 = -3.3; // between north rooms and mid rooms
  const Z_DIV2 = 3.3;  // between mid rooms and south rooms

  // ── Materials with procedural textures ──
  const wallTex = makeWallTexture();
  wallTex.repeat.set(2, 1);
  const wallNormal = makeNormalMap(wallTex, 2.0);
  const wallRoughMap = makeRoughnessMap(256, 256, 0.92, 0.15, wallTex.repeat);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x8a7e6b,
    roughness: 1.0,
    metalness: 0.0,
    emissive: 0x050403,
    emissiveIntensity: 0.3,
    map: wallTex,
    normalMap: wallNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: wallRoughMap,
  });

  const wallTexDark = makeWallTexture();
  wallTexDark.repeat.set(2, 1);
  const wallDarkNormal = makeNormalMap(wallTexDark, 2.0);
  const wallDarkRoughMap = makeRoughnessMap(256, 256, 0.92, 0.15, wallTexDark.repeat);
  const wallMatDark = new THREE.MeshStandardMaterial({
    color: 0x5a5347,
    roughness: 1.0,
    metalness: 0.0,
    emissive: 0x030302,
    emissiveIntensity: 0.2,
    map: wallTexDark,
    normalMap: wallDarkNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: wallDarkRoughMap,
  });

  const floorTex = makeFloorTexture();
  floorTex.repeat.set(4, 3);
  const floorNormal = makeNormalMap(floorTex, 3.0);
  const floorRoughMap = makeRoughnessMap(256, 256, 0.9, 0.2, floorTex.repeat);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2e,
    roughness: 1.0,
    metalness: 0.02,
    emissive: 0x020203,
    emissiveIntensity: 0.1,
    map: floorTex,
    normalMap: floorNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: floorRoughMap,
  });

  const corrFloorTex = makeFloorTexture();
  corrFloorTex.repeat.set(1, 6);
  const corrFloorNormal = makeNormalMap(corrFloorTex, 3.0);
  const corrFloorRoughMap = makeRoughnessMap(256, 256, 0.9, 0.2, corrFloorTex.repeat);
  const corridorFloorMat = new THREE.MeshStandardMaterial({
    color: 0x22222a,
    roughness: 1.0,
    metalness: 0.02,
    map: corrFloorTex,
    normalMap: corrFloorNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: corrFloorRoughMap,
  });

  const ceilTex = makeCeilingTexture();
  ceilTex.repeat.set(3, 2);
  const ceilNormal = makeNormalMap(ceilTex, 1.5);
  const ceilRoughMap = makeRoughnessMap(256, 256, 0.88, 0.1, ceilTex.repeat);
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x555550,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
    map: ceilTex,
    normalMap: ceilNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: ceilRoughMap,
  });

  const rubbleMat = new THREE.MeshStandardMaterial({
    color: 0x4a4540,
    roughness: 1.0,
    metalness: 0.0,
  });

  const rubbleDarkMat = new THREE.MeshStandardMaterial({
    color: 0x333030,
    roughness: 1.0,
    metalness: 0.0,
  });

  // External texture no longer needed — using procedural textures above

  // ── Helpers ──

  /** Add a wall box with collision */
  const addWall = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat?: THREE.Material) => {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat || wallMat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    ));
  };

  /** Add a floor plane with faux AO at edges */
  const addFloor = (cx: number, cz: number, sx: number, sz: number, mat?: THREE.Material) => {
    const geo = new THREE.PlaneGeometry(sx, sz, 4, 4);
    // Darken edge vertices for faux ambient occlusion
    const posAttr = geo.getAttribute('position');
    const colors = new Float32Array(posAttr.count * 3);
    const halfX = sx / 2, halfZ = sz / 2;
    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i);
      const lz = posAttr.getY(i); // PlaneGeometry: Y in local = Z in world after rotation
      const edgeX = 1 - Math.pow(Math.abs(lx) / halfX, 3);
      const edgeZ = 1 - Math.pow(Math.abs(lz) / halfZ, 3);
      const ao = 0.65 + 0.35 * Math.min(edgeX, edgeZ);
      colors[i * 3] = ao;
      colors[i * 3 + 1] = ao;
      colors[i * 3 + 2] = ao;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const useMat = (mat || floorMat) as THREE.MeshStandardMaterial;
    const aoMat = useMat.clone();
    aoMat.vertexColors = true;
    const mesh = new THREE.Mesh(geo, aoMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, 0, cz);
    mesh.receiveShadow = true;
    root.add(mesh);
  };

  /** Add a ceiling plane with faux AO at edges */
  const addCeiling = (cx: number, cz: number, sx: number, sz: number) => {
    const geo = new THREE.PlaneGeometry(sx, sz, 4, 4);
    const posAttr = geo.getAttribute('position');
    const colors = new Float32Array(posAttr.count * 3);
    const halfX = sx / 2, halfZ = sz / 2;
    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i);
      const lz = posAttr.getY(i);
      const edgeX = 1 - Math.pow(Math.abs(lx) / halfX, 3);
      const edgeZ = 1 - Math.pow(Math.abs(lz) / halfZ, 3);
      const ao = 0.7 + 0.3 * Math.min(edgeX, edgeZ);
      colors[i * 3] = ao;
      colors[i * 3 + 1] = ao;
      colors[i * 3 + 2] = ao;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const aoMat = ceilingMat.clone();
    aoMat.vertexColors = true;
    const mesh = new THREE.Mesh(geo, aoMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(cx, CEIL_H, cz);
    root.add(mesh);
  };

  /** Add rubble pile (decorative + collision) */
  const addRubble = (cx: number, cz: number, spread: number, count: number, withCollision: boolean) => {
    const rubbleGroup = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const sx = 0.2 + Math.random() * 0.6;
      const sy = 0.15 + Math.random() * 0.45;
      const sz = 0.2 + Math.random() * 0.6;
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const mesh = new THREE.Mesh(geo, Math.random() > 0.5 ? rubbleMat : rubbleDarkMat);
      mesh.position.set(
        cx + (Math.random() - 0.5) * spread,
        sy / 2,
        cz + (Math.random() - 0.5) * spread,
      );
      mesh.rotation.set(
        Math.random() * 0.3,
        Math.random() * Math.PI,
        Math.random() * 0.3,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      rubbleGroup.add(mesh);
    }
    root.add(rubbleGroup);

    if (withCollision) {
      // Big collision box covering the rubble pile
      obstacles.push(makeBoxObstacle(
        new THREE.Vector3(cx - spread / 2 - 0.3, 0, cz - spread / 2 - 0.3),
        new THREE.Vector3(cx + spread / 2 + 0.3, 1.2, cz + spread / 2 + 0.3),
      ));
    }
  };

  /** Add scattered floor debris (no collision, just atmosphere) */
  const addDebris = (cx: number, cz: number, spread: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const s = 0.05 + Math.random() * 0.15;
      const geo = new THREE.BoxGeometry(s, s * 0.3, s);
      const mesh = new THREE.Mesh(geo, rubbleDarkMat);
      mesh.position.set(
        cx + (Math.random() - 0.5) * spread,
        s * 0.15,
        cz + (Math.random() - 0.5) * spread,
      );
      mesh.rotation.y = Math.random() * Math.PI;
      root.add(mesh);
    }
  };

  // ═══════════════════════════════════════════════════════════
  //  FLOORS & CEILINGS
  // ═══════════════════════════════════════════════════════════

  // Corridor floor + ceiling
  addFloor(0, 0, CORR_HALF * 2, Z_MAX - Z_MIN, corridorFloorMat);
  addCeiling(0, 0, CORR_HALF * 2, Z_MAX - Z_MIN);

  // West rooms floors + ceilings
  const westRoomW = Math.abs(X_MIN) - CORR_HALF;
  const westCenterX = (X_MIN + (-CORR_HALF)) / 2;
  const roomDepth1 = Z_DIV1 - Z_MIN;
  const roomDepth2 = Z_DIV2 - Z_DIV1;
  const roomDepth3 = Z_MAX - Z_DIV2;

  // West north room (Nap Room)
  addFloor(westCenterX, (Z_MIN + Z_DIV1) / 2, westRoomW, roomDepth1);
  addCeiling(westCenterX, (Z_MIN + Z_DIV1) / 2, westRoomW, roomDepth1);
  roomCenters.set('Спальня', new THREE.Vector3(westCenterX, 0, (Z_MIN + Z_DIV1) / 2));

  // West mid room (Playroom)
  addFloor(westCenterX, (Z_DIV1 + Z_DIV2) / 2, westRoomW, roomDepth2);
  addCeiling(westCenterX, (Z_DIV1 + Z_DIV2) / 2, westRoomW, roomDepth2);
  roomCenters.set('Ігрова', new THREE.Vector3(westCenterX, 0, (Z_DIV1 + Z_DIV2) / 2));

  // West south room (WC)
  addFloor(westCenterX, (Z_DIV2 + Z_MAX) / 2, westRoomW, roomDepth3);
  addCeiling(westCenterX, (Z_DIV2 + Z_MAX) / 2, westRoomW, roomDepth3);
  roomCenters.set('Туалет', new THREE.Vector3(westCenterX, 0, (Z_DIV2 + Z_MAX) / 2));

  // East rooms
  const eastRoomW = X_MAX - CORR_HALF;
  const eastCenterX = (CORR_HALF + X_MAX) / 2;

  // East north room (Office)
  addFloor(eastCenterX, (Z_MIN + Z_DIV1) / 2, eastRoomW, roomDepth1);
  addCeiling(eastCenterX, (Z_MIN + Z_DIV1) / 2, eastRoomW, roomDepth1);
  roomCenters.set('Кабінет', new THREE.Vector3(eastCenterX, 0, (Z_MIN + Z_DIV1) / 2));

  // East mid room (Cafeteria)
  addFloor(eastCenterX, (Z_DIV1 + Z_DIV2) / 2, eastRoomW, roomDepth2);
  addCeiling(eastCenterX, (Z_DIV1 + Z_DIV2) / 2, eastRoomW, roomDepth2);
  roomCenters.set('Їдальня', new THREE.Vector3(eastCenterX, 0, (Z_DIV1 + Z_DIV2) / 2));

  // East south room (Storage)
  addFloor(eastCenterX, (Z_DIV2 + Z_MAX) / 2, eastRoomW, roomDepth3);
  addCeiling(eastCenterX, (Z_DIV2 + Z_MAX) / 2, eastRoomW, roomDepth3);
  roomCenters.set('Комірка', new THREE.Vector3(eastCenterX, 0, (Z_DIV2 + Z_MAX) / 2));

  roomCenters.set('Коридор', new THREE.Vector3(0, 0, 0));

  // ═══════════════════════════════════════════════════════════
  //  OUTER WALLS
  // ═══════════════════════════════════════════════════════════

  const WH = CEIL_H; // wall height
  const WY = CEIL_H / 2;  // wall center Y

  // North wall (Z = Z_MIN)
  addWall(0, WY, Z_MIN, X_MAX - X_MIN, WH, WALL_T);
  // South wall — west portion only (east side opens into Велика Ігрова via Комірка)
  addWall((X_MIN + CORR_HALF) / 2, WY, Z_MAX, CORR_HALF - X_MIN, WH, WALL_T);
  // West wall (X = X_MIN)
  addWall(X_MIN, WY, 0, WALL_T, WH, Z_MAX - Z_MIN);
  // East wall (X = X_MAX)
  addWall(X_MAX, WY, 0, WALL_T, WH, Z_MAX - Z_MIN);

  // ═══════════════════════════════════════════════════════════
  //  CORRIDOR WALLS (with door gaps)
  // ═══════════════════════════════════════════════════════════

  // West corridor wall (X = -CORR_HALF), split by door gaps
  // Door gap positions (Z center of 1.4-unit gap):
  const doorGapSize = 1.4;

  // West corridor wall — 3 doors at center of each room
  const westDoors = [
    (Z_MIN + Z_DIV1) / 2,  // Nap room door
    (Z_DIV1 + Z_DIV2) / 2, // Playroom door
    (Z_DIV2 + Z_MAX) / 2,  // WC door
  ];

  buildWallWithGaps(-CORR_HALF, Z_MIN, Z_MAX, westDoors, doorGapSize, 'z', WH, WY, WALL_T, wallMat, root, obstacles);

  // East corridor wall — 3 doors
  const eastDoors = [
    (Z_MIN + Z_DIV1) / 2,  // Office door
    (Z_DIV1 + Z_DIV2) / 2, // Cafeteria door
    (Z_DIV2 + Z_MAX) / 2,  // Storage door (will be blocked by rubble)
  ];

  buildWallWithGaps(CORR_HALF, Z_MIN, Z_MAX, eastDoors, doorGapSize, 'z', WH, WY, WALL_T, wallMat, root, obstacles);

  // ═══════════════════════════════════════════════════════════
  //  ROOM DIVIDER WALLS
  // ═══════════════════════════════════════════════════════════

  // West dividers (between west rooms), running X from X_MIN to -CORR_HALF
  // Z = Z_DIV1 wall — solid between Nap Room and Playroom
  const westDivDoors1: number[] = []; // no door — wall is solid but DAMAGED
  buildWallWithGaps(Z_DIV1, X_MIN, -CORR_HALF, westDivDoors1, doorGapSize, 'x', WH, WY, WALL_T, wallMatDark, root, obstacles, true);

  // Z = Z_DIV2 wall — door between Playroom and WC
  buildWallWithGaps(Z_DIV2, X_MIN, -CORR_HALF, [(X_MIN + (-CORR_HALF)) / 2], doorGapSize, 'x', WH, WY, WALL_T, wallMatDark, root, obstacles, true);

  // East dividers
  // Z = Z_DIV1 — between Office and Cafeteria, has a door
  buildWallWithGaps(Z_DIV1, CORR_HALF, X_MAX, [(CORR_HALF + X_MAX) / 2], doorGapSize, 'x', WH, WY, WALL_T, wallMatDark, root, obstacles, true);

  // Z = Z_DIV2 — between Cafeteria and Storage, SOLID (blocked)
  buildWallWithGaps(Z_DIV2, CORR_HALF, X_MAX, [], doorGapSize, 'x', WH, WY, WALL_T, wallMatDark, root, obstacles, true);

  // ═══════════════════════════════════════════════════════════
  //  BLOCKED PASSAGES (rubble fills doorway)
  // ═══════════════════════════════════════════════════════════

  // Storage room entrance — locked door placed here (see LOCKED DOOR section below)

  // Block 2: Corridor north end — decorative rubble only, exit must be reachable
  addRubble(-0.8, Z_MIN + 2.5, 1.5, 10, false);

  // Block 3: Between nap room and playroom (west divider Z_DIV1) — rubble on both sides
  addRubble(westCenterX, Z_DIV1, 2.5, 12, false); // decorative only, wall is already solid

  // Corridor rubble pile (mid section, partial blockage — can squeeze past)
  addRubble(-0.6, 0, 1.2, 8, false); // decorative, no collision — can walk through

  // ═══════════════════════════════════════════════════════════
  //  SCATTERED DEBRIS (atmosphere)
  // ═══════════════════════════════════════════════════════════

  addDebris(westCenterX, (Z_MIN + Z_DIV1) / 2, 8, 20);  // Nap room
  addDebris(westCenterX, 0, 8, 15);                       // Playroom
  addDebris(eastCenterX, 0, 8, 12);                       // Cafeteria
  addDebris(eastCenterX, (Z_MIN + Z_DIV1) / 2, 6, 10);   // Office
  addDebris(0, 5, 2, 8);                                  // Corridor south
  addDebris(0, -5, 2, 6);                                 // Corridor north

  // ═══════════════════════════════════════════════════════════
  //  KINDERGARTEN FURNITURE (ruined)
  // ═══════════════════════════════════════════════════════════

  const furnitureMat = new THREE.MeshStandardMaterial({
    color: 0x6b5a42,
    roughness: 0.9,
    metalness: 0.02,
  });

  const furnitureColorMat = new THREE.MeshStandardMaterial({
    color: 0x4a6b5a,  // faded green
    roughness: 0.85,
    metalness: 0.0,
  });

  const furnitureRedMat = new THREE.MeshStandardMaterial({
    color: 0x6b3a3a,  // faded red
    roughness: 0.85,
    metalness: 0.0,
  });

  // Small chairs (scattered in playroom and cafeteria)
  const addChair = (x: number, z: number, rotY: number, tipped: boolean) => {
    const group = new THREE.Group();
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), furnitureColorMat);
    seat.position.y = 0.28;
    group.add(seat);
    // Legs
    for (const [lx, lz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.28, 0.03), furnitureMat);
      leg.position.set(lx, 0.14, lz);
      group.add(leg);
    }
    // Back
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.03), furnitureColorMat);
    back.position.set(0, 0.41, -0.135);
    group.add(back);

    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    if (tipped) {
      group.rotation.z = 0.6 + Math.random() * 0.5;
      group.position.y = 0.1;
    }
    group.castShadow = true;
    root.add(group);
  };

  // Small tables
  const addTable = (x: number, z: number, rotY: number, tipped: boolean) => {
    const group = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.5), furnitureRedMat);
    top.position.y = 0.42;
    group.add(top);
    for (const [lx, lz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), furnitureMat);
      leg.position.set(lx, 0.21, lz);
      group.add(leg);
    }
    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    if (tipped) {
      group.rotation.z = 1.2;
      group.position.y = 0.2;
    }
    root.add(group);

    if (!tipped) {
      obstacles.push(makeBoxObstacle(
        new THREE.Vector3(x - 0.4, 0, z - 0.3),
        new THREE.Vector3(x + 0.4, 0.46, z + 0.3),
      ));
    }
  };

  // Playroom furniture
  addTable(-5, -1, 0.1, false);
  addTable(-8, 1, -0.3, true);  // tipped over
  addChair(-4.5, -0.5, 0.3, false);
  addChair(-5.5, -0.5, -0.2, true);  // tipped
  addChair(-6, 0.5, 1.2, false);
  addChair(-4, 1, 0.8, true);

  // Cafeteria furniture
  addTable(5, -1.5, 0, false);
  addTable(8, 0, 0.5, false);
  addTable(6, 1.5, -0.2, true);  // tipped
  addChair(4.5, -1, 0.1, false);
  addChair(5.5, -2, -0.4, false);
  addChair(8.5, 0.5, 0, true);
  addChair(7, -0.5, 1.5, true);
  addChair(9, 1, 0.2, false);

  // Nap room — small beds
  const addBed = (x: number, z: number, rotY: number, flipped: boolean) => {
    const group = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 1.2), furnitureMat);
    frame.position.y = 0.125;
    group.add(frame);
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.08, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.95 }),
    );
    mattress.position.y = 0.29;
    group.add(mattress);
    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    if (flipped) {
      group.rotation.z = 0.8;
      group.position.y = 0.15;
    }
    root.add(group);
    if (!flipped) {
      obstacles.push(makeBoxObstacle(
        new THREE.Vector3(x - 0.35, 0, z - 0.65),
        new THREE.Vector3(x + 0.35, 0.4, z + 0.65),
      ));
    }
  };

  addBed(-4, -8, 0, false);
  addBed(-6, -8, 0, false);
  addBed(-8, -8, 0, true);   // flipped
  addBed(-4, -6, 0, false);
  addBed(-6, -6, 0, false);
  addBed(-9, -6.5, 0.3, true); // flipped and rotated

  // Office — desk and shelves
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.85 });
  const deskGeo = new THREE.BoxGeometry(1.8, 0.7, 0.8);
  const desk = new THREE.Mesh(deskGeo, deskMat);
  desk.position.set(eastCenterX + 2, 0.35, (Z_MIN + Z_DIV1) / 2 - 1);
  desk.castShadow = true;
  root.add(desk);
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(eastCenterX + 2 - 0.9, 0, (Z_MIN + Z_DIV1) / 2 - 1.4),
    new THREE.Vector3(eastCenterX + 2 + 0.9, 0.7, (Z_MIN + Z_DIV1) / 2 - 0.6),
  ));

  // Shelf in office
  const shelfGeo = new THREE.BoxGeometry(0.3, 1.6, 1.4);
  const shelf = new THREE.Mesh(shelfGeo, furnitureMat);
  shelf.position.set(X_MAX - 0.5, 0.8, (Z_MIN + Z_DIV1) / 2);
  shelf.castShadow = true;
  root.add(shelf);
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(X_MAX - 0.65, 0, (Z_MIN + Z_DIV1) / 2 - 0.7),
    new THREE.Vector3(X_MAX - 0.35, 1.6, (Z_MIN + Z_DIV1) / 2 + 0.7),
  ));

  // WC room — just some rubble and a broken sink shape
  addRubble(westCenterX - 1, (Z_DIV2 + Z_MAX) / 2, 2, 6, false);
  addRubble(westCenterX + 2, (Z_DIV2 + Z_MAX) / 2 + 1, 1.5, 4, false);

  // ═══════════════════════════════════════════════════════════
  //  DAMAGED CEILING SECTIONS (holes showing darkness above)
  // ═══════════════════════════════════════════════════════════

  // Dark patches on ceiling where tiles fell (just dark boxes above ceiling line)
  const addCeilingDamage = (x: number, z: number, sx: number, sz: number) => {
    const geo = new THREE.PlaneGeometry(sx, sz);
    const mat = new THREE.MeshBasicMaterial({ color: 0x010101, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, CEIL_H - 0.01, z);
    root.add(mesh);
  };

  addCeilingDamage(-5, -2, 1.5, 1.2);
  addCeilingDamage(3, -7, 2, 1);
  addCeilingDamage(-8, 6, 1, 1.8);
  addCeilingDamage(0, 3, 1.2, 0.8);

  // ═══════════════════════════════════════════════════════════
  //  WALL STAINS & DRAWINGS (colored patches on walls)
  // ═══════════════════════════════════════════════════════════

  const addWallDrawing = (x: number, y: number, z: number, sx: number, sy: number, facingAxis: 'x' | 'z', color: number) => {
    const geo = new THREE.PlaneGeometry(sx, sy);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.8,
      emissive: color,
      emissiveIntensity: 0.05,
      transparent: true,
      opacity: 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (facingAxis === 'x') mesh.rotation.y = Math.PI / 2;
    root.add(mesh);
  };

  // Children's drawings on walls (colored rectangles — abstract representation)
  addWallDrawing(X_MIN + 0.15, 1.2, -7, 1.0, 0.7, 'x', 0xff6644); // orange drawing in nap room
  addWallDrawing(X_MIN + 0.15, 1.0, -1, 0.8, 0.6, 'x', 0x44aa66); // green drawing in playroom
  addWallDrawing(X_MIN + 0.15, 1.3, 0.5, 1.2, 0.5, 'x', 0x4466ff); // blue drawing
  addWallDrawing(X_MAX - 0.15, 1.1, -6.5, 0.9, 0.7, 'x', 0xffcc22); // yellow drawing in office
  addWallDrawing(X_MAX - 0.15, 1.2, 0, 0.7, 0.5, 'x', 0xff4488); // pink in cafeteria

  // ═══════════════════════════════════════════════════════════
  //  LIGHTING (minimal — mostly dark, player has flashlight)
  // ═══════════════════════════════════════════════════════════

  // Ambient light — dim for horror atmosphere
  const ambient = new THREE.AmbientLight(0x222233, 1.2);
  root.add(ambient);

  const hemi = new THREE.HemisphereLight(0x334455, 0x1a1a22, 0.6);
  root.add(hemi);

  // Room lights — every room gets a flickering ceiling light
  const flickerLights: FlickerLight[] = [];
  // Light fixture geometry (shared)
  const fixtureGeo = new THREE.BoxGeometry(0.4, 0.03, 0.15);
  const fixtureMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.7,
    metalness: 0.5,
  });

  const addFlicker = (x: number, z: number, color: number, intensity: number) => {
    const light = new THREE.PointLight(color, intensity, 16, 1.5);
    light.position.set(x, CEIL_H - 0.3, z);
    light.castShadow = false;
    root.add(light);

    // Fixture mesh at ceiling
    const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
    fixture.position.set(x, CEIL_H - 0.02, z);
    root.add(fixture);

    flickerLights.push({ light, baseIntensity: intensity, phase: Math.random() * Math.PI * 2 });
    return light;
  };

  // Corridor lights (along its length)
  addFlicker(0, 7, 0xaabb99, 1.2);
  addFlicker(0, 0, 0x99aabb, 0.8);
  addFlicker(0, -7, 0xaabb99, 1.0);

  // West rooms
  addFlicker(westCenterX, (Z_MIN + Z_DIV1) / 2, 0xccaa77, 1.0);   // Nap room
  addFlicker(westCenterX, (Z_DIV1 + Z_DIV2) / 2, 0xffaa66, 0.8);  // Playroom
  addFlicker(westCenterX, (Z_DIV2 + Z_MAX) / 2, 0x99bbaa, 0.6);   // WC

  // East rooms
  addFlicker(eastCenterX, (Z_MIN + Z_DIV1) / 2, 0xbbaa88, 0.8);   // Office
  addFlicker(eastCenterX, (Z_DIV1 + Z_DIV2) / 2, 0xaaaacc, 1.0);  // Cafeteria
  addFlicker(eastCenterX, (Z_DIV2 + Z_MAX) / 2, 0x88aaaa, 0.5);   // Storage

  // ═══════════════════════════════════════════════════════════
  //  SPAWNS & EXIT
  // ═══════════════════════════════════════════════════════════

  const playerHeight = 1.5; // slightly shorter — it's a kindergarten, low ceilings feel
  const playerSpawn = new THREE.Vector3(0, playerHeight, Z_MAX - 1.5); // south end of corridor

  // Enemy spawn — in the Cafeteria (east mid room)
  const enemyRig = new THREE.Object3D();
  enemyRig.position.set(eastCenterX, playerHeight, (Z_DIV1 + Z_DIV2) / 2);

  // Articulated enemy body — dark humanoid figure
  const enemyMat = new THREE.MeshStandardMaterial({
    color: 0x0f0f12, roughness: 0.55, metalness: 0.2,
    emissive: 0x200000, emissiveIntensity: 1.8,
  });
  const enemyBody = new THREE.Group();
  enemyBody.name = 'enemyBody';
  enemyBody.position.y = -playerHeight;

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.25), enemyMat);
  torso.name = 'enemyTorso';
  torso.position.y = 1.1;
  torso.castShadow = true;
  enemyBody.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), enemyMat);
  head.name = 'enemyHead';
  head.position.y = 1.6;
  head.castShadow = true;
  enemyBody.add(head);

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 3.0,
  });
  const eyeGeo = new THREE.SphereGeometry(0.04, 8, 8);
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.07, 1.63, -0.15);
  enemyBody.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.07, 1.63, -0.15);
  enemyBody.add(rightEye);

  // Arms (pivots at shoulder)
  const armGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
  const leftArmPivot = new THREE.Object3D();
  leftArmPivot.name = 'leftArmPivot';
  leftArmPivot.position.set(-0.3, 1.35, 0);
  const leftArmMesh = new THREE.Mesh(armGeo, enemyMat);
  leftArmMesh.position.y = -0.25;
  leftArmMesh.castShadow = true;
  leftArmPivot.add(leftArmMesh);
  enemyBody.add(leftArmPivot);

  const rightArmPivot = new THREE.Object3D();
  rightArmPivot.name = 'rightArmPivot';
  rightArmPivot.position.set(0.3, 1.35, 0);
  const rightArmMesh = new THREE.Mesh(armGeo, enemyMat);
  rightArmMesh.position.y = -0.25;
  rightArmMesh.castShadow = true;
  rightArmPivot.add(rightArmMesh);
  enemyBody.add(rightArmPivot);

  // Legs (pivots at hip)
  const legGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12);
  const leftLegPivot = new THREE.Object3D();
  leftLegPivot.name = 'leftLegPivot';
  leftLegPivot.position.set(-0.12, 0.8, 0);
  const leftLegMesh = new THREE.Mesh(legGeo, enemyMat);
  leftLegMesh.position.y = -0.275;
  leftLegMesh.castShadow = true;
  leftLegPivot.add(leftLegMesh);
  enemyBody.add(leftLegPivot);

  const rightLegPivot = new THREE.Object3D();
  rightLegPivot.name = 'rightLegPivot';
  rightLegPivot.position.set(0.12, 0.8, 0);
  const rightLegMesh = new THREE.Mesh(legGeo, enemyMat);
  rightLegMesh.position.y = -0.275;
  rightLegMesh.castShadow = true;
  rightLegPivot.add(rightLegMesh);
  enemyBody.add(rightLegPivot);

  enemyRig.add(enemyBody);

  // Enemy faint red light (so you can see it coming in the dark)
  const enemyLight = new THREE.PointLight(0xff2200, 1.2, 5, 2);
  enemyLight.position.set(0, 0, 0);
  enemyLight.name = 'enemyLight';
  enemyRig.add(enemyLight);

  root.add(enemyRig);

  // ═══════════════════════════════════════════════════════════
  //  LOCKED DOOR (blocks entrance to Комірка from corridor)
  // ═══════════════════════════════════════════════════════════

  const storageDoorZ = (Z_DIV2 + Z_MAX) / 2; // door gap in east corridor wall
  const doorX = CORR_HALF; // at the east corridor wall gap

  // Door mesh — heavy metal door
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a40,
    roughness: 0.7,
    metalness: 0.4,
    emissive: 0x050508,
    emissiveIntensity: 0.3,
  });
  const doorGroup = new THREE.Group();
  // Door panel
  const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.12, CEIL_H - 0.2, doorGapSize - 0.1), doorMat);
  doorPanel.position.set(0, CEIL_H / 2, 0);
  doorPanel.castShadow = true;
  doorGroup.add(doorPanel);
  // Door handle
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.15), handleMat);
  handle.position.set(0.08, CEIL_H / 2, doorGapSize / 2 - 0.25);
  doorGroup.add(handle);
  // Lock indicator — red light
  const lockLight = new THREE.PointLight(0xff2200, 0.5, 3, 2);
  lockLight.position.set(0.1, CEIL_H / 2 + 0.2, 0);
  doorGroup.add(lockLight);
  const lockDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 3 }),
  );
  lockDot.position.set(0.08, CEIL_H / 2 + 0.2, doorGapSize / 2 - 0.25);
  doorGroup.add(lockDot);

  doorGroup.position.set(doorX, 0, storageDoorZ);
  root.add(doorGroup);

  // Door collision (blocks the gap)
  const doorPos = new THREE.Vector3(doorX, 0, storageDoorZ);
  const doorObstacle = makeBoxObstacle(
    new THREE.Vector3(doorX - 0.15, 0, storageDoorZ - doorGapSize / 2),
    new THREE.Vector3(doorX + 0.15, CEIL_H, storageDoorZ + doorGapSize / 2),
  );
  obstacles.push(doorObstacle);

  // ═══════════════════════════════════════════════════════════
  //  ВЕЛИКА ІГРОВА (Big Playroom — behind Комірка/Storage)
  // ═══════════════════════════════════════════════════════════

  const NEW_Z_MAX = 22;
  const playRoomW = X_MAX - CORR_HALF;
  const playRoomD = NEW_Z_MAX - Z_MAX;
  const playRoomCX = (CORR_HALF + X_MAX) / 2;
  const playRoomCZ = (Z_MAX + NEW_Z_MAX) / 2;

  // Floor & ceiling
  addFloor(playRoomCX, playRoomCZ, playRoomW, playRoomD);
  addCeiling(playRoomCX, playRoomCZ, playRoomW, playRoomD);

  // Walls
  addWall(CORR_HALF, WY, playRoomCZ, WALL_T, WH, playRoomD);   // west wall
  addWall(X_MAX, WY, playRoomCZ, WALL_T, WH, playRoomD);        // east wall extension
  addWall(playRoomCX, WY, NEW_Z_MAX, playRoomW, WH, WALL_T);   // south wall

  roomCenters.set('Велика Ігрова', new THREE.Vector3(playRoomCX, 0, playRoomCZ));

  // Lights
  addFlicker(playRoomCX - 3, playRoomCZ - 3, 0xffcc88, 1.5);
  addFlicker(playRoomCX + 3, playRoomCZ + 3, 0xaaccff, 1.2);
  addFlicker(playRoomCX, playRoomCZ, 0xccaa77, 0.8);

  // ── Гірка (Slide) ──
  const slideMat = new THREE.MeshStandardMaterial({ color: 0x3366cc, roughness: 0.3, metalness: 0.6 });
  const slideGroup = new THREE.Group();
  // Platform at top
  const sPlatform = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 1.0), slideMat);
  sPlatform.position.set(0, 1.85, -1.8);
  slideGroup.add(sPlatform);
  // Ramp
  const sRamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 3.2), slideMat);
  sRamp.rotation.x = -0.32;
  sRamp.position.set(0, 0.95, 0);
  slideGroup.add(sRamp);
  // Back legs (under platform)
  for (const lx of [-0.55, 0.55]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.85, 0.08), slideMat);
    leg.position.set(lx, 0.925, -1.8);
    slideGroup.add(leg);
  }
  // Front legs (under ramp high end at z≈+1.5) — ramp y≈1.45 there due to rotation
  const frontLegH = 1.5;
  for (const lx of [-0.48, 0.48]) {
    const fLeg = new THREE.Mesh(new THREE.BoxGeometry(0.08, frontLegH, 0.08), slideMat);
    fLeg.position.set(lx, frontLegH / 2, 1.5);
    slideGroup.add(fLeg);
  }
  // Ladder (back)
  for (let ry = 0.3; ry < 1.8; ry += 0.35) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), slideMat);
    rung.position.set(0, ry, -2.3);
    slideGroup.add(rung);
  }
  // Side rails
  for (const rx of [-0.48, 0.48]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 3.2), slideMat);
    rail.rotation.x = -0.32;
    rail.position.set(rx, 1.1, 0);
    slideGroup.add(rail);
  }
  slideGroup.position.set(playRoomCX - 3, 0, playRoomCZ - 2);
  slideGroup.rotation.y = 0.3;
  root.add(slideGroup);
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(playRoomCX - 4.2, 0, playRoomCZ - 4.5),
    new THREE.Vector3(playRoomCX - 1.8, 2.0, playRoomCZ - 0.2),
  ));

  // ── Гойдалки (Swings) ──
  const swingFrameMat = new THREE.MeshStandardMaterial({ color: 0xcc4422, roughness: 0.5, metalness: 0.4 });
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 });
  const swingGroup = new THREE.Group();
  // Top bar
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 0.1), swingFrameMat);
  topBar.position.set(0, 2.6, 0);
  swingGroup.add(topBar);
  // A-frame legs
  for (const [sx, sz] of [[-1.6, -0.7], [-1.6, 0.7], [1.6, -0.7], [1.6, 0.7]] as [number, number][]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), swingFrameMat);
    leg.position.set(sx, 1.3, sz);
    leg.rotation.z = sx < 0 ? 0.1 : -0.1;
    leg.rotation.x = sz < 0 ? -0.15 : 0.15;
    swingGroup.add(leg);
  }
  // Two swing seats
  for (const seatX of [-0.6, 0.6]) {
    // Chains
    for (const cx of [-0.14, 0.14]) {
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.7, 0.02), chainMat);
      chain.position.set(seatX + cx, 1.75, 0);
      swingGroup.add(chain);
    }
    // Seat plank
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x6b5a42, roughness: 0.9 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.25), seatMat);
    seat.position.set(seatX, 0.9, 0);
    swingGroup.add(seat);
  }
  swingGroup.position.set(playRoomCX + 3, 0, playRoomCZ - 2);
  root.add(swingGroup);
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(playRoomCX + 1.2, 0, playRoomCZ - 2.9),
    new THREE.Vector3(playRoomCX + 4.8, 2.7, playRoomCZ - 1.1),
  ));

  // ── Басейн з кульками (Ball Pit) ──
  const pitWallMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.7, metalness: 0.1 });
  const pitGroup = new THREE.Group();
  const PIT_W = 4.5, PIT_D = 3.5, PIT_H = 0.85;
  // Pit walls
  const pitFront = new THREE.Mesh(new THREE.BoxGeometry(PIT_W, PIT_H, 0.12), pitWallMat);
  pitFront.position.set(0, PIT_H / 2, PIT_D / 2);
  pitGroup.add(pitFront);
  const pitBack = new THREE.Mesh(new THREE.BoxGeometry(PIT_W, PIT_H, 0.12), pitWallMat);
  pitBack.position.set(0, PIT_H / 2, -PIT_D / 2);
  pitGroup.add(pitBack);
  const pitLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, PIT_H, PIT_D), pitWallMat);
  pitLeft.position.set(-PIT_W / 2, PIT_H / 2, 0);
  pitGroup.add(pitLeft);
  const pitRight = new THREE.Mesh(new THREE.BoxGeometry(0.12, PIT_H, PIT_D), pitWallMat);
  pitRight.position.set(PIT_W / 2, PIT_H / 2, 0);
  pitGroup.add(pitRight);
  // Pit floor (darker)
  const pitFloor = new THREE.Mesh(
    new THREE.BoxGeometry(PIT_W, 0.05, PIT_D),
    new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 1 }),
  );
  pitFloor.position.set(0, 0.025, 0);
  pitGroup.add(pitFloor);
  // Balls — fill the pit using InstancedMesh (8 draw calls instead of hundreds)
  const ballColors = [0xff3333, 0x33ff33, 0x3333ff, 0xffff33, 0xff33ff, 0x33ffff, 0xff8800, 0xff0088];
  const ballMats = ballColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.1 }));
  const BALL_R = 0.11;
  const BALL_D = BALL_R * 2;
  const ballGeo = new THREE.SphereGeometry(BALL_R, 6, 6);
  const cols = Math.floor((PIT_W - 0.3) / BALL_D);
  const rows = Math.floor((PIT_D - 0.3) / BALL_D);
  const layers = Math.floor((PIT_H - 0.05) / BALL_D);

  // Collect positions per color bucket
  const ballBuckets: THREE.Matrix4[][] = ballMats.map(() => []);
  const _tmpMatrix = new THREE.Matrix4();
  for (let ly = 0; ly < layers; ly++) {
    const offsetX = (ly % 2) * BALL_R;
    const offsetZ = (ly % 2) * BALL_R;
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const colorIdx = Math.floor(Math.random() * ballMats.length);
        _tmpMatrix.makeTranslation(
          -((cols - 1) * BALL_D) / 2 + col * BALL_D + offsetX + (Math.random() - 0.5) * 0.03,
          BALL_R + ly * BALL_D + (Math.random() - 0.5) * 0.02,
          -((rows - 1) * BALL_D) / 2 + row * BALL_D + offsetZ + (Math.random() - 0.5) * 0.03,
        );
        ballBuckets[colorIdx].push(_tmpMatrix.clone());
      }
    }
  }
  for (let i = 0; i < ballMats.length; i++) {
    if (ballBuckets[i].length === 0) continue;
    const instanced = new THREE.InstancedMesh(ballGeo, ballMats[i], ballBuckets[i].length);
    for (let j = 0; j < ballBuckets[i].length; j++) {
      instanced.setMatrixAt(j, ballBuckets[i][j]);
    }
    pitGroup.add(instanced);
  }
  pitGroup.position.set(playRoomCX, 0, playRoomCZ + 3);
  root.add(pitGroup);
  // Ball pit walls — individual obstacles tall enough to block the player sphere
  const pitCX = playRoomCX, pitCZ = playRoomCZ + 3;
  const pitWallH = 2.0; // tall enough to intersect player sphere at y=1.5
  const pitWT = 0.12;   // wall thickness matches visual mesh
  // Front wall (positive Z)
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(pitCX - PIT_W / 2 - 0.1, 0, pitCZ + PIT_D / 2 - pitWT / 2),
    new THREE.Vector3(pitCX + PIT_W / 2 + 0.1, pitWallH, pitCZ + PIT_D / 2 + pitWT / 2),
  ));
  // Back wall (negative Z)
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(pitCX - PIT_W / 2 - 0.1, 0, pitCZ - PIT_D / 2 - pitWT / 2),
    new THREE.Vector3(pitCX + PIT_W / 2 + 0.1, pitWallH, pitCZ - PIT_D / 2 + pitWT / 2),
  ));
  // Left wall (negative X)
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(pitCX - PIT_W / 2 - pitWT / 2, 0, pitCZ - PIT_D / 2 - 0.1),
    new THREE.Vector3(pitCX - PIT_W / 2 + pitWT / 2, pitWallH, pitCZ + PIT_D / 2 + 0.1),
  ));
  // Right wall (positive X)
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(pitCX + PIT_W / 2 - pitWT / 2, 0, pitCZ - PIT_D / 2 - 0.1),
    new THREE.Vector3(pitCX + PIT_W / 2 + pitWT / 2, pitWallH, pitCZ + PIT_D / 2 + 0.1),
  ));

  // Scattered debris in playroom
  addDebris(playRoomCX, playRoomCZ, 8, 15);
  addDebris(playRoomCX - 2, playRoomCZ + 4, 4, 8);

  // Exit — at the far south wall of Велика Ігрова
  const exit = new THREE.Vector3(playRoomCX, 0, NEW_Z_MAX - 1.5);

  // Exit marker — faint green glow (emergency exit sign)
  const exitGeo = new THREE.BoxGeometry(0.6, 0.3, 0.05);
  const exitMat = new THREE.MeshStandardMaterial({
    color: 0x00ff44,
    emissive: 0x00ff44,
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 0.8,
  });
  const exitMesh = new THREE.Mesh(exitGeo, exitMat);
  exitMesh.position.set(playRoomCX, 2.2, NEW_Z_MAX - 0.15);
  root.add(exitMesh);

  // Exit glow on floor
  const exitFloorLight = new THREE.PointLight(0x00ff44, 0.6, 4, 2);
  exitFloorLight.position.set(exit.x, 0.5, exit.z);
  root.add(exitFloorLight);

  // ═══════════════════════════════════════════════════════════
  //  KEY (hidden in the Office room)
  // ═══════════════════════════════════════════════════════════

  const keyGroup = new THREE.Group();
  // Key body
  const keyBodyGeo = new THREE.BoxGeometry(0.04, 0.04, 0.25);
  const keyMat = new THREE.MeshStandardMaterial({
    color: 0xddaa22,
    emissive: 0xddaa22,
    emissiveIntensity: 1.5,
    metalness: 0.8,
    roughness: 0.3,
  });
  const keyBody = new THREE.Mesh(keyBodyGeo, keyMat);
  keyGroup.add(keyBody);
  // Key ring (torus)
  const keyRingGeo = new THREE.TorusGeometry(0.06, 0.015, 8, 16);
  const keyRing = new THREE.Mesh(keyRingGeo, keyMat);
  keyRing.position.set(0, 0, 0.155);
  keyGroup.add(keyRing);
  // Key teeth
  for (let i = 0; i < 3; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), keyMat);
    tooth.position.set(-0.02, 0, -0.08 + i * 0.05);
    keyGroup.add(tooth);
  }

  // Place key on the desk in the Office
  const keyPos = new THREE.Vector3(eastCenterX + 2, 0.75, (Z_MIN + Z_DIV1) / 2 - 1);
  keyGroup.position.copy(keyPos);
  keyGroup.rotation.set(0.1, 0.5, Math.PI / 2);

  // Key glow light
  const keyLight = new THREE.PointLight(0xddaa22, 0.8, 4, 2);
  keyLight.position.set(0, 0.3, 0);
  keyGroup.add(keyLight);

  root.add(keyGroup);

  // ── Ground fog plane ──
  const fogMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vWorldXZ;
      varying float vWorldY;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldXZ = worldPos.xz;
        vWorldY = worldPos.y;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vWorldXZ;
      varying float vWorldY;

      float noise(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      float smoothNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = noise(i);
        float b = noise(i + vec2(1.0, 0.0));
        float c = noise(i + vec2(0.0, 1.0));
        float d = noise(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        v += smoothNoise(p * 1.0) * 0.5;
        v += smoothNoise(p * 2.0 + 3.7) * 0.25;
        v += smoothNoise(p * 4.0 + 7.1) * 0.125;
        return v;
      }

      void main() {
        vec2 uv = vWorldXZ * 0.3 + uTime * 0.02;
        float n = fbm(uv);
        float alpha = n * 0.12;
        // Fade at edges
        alpha *= smoothstep(0.5, 0.0, vWorldY);
        gl_FragColor = vec4(0.6, 0.65, 0.7, alpha);
      }
    `,
  });
  const fogPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(X_MAX - X_MIN, Z_MAX - Z_MIN + 12),
    fogMat
  );
  fogPlane.rotation.x = -Math.PI / 2;
  fogPlane.position.set(0, 0.15, (Z_MIN + Z_MAX + 12) / 2);
  fogPlane.renderOrder = 999;
  root.add(fogPlane);
  // Store reference for animation
  (root as any)._fogMaterial = fogMat;

  // Patrol waypoints — enemy visits rooms in a loop
  const patrolPoints = [
    roomCenters.get('Їдальня')!.clone().setY(playerHeight),
    roomCenters.get('Коридор')!.clone().setY(playerHeight),
    roomCenters.get('Спальня')!.clone().setY(playerHeight),
    roomCenters.get('Коридор')!.clone().setY(playerHeight).add(new THREE.Vector3(0, 0, 3)),
    roomCenters.get('Ігрова')!.clone().setY(playerHeight),
    roomCenters.get('Коридор')!.clone().setY(playerHeight).add(new THREE.Vector3(0, 0, -2)),
    roomCenters.get('Кабінет')!.clone().setY(playerHeight),
    roomCenters.get('Комірка')!.clone().setY(playerHeight),
  ];

  return {
    root,
    obstacles,
    spawn: playerSpawn.clone(),
    playerSpawn: playerSpawn.clone(),
    playerHeight,
    enemyRig,
    exit: exit.clone(),
    exitMarker: exitMesh,
    roomCenters,
    keyObj: keyGroup,
    keyPos: keyPos.clone(),
    doorObj: doorGroup,
    doorPos: doorPos.clone(),
    doorObstacle,
    flickerLights,
    patrolPoints,
  };
}

// ═══════════════════════════════════════════════════════════
//  Wall builder with door gaps
// ═══════════════════════════════════════════════════════════

/**
 * Build a wall along one axis with gaps for doors.
 * @param fixedPos - The fixed coordinate (X for z-running walls, Z for x-running walls)
 * @param start - Start of the wall along the running axis
 * @param end - End of the wall along the running axis
 * @param gapCenters - Centers of door gaps along the running axis
 * @param gapSize - Size of each gap
 * @param runAxis - 'x' means wall runs along X (fixed Z), 'z' means wall runs along Z (fixed X)
 * @param wallH - Wall height
 * @param wallY - Wall center Y
 * @param wallT - Wall thickness
 * @param mat - Material
 * @param root - Parent group
 * @param obstacles - Collision array
 * @param isHorizontal - If true, wall runs along X axis (Z is fixed)
 */
function buildWallWithGaps(
  fixedPos: number,
  start: number,
  end: number,
  gapCenters: number[],
  gapSize: number,
  runAxis: 'x' | 'z',
  wallH: number,
  wallY: number,
  wallT: number,
  mat: THREE.Material,
  root: THREE.Group,
  obstacles: AABBObstacle[],
  isHorizontal?: boolean,
): void {
  // Sort gap centers
  const gaps = gapCenters.slice().sort((a, b) => a - b);

  // Build segments between gaps
  const segments: Array<[number, number]> = [];
  let cursor = start;
  for (const gc of gaps) {
    const gapStart = gc - gapSize / 2;
    const gapEnd = gc + gapSize / 2;
    if (gapStart > cursor) segments.push([cursor, gapStart]);
    cursor = gapEnd;
  }
  if (cursor < end) segments.push([cursor, end]);

  for (const [segStart, segEnd] of segments) {
    const len = segEnd - segStart;
    const center = (segStart + segEnd) / 2;

    let cx: number, cz: number, sx: number, sz: number;

    if (runAxis === 'z') {
      // Wall runs along Z, fixed X
      cx = fixedPos;
      cz = center;
      sx = wallT;
      sz = len;
    } else {
      // Wall runs along X, fixed Z
      cx = center;
      cz = fixedPos;
      sx = len;
      sz = wallT;
    }

    const geo = new THREE.BoxGeometry(sx, wallH, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, wallY, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);

    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(cx - sx / 2, wallY - wallH / 2, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, wallY + wallH / 2, cz + sz / 2),
    ));
  }
}
