import * as THREE from 'three';
import type { AABBObstacle } from '../systems/PlayerController';

export type FlickerLight = {
  light: THREE.PointLight;
  baseIntensity: number;
  /** Random phase offset so lights don't flicker in sync */
  phase: number;
};

export type OpenableDoor = {
  /** Name of the room this door belongs to */
  roomName: string;
  /** Pivot group (rotates around hinge) */
  pivot: THREE.Group;
  /** Position to check for interaction */
  pos: THREE.Vector3;
  /** Collision obstacle (removed when open) */
  obstacle: AABBObstacle;
  /** Current state */
  isOpen: boolean;
  /** Animation progress 0..1 */
  animProgress: number;
  /** Which side the door faces: 'x' means door panel lies in XY plane */
  facingAxis: 'x' | 'z';
  /** Open direction: 1 or -1 */
  openDir: number;
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
  /** Ball gun pickup */
  gunObj: THREE.Object3D;
  gunPos: THREE.Vector3;
  /** Shooting target + secret door in cafeteria */
  targetObj: THREE.Object3D;
  targetPos: THREE.Vector3;
  secretDoorObj: THREE.Object3D;
  secretDoorPos: THREE.Vector3;
  secretDoorObstacle: AABBObstacle;
  /** Openable doors (rooms 1,3,4,5) */
  openableDoors: OpenableDoor[];
  /** Locked door to Generator room */
  genDoorObj: THREE.Object3D;
  genDoorPos: THREE.Vector3;
  genDoorObstacle: AABBObstacle;
  /** Key to Generator room (in Secret Room) */
  genKeyObj: THREE.Object3D;
  genKeyPos: THREE.Vector3;
  /** Locked door to Склад */
  stgDoorObj: THREE.Object3D;
  stgDoorPos: THREE.Vector3;
  stgDoorObstacle: AABBObstacle;
  /** Locked door to Лабораторія */
  labDoorObj: THREE.Object3D;
  labDoorPos: THREE.Vector3;
  labDoorObstacle: AABBObstacle;
  /** Bulb puzzle: pickupable bulbs */
  yellowBulbObj: THREE.Object3D;
  yellowBulbPos: THREE.Vector3;
  blueBulbObj: THREE.Object3D;
  blueBulbPos: THREE.Vector3;
  /** Generator bulb slots interaction position */
  generatorSlotsPos: THREE.Vector3;
  /** Door indicator lights (to change color when bulb installed) */
  stgDoorIndicator: THREE.Mesh;
  labDoorIndicator: THREE.Mesh;
  srvDoorIndicator: THREE.Mesh;
  /** Generator slot indicators (to change when bulb installed) */
  genSlotYellow: THREE.Mesh;
  genSlotBlue: THREE.Mesh;
  /** Ventilation puzzle in storage room */
  ventCode: string;
  ventObj: THREE.Object3D;
  ventPos: THREE.Vector3;
  ventObstacle: AABBObstacle;
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
  // West wall (X = X_MIN) — with gap for passage to hidden alcove
  const westPassageZ = -1;  // center of passage (where green drawing was)
  const westPassageGap = 1.4;
  // North segment: Z_MIN to gap start
  const wNorthLen = (westPassageZ - westPassageGap / 2) - Z_MIN;
  addWall(X_MIN, WY, Z_MIN + wNorthLen / 2, WALL_T, WH, wNorthLen);
  // South segment: gap end to Z_MAX
  const wSouthLen = Z_MAX - (westPassageZ + westPassageGap / 2);
  addWall(X_MIN, WY, Z_MAX - wSouthLen / 2, WALL_T, WH, wSouthLen);
  // East wall (X = X_MAX) — with gap for secret room door in cafeteria area
  const secretDoorZ = 0; // center of cafeteria
  const secretGap = 1.4;
  // North segment: Z_MIN to secretDoorZ - gap/2
  const eNorthLen = (secretDoorZ - secretGap / 2) - Z_MIN;
  addWall(X_MAX, WY, Z_MIN + eNorthLen / 2, WALL_T, WH, eNorthLen);
  // South segment: secretDoorZ + gap/2 to Z_MAX
  const eSouthLen = Z_MAX - (secretDoorZ + secretGap / 2);
  addWall(X_MAX, WY, Z_MAX - eSouthLen / 2, WALL_T, WH, eSouthLen);

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
  addRubble(-0.8, Z_MIN + 2.5, 1.5, 10, true);

  // Block 3: Between nap room and playroom (west divider Z_DIV1) — rubble on both sides
  addRubble(westCenterX, Z_DIV1, 2.5, 12, true);

  // Corridor rubble pile (mid section, partial blockage — can squeeze past)
  addRubble(-0.6, 0, 1.2, 8, true);

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
    color: 0x3a2d1e,
    roughness: 0.9,
    metalness: 0.02,
  });

  const furnitureColorMat = new THREE.MeshStandardMaterial({
    color: 0x2a3d2e,  // faded green
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
    // Collision obstacle for chair (approximate AABB)
    const cr = 0.25; // half-extent radius for chair footprint
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(x - cr, 0, z - cr),
      new THREE.Vector3(x + cr, tipped ? 0.35 : 0.52, z + cr),
    ));
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
    } else {
      // Tipped table still blocks movement
      obstacles.push(makeBoxObstacle(
        new THREE.Vector3(x - 0.4, 0, z - 0.3),
        new THREE.Vector3(x + 0.4, 0.35, z + 0.3),
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
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x2e2418, roughness: 0.85 });
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
  addRubble(westCenterX - 1, (Z_DIV2 + Z_MAX) / 2, 2, 6, true);
  addRubble(westCenterX + 2, (Z_DIV2 + Z_MAX) / 2 + 1, 1.5, 4, true);

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
  // (green drawing removed — passage here now)
  addWallDrawing(X_MIN + 0.15, 1.3, 0.5, 1.2, 0.5, 'x', 0x4466ff); // blue drawing
  addWallDrawing(X_MAX - 0.15, 1.1, -6.5, 0.9, 0.7, 'x', 0xffcc22); // yellow drawing in office
  addWallDrawing(X_MAX - 0.15, 1.2, 0, 0.7, 0.5, 'x', 0xff4488); // pink in cafeteria

  // ═══════════════════════════════════════════════════════════
  //  ROOM NAME SIGNS (numbered plaques above doorways)
  // ═══════════════════════════════════════════════════════════

  const addRoomSign = (text: string, x: number, y: number, z: number, facingAxis: 'x' | 'z', flipSign?: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Aged metal plaque background
    ctx.fillStyle = '#2a3a2a';
    ctx.fillRect(0, 0, 512, 128);
    // Border
    ctx.strokeStyle = '#556b55';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 116);

    // Text
    ctx.fillStyle = '#c8d8b0';
    ctx.font = 'bold 52px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);

    const tex = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(1.2, 0.3);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.6,
      metalness: 0.3,
      emissive: 0xc8d8b0,
      emissiveIntensity: 0.02,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (facingAxis === 'x') mesh.rotation.y = flipSign ? -Math.PI / 2 : Math.PI / 2;
    if (facingAxis === 'z' && flipSign) mesh.rotation.y = Math.PI;
    root.add(mesh);
  };

  const signY = 2.45; // above door height

  // West corridor wall signs (facing east, into corridor) — facingAxis 'x', flipSign to face corridor
  addRoomSign('1 — Спальня', -CORR_HALF - 0.14, signY, (Z_MIN + Z_DIV1) / 2, 'x');
  addRoomSign('2 — Ігрова',  -CORR_HALF - 0.14, signY, (Z_DIV1 + Z_DIV2) / 2, 'x');
  addRoomSign('3 — Туалет',  -CORR_HALF - 0.14, signY, (Z_DIV2 + Z_MAX) / 2, 'x');

  // East corridor wall signs (facing west, into corridor) — facingAxis 'x', flipSign
  addRoomSign('4 — Кабінет',  CORR_HALF + 0.14, signY, (Z_MIN + Z_DIV1) / 2, 'x', true);
  addRoomSign('5 — Їдальня',  CORR_HALF + 0.14, signY, (Z_DIV1 + Z_DIV2) / 2, 'x', true);
  addRoomSign('6 — Комірка',  CORR_HALF + 0.14, signY, (Z_DIV2 + Z_MAX) / 2, 'x', true);

  // Corridor — sign on north wall
  addRoomSign('7 — Коридор', 0, signY, Z_MIN + 0.14, 'z');

  // ═══════════════════════════════════════════════════════════
  //  LIGHTING (minimal — mostly dark, player has flashlight)
  // ═══════════════════════════════════════════════════════════

  // Ambient light — enough to see walls/furniture, flashlight adds drama
  const ambient = new THREE.AmbientLight(0x556666, 4.0);
  root.add(ambient);

  const hemi = new THREE.HemisphereLight(0x667788, 0x444455, 2.5);
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

  const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const addFlicker = (x: number, z: number, color: number, intensity: number) => {
    const light = new THREE.PointLight(color, intensity * 25, isMobileDevice ? 10 : 18, isMobileDevice ? 2 : 1.2);
    light.position.set(x, CEIL_H - 0.3, z);
    light.castShadow = false;
    root.add(light);

    // Fixture mesh at ceiling
    const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
    fixture.position.set(x, CEIL_H - 0.02, z);
    root.add(fixture);

    flickerLights.push({ light, baseIntensity: intensity * 25, phase: Math.random() * Math.PI * 2 });
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

  // Room sign on west wall (visible when entering from storage)
  addRoomSign('8 — Велика Ігрова', CORR_HALF + 0.14, signY, Z_MAX + 1, 'x', true);

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

  // ── Ball Gun (on the edge of the ball pit) ──
  const gunGroup = new THREE.Group();
  gunGroup.name = 'ballGunPickup';
  const gunMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.4, metalness: 0.3 });
  const gunDarkMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.5 });
  // Barrel
  const gBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.28, 8), gunDarkMat);
  gBarrel.rotation.x = Math.PI / 2;
  gBarrel.position.z = -0.14;
  gunGroup.add(gBarrel);
  // Body
  const gBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.18), gunMat);
  gunGroup.add(gBody);
  // Handle
  const gHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.05), gunDarkMat);
  gHandle.position.set(0, -0.06, 0.04);
  gHandle.rotation.x = 0.2;
  gunGroup.add(gHandle);
  // Hopper
  const gHopper = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.08, 8), gunMat);
  gHopper.position.y = 0.055;
  gunGroup.add(gHopper);
  // Glow
  const gunLight = new THREE.PointLight(0xff8800, 0.6, 3, 2);
  gunLight.position.set(0, 0.2, 0);
  gunGroup.add(gunLight);

  const gunPos = new THREE.Vector3(pitCX + PIT_W / 2 - 0.4, PIT_H + 0.1, pitCZ);
  gunGroup.position.copy(gunPos);
  gunGroup.rotation.y = 0.5;
  root.add(gunGroup);

  // ═══════════════════════════════════════════════════════════
  //  WEST HALL — large room beyond west wall with generator & houses
  // ═══════════════════════════════════════════════════════════

  const HALL_X_MIN = X_MIN - 30;
  const HALL_X_MAX = X_MIN;
  const HALL_Z_MIN = -14;
  const HALL_Z_MAX = 14;
  const hallCX = (HALL_X_MIN + HALL_X_MAX) / 2;
  const hallCZ = (HALL_Z_MIN + HALL_Z_MAX) / 2;
  const hallW = HALL_X_MAX - HALL_X_MIN;
  const hallD = HALL_Z_MAX - HALL_Z_MIN;

  addFloor(hallCX, hallCZ, hallW, hallD);
  addCeiling(hallCX, hallCZ, hallW, hallD);

  // Walls — split for generator room doors (gap = 1.4, half = 0.7)
  const grDoorGapHalf = 0.7;
  const grDoor1X = hallCX - 2; // north & south door X
  const grDoor3Z = hallCZ;     // west door Z

  // West wall — split around door at Z = hallCZ
  const wWestNorth = grDoor3Z - grDoorGapHalf - HALL_Z_MIN;
  if (wWestNorth > 0.2) addWall(HALL_X_MIN, WY, HALL_Z_MIN + wWestNorth / 2, WALL_T, WH, wWestNorth);
  const wWestSouth = HALL_Z_MAX - (grDoor3Z + grDoorGapHalf);
  if (wWestSouth > 0.2) addWall(HALL_X_MIN, WY, HALL_Z_MAX - wWestSouth / 2, WALL_T, WH, wWestSouth);

  // North wall — split around door at X = grDoor1X
  const wNorthLeft = grDoor1X - grDoorGapHalf - (hallCX - hallW / 2);
  if (wNorthLeft > 0.2) addWall(hallCX - hallW / 2 + wNorthLeft / 2, WY, HALL_Z_MIN, wNorthLeft, WH, WALL_T);
  const wNorthRight = (hallCX + hallW / 2) - (grDoor1X + grDoorGapHalf);
  if (wNorthRight > 0.2) addWall(hallCX + hallW / 2 - wNorthRight / 2, WY, HALL_Z_MIN, wNorthRight, WH, WALL_T);

  // South wall — split around door at X = grDoor1X
  const wSouthLeft = grDoor1X - grDoorGapHalf - (hallCX - hallW / 2);
  if (wSouthLeft > 0.2) addWall(hallCX - hallW / 2 + wSouthLeft / 2, WY, HALL_Z_MAX, wSouthLeft, WH, WALL_T);
  const wSouthRight = (hallCX + hallW / 2) - (grDoor1X + grDoorGapHalf);
  if (wSouthRight > 0.2) addWall(hallCX + hallW / 2 - wSouthRight / 2, WY, HALL_Z_MAX, wSouthRight, WH, WALL_T);
  // East wall segments (gap already made in main west wall above)
  const awNorthLen = (westPassageZ - westPassageGap / 2) - HALL_Z_MIN;
  if (awNorthLen > 0.5) addWall(HALL_X_MAX, WY, HALL_Z_MIN + awNorthLen / 2, WALL_T, WH, awNorthLen);
  const awSouthLen = HALL_Z_MAX - (westPassageZ + westPassageGap / 2);
  if (awSouthLen > 0.5) addWall(HALL_X_MAX, WY, HALL_Z_MAX - awSouthLen / 2, WALL_T, WH, awSouthLen);

  roomCenters.set('Генераторна', new THREE.Vector3(hallCX, 0, hallCZ));

  // Room sign on east wall (visible when entering from passage)
  addRoomSign('9 — Генераторна', HALL_X_MAX - 0.14, signY, westPassageZ, 'x');

  // Lighting — industrial dim
  addFlicker(hallCX, hallCZ - 6, 0xff6633, 2.0);
  addFlicker(hallCX, hallCZ + 6, 0xff6633, 2.0);
  addFlicker(hallCX - 8, hallCZ, 0xffaa44, 1.5);
  addFlicker(hallCX + 5, hallCZ, 0xff4422, 1.8);

  // Debris
  addDebris(hallCX, hallCZ, 12, 25);

  // ── GENERATOR (large industrial machine, center-left) ──
  const genMat = new THREE.MeshStandardMaterial({
    color: 0x3a4a3a,
    roughness: 0.7,
    metalness: 0.5,
  });
  const genMatDark = new THREE.MeshStandardMaterial({
    color: 0x2a2a2e,
    roughness: 0.6,
    metalness: 0.6,
  });
  const genAccent = new THREE.MeshStandardMaterial({
    color: 0x886633,
    roughness: 0.5,
    metalness: 0.7,
  });

  const genGroup = new THREE.Group();
  genGroup.position.set(hallCX - 4, 0, hallCZ);

  // Main body — large box
  const genBody = new THREE.Mesh(new THREE.BoxGeometry(4, 2.0, 2.5), genMat);
  genBody.position.y = 1.0;
  genBody.castShadow = true;
  genBody.receiveShadow = true;
  genGroup.add(genBody);

  // Engine block on top
  const engineBlock = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.8, 1.8), genMatDark);
  engineBlock.position.set(0, 2.4, 0);
  engineBlock.castShadow = true;
  genGroup.add(engineBlock);

  // Cylinders (exhaust pipes)
  const pipeMat = genAccent;
  for (const pz of [-0.6, 0.6]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8), pipeMat);
    pipe.position.set(-0.8, 2.55, pz);
    pipe.castShadow = true;
    genGroup.add(pipe);
  }

  // Fuel tank (cylinder on the side)
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.0, 12), genMatDark);
  tank.position.set(2.4, 1.0, 0);
  tank.rotation.z = Math.PI / 2;
  tank.castShadow = true;
  genGroup.add(tank);

  // Control panel
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.3), genMatDark);
  panel.position.set(-2.3, 0.8, 1.0);
  panel.castShadow = true;
  genGroup.add(panel);
  // Panel lights (small emissive cubes)
  const panelLightMat = new THREE.MeshStandardMaterial({
    color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0,
  });
  const panelLightGreen = new THREE.MeshStandardMaterial({
    color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 2.0,
  });
  for (let i = 0; i < 3; i++) {
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.05),
      i === 1 ? panelLightGreen : panelLightMat,
    );
    light.position.set(-2.3 + (i - 1) * 0.12, 1.1, 1.17);
    genGroup.add(light);
  }

  // Bulb slots on panel — 3 sockets with colored bulbs
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 });
  const socketGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8);
  const bulbGeo = new THREE.SphereGeometry(0.05, 8, 8);

  // Labels for wires: red=server(north), yellow=lab(west), blue=storage(south)
  const slotPositions = [
    { lx: -2.42, lz: 1.17, color: 'red' },
    { lx: -2.30, lz: 1.17, color: 'yellow' },
    { lx: -2.18, lz: 1.17, color: 'blue' },
  ];
  // Red bulb — IN PLACE
  const redBulbMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
  for (const sl of slotPositions) {
    const socket = new THREE.Mesh(socketGeo, socketMat);
    socket.position.set(sl.lx, 1.35, sl.lz);
    genGroup.add(socket);
  }
  // Red bulb installed
  const redBulb = new THREE.Mesh(bulbGeo, redBulbMat);
  redBulb.position.set(slotPositions[0].lx, 1.44, slotPositions[0].lz);
  genGroup.add(redBulb);
  const redBulbLight = new THREE.PointLight(0xff0000, 0.6, 2, 2);
  redBulbLight.position.set(slotPositions[0].lx, 1.5, slotPositions[0].lz);
  genGroup.add(redBulbLight);

  // Yellow slot — EMPTY (dim placeholder)
  const yellowSlotMatOff = new THREE.MeshStandardMaterial({ color: 0x444422, emissive: 0x222200, emissiveIntensity: 0.2 });
  const genSlotYellow = new THREE.Mesh(bulbGeo, yellowSlotMatOff);
  genSlotYellow.position.set(slotPositions[1].lx, 1.44, slotPositions[1].lz);
  genGroup.add(genSlotYellow);

  // Blue slot — EMPTY (dim placeholder)
  const blueSlotMatOff = new THREE.MeshStandardMaterial({ color: 0x222244, emissive: 0x000022, emissiveIntensity: 0.2 });
  const genSlotBlue = new THREE.Mesh(bulbGeo, blueSlotMatOff);
  genSlotBlue.position.set(slotPositions[2].lx, 1.44, slotPositions[2].lz);
  genGroup.add(genSlotBlue);

  // Generator slots interaction position (in world coords, near the panel)
  const generatorSlotsPos = new THREE.Vector3(hallCX - 4 - 2.3, 0, hallCZ + 1.0);

  // Base/feet
  for (const [fx, fz] of [[-1.5, -1.0], [1.5, -1.0], [-1.5, 1.0], [1.5, 1.0]]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.4), genAccent);
    foot.position.set(fx, 0.075, fz);
    genGroup.add(foot);
  }

  root.add(genGroup);
  // Generator collision box
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(hallCX - 4 - 2.8, 0, hallCZ - 1.5),
    new THREE.Vector3(hallCX - 4 + 2.8, 2.8, hallCZ + 1.5),
  ));

  // ── Openable door materials & array (shared with houses and room doors) ──
  const openableDoors: OpenableDoor[] = [];
  const oDoorMat = new THREE.MeshStandardMaterial({
    color: 0x6b5a3e,
    roughness: 0.85,
    metalness: 0.1,
    emissive: 0x0a0804,
    emissiveIntensity: 0.2,
  });
  const oHandleMat = new THREE.MeshStandardMaterial({ color: 0xaa9955, metalness: 0.6, roughness: 0.4 });

  // ── HOUSE 1 (north side of hall) ──
  const houseMat = new THREE.MeshStandardMaterial({
    color: 0x7a6b55, roughness: 0.9, metalness: 0.0,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x8b3a3a, roughness: 0.85, metalness: 0.05,
  });
  const houseDoorMat = new THREE.MeshStandardMaterial({
    color: 0x4a3520, roughness: 0.9, metalness: 0.0,
  });
  const houseWindowMat = new THREE.MeshStandardMaterial({
    color: 0x334455, roughness: 0.3, metalness: 0.1,
    emissive: 0x112233, emissiveIntensity: 0.5,
  });

  const houseDoorGap = 1.2; // width of door opening in front wall

  const buildHouse = (hx: number, hz: number, roomName: string): OpenableDoor => {
    const house = new THREE.Group();
    const houseW = 5, houseD = 4, wallH = 2.2;
    const halfW = houseW / 2;
    const halfD = houseD / 2;
    const halfGap = houseDoorGap / 2;

    // Door is centered in front wall (Z = -halfD)
    const doorCenterX = 0;

    // Front wall — split into left and right segments around door gap
    const frontLeftW = halfW + doorCenterX - halfGap;
    if (frontLeftW > 0.1) {
      const fl = new THREE.Mesh(new THREE.BoxGeometry(frontLeftW, wallH, WALL_T), houseMat);
      fl.position.set(-halfW + frontLeftW / 2, wallH / 2, -halfD);
      fl.castShadow = true; fl.receiveShadow = true;
      house.add(fl);
    }
    const frontRightW = halfW - doorCenterX - halfGap;
    if (frontRightW > 0.1) {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(frontRightW, wallH, WALL_T), houseMat);
      fr.position.set(halfW - frontRightW / 2, wallH / 2, -halfD);
      fr.castShadow = true; fr.receiveShadow = true;
      house.add(fr);
    }
    // Header above door
    const headerH = wallH - 1.9;
    if (headerH > 0.05) {
      const header = new THREE.Mesh(new THREE.BoxGeometry(houseDoorGap, headerH, WALL_T), houseMat);
      header.position.set(doorCenterX, wallH - headerH / 2, -halfD);
      header.castShadow = true;
      house.add(header);
    }

    // Back wall
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(houseW, wallH, WALL_T), houseMat);
    backWall.position.set(0, wallH / 2, halfD);
    backWall.castShadow = true; backWall.receiveShadow = true;
    house.add(backWall);

    // Left wall
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, wallH, houseD), houseMat);
    leftWall.position.set(-halfW, wallH / 2, 0);
    leftWall.castShadow = true; leftWall.receiveShadow = true;
    house.add(leftWall);

    // Right wall
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, wallH, houseD), houseMat);
    rightWall.position.set(halfW, wallH / 2, 0);
    rightWall.castShadow = true; rightWall.receiveShadow = true;
    house.add(rightWall);

    // Roof (triangular prism using ExtrudeGeometry)
    const roofHeight = 1.2;
    const roofOverhang = 0.4;
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-(halfW + roofOverhang), 0);
    roofShape.lineTo(0, roofHeight);
    roofShape.lineTo(halfW + roofOverhang, 0);
    roofShape.lineTo(-(halfW + roofOverhang), 0);
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
      depth: houseD + roofOverhang * 2,
      bevelEnabled: false,
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, wallH, -(halfD + roofOverhang));
    roof.castShadow = true; roof.receiveShadow = true;
    house.add(roof);

    // Windows (front wall, on each side of door)
    const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.05), houseWindowMat);
    win1.position.set(-halfW + 0.6, 1.3, -halfD - 0.05);
    house.add(win1);
    const win2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.05), houseWindowMat);
    win2.position.set(halfW - 0.6, 1.3, -halfD - 0.05);
    house.add(win2);

    // Window on side
    const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.6), houseWindowMat);
    sideWin.position.set(halfW + 0.05, 1.3, 0);
    house.add(sideWin);

    // ── Furniture: bed (against back wall) ──
    const bedFrameMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9, metalness: 0.05 });
    const mattressMat = new THREE.MeshStandardMaterial({ color: 0x8b9dc3, roughness: 0.95, metalness: 0.0 });
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0xd4cfc4, roughness: 0.95, metalness: 0.0 });
    const blanketMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.92, metalness: 0.0 });

    const bedW = 1.0, bedD = 2.0, bedFrameH = 0.3;
    const bedGroup = new THREE.Group();
    // Frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(bedW, bedFrameH, bedD), bedFrameMat);
    frame.position.set(0, bedFrameH / 2, 0);
    frame.castShadow = true; frame.receiveShadow = true;
    bedGroup.add(frame);
    // Headboard
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(bedW, 0.5, 0.06), bedFrameMat);
    headboard.position.set(0, bedFrameH + 0.25, -bedD / 2 + 0.03);
    headboard.castShadow = true;
    bedGroup.add(headboard);
    // Footboard
    const footboard = new THREE.Mesh(new THREE.BoxGeometry(bedW, 0.3, 0.06), bedFrameMat);
    footboard.position.set(0, bedFrameH + 0.15, bedD / 2 - 0.03);
    footboard.castShadow = true;
    bedGroup.add(footboard);
    // Mattress
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(bedW - 0.08, 0.12, bedD - 0.1), mattressMat);
    mattress.position.set(0, bedFrameH + 0.06, 0);
    mattress.receiveShadow = true;
    bedGroup.add(mattress);
    // Pillow
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.3), pillowMat);
    pillow.position.set(0, bedFrameH + 0.16, -bedD / 2 + 0.25);
    bedGroup.add(pillow);
    // Blanket (covers lower 2/3 of mattress)
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(bedW - 0.06, 0.04, bedD * 0.6), blanketMat);
    blanket.position.set(0, bedFrameH + 0.14, bedD / 2 - bedD * 0.3);
    bedGroup.add(blanket);

    // Position bed against back-right corner
    bedGroup.position.set(halfW - bedW / 2 - 0.3, 0, halfD - bedD / 2 - 0.3);
    house.add(bedGroup);

    // ── Furniture: shelf with lamp (against left wall) ──
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.88, metalness: 0.05 });
    const lampBaseMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5, roughness: 0.4 });
    const lampShadeMat = new THREE.MeshStandardMaterial({
      color: 0xddc89f, roughness: 0.8, metalness: 0.0,
      emissive: 0xffcc66, emissiveIntensity: 0.6,
      side: THREE.DoubleSide,
    });

    const shelfW = 0.8, shelfD = 0.4, shelfH = 0.8;
    const shelfGroup = new THREE.Group();

    // Shelf top
    const shelfTop = new THREE.Mesh(new THREE.BoxGeometry(shelfW, 0.04, shelfD), shelfMat);
    shelfTop.position.set(0, shelfH, 0);
    shelfTop.castShadow = true; shelfTop.receiveShadow = true;
    shelfGroup.add(shelfTop);
    // Shelf legs (4 legs)
    const legGeo = new THREE.BoxGeometry(0.05, shelfH, 0.05);
    for (const lx of [-shelfW / 2 + 0.04, shelfW / 2 - 0.04]) {
      for (const lz of [-shelfD / 2 + 0.04, shelfD / 2 - 0.04]) {
        const leg = new THREE.Mesh(legGeo, shelfMat);
        leg.position.set(lx, shelfH / 2, lz);
        leg.castShadow = true;
        shelfGroup.add(leg);
      }
    }
    // Middle shelf
    const midShelf = new THREE.Mesh(new THREE.BoxGeometry(shelfW - 0.1, 0.03, shelfD - 0.06), shelfMat);
    midShelf.position.set(0, shelfH * 0.45, 0);
    midShelf.receiveShadow = true;
    shelfGroup.add(midShelf);

    // Lamp on top of shelf
    // Base
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 8), lampBaseMat);
    lampBase.position.set(0, shelfH + 0.04, 0);
    lampBase.castShadow = true;
    shelfGroup.add(lampBase);
    // Stem
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 6), lampBaseMat);
    lampStem.position.set(0, shelfH + 0.04 + 0.125, 0);
    shelfGroup.add(lampStem);
    // Shade (truncated cone)
    const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.12, 0.14, 8, 1, true), lampShadeMat);
    lampShade.position.set(0, shelfH + 0.04 + 0.25 + 0.07, 0);
    lampShade.castShadow = true;
    shelfGroup.add(lampShade);

    // Position shelf against left wall, towards back
    shelfGroup.position.set(-halfW + shelfD / 2 + 0.2, 0, halfD - shelfW / 2 - 0.3);
    house.add(shelfGroup);

    // Lamp point light
    const lampLight = new THREE.PointLight(0xffcc66, 0.8, 4, 2);
    lampLight.position.set(
      -halfW + shelfD / 2 + 0.2,
      shelfH + 0.04 + 0.25 + 0.1,
      halfD - shelfW / 2 - 0.3,
    );
    lampLight.castShadow = false;
    house.add(lampLight);
    flickerLights.push({ light: lampLight, baseIntensity: 0.8, phase: Math.random() * Math.PI * 2 });

    house.position.set(hx, 0, hz);
    root.add(house);

    // ── Furniture collision (world coords) ──
    // Bed collision
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(hx + halfW - bedW - 0.3, 0, hz + halfD - bedD - 0.3),
      new THREE.Vector3(hx + halfW - 0.3, bedFrameH + 0.2, hz + halfD - 0.3),
    ));
    // Shelf collision
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(hx - halfW + 0.1, 0, hz + halfD - shelfW - 0.1),
      new THREE.Vector3(hx - halfW + shelfD + 0.3, shelfH + 0.1, hz + halfD - 0.1),
    ));

    // ── Per-wall collision boxes (AABB, world coords) ──
    const wt = WALL_T / 2 + 0.05; // half-thickness for collision

    // Back wall
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(hx - halfW, 0, hz + halfD - wt),
      new THREE.Vector3(hx + halfW, wallH, hz + halfD + wt),
    ));
    // Left wall
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(hx - halfW - wt, 0, hz - halfD),
      new THREE.Vector3(hx - halfW + wt, wallH, hz + halfD),
    ));
    // Right wall
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(hx + halfW - wt, 0, hz - halfD),
      new THREE.Vector3(hx + halfW + wt, wallH, hz + halfD),
    ));
    // Front wall left segment
    if (frontLeftW > 0.1) {
      obstacles.push(makeBoxObstacle(
        new THREE.Vector3(hx - halfW, 0, hz - halfD - wt),
        new THREE.Vector3(hx - halfW + frontLeftW, wallH, hz - halfD + wt),
      ));
    }
    // Front wall right segment
    if (frontRightW > 0.1) {
      obstacles.push(makeBoxObstacle(
        new THREE.Vector3(hx + halfW - frontRightW, 0, hz - halfD - wt),
        new THREE.Vector3(hx + halfW, wallH, hz - halfD + wt),
      ));
    }

    // ── Openable door ──
    const doorWorldZ = hz - halfD;
    const doorWorldX = hx + doorCenterX;

    const doorPivot = new THREE.Group();
    // Hinge at left edge of gap (negative X side)
    doorPivot.position.set(doorWorldX - halfGap, 0, doorWorldZ);

    const panelH = 1.85;
    const panelW = houseDoorGap - 0.05;
    const doorPanel = new THREE.Mesh(
      new THREE.BoxGeometry(panelW, panelH, 0.08),
      houseDoorMat,
    );
    doorPanel.position.set(panelW / 2, panelH / 2, 0);
    doorPanel.castShadow = true;
    doorPivot.add(doorPanel);

    // Door handle (outside)
    const hHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.12),
      oHandleMat,
    );
    hHandle.position.set(panelW - 0.15, panelH / 2, -0.07);
    doorPivot.add(hHandle);
    // Door handle (inside)
    const hHandle2 = hHandle.clone();
    hHandle2.position.set(panelW - 0.15, panelH / 2, 0.07);
    doorPivot.add(hHandle2);

    root.add(doorPivot);

    // Collision obstacle for the closed door
    const doorObs = makeBoxObstacle(
      new THREE.Vector3(doorWorldX - halfGap - 0.1, 0, doorWorldZ - 0.1),
      new THREE.Vector3(doorWorldX + halfGap + 0.1, panelH, doorWorldZ + 0.1),
    );
    obstacles.push(doorObs);

    const doorPos = new THREE.Vector3(doorWorldX, 0, doorWorldZ);

    return {
      roomName,
      pivot: doorPivot,
      pos: doorPos,
      obstacle: doorObs,
      isOpen: false,
      animProgress: 0,
      facingAxis: 'z',
      openDir: 1,
    };
  };

  // ── 3 DOORS IN GENERATOR ROOM (along walls) with wires from generator ──
  const genDoorMat2 = new THREE.MeshStandardMaterial({
    color: 0x555560, roughness: 0.65, metalness: 0.45,
    emissive: 0x060610, emissiveIntensity: 0.2,
  });
  const wireMat = new THREE.MeshStandardMaterial({
    color: 0x222222, roughness: 0.6, metalness: 0.3,
  });
  const wireGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 0.6,
    roughness: 0.5, metalness: 0.2,
  });

  const genWorldX = hallCX - 4; // generator center X
  const genWorldZ = hallCZ;     // generator center Z
  const genTopY = 2.8;          // top of generator
  const wireR = 0.03;           // wire radius

  // Helper: create a wire (TubeGeometry) along a path of points
  const addWire = (points: THREE.Vector3[], glow: boolean) => {
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, points.length * 8, wireR, 6, false);
    const tube = new THREE.Mesh(tubeGeo, glow ? wireGlowMat : wireMat);
    tube.castShadow = true;
    root.add(tube);
  };

  // Helper: make a generator room door on a wall
  const makeGenRoomDoor = (
    wallAxis: 'x' | 'z',        // which axis the wall is perpendicular to
    wallCoord: number,           // wall coordinate on that axis
    doorCoord: number,           // door center on the other axis
    facingSide: number,          // +1 or -1: which side the door opens toward
    label: string,
  ): OpenableDoor => {
    const gapW = 1.4;
    const halfGap = gapW / 2;
    const panelH2 = CEIL_H - 0.3;
    const panelW2 = gapW - 0.08;

    const pivot = new THREE.Group();
    if (wallAxis === 'z') {
      // Door in a wall perpendicular to Z (north/south wall)
      // Panel lies in XY plane, hinge at one X edge
      const hingeX = doorCoord - halfGap;
      pivot.position.set(hingeX, 0, wallCoord);

      const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW2, panelH2, 0.1), genDoorMat2);
      panel.position.set(panelW2 / 2, panelH2 / 2, 0);
      panel.castShadow = true;
      pivot.add(panel);

      // Handles
      const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), oHandleMat);
      h1.position.set(panelW2 - 0.15, panelH2 / 2, -0.08);
      pivot.add(h1);
      const h2 = h1.clone();
      h2.position.set(panelW2 - 0.15, panelH2 / 2, 0.08);
      pivot.add(h2);
    } else {
      // Door in a wall perpendicular to X (west wall)
      // Panel lies in ZY plane, hinge at one Z edge
      const hingeZ = doorCoord - halfGap;
      pivot.position.set(wallCoord, 0, hingeZ);

      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, panelH2, panelW2), genDoorMat2);
      panel.position.set(0, panelH2 / 2, panelW2 / 2);
      panel.castShadow = true;
      pivot.add(panel);

      // Handles
      const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), oHandleMat);
      h1.position.set(-0.08, panelH2 / 2, panelW2 - 0.15);
      pivot.add(h1);
      const h2 = h1.clone();
      h2.position.set(0.08, panelH2 / 2, panelW2 - 0.15);
      pivot.add(h2);
    }

    root.add(pivot);

    // Collision obstacle
    let obs: AABBObstacle;
    const interactPos = new THREE.Vector3();
    if (wallAxis === 'z') {
      obs = makeBoxObstacle(
        new THREE.Vector3(doorCoord - halfGap - 0.1, 0, wallCoord - 0.12),
        new THREE.Vector3(doorCoord + halfGap + 0.1, panelH2, wallCoord + 0.12),
      );
      interactPos.set(doorCoord, 0, wallCoord);
    } else {
      obs = makeBoxObstacle(
        new THREE.Vector3(wallCoord - 0.12, 0, doorCoord - halfGap - 0.1),
        new THREE.Vector3(wallCoord + 0.12, panelH2, doorCoord + halfGap + 0.1),
      );
      interactPos.set(wallCoord, 0, doorCoord);
    }
    obstacles.push(obs);

    return {
      roomName: label,
      pivot,
      pos: interactPos,
      obstacle: obs,
      isOpen: false,
      animProgress: 0,
      facingAxis: wallAxis,
      openDir: facingSide,
    };
  };

  // Door 1 — north wall → Серверна (openable, RED indicator — bulb in place)
  const genDoor1Z = HALL_Z_MIN;
  const genDoor1X = hallCX - 2;
  openableDoors.push(makeGenRoomDoor('z', genDoor1Z, genDoor1X, -1, 'Генераторна Двері 1'));
  // Red indicator on north door frame
  const srvIndicatorMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
  const srvDoorIndicator = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), srvIndicatorMat);
  srvDoorIndicator.position.set(genDoor1X + 0.9, CEIL_H - 0.5, genDoor1Z);
  root.add(srvDoorIndicator);
  const srvIndicatorLight = new THREE.PointLight(0xff0000, 0.5, 3, 2);
  srvIndicatorLight.position.copy(srvDoorIndicator.position);
  root.add(srvIndicatorLight);

  // Door 2 — south wall → Склад (LOCKED, BLUE indicator — bulb missing)
  const genDoor2Z = HALL_Z_MAX;
  const genDoor2X = hallCX - 2;
  const stgDoorGroup = new THREE.Group();
  let stgDoorIndicator: THREE.Mesh;
  {
    const gapW2 = 1.4, panelH2 = CEIL_H - 0.3, panelW2 = gapW2 - 0.08;
    const p = new THREE.Mesh(new THREE.BoxGeometry(panelW2, panelH2, 0.1), genDoorMat2);
    p.position.set(0, panelH2 / 2, 0);
    p.castShadow = true;
    stgDoorGroup.add(p);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), oHandleMat);
    h.position.set(panelW2 / 2 - 0.15, panelH2 / 2, -0.08);
    stgDoorGroup.add(h);
    const h2 = h.clone(); h2.position.z = 0.08;
    stgDoorGroup.add(h2);
  }
  const stgDoorPos = new THREE.Vector3(genDoor2X, 0, genDoor2Z);
  stgDoorGroup.position.copy(stgDoorPos);
  root.add(stgDoorGroup);
  // Blue indicator sphere on door frame (dim — bulb not installed yet)
  const stgIndicatorMatOff = new THREE.MeshStandardMaterial({ color: 0x222244, emissive: 0x111133, emissiveIntensity: 0.3 });
  stgDoorIndicator = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), stgIndicatorMatOff);
  stgDoorIndicator.position.set(genDoor2X + 0.9, CEIL_H - 0.5, genDoor2Z);
  root.add(stgDoorIndicator);
  const stgDoorObstacle = makeBoxObstacle(
    new THREE.Vector3(genDoor2X - 0.8, 0, genDoor2Z - 0.12),
    new THREE.Vector3(genDoor2X + 0.8, CEIL_H - 0.3, genDoor2Z + 0.12),
  );
  obstacles.push(stgDoorObstacle);

  // Door 3 — west wall → Лабораторія (LOCKED, YELLOW indicator — bulb missing)
  const genDoor3X = HALL_X_MIN;
  const genDoor3Z = hallCZ;
  const labDoorGroup = new THREE.Group();
  let labDoorIndicator: THREE.Mesh;
  {
    const gapW2 = 1.4, panelH2 = CEIL_H - 0.3, panelW2 = gapW2 - 0.08;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, panelH2, panelW2), genDoorMat2);
    p.position.set(0, panelH2 / 2, 0);
    p.castShadow = true;
    labDoorGroup.add(p);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), oHandleMat);
    h.position.set(-0.08, panelH2 / 2, panelW2 / 2 - 0.15);
    labDoorGroup.add(h);
    const h2 = h.clone(); h2.position.x = 0.08;
    labDoorGroup.add(h2);
  }
  const labDoorPos = new THREE.Vector3(genDoor3X, 0, genDoor3Z);
  labDoorGroup.position.copy(labDoorPos);
  root.add(labDoorGroup);
  // Yellow indicator sphere on door frame (dim — bulb not installed yet)
  const labIndicatorMatOff = new THREE.MeshStandardMaterial({ color: 0x444422, emissive: 0x333311, emissiveIntensity: 0.3 });
  labDoorIndicator = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), labIndicatorMatOff);
  labDoorIndicator.position.set(genDoor3X, CEIL_H - 0.5, genDoor3Z + 0.9);
  root.add(labDoorIndicator);
  const labDoorObstacle = makeBoxObstacle(
    new THREE.Vector3(genDoor3X - 0.12, 0, genDoor3Z - 0.8),
    new THREE.Vector3(genDoor3X + 0.12, CEIL_H - 0.3, genDoor3Z + 0.8),
  );
  obstacles.push(labDoorObstacle);

  // ── Wires from generator to each door ──
  const wireY = 2.6; // wire height along ceiling

  // Wire 1 — generator → north door
  addWire([
    new THREE.Vector3(genWorldX, genTopY, genWorldZ - 1.2),
    new THREE.Vector3(genWorldX, wireY + 0.2, genWorldZ - 3),
    new THREE.Vector3(genDoor1X, wireY, (genWorldZ + genDoor1Z) / 2),
    new THREE.Vector3(genDoor1X, wireY - 0.3, genDoor1Z + 1.5),
    new THREE.Vector3(genDoor1X, CEIL_H * 0.7, genDoor1Z + 0.3),
  ], true);
  // Second wire for thickness
  addWire([
    new THREE.Vector3(genWorldX + 0.15, genTopY, genWorldZ - 1.1),
    new THREE.Vector3(genWorldX + 0.15, wireY + 0.1, genWorldZ - 4),
    new THREE.Vector3(genDoor1X + 0.2, wireY - 0.1, (genWorldZ + genDoor1Z) / 2 + 1),
    new THREE.Vector3(genDoor1X + 0.15, wireY - 0.4, genDoor1Z + 1.8),
    new THREE.Vector3(genDoor1X + 0.15, CEIL_H * 0.7, genDoor1Z + 0.3),
  ], false);

  // Wire 2 — generator → south door
  addWire([
    new THREE.Vector3(genWorldX, genTopY, genWorldZ + 1.2),
    new THREE.Vector3(genWorldX, wireY + 0.2, genWorldZ + 3),
    new THREE.Vector3(genDoor2X, wireY, (genWorldZ + genDoor2Z) / 2),
    new THREE.Vector3(genDoor2X, wireY - 0.3, genDoor2Z - 1.5),
    new THREE.Vector3(genDoor2X, CEIL_H * 0.7, genDoor2Z - 0.3),
  ], true);
  addWire([
    new THREE.Vector3(genWorldX - 0.12, genTopY, genWorldZ + 1.1),
    new THREE.Vector3(genWorldX - 0.12, wireY + 0.1, genWorldZ + 4),
    new THREE.Vector3(genDoor2X - 0.18, wireY - 0.1, (genWorldZ + genDoor2Z) / 2 - 1),
    new THREE.Vector3(genDoor2X - 0.15, wireY - 0.4, genDoor2Z - 1.8),
    new THREE.Vector3(genDoor2X - 0.15, CEIL_H * 0.7, genDoor2Z - 0.3),
  ], false);

  // Wire 3 — generator → west door
  addWire([
    new THREE.Vector3(genWorldX - 2.5, genTopY - 0.5, genWorldZ),
    new THREE.Vector3(genWorldX - 5, wireY, genWorldZ),
    new THREE.Vector3((genWorldX + genDoor3X) / 2, wireY - 0.2, genDoor3Z),
    new THREE.Vector3(genDoor3X + 2, wireY - 0.3, genDoor3Z),
    new THREE.Vector3(genDoor3X + 0.3, CEIL_H * 0.7, genDoor3Z),
  ], true);
  addWire([
    new THREE.Vector3(genWorldX - 2.5, genTopY - 0.4, genWorldZ + 0.15),
    new THREE.Vector3(genWorldX - 5, wireY - 0.1, genWorldZ + 0.2),
    new THREE.Vector3((genWorldX + genDoor3X) / 2, wireY - 0.3, genDoor3Z + 0.2),
    new THREE.Vector3(genDoor3X + 2, wireY - 0.5, genDoor3Z + 0.15),
    new THREE.Vector3(genDoor3X + 0.3, CEIL_H * 0.7, genDoor3Z + 0.15),
  ], false);

  // Wire clamps on ceiling (small boxes along wire paths)
  const clampMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.6, roughness: 0.4 });
  const clampGeo = new THREE.BoxGeometry(0.12, 0.06, 0.12);
  const clampPositions = [
    // North wire clamps
    new THREE.Vector3(genDoor1X, wireY + 0.03, genWorldZ - 5),
    new THREE.Vector3(genDoor1X, wireY + 0.03, (genWorldZ + genDoor1Z) / 2),
    // South wire clamps
    new THREE.Vector3(genDoor2X, wireY + 0.03, genWorldZ + 5),
    new THREE.Vector3(genDoor2X, wireY + 0.03, (genWorldZ + genDoor2Z) / 2),
    // West wire clamps
    new THREE.Vector3(genWorldX - 6, wireY + 0.03, genDoor3Z),
    new THREE.Vector3((genWorldX + genDoor3X) / 2, wireY + 0.03, genDoor3Z),
  ];
  for (const cp of clampPositions) {
    const clamp = new THREE.Mesh(clampGeo, clampMat);
    clamp.position.copy(cp);
    root.add(clamp);
  }

  // ═══════════════════════════════════════════════════════════
  //  ROOMS BEHIND GENERATOR DOORS (3 rooms beyond north, south, west walls)
  // ═══════════════════════════════════════════════════════════

  // ── Room 1 — Серверна (server room) — beyond north wall ──
  const srv_W = 8, srv_D = 10;
  const srv_X = genDoor1X;                    // centered on door X
  const srv_Z_MAX = HALL_Z_MIN;              // starts at hall north wall
  const srv_Z_MIN = srv_Z_MAX - srv_D;
  const srv_CX = srv_X;
  const srv_CZ = (srv_Z_MIN + srv_Z_MAX) / 2;

  addFloor(srv_CX, srv_CZ, srv_W, srv_D);
  addCeiling(srv_CX, srv_CZ, srv_W, srv_D);

  // Walls (north, west, east; south wall has gap for door — reuse hall north wall)
  addWall(srv_CX, WY, srv_Z_MIN, srv_W, WH, WALL_T);                          // north
  addWall(srv_CX - srv_W / 2, WY, srv_CZ, WALL_T, WH, srv_D);                // west
  addWall(srv_CX + srv_W / 2, WY, srv_CZ, WALL_T, WH, srv_D);                // east
  // South wall segments around door gap
  const srv_gapHalf = 0.7;
  const srv_leftLen = (genDoor1X - srv_gapHalf) - (srv_CX - srv_W / 2);
  if (srv_leftLen > 0.2) addWall(srv_CX - srv_W / 2 + srv_leftLen / 2, WY, srv_Z_MAX, srv_leftLen, WH, WALL_T);
  const srv_rightLen = (srv_CX + srv_W / 2) - (genDoor1X + srv_gapHalf);
  if (srv_rightLen > 0.2) addWall(srv_CX + srv_W / 2 - srv_rightLen / 2, WY, srv_Z_MAX, srv_rightLen, WH, WALL_T);

  roomCenters.set('Серверна', new THREE.Vector3(srv_CX, 0, srv_CZ));
  addRoomSign('10 — Серверна', genDoor1X, signY, HALL_Z_MIN + 0.14, 'z');

  addFlicker(srv_CX, srv_CZ, 0x3366ff, 1.2);
  addFlicker(srv_CX, srv_CZ - 3, 0x3355cc, 0.8);

  // Server racks (tall cabinets along walls)
  const rackMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.5, metalness: 0.6 });
  const rackLightMat = new THREE.MeshStandardMaterial({
    color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 1.5,
  });
  const rackLightRedMat = new THREE.MeshStandardMaterial({
    color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 1.5,
  });

  for (let i = 0; i < 4; i++) {
    const rackZ = srv_Z_MIN + 1.5 + i * 2.2;
    // Left row
    const rackL = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 0.6), rackMat);
    rackL.position.set(srv_CX - srv_W / 2 + 0.8, 1.1, rackZ);
    rackL.castShadow = true; rackL.receiveShadow = true;
    root.add(rackL);
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(srv_CX - srv_W / 2 + 0.3, 0, rackZ - 0.35),
      new THREE.Vector3(srv_CX - srv_W / 2 + 1.3, 2.2, rackZ + 0.35),
    ));
    // Right row
    const rackR = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 0.6), rackMat);
    rackR.position.set(srv_CX + srv_W / 2 - 0.8, 1.1, rackZ);
    rackR.castShadow = true; rackR.receiveShadow = true;
    root.add(rackR);
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(srv_CX + srv_W / 2 - 1.3, 0, rackZ - 0.35),
      new THREE.Vector3(srv_CX + srv_W / 2 - 0.3, 2.2, rackZ + 0.35),
    ));

    // Indicator lights on racks
    for (let ly = 0; ly < 4; ly++) {
      const lightL = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.02),
        Math.random() > 0.3 ? rackLightMat : rackLightRedMat,
      );
      lightL.position.set(srv_CX - srv_W / 2 + 1.21, 0.5 + ly * 0.5, rackZ + (Math.random() - 0.5) * 0.3);
      root.add(lightL);
      const lightR = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.02),
        Math.random() > 0.3 ? rackLightMat : rackLightRedMat,
      );
      lightR.position.set(srv_CX + srv_W / 2 - 1.21, 0.5 + ly * 0.5, rackZ + (Math.random() - 0.5) * 0.3);
      root.add(lightR);
    }
  }

  // Central table with monitors
  const srvTableMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.4 });
  const srvTable = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 0.8), srvTableMat);
  srvTable.position.set(srv_CX, 0.375, srv_CZ);
  srvTable.castShadow = true; srvTable.receiveShadow = true;
  root.add(srvTable);
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(srv_CX - 1.1, 0, srv_CZ - 0.5),
    new THREE.Vector3(srv_CX + 1.1, 0.8, srv_CZ + 0.5),
  ));

  // Monitor screens on table
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x112244, emissive: 0x1133aa, emissiveIntensity: 0.8,
  });
  for (const mx of [-0.5, 0.5]) {
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.04), screenMat);
    screen.position.set(srv_CX + mx, 0.75 + 0.225, srv_CZ - 0.2);
    root.add(screen);
  }

  // Cable bundles on floor
  for (let i = 0; i < 6; i++) {
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, srv_W - 2, 6),
      wireMat,
    );
    cable.rotation.z = Math.PI / 2;
    cable.position.set(srv_CX, 0.03, srv_Z_MIN + 1 + i * 1.5);
    root.add(cable);
  }

  addDebris(srv_CX, srv_CZ, 3, 8);

  // ── Room 2 — Склад (storage room) — beyond south wall ──
  const stg_W = 8, stg_D = 8;
  const stg_X = genDoor2X;
  const stg_Z_MIN = HALL_Z_MAX;
  const stg_Z_MAX = stg_Z_MIN + stg_D;
  const stg_CX = stg_X;
  const stg_CZ = (stg_Z_MIN + stg_Z_MAX) / 2;

  addFloor(stg_CX, stg_CZ, stg_W, stg_D);
  addCeiling(stg_CX, stg_CZ, stg_W, stg_D);

  // Walls
  // South wall — split around vent opening (ventW = 0.9 centered on stg_CX)
  const stgVentGap = 1.0; // slightly wider than ventW to allow passage
  const stgSouthLeftLen = (stg_CX - stgVentGap / 2) - (stg_CX - stg_W / 2);
  if (stgSouthLeftLen > 0.2) addWall(stg_CX - stg_W / 2 + stgSouthLeftLen / 2, WY, stg_Z_MAX, stgSouthLeftLen, WH, WALL_T);
  const stgSouthRightLen = (stg_CX + stg_W / 2) - (stg_CX + stgVentGap / 2);
  if (stgSouthRightLen > 0.2) addWall(stg_CX + stg_W / 2 - stgSouthRightLen / 2, WY, stg_Z_MAX, stgSouthRightLen, WH, WALL_T);
  // Upper wall above vent opening (visual only — no XZ obstacle, so prone player can pass)
  const ventTopY = 0.95;
  const aboveVentH = CEIL_H - ventTopY;
  {
    const geo = new THREE.BoxGeometry(stgVentGap, aboveVentH, WALL_T);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.position.set(stg_CX, ventTopY + aboveVentH / 2, stg_Z_MAX);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  addWall(stg_CX - stg_W / 2, WY, stg_CZ, WALL_T, WH, stg_D);                // west
  addWall(stg_CX + stg_W / 2, WY, stg_CZ, WALL_T, WH, stg_D);                // east
  // North wall segments around door gap
  const stg_leftLen = (genDoor2X - srv_gapHalf) - (stg_CX - stg_W / 2);
  if (stg_leftLen > 0.2) addWall(stg_CX - stg_W / 2 + stg_leftLen / 2, WY, stg_Z_MIN, stg_leftLen, WH, WALL_T);
  const stg_rightLen = (stg_CX + stg_W / 2) - (genDoor2X + srv_gapHalf);
  if (stg_rightLen > 0.2) addWall(stg_CX + stg_W / 2 - stg_rightLen / 2, WY, stg_Z_MIN, stg_rightLen, WH, WALL_T);

  roomCenters.set('Склад', new THREE.Vector3(stg_CX, 0, stg_CZ));
  addRoomSign('11 — Склад', genDoor2X, signY, HALL_Z_MAX - 0.14, 'z');

  addFlicker(stg_CX, stg_CZ, 0xffaa44, 1.0);

  // Shelving units along walls
  const shelvingMat = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.7, metalness: 0.5 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b5530, roughness: 0.9, metalness: 0.0 });

  // West wall shelving
  for (let i = 0; i < 3; i++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 1.2), shelvingMat);
    shelf.position.set(stg_CX - stg_W / 2 + 0.5, 1.1, stg_Z_MIN + 1.2 + i * 2.2);
    shelf.castShadow = true; shelf.receiveShadow = true;
    root.add(shelf);
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(stg_CX - stg_W / 2 + 0.15, 0, stg_Z_MIN + 0.5 + i * 2.2),
      new THREE.Vector3(stg_CX - stg_W / 2 + 0.85, 2.2, stg_Z_MIN + 1.9 + i * 2.2),
    ));
  }

  // East wall shelving
  for (let i = 0; i < 3; i++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 1.2), shelvingMat);
    shelf.position.set(stg_CX + stg_W / 2 - 0.5, 1.1, stg_Z_MIN + 1.2 + i * 2.2);
    shelf.castShadow = true; shelf.receiveShadow = true;
    root.add(shelf);
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(stg_CX + stg_W / 2 - 0.85, 0, stg_Z_MIN + 0.5 + i * 2.2),
      new THREE.Vector3(stg_CX + stg_W / 2 - 0.15, 2.2, stg_Z_MIN + 1.9 + i * 2.2),
    ));
  }

  // Crates scattered on floor
  for (let i = 0; i < 5; i++) {
    const crateSize = 0.4 + Math.random() * 0.4;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(crateSize, crateSize, crateSize), crateMat);
    const cx2 = stg_CX + (Math.random() - 0.5) * (stg_W - 3);
    const cz2 = stg_CZ + (Math.random() - 0.5) * (stg_D - 3);
    crate.position.set(cx2, crateSize / 2, cz2);
    crate.rotation.y = Math.random() * Math.PI;
    crate.castShadow = true; crate.receiveShadow = true;
    root.add(crate);
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(cx2 - crateSize / 2 - 0.05, 0, cz2 - crateSize / 2 - 0.05),
      new THREE.Vector3(cx2 + crateSize / 2 + 0.05, crateSize, cz2 + crateSize / 2 + 0.05),
    ));
  }

  // Barrel in corner
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3a5a3a, roughness: 0.7, metalness: 0.3 });
  for (const [bx, bz] of [[stg_CX + stg_W / 2 - 0.8, stg_Z_MAX - 0.8], [stg_CX - stg_W / 2 + 0.8, stg_Z_MAX - 0.8]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 1.0, 10), barrelMat);
    barrel.position.set(bx, 0.5, bz);
    barrel.castShadow = true;
    root.add(barrel);
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(bx - 0.4, 0, bz - 0.4),
      new THREE.Vector3(bx + 0.4, 1.0, bz + 0.4),
    ));
  }

  addDebris(stg_CX, stg_CZ, 3, 10);

  // ── Ventilation grate on south wall of storage room ──
  const ventGrateGroup = new THREE.Group();
  const ventX = stg_CX;
  const ventInnerZ = stg_Z_MAX - WALL_T / 2; // inner face of south wall
  const ventZ = ventInnerZ - 0.04;            // slightly in front of wall
  const ventW = 0.9, ventH = 0.9;
  const ventY = ventH / 2;                    // bottom edge at floor level

  // Dark hole behind the grate (visible through slats)
  const ventHoleMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1.0 });
  const ventHole = new THREE.Mesh(new THREE.BoxGeometry(ventW - 0.04, ventH - 0.04, 0.15), ventHoleMat);
  ventHole.position.set(0, 0, 0.06);
  ventGrateGroup.add(ventHole);

  // Outer frame (metal, slightly emissive so visible in the dark)
  const ventFrameMat = new THREE.MeshStandardMaterial({
    color: 0x808890, roughness: 0.5, metalness: 0.6,
    emissive: 0x1a1a22, emissiveIntensity: 0.5,
  });
  const ventFrame = new THREE.Mesh(new THREE.BoxGeometry(ventW + 0.1, ventH + 0.1, 0.06), ventFrameMat);
  ventFrame.position.set(0, 0, 0);
  ventGrateGroup.add(ventFrame);

  // Grate bars (horizontal slats)
  const ventBarMat = new THREE.MeshStandardMaterial({
    color: 0x707880, roughness: 0.4, metalness: 0.7,
    emissive: 0x151518, emissiveIntensity: 0.4,
  });
  const slats = 6;
  for (let i = 0; i < slats; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(ventW - 0.06, 0.02, 0.05), ventBarMat);
    bar.position.set(0, -ventH / 2 + 0.06 + i * (ventH - 0.12) / (slats - 1), -0.02);
    ventGrateGroup.add(bar);
  }

  // Keypad box next to the grate, at ~1m height on the wall (above the grate)
  const keypadWorldY = 1.0;
  const keypadLocalY = keypadWorldY - ventY; // offset relative to group center
  const keypadBoxMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.5 });
  const keypadBox = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.08), keypadBoxMat);
  keypadBox.position.set(ventW / 2 + 0.25, keypadLocalY, -0.01);
  ventGrateGroup.add(keypadBox);

  // Red LED on keypad (locked indicator)
  const ventLedMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 });
  const ventLed = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), ventLedMat);
  ventLed.position.set(ventW / 2 + 0.25, keypadLocalY + 0.1, -0.06);
  ventGrateGroup.add(ventLed);

  // Red point light on keypad — strong enough to illuminate the vent area
  const ventKeypadLight = new THREE.PointLight(0xff2200, 1.0, 4, 2);
  ventKeypadLight.position.set(ventW / 2 + 0.25, keypadLocalY + 0.1, -0.5);
  ventGrateGroup.add(ventKeypadLight);

  ventGrateGroup.position.set(ventX, ventY, ventZ);
  root.add(ventGrateGroup);

  const ventPos = new THREE.Vector3(ventX, ventY, ventZ);
  const ventObstacle = makeBoxObstacle(
    new THREE.Vector3(ventX - stgVentGap / 2 - 0.05, 0, stg_Z_MAX - WALL_T / 2 - 0.1),
    new THREE.Vector3(ventX + stgVentGap / 2 + 0.5, ventTopY, stg_Z_MAX + WALL_T / 2 + 0.1),
  );
  obstacles.push(ventObstacle);

  // ── Ventilation duct maze (behind vent grate, south of Склад) ──
  {
    const DUCT_H = 0.95;       // duct height — must be prone to navigate
    const DUCT_W = 1.0;        // duct passage width
    const DUCT_WALL = 0.1;     // duct wall thickness
    const ductY = DUCT_H / 2;  // center Y for walls
    const ductEntryX = stg_CX;
    const ductEntryZ = stg_Z_MAX + WALL_T / 2; // just past the south wall

    const ductMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a40, roughness: 0.6, metalness: 0.7,
      emissive: 0x0a0a0e, emissiveIntensity: 0.3,
    });

    // Helper: add duct wall segment + obstacle
    const addDuctWall = (cx: number, cz: number, sx: number, sz: number) => {
      const geo = new THREE.BoxGeometry(sx, DUCT_H, sz);
      const mesh = new THREE.Mesh(geo, ductMat);
      mesh.position.set(cx, ductY, cz);
      mesh.receiveShadow = true;
      root.add(mesh);
      obstacles.push(makeBoxObstacle(
        new THREE.Vector3(cx - sx / 2, 0, cz - sz / 2),
        new THREE.Vector3(cx + sx / 2, DUCT_H, cz + sz / 2),
      ));
    };

    // Helper: add duct floor
    const addDuctFloor = (cx: number, cz: number, sx: number, sz: number) => {
      const geo = new THREE.PlaneGeometry(sx, sz);
      const mesh = new THREE.Mesh(geo, ductMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cx, 0.005, cz);
      mesh.receiveShadow = true;
      root.add(mesh);
    };

    // Helper: add duct ceiling
    const addDuctCeiling = (cx: number, cz: number, sx: number, sz: number) => {
      const geo = new THREE.PlaneGeometry(sx, sz);
      const mesh = new THREE.Mesh(geo, ductMat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(cx, DUCT_H, cz);
      mesh.receiveShadow = true;
      root.add(mesh);
    };

    // Helper: add dim red duct light
    const addDuctLight = (x: number, z: number) => {
      const light = new THREE.PointLight(0xff3311, 0.4, 4, 2);
      light.position.set(x, DUCT_H - 0.05, z);
      root.add(light);
      flickerLights.push({ light, baseIntensity: 0.4, phase: Math.random() * Math.PI * 2 });
    };

    // ── Layout ──
    // Segment 1: straight south from vent entry (length 4)
    const seg1_len = 4;
    const seg1_z1 = ductEntryZ;
    const seg1_z2 = seg1_z1 + seg1_len;
    const seg1_cx = ductEntryX;

    // Left (west) wall of segment 1
    addDuctWall(seg1_cx - DUCT_W / 2 - DUCT_WALL / 2, (seg1_z1 + seg1_z2) / 2, DUCT_WALL, seg1_len);
    // Right (east) wall of segment 1
    addDuctWall(seg1_cx + DUCT_W / 2 + DUCT_WALL / 2, (seg1_z1 + seg1_z2) / 2, DUCT_WALL, seg1_len);
    addDuctFloor(seg1_cx, (seg1_z1 + seg1_z2) / 2, DUCT_W, seg1_len);
    addDuctCeiling(seg1_cx, (seg1_z1 + seg1_z2) / 2, DUCT_W, seg1_len);
    addDuctLight(seg1_cx, seg1_z1 + 1);

    // T-junction 1 at seg1_z2: left dead-end (west), right dead-end (east), continue south
    const tj1_z = seg1_z2;
    const tj1_armLen = 3; // dead-end arm length

    // Junction box floor/ceiling (wider area for the T)
    const junctionW = DUCT_W + 2 * (tj1_armLen + DUCT_WALL);
    addDuctFloor(seg1_cx, tj1_z + DUCT_W / 2, junctionW, DUCT_W);
    addDuctCeiling(seg1_cx, tj1_z + DUCT_W / 2, junctionW, DUCT_W);

    // Left dead-end (west arm)
    const leftArm_x1 = seg1_cx - DUCT_W / 2 - DUCT_WALL;
    const leftArm_x2 = leftArm_x1 - tj1_armLen;
    const leftArm_cx = (leftArm_x1 + leftArm_x2) / 2;
    // North wall of left arm
    addDuctWall(leftArm_cx, tj1_z, tj1_armLen, DUCT_WALL);
    // South wall of left arm
    addDuctWall(leftArm_cx, tj1_z + DUCT_W, tj1_armLen, DUCT_WALL);
    // West end cap of left arm
    addDuctWall(leftArm_x2 - DUCT_WALL / 2, tj1_z + DUCT_W / 2, DUCT_WALL, DUCT_W + DUCT_WALL * 2);
    addDuctFloor(leftArm_cx, tj1_z + DUCT_W / 2, tj1_armLen, DUCT_W);
    addDuctCeiling(leftArm_cx, tj1_z + DUCT_W / 2, tj1_armLen, DUCT_W);
    addDuctLight(leftArm_cx, tj1_z + DUCT_W / 2);

    // Right dead-end (east arm)
    const rightArm_x1 = seg1_cx + DUCT_W / 2 + DUCT_WALL;
    const rightArm_x2 = rightArm_x1 + tj1_armLen;
    const rightArm_cx = (rightArm_x1 + rightArm_x2) / 2;
    // North wall of right arm
    addDuctWall(rightArm_cx, tj1_z, tj1_armLen, DUCT_WALL);
    // South wall of right arm
    addDuctWall(rightArm_cx, tj1_z + DUCT_W, tj1_armLen, DUCT_WALL);
    // East end cap of right arm
    addDuctWall(rightArm_x2 + DUCT_WALL / 2, tj1_z + DUCT_W / 2, DUCT_WALL, DUCT_W + DUCT_WALL * 2);
    addDuctFloor(rightArm_cx, tj1_z + DUCT_W / 2, tj1_armLen, DUCT_W);
    addDuctCeiling(rightArm_cx, tj1_z + DUCT_W / 2, tj1_armLen, DUCT_W);
    addDuctLight(rightArm_cx, tj1_z + DUCT_W / 2);

    // Segment 2: continue south from T-junction (length 5)
    const seg2_z1 = tj1_z + DUCT_W;
    const seg2_len = 5;
    const seg2_z2 = seg2_z1 + seg2_len;
    // Left wall of segment 2
    addDuctWall(seg1_cx - DUCT_W / 2 - DUCT_WALL / 2, (seg2_z1 + seg2_z2) / 2, DUCT_WALL, seg2_len);
    // Right wall of segment 2
    addDuctWall(seg1_cx + DUCT_W / 2 + DUCT_WALL / 2, (seg2_z1 + seg2_z2) / 2, DUCT_WALL, seg2_len);
    addDuctFloor(seg1_cx, (seg2_z1 + seg2_z2) / 2, DUCT_W, seg2_len);
    addDuctCeiling(seg1_cx, (seg2_z1 + seg2_z2) / 2, DUCT_W, seg2_len);
    addDuctLight(seg1_cx, seg2_z1 + 2);

    // T-junction 2 at seg2_z2: left arm continues, right dead-end
    const tj2_z = seg2_z2;

    // Junction floor/ceiling
    addDuctFloor(seg1_cx, tj2_z + DUCT_W / 2, junctionW, DUCT_W);
    addDuctCeiling(seg1_cx, tj2_z + DUCT_W / 2, junctionW, DUCT_W);

    // Right dead-end (east arm) at junction 2
    const r2_x1 = seg1_cx + DUCT_W / 2 + DUCT_WALL;
    const r2_x2 = r2_x1 + tj1_armLen + 1;
    const r2_cx = (r2_x1 + r2_x2) / 2;
    const r2_len = r2_x2 - r2_x1;
    addDuctWall(r2_cx, tj2_z, r2_len, DUCT_WALL);
    addDuctWall(r2_cx, tj2_z + DUCT_W, r2_len, DUCT_WALL);
    addDuctWall(r2_x2 + DUCT_WALL / 2, tj2_z + DUCT_W / 2, DUCT_WALL, DUCT_W + DUCT_WALL * 2);
    addDuctFloor(r2_cx, tj2_z + DUCT_W / 2, r2_len, DUCT_W);
    addDuctCeiling(r2_cx, tj2_z + DUCT_W / 2, r2_len, DUCT_W);
    addDuctLight(r2_cx, tj2_z + DUCT_W / 2);

    // Left arm (west) leads to final room — continues west then south
    const l2_x1 = seg1_cx - DUCT_W / 2 - DUCT_WALL;
    const l2_x2 = l2_x1 - 4;
    const l2_cx = (l2_x1 + l2_x2) / 2;
    const l2_len = l2_x1 - l2_x2;
    // North wall
    addDuctWall(l2_cx, tj2_z, l2_len, DUCT_WALL);
    // South wall
    addDuctWall(l2_cx, tj2_z + DUCT_W, l2_len, DUCT_WALL);
    addDuctFloor(l2_cx, tj2_z + DUCT_W / 2, l2_len, DUCT_W);
    addDuctCeiling(l2_cx, tj2_z + DUCT_W / 2, l2_len, DUCT_W);
    addDuctLight(l2_cx, tj2_z + DUCT_W / 2);

    // Final segment: turn south from left arm end
    const seg3_x = l2_x2;
    const seg3_z1 = tj2_z;
    const seg3_len = 3;
    const seg3_z2 = seg3_z1 + seg3_len + DUCT_W;
    // West wall
    addDuctWall(seg3_x - DUCT_W / 2 - DUCT_WALL / 2, (seg3_z1 + seg3_z2) / 2, DUCT_WALL, seg3_z2 - seg3_z1);
    // East wall (starts after the junction opening)
    addDuctWall(seg3_x + DUCT_W / 2 + DUCT_WALL / 2, (tj2_z + DUCT_W + seg3_z2) / 2, DUCT_WALL, seg3_z2 - tj2_z - DUCT_W);
    addDuctFloor(seg3_x, (seg3_z1 + seg3_z2) / 2, DUCT_W, seg3_z2 - seg3_z1);
    addDuctCeiling(seg3_x, (seg3_z1 + seg3_z2) / 2, DUCT_W, seg3_z2 - seg3_z1);

    // No end cap — seg3 opens into sewer
    addDuctLight(seg3_x, seg3_z2 - 1);

    // South end of main corridor (end cap past junction 2)
    addDuctWall(seg1_cx, tj2_z + DUCT_W + DUCT_WALL / 2, DUCT_W + DUCT_WALL * 2, DUCT_WALL);

    // ── Sewer system (Каналізація) — accessible from vent duct end ──
    {
      const SEWER_H = 2.6;         // tall enough to stand
      const SEWER_W = 2.0;         // wider than vent ducts
      const SEWER_WALL = 0.2;      // thicker walls
      const WATER_Y = 0.05;        // shallow water level
      const sewerEntryZ = seg3_z2; // where vent ends = sewer begins

      // Sewer materials
      const sewerWallTex = makeCanvasTexture(256, 256, (ctx) => {
        // Dark greenish-brown concrete with stains
        ctx.fillStyle = '#2a3028';
        ctx.fillRect(0, 0, 256, 256);
        // Brick/block pattern
        for (let row = 0; row < 8; row++) {
          const y = row * 32;
          const offset = (row % 2) * 32;
          ctx.strokeStyle = 'rgba(20,20,15,0.6)';
          ctx.lineWidth = 2;
          for (let col = 0; col < 5; col++) {
            ctx.strokeRect(offset + col * 64, y, 64, 32);
          }
        }
        // Water stains dripping down
        for (let i = 0; i < 15; i++) {
          const sx = Math.random() * 256;
          const sy = Math.random() * 100;
          const grad = ctx.createLinearGradient(sx, sy, sx, sy + 60 + Math.random() * 120);
          grad.addColorStop(0, 'rgba(40,60,35,0.4)');
          grad.addColorStop(1, 'rgba(40,60,35,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(sx - 3, sy, 6, 60 + Math.random() * 120);
        }
        // Moss patches
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = `rgba(${30 + Math.random() * 30},${50 + Math.random() * 40},${20 + Math.random() * 20},0.5)`;
          ctx.beginPath();
          ctx.arc(Math.random() * 256, 200 + Math.random() * 56, 8 + Math.random() * 15, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      sewerWallTex.repeat.set(2, 1);

      const sewerWallMat = new THREE.MeshStandardMaterial({
        map: sewerWallTex,
        roughness: 0.85,
        metalness: 0.1,
        color: 0x586058,
      });

      const sewerFloorTex = makeCanvasTexture(256, 256, (ctx) => {
        ctx.fillStyle = '#1e2520';
        ctx.fillRect(0, 0, 256, 256);
        // Uneven stone floor
        for (let i = 0; i < 20; i++) {
          const x = Math.random() * 256;
          const y = Math.random() * 256;
          const r = 15 + Math.random() * 30;
          ctx.fillStyle = `rgba(${25 + Math.random() * 20},${30 + Math.random() * 20},${22 + Math.random() * 15},0.6)`;
          ctx.beginPath();
          ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      sewerFloorTex.repeat.set(3, 3);

      const sewerFloorMat = new THREE.MeshStandardMaterial({
        map: sewerFloorTex,
        roughness: 0.9,
        metalness: 0.05,
        color: 0x445044,
      });

      const sewerCeilMat = new THREE.MeshStandardMaterial({
        color: 0x3a4238,
        roughness: 0.9,
        metalness: 0.05,
      });

      // Water material — semi-transparent greenish
      const waterMat = new THREE.MeshStandardMaterial({
        color: 0x2a4a35,
        roughness: 0.1,
        metalness: 0.3,
        transparent: true,
        opacity: 0.55,
        emissive: 0x1a3a1a,
        emissiveIntensity: 0.4,
      });

      // Pipe material
      const pipeMat = new THREE.MeshStandardMaterial({
        color: 0x5a4a3a,
        roughness: 0.5,
        metalness: 0.6,
      });

      // Helper: add sewer wall segment + obstacle
      const addSewerWall = (cx: number, cz: number, sx: number, sz: number, h = SEWER_H) => {
        const geo = new THREE.BoxGeometry(sx, h, sz);
        const mesh = new THREE.Mesh(geo, sewerWallMat);
        mesh.position.set(cx, h / 2, cz);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        root.add(mesh);
        obstacles.push(makeBoxObstacle(
          new THREE.Vector3(cx - sx / 2, 0, cz - sz / 2),
          new THREE.Vector3(cx + sx / 2, h, cz + sz / 2),
        ));
      };

      const addSewerFloor = (cx: number, cz: number, sx: number, sz: number) => {
        const geo = new THREE.PlaneGeometry(sx, sz);
        const mesh = new THREE.Mesh(geo, sewerFloorMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(cx, 0.005, cz);
        mesh.receiveShadow = true;
        root.add(mesh);
      };

      const addSewerCeiling = (cx: number, cz: number, sx: number, sz: number) => {
        const geo = new THREE.PlaneGeometry(sx, sz);
        const mesh = new THREE.Mesh(geo, sewerCeilMat);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(cx, SEWER_H, cz);
        mesh.receiveShadow = true;
        root.add(mesh);
      };

      const addWaterPlane = (cx: number, cz: number, sx: number, sz: number) => {
        const geo = new THREE.PlaneGeometry(sx, sz);
        const mesh = new THREE.Mesh(geo, waterMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(cx, WATER_Y, cz);
        root.add(mesh);
      };

      const addSewerLight = (x: number, z: number, color = 0x55cc66, intensity = 1.2) => {
        const light = new THREE.PointLight(color, intensity, 8, 2);
        light.position.set(x, SEWER_H - 0.2, z);
        root.add(light);
        flickerLights.push({ light, baseIntensity: intensity, phase: Math.random() * Math.PI * 2 });
      };

      // Pipe along tunnel wall
      const addPipe = (x: number, z1: number, z2: number, y: number, radius = 0.08) => {
        const len = Math.abs(z2 - z1);
        const geo = new THREE.CylinderGeometry(radius, radius, len, 8);
        geo.rotateX(Math.PI / 2);
        const mesh = new THREE.Mesh(geo, pipeMat);
        mesh.position.set(x, y, (z1 + z2) / 2);
        mesh.castShadow = true;
        root.add(mesh);
      };

      // Pipe running along X axis
      const addPipeX = (z: number, x1: number, x2: number, y: number, radius = 0.08) => {
        const len = Math.abs(x2 - x1);
        const geo = new THREE.CylinderGeometry(radius, radius, len, 8);
        geo.rotateZ(Math.PI / 2);
        const mesh = new THREE.Mesh(geo, pipeMat);
        mesh.position.set((x1 + x2) / 2, y, z);
        mesh.castShadow = true;
        root.add(mesh);
      };

      // ── Transition zone: vent widens into sewer ──
      // Short ramp section where ceiling rises from DUCT_H to SEWER_H
      const transLen = 1.5;
      const transZ1 = sewerEntryZ;
      const transZ2 = transZ1 + transLen;

      // Transition walls (same width as duct, expanding)
      addSewerWall(seg3_x - DUCT_W / 2 - SEWER_WALL / 2, (transZ1 + transZ2) / 2, SEWER_WALL, transLen, SEWER_H);
      addSewerWall(seg3_x + DUCT_W / 2 + SEWER_WALL / 2, (transZ1 + transZ2) / 2, SEWER_WALL, transLen, SEWER_H);
      addSewerFloor(seg3_x, (transZ1 + transZ2) / 2, DUCT_W, transLen);
      addSewerCeiling(seg3_x, (transZ1 + transZ2) / 2, DUCT_W, transLen);
      addWaterPlane(seg3_x, (transZ1 + transZ2) / 2, DUCT_W, transLen);

      // ── Main sewer tunnel: runs east-west ──
      const mainLen = 16;
      const mainCX = seg3_x;
      const mainZ = transZ2 + SEWER_W / 2;
      const mainX1 = mainCX - mainLen / 2;
      const mainX2 = mainCX + mainLen / 2;

      // North wall (with gap where transition connects)
      const nGapLeft = (seg3_x - DUCT_W / 2) - mainX1;
      const nGapRight = mainX2 - (seg3_x + DUCT_W / 2);
      if (nGapLeft > 0.3) addSewerWall(mainX1 + nGapLeft / 2, mainZ - SEWER_W / 2, nGapLeft, SEWER_WALL);
      if (nGapRight > 0.3) addSewerWall(mainX2 - nGapRight / 2, mainZ - SEWER_W / 2, nGapRight, SEWER_WALL);
      // South wall — split around branch opening at branchX
      const branchX = mainCX + 3;
      const sGapLeft = (branchX - SEWER_W / 2) - mainX1;
      const sGapRight = mainX2 - (branchX + SEWER_W / 2);
      if (sGapLeft > 0.3) addSewerWall(mainX1 + sGapLeft / 2, mainZ + SEWER_W / 2, sGapLeft, SEWER_WALL);
      if (sGapRight > 0.3) addSewerWall(mainX2 - sGapRight / 2, mainZ + SEWER_W / 2, sGapRight, SEWER_WALL);
      // West end cap
      addSewerWall(mainX1 - SEWER_WALL / 2, mainZ, SEWER_WALL, SEWER_W + SEWER_WALL * 2);
      // East end — open, continues to extension

      addSewerFloor(mainCX, mainZ, mainLen, SEWER_W);
      addSewerCeiling(mainCX, mainZ, mainLen, SEWER_W);
      addWaterPlane(mainCX, mainZ, mainLen, SEWER_W);

      // Pipes along main tunnel
      addPipeX(mainZ - SEWER_W / 2 + 0.3, mainX1 + 1, mainX2 - 1, SEWER_H - 0.3, 0.1);
      addPipeX(mainZ + SEWER_W / 2 - 0.3, mainX1 + 1, mainX2 - 1, 1.8, 0.06);
      addPipeX(mainZ + SEWER_W / 2 - 0.3, mainX1 + 2, mainX2 - 3, 0.4, 0.05);

      // Lights along main tunnel
      addSewerLight(mainCX - 5, mainZ, 0x55cc66, 1.0);
      addSewerLight(mainCX, mainZ, 0x66dd77, 1.3);
      addSewerLight(mainCX + 5, mainZ, 0x55cc66, 1.0);

      // ── South branch: goes south from main tunnel ──
      const branchLen = 10;
      const branchZ1 = mainZ + SEWER_W / 2;
      const branchZ2 = branchZ1 + branchLen;

      // West wall of branch
      addSewerWall(branchX - SEWER_W / 2 - SEWER_WALL / 2, (branchZ1 + branchZ2) / 2, SEWER_WALL, branchLen);
      // East wall of branch
      addSewerWall(branchX + SEWER_W / 2 + SEWER_WALL / 2, (branchZ1 + branchZ2) / 2, SEWER_WALL, branchLen);
      // South end cap of branch
      addSewerWall(branchX, branchZ2 + SEWER_WALL / 2, SEWER_W + SEWER_WALL * 2, SEWER_WALL);

      addSewerFloor(branchX, (branchZ1 + branchZ2) / 2, SEWER_W, branchLen);
      addSewerCeiling(branchX, (branchZ1 + branchZ2) / 2, SEWER_W, branchLen);
      addWaterPlane(branchX, (branchZ1 + branchZ2) / 2, SEWER_W, branchLen);

      // Pipes along branch
      addPipe(branchX - SEWER_W / 2 + 0.25, branchZ1, branchZ2, SEWER_H - 0.25, 0.08);
      addPipe(branchX + SEWER_W / 2 - 0.25, branchZ1, branchZ2, 1.5, 0.06);

      addSewerLight(branchX, branchZ1 + 2, 0x44cc55, 0.9);
      addSewerLight(branchX, branchZ1 + 6, 0x66dd77, 1.1);
      addSewerLight(branchX, branchZ2 - 1, 0x44cc55, 0.7);

      // ── East extension from main tunnel ──
      const eastLen = 8;
      const eastX1 = mainX2;
      const eastX2 = eastX1 + eastLen;
      const eastCX = (eastX1 + eastX2) / 2;

      // North wall
      addSewerWall(eastCX, mainZ - SEWER_W / 2, eastLen, SEWER_WALL);
      // South wall
      addSewerWall(eastCX, mainZ + SEWER_W / 2, eastLen, SEWER_WALL);
      // East end cap
      addSewerWall(eastX2 + SEWER_WALL / 2, mainZ, SEWER_WALL, SEWER_W + SEWER_WALL * 2);

      addSewerFloor(eastCX, mainZ, eastLen, SEWER_W);
      addSewerCeiling(eastCX, mainZ, eastLen, SEWER_W);
      addWaterPlane(eastCX, mainZ, eastLen, SEWER_W);

      addPipeX(mainZ - SEWER_W / 2 + 0.3, eastX1, eastX2 - 1, SEWER_H - 0.3, 0.1);
      addSewerLight(eastCX, mainZ, 0x55cc66, 1.0);

      // ── Props: grate covers, debris ──
      // Rusty grate on floor at transition
      const grateMat = new THREE.MeshStandardMaterial({
        color: 0x6a5a4a, roughness: 0.7, metalness: 0.8,
      });
      const grate = new THREE.Mesh(new THREE.BoxGeometry(DUCT_W - 0.1, 0.03, 0.6), grateMat);
      grate.position.set(seg3_x, 0.01, transZ1 + 0.3);
      grate.rotation.y = 0.1; // slightly askew — looks broken/displaced
      root.add(grate);

      // Dripping water particles (visual meshes falling periodically — simple static drip spots)
      const dripMat = new THREE.MeshStandardMaterial({
        color: 0x4a6a4a, emissive: 0x1a3a1a, emissiveIntensity: 0.3, transparent: true, opacity: 0.5,
      });
      const dripSpots = [
        [mainCX - 3, mainZ],
        [mainCX + 2, mainZ],
        [branchX, branchZ1 + 4],
        [eastCX - 2, mainZ],
      ] as const;
      for (const [dx, dz] of dripSpots) {
        // Small puddle on floor
        const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.3, 8), dripMat);
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(dx, WATER_Y + 0.01, dz);
        root.add(puddle);
      }

      // Broken pipe prop at east end
      const brokenPipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8, 1, true),
        pipeMat,
      );
      brokenPipe.position.set(eastX2 - 1, 0.6, mainZ + 0.5);
      brokenPipe.rotation.z = 0.3;
      root.add(brokenPipe);

      // Valve wheel on west end wall
      const valveMat = new THREE.MeshStandardMaterial({ color: 0xaa3333, roughness: 0.6, metalness: 0.7 });
      const valve = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 16), valveMat);
      valve.position.set(mainX1 + 0.15, 1.2, mainZ);
      valve.rotation.y = Math.PI / 2;
      root.add(valve);

      // Warning sign on wall
      const signTex = makeCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = '#aa8800';
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#111';
        ctx.fillRect(4, 4, 120, 120);
        ctx.fillStyle = '#aa8800';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ НЕБЕЗПЕКА', 64, 50);
        ctx.font = '14px sans-serif';
        ctx.fillText('Каналізація', 64, 75);
        ctx.fillText('Вхід заборонено', 64, 95);
      });
      const signMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.6),
        new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }),
      );
      signMesh.position.set(seg3_x + DUCT_W / 2 + SEWER_WALL - 0.01, 1.5, transZ1 + 0.5);
      signMesh.rotation.y = -Math.PI / 2;
      root.add(signMesh);

      roomCenters.set('Каналізація', new THREE.Vector3(mainCX, 0, mainZ));
    }
  }

  // ── Room 3 — Лабораторія (lab) — beyond west wall ──
  const lab_W = 12, lab_D = 8;
  const lab_X_MAX = HALL_X_MIN;
  const lab_X_MIN = lab_X_MAX - lab_W;
  const lab_Z = genDoor3Z;
  const lab_CX = (lab_X_MIN + lab_X_MAX) / 2;
  const lab_CZ = lab_Z;

  addFloor(lab_CX, lab_CZ, lab_W, lab_D);
  addCeiling(lab_CX, lab_CZ, lab_W, lab_D);

  // Walls
  addWall(lab_X_MIN, WY, lab_CZ, WALL_T, WH, lab_D);                          // west
  addWall(lab_CX, WY, lab_CZ - lab_D / 2, lab_W, WH, WALL_T);                // north
  addWall(lab_CX, WY, lab_CZ + lab_D / 2, lab_W, WH, WALL_T);                // south
  // East wall segments around door gap
  const lab_topLen = (genDoor3Z - srv_gapHalf) - (lab_CZ - lab_D / 2);
  if (lab_topLen > 0.2) addWall(lab_X_MAX, WY, lab_CZ - lab_D / 2 + lab_topLen / 2, WALL_T, WH, lab_topLen);
  const lab_botLen = (lab_CZ + lab_D / 2) - (genDoor3Z + srv_gapHalf);
  if (lab_botLen > 0.2) addWall(lab_X_MAX, WY, lab_CZ + lab_D / 2 - lab_botLen / 2, WALL_T, WH, lab_botLen);

  roomCenters.set('Лабораторія', new THREE.Vector3(lab_CX, 0, lab_CZ));
  addRoomSign('12 — Лабораторія', HALL_X_MIN + 0.14, signY, genDoor3Z, 'x');

  addFlicker(lab_CX, lab_CZ - 2, 0xaaccff, 1.5);
  addFlicker(lab_CX, lab_CZ + 2, 0xaaccff, 1.0);

  // Lab tables
  const labTableMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const labTable = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.8, 0.9), labTableMat);
    const ltx = lab_X_MIN + 2 + i * 3.5;
    labTable.position.set(ltx, 0.4, lab_CZ - lab_D / 2 + 1.2);
    labTable.castShadow = true; labTable.receiveShadow = true;
    root.add(labTable);
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(ltx - 1.35, 0, lab_CZ - lab_D / 2 + 0.7),
      new THREE.Vector3(ltx + 1.35, 0.85, lab_CZ - lab_D / 2 + 1.7),
    ));

    // Beakers/flasks on tables
    const flaskMat = new THREE.MeshStandardMaterial({
      color: 0x88ccaa, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.7,
    });
    for (let f = 0; f < 3; f++) {
      const flask = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.18, 8), flaskMat);
      flask.position.set(ltx + (f - 1) * 0.4, 0.8 + 0.09, lab_CZ - lab_D / 2 + 1.2);
      root.add(flask);
    }
  }

  // Generate random 4-digit ventilation code
  const ventCode = String(Math.floor(1000 + Math.random() * 9000));

  // Whiteboard on south wall — with ventilation code written on it
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512;
  boardCanvas.height = 256;
  const bCtx = boardCanvas.getContext('2d')!;
  // White background
  bCtx.fillStyle = '#e8e8e8';
  bCtx.fillRect(0, 0, 512, 256);
  // Faint grid lines
  bCtx.strokeStyle = 'rgba(180,180,200,0.3)';
  bCtx.lineWidth = 1;
  for (let gy = 0; gy < 256; gy += 32) { bCtx.beginPath(); bCtx.moveTo(0, gy); bCtx.lineTo(512, gy); bCtx.stroke(); }
  // Handwritten-style text
  bCtx.fillStyle = '#1a1a80';
  bCtx.font = 'italic 22px serif';
  bCtx.fillText('Формули реакцій', 20, 40);
  bCtx.fillStyle = '#333';
  bCtx.font = '16px serif';
  bCtx.fillText('H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O', 20, 80);
  bCtx.fillText('CaCO₃ → CaO + CO₂', 20, 110);
  // Vent code written as "Код вент: XXXX" in red marker — large and bold
  bCtx.fillStyle = '#dd1111';
  bCtx.font = 'bold 48px monospace';
  bCtx.fillText(`Код вент: ${ventCode}`, 16, 190);
  // Underline for emphasis
  bCtx.strokeStyle = '#dd1111';
  bCtx.lineWidth = 3;
  bCtx.beginPath(); bCtx.moveTo(16, 198); bCtx.lineTo(496, 198); bCtx.stroke();
  // Small note
  bCtx.fillStyle = '#555';
  bCtx.font = 'italic 18px serif';
  bCtx.fillText('(склад — вентиляція)', 20, 230);

  const boardTex = new THREE.CanvasTexture(boardCanvas);
  const boardFrameMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.4 });
  // Frame (box behind the board face)
  const bFrame = new THREE.Mesh(new THREE.BoxGeometry(3.1, 1.6, 0.05), boardFrameMat);
  bFrame.position.set(lab_CX, 1.5, lab_CZ + lab_D / 2 - 0.15);
  root.add(bFrame);
  // Board face — thin box with canvas texture, DoubleSide so visible from both directions
  const boardFaceMat = new THREE.MeshStandardMaterial({
    map: boardTex, roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide,
    emissive: 0xffffff, emissiveIntensity: 0.15, emissiveMap: boardTex,
  });
  const boardFace = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.5, 0.02), boardFaceMat);
  boardFace.position.set(lab_CX, 1.5, lab_CZ + lab_D / 2 - 0.18);
  root.add(boardFace);
  // Light to illuminate the whiteboard — bright so code is clearly visible
  const boardLight = new THREE.PointLight(0xffffff, 2.5, 6, 2);
  boardLight.position.set(lab_CX, 2.0, lab_CZ + lab_D / 2 - 0.6);
  root.add(boardLight);

  // Cabinet with chemicals along south wall
  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6, metalness: 0.4 });
  for (const cbx of [lab_X_MIN + 1.2, lab_X_MAX - 1.2]) {
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.5), cabinetMat);
    cabinet.position.set(cbx, 1.0, lab_CZ + lab_D / 2 - 0.5);
    cabinet.castShadow = true; cabinet.receiveShadow = true;
    root.add(cabinet);
    obstacles.push(makeBoxObstacle(
      new THREE.Vector3(cbx - 0.55, 0, lab_CZ + lab_D / 2 - 0.8),
      new THREE.Vector3(cbx + 0.55, 2.0, lab_CZ + lab_D / 2 - 0.2),
    ));
  }

  // Sink along west wall
  const sinkMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.3, metalness: 0.5 });
  const sink = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 1.5), sinkMat);
  sink.position.set(lab_X_MIN + 0.5, 0.4, lab_CZ);
  sink.castShadow = true; sink.receiveShadow = true;
  root.add(sink);
  obstacles.push(makeBoxObstacle(
    new THREE.Vector3(lab_X_MIN + 0.1, 0, lab_CZ - 0.8),
    new THREE.Vector3(lab_X_MIN + 0.9, 0.85, lab_CZ + 0.8),
  ));

  // Faucet
  const faucetMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8, roughness: 0.2 });
  const faucet = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), faucetMat);
  faucet.position.set(lab_X_MIN + 0.5, 0.95, lab_CZ);
  root.add(faucet);
  const faucetSpout = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.15), faucetMat);
  faucetSpout.position.set(lab_X_MIN + 0.5, 1.1, lab_CZ + 0.08);
  root.add(faucetSpout);

  addDebris(lab_CX, lab_CZ, 4, 12);

  // Place two large houses (no rotation for proper AABB collision)
  openableDoors.push(buildHouse(hallCX + 6, hallCZ - 6, 'Будиночок 1'));
  openableDoors.push(buildHouse(hallCX + 4, hallCZ + 6, 'Будиночок 2'));

  // ═══════════════════════════════════════════════════════════
  //  SECRET ROOM — beyond cafeteria east wall, opened by target
  // ═══════════════════════════════════════════════════════════

  const SECRET_X_MIN = X_MAX;         // starts where main building ends
  const SECRET_X_MAX = X_MAX + 16;    // very large room
  const SECRET_Z_MIN = -6;
  const SECRET_Z_MAX = 6;
  const secretCX = (SECRET_X_MIN + SECRET_X_MAX) / 2;
  const secretCZ = (SECRET_Z_MIN + SECRET_Z_MAX) / 2;
  const secretW = SECRET_X_MAX - SECRET_X_MIN;
  const secretD = SECRET_Z_MAX - SECRET_Z_MIN;

  // Floor + ceiling
  addFloor(secretCX, secretCZ, secretW, secretD);
  addCeiling(secretCX, secretCZ, secretW, secretD);

  // Walls
  addWall(SECRET_X_MAX, WY, secretCZ, WALL_T, WH, secretD);       // east wall
  addWall(secretCX, WY, SECRET_Z_MIN, secretW, WH, WALL_T);       // north wall
  addWall(secretCX, WY, SECRET_Z_MAX, secretW, WH, WALL_T);       // south wall
  // West wall segments (gap already made in main east wall above)
  // Top segment above gap on west side of secret room
  const swNorthLen = (secretDoorZ - secretGap / 2) - SECRET_Z_MIN;
  if (swNorthLen > 0.5) addWall(SECRET_X_MIN, WY, SECRET_Z_MIN + swNorthLen / 2, WALL_T, WH, swNorthLen);
  const swSouthLen = SECRET_Z_MAX - (secretDoorZ + secretGap / 2);
  if (swSouthLen > 0.5) addWall(SECRET_X_MIN, WY, SECRET_Z_MAX - swSouthLen / 2, WALL_T, WH, swSouthLen);

  roomCenters.set('Таємна Кімната', new THREE.Vector3(secretCX, 0, secretCZ));

  // Room sign on west wall (visible when entering from cafeteria)
  addRoomSign('10 — Таємна Кімната', SECRET_X_MIN + 0.14, signY, secretDoorZ, 'x', true);

  // Lighting — dim red/orange
  addFlicker(secretCX - 4, secretCZ - 2, 0xff6644, 1.8);
  addFlicker(secretCX + 4, secretCZ + 2, 0xff4422, 1.5);
  addFlicker(secretCX, secretCZ, 0xffaa44, 2.0);

  // Some rubble/debris inside
  addRubble(secretCX + 3, secretCZ - 2, 4, 8, true);
  addRubble(secretCX - 5, secretCZ + 3, 3, 6, true);
  addDebris(secretCX, secretCZ, 6, 10);

  // ── Secret door (blocks the gap in east wall) ──
  const sDoorMat = new THREE.MeshStandardMaterial({
    color: 0x553322, roughness: 0.7, metalness: 0.3,
    emissive: 0x110500, emissiveIntensity: 0.3,
  });
  const sDoorGroup = new THREE.Group();
  sDoorGroup.name = 'secretDoor';
  const sDoorMesh = new THREE.Mesh(new THREE.BoxGeometry(WALL_T + 0.05, WH, secretGap), sDoorMat);
  sDoorMesh.castShadow = true;
  sDoorGroup.add(sDoorMesh);
  // Lock indicator — red light
  const sDoorLock = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2.0 }),
  );
  sDoorLock.position.set(-0.15, 0.3, 0);
  sDoorGroup.add(sDoorLock);

  const sDoorPos = new THREE.Vector3(X_MAX, WY, secretDoorZ);
  sDoorGroup.position.copy(sDoorPos);
  root.add(sDoorGroup);
  const sDoorObstacle = makeBoxObstacle(
    new THREE.Vector3(X_MAX - WALL_T / 2 - 0.05, 0, secretDoorZ - secretGap / 2),
    new THREE.Vector3(X_MAX + WALL_T / 2 + 0.05, WH, secretDoorZ + secretGap / 2),
  );
  obstacles.push(sDoorObstacle);

  // ── Shooting target (on cafeteria wall, near the door) ──
  const targetGroup = new THREE.Group();
  targetGroup.name = 'shootingTarget';

  // Backboard
  const tBoard = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x886644, roughness: 0.9 }),
  );
  targetGroup.add(tBoard);

  // Rings (concentric circles via torus)
  const ringMat1 = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 });
  const ringMat2 = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 0.5 });
  const ringMat3 = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.8 });

  // Outer ring (white)
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 24), ringMat1);
  ring1.position.z = 0.035;
  targetGroup.add(ring1);
  // Middle ring (red)
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 24), ringMat2);
  ring2.position.z = 0.035;
  targetGroup.add(ring2);
  // Bullseye (yellow center)
  const bullseye = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.04, 12),
    ringMat3,
  );
  bullseye.rotation.x = Math.PI / 2;
  bullseye.position.z = 0.04;
  targetGroup.add(bullseye);

  // Target light
  const targetLight = new THREE.PointLight(0xffaa00, 0.8, 4, 2);
  targetLight.position.set(0, 0.5, 0.3);
  targetGroup.add(targetLight);

  // Place target on the east wall of cafeteria, next to the door
  const targetPos = new THREE.Vector3(X_MAX - 0.04, 1.5, secretDoorZ + secretGap / 2 + 0.8);
  targetGroup.position.copy(targetPos);
  root.add(targetGroup);

  // ═══════════════════════════════════════════════════════════
  //  OPENABLE DOORS (rooms 1-Спальня, 3-Туалет, 4-Кабінет, 5-Їдальня)
  // ═══════════════════════════════════════════════════════════

  const makeDoor = (
    wallX: number, doorZ: number,
    roomName: string,
    isWest: boolean,
  ): OpenableDoor => {
    // Pivot at the hinge edge of the door gap
    const pivot = new THREE.Group();
    const hingeZ = doorZ - doorGapSize / 2; // hinge at north edge of gap

    pivot.position.set(wallX, 0, hingeZ);

    // Door panel — positioned so hinge is at local Z=0
    const panelH = CEIL_H - 0.2;
    const panelW = doorGapSize - 0.1;
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, panelH, panelW),
      oDoorMat,
    );
    panel.position.set(0, CEIL_H / 2, panelW / 2);
    panel.castShadow = true;
    pivot.add(panel);

    // Handle on corridor side
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.12),
      oHandleMat,
    );
    const handleSide = isWest ? 0.08 : -0.08;
    handle.position.set(handleSide, CEIL_H / 2, panelW - 0.2);
    pivot.add(handle);

    // Handle on room side
    const handle2 = handle.clone();
    handle2.position.set(-handleSide, CEIL_H / 2, panelW - 0.2);
    pivot.add(handle2);

    root.add(pivot);

    // Collision obstacle
    const halfGap = doorGapSize / 2;
    const obs = makeBoxObstacle(
      new THREE.Vector3(wallX - 0.12, 0, doorZ - halfGap),
      new THREE.Vector3(wallX + 0.12, CEIL_H, doorZ + halfGap),
    );
    obstacles.push(obs);

    // Interaction position (center of doorway)
    const pos = new THREE.Vector3(wallX, 0, doorZ);

    // openDir: west doors open into the room (negative X), east doors open into the room (positive X)
    const openDir = isWest ? 1 : -1;

    return {
      roomName,
      pivot,
      pos,
      obstacle: obs,
      isOpen: false,
      animProgress: 0,
      facingAxis: 'x',
      openDir,
    };
  };

  // Room 1 — Спальня (west, Z = center of north west room)
  openableDoors.push(makeDoor(-CORR_HALF, (Z_MIN + Z_DIV1) / 2, 'Спальня', true));
  // Room 3 — Туалет (west, Z = center of south west room)
  openableDoors.push(makeDoor(-CORR_HALF, (Z_DIV2 + Z_MAX) / 2, 'Туалет', true));
  // Room 4 — Кабінет (east, Z = center of north east room)
  openableDoors.push(makeDoor(CORR_HALF, (Z_MIN + Z_DIV1) / 2, 'Кабінет', false));
  // Room 5 — Їдальня (east, Z = center of mid east room)
  openableDoors.push(makeDoor(CORR_HALF, (Z_DIV1 + Z_DIV2) / 2, 'Їдальня', false));

  // ═══════════════════════════════════════════════════════════
  //  LOCKED DOOR TO ГЕНЕРАТОРНА (blocks west passage)
  // ═══════════════════════════════════════════════════════════

  const genDoorMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a52,
    roughness: 0.6,
    metalness: 0.5,
    emissive: 0x060610,
    emissiveIntensity: 0.3,
  });
  const genDoorGroup = new THREE.Group();
  const genPanelH = CEIL_H - 0.2;
  const genPanelW = westPassageGap - 0.1;
  const genPanel = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_T, genPanelH, genPanelW),
    genDoorMat,
  );
  genPanel.position.set(0, CEIL_H / 2, 0);
  genPanel.castShadow = true;
  genDoorGroup.add(genPanel);

  // Handle
  const genHandleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 });
  const genHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.15), genHandleMat);
  genHandle.position.set(WALL_T / 2 + 0.03, CEIL_H / 2, genPanelW / 2 - 0.25);
  genDoorGroup.add(genHandle);

  // Lock indicator — red light
  const genLockLight = new THREE.PointLight(0xff2200, 0.5, 3, 2);
  genLockLight.position.set(WALL_T / 2 + 0.05, CEIL_H / 2 + 0.2, 0);
  genDoorGroup.add(genLockLight);
  const genLockDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 3 }),
  );
  genLockDot.position.set(WALL_T / 2 + 0.03, CEIL_H / 2 + 0.2, genPanelW / 2 - 0.25);
  genDoorGroup.add(genLockDot);

  const genDoorPos = new THREE.Vector3(X_MIN, 0, westPassageZ);
  genDoorGroup.position.copy(genDoorPos);
  root.add(genDoorGroup);

  const genDoorObstacle = makeBoxObstacle(
    new THREE.Vector3(X_MIN - WALL_T / 2, 0, westPassageZ - westPassageGap / 2),
    new THREE.Vector3(X_MIN + WALL_T / 2, CEIL_H, westPassageZ + westPassageGap / 2),
  );
  obstacles.push(genDoorObstacle);

  // ═══════════════════════════════════════════════════════════
  //  KEY TO ГЕНЕРАТОРНА (in the Secret Room)
  // ═══════════════════════════════════════════════════════════

  const genKeyGroup = new THREE.Group();
  const genKeyMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    emissive: 0x88ccff,
    emissiveIntensity: 1.5,
    metalness: 0.8,
    roughness: 0.3,
  });
  // Key body
  const genKeyBody = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.25), genKeyMat);
  genKeyGroup.add(genKeyBody);
  // Key ring
  const genKeyRing = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 8, 16), genKeyMat);
  genKeyRing.position.set(0, 0, 0.155);
  genKeyGroup.add(genKeyRing);
  // Key teeth
  for (let i = 0; i < 4; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.025), genKeyMat);
    tooth.position.set(-0.02, 0, -0.1 + i * 0.05);
    genKeyGroup.add(tooth);
  }

  // secretCX and secretCZ already defined above for the secret room
  const genKeyPos = new THREE.Vector3(secretCX + 2, 0.75, secretCZ - 1.5);
  genKeyGroup.position.copy(genKeyPos);
  genKeyGroup.rotation.set(0.1, -0.3, Math.PI / 2);

  // Blue glow
  const genKeyLight = new THREE.PointLight(0x88ccff, 0.8, 4, 2);
  genKeyLight.position.set(0, 0.3, 0);
  genKeyGroup.add(genKeyLight);

  root.add(genKeyGroup);

  // ── BLUE BULB (for Склад) — placed in Серверна (server room) ──
  const blueBulbMat = new THREE.MeshStandardMaterial({
    color: 0x4444ff, emissive: 0x2222ff, emissiveIntensity: 1.5,
  });
  const blueBulbGroup = new THREE.Group();
  const blueBulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), blueBulbMat);
  blueBulbGroup.add(blueBulbMesh);
  // Glass base
  const blueBulbBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.06, 8),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 }),
  );
  blueBulbBase.position.set(0, -0.09, 0);
  blueBulbGroup.add(blueBulbBase);
  const blueBulbPos = new THREE.Vector3(srv_CX + 1, 0.82, srv_CZ);
  blueBulbGroup.position.copy(blueBulbPos);
  const blueBulbLight = new THREE.PointLight(0x4444ff, 0.8, 4, 2);
  blueBulbLight.position.set(0, 0.15, 0);
  blueBulbGroup.add(blueBulbLight);
  root.add(blueBulbGroup);

  // ── YELLOW BULB (for Лабораторія) — placed in Будиночок 1 ──
  const yellowBulbMat = new THREE.MeshStandardMaterial({
    color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 1.5,
  });
  const yellowBulbGroup = new THREE.Group();
  const yellowBulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), yellowBulbMat);
  yellowBulbGroup.add(yellowBulbMesh);
  const yellowBulbBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.06, 8),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 }),
  );
  yellowBulbBase.position.set(0, -0.09, 0);
  yellowBulbGroup.add(yellowBulbBase);
  // Place inside house 1 (hallCX + 6, hallCZ - 6), on the floor
  const yellowBulbPos = new THREE.Vector3(hallCX + 6, 0.15, hallCZ - 6);
  yellowBulbGroup.position.copy(yellowBulbPos);
  const yellowBulbLight = new THREE.PointLight(0xffcc00, 0.8, 4, 2);
  yellowBulbLight.position.set(0, 0.15, 0);
  yellowBulbGroup.add(yellowBulbLight);
  root.add(yellowBulbGroup);

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
    gunObj: gunGroup,
    gunPos: gunPos.clone(),
    targetObj: targetGroup,
    targetPos: targetPos.clone(),
    secretDoorObj: sDoorGroup,
    secretDoorPos: sDoorPos.clone(),
    secretDoorObstacle: sDoorObstacle,
    openableDoors,
    genDoorObj: genDoorGroup,
    genDoorPos: genDoorPos.clone(),
    genDoorObstacle,
    genKeyObj: genKeyGroup,
    genKeyPos: genKeyPos.clone(),
    stgDoorObj: stgDoorGroup,
    stgDoorPos: stgDoorPos.clone(),
    stgDoorObstacle,
    labDoorObj: labDoorGroup,
    labDoorPos: labDoorPos.clone(),
    labDoorObstacle,
    yellowBulbObj: yellowBulbGroup,
    yellowBulbPos: yellowBulbPos.clone(),
    blueBulbObj: blueBulbGroup,
    blueBulbPos: blueBulbPos.clone(),
    generatorSlotsPos: generatorSlotsPos.clone(),
    stgDoorIndicator,
    labDoorIndicator,
    srvDoorIndicator,
    genSlotYellow,
    genSlotBlue,
    ventCode,
    ventObj: ventGrateGroup,
    ventPos: ventPos.clone(),
    ventObstacle,
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
