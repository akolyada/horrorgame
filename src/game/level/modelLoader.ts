import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AABBObstacle } from '../systems/PlayerController';

const loader = new GLTFLoader();
const modelCache = new Map<string, THREE.Group>();

async function loadModel(path: string): Promise<THREE.Group> {
  const cached = modelCache.get(path);
  if (cached) return cached.clone();

  try {
    const gltf = await loader.loadAsync(path);
    const model = gltf.scene;
    modelCache.set(path, model);
    return model.clone();
  } catch (e) {
    console.warn(`Failed to load model: ${path}`, e);
    return new THREE.Group();
  }
}

function placeModel(
  model: THREE.Object3D,
  parent: THREE.Group,
  pos: THREE.Vector3,
  rotY = 0,
  scale = 1,
) {
  model.position.copy(pos);
  model.rotation.y = rotY;
  model.scale.setScalar(scale);
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  parent.add(model);
  return model;
}

function aabbFromObject(obj: THREE.Object3D): AABBObstacle {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  return { min: box.min.clone(), max: box.max.clone() };
}

// Furniture kit paths
const FURN = '/assets/kenney_furniture-kit/Models/GLTF format';
// Graveyard kit paths
const GRAVE = '/assets/kenney_graveyard-kit/Models/GLB format';

// ── Monster model ──

export async function loadMonsterModel(): Promise<THREE.Group> {
  // Try ghost first, then skeleton, then zombie
  for (const name of ['character-ghost.glb', 'character-skeleton.glb', 'character-zombie.glb']) {
    const model = await loadModel(`${GRAVE}/${name}`);
    if (model.children.length > 0) return model;
  }
  return new THREE.Group(); // fallback: empty → procedural body will be used
}

// ── Furniture placement for kindergarten rooms ──

type RoomFurniturePlan = {
  models: Array<{
    path: string;
    pos: THREE.Vector3;
    rotY?: number;
    scale?: number;
    obstacle?: boolean;
  }>;
};

function makeRoomPlan(
  roomName: string,
  cx: number,
  cz: number,
  roomW: number,
  roomD: number,
): RoomFurniturePlan {
  const plan: RoomFurniturePlan = { models: [] };
  const halfW = roomW / 2 - 0.5;
  const halfD = roomD / 2 - 0.5;

  switch (roomName) {
    case 'Спальня': // Nap room — beds
      for (let i = 0; i < 3; i++) {
        plan.models.push({
          path: `${FURN}/bedSingle.glb`,
          pos: new THREE.Vector3(cx - halfW + 0.5, 0, cz - halfD + 1 + i * 2.2),
          rotY: Math.PI / 2,
          scale: 1.0,
          obstacle: true,
        });
      }
      // Bear on one bed
      plan.models.push({
        path: `${FURN}/bear.glb`,
        pos: new THREE.Vector3(cx - halfW + 1.2, 0.5, cz - halfD + 1),
        scale: 1.0,
      });
      break;

    case 'Ігрова': // Playroom — chairs, table, toys
      plan.models.push({
        path: `${FURN}/tableRound.glb`,
        pos: new THREE.Vector3(cx, 0, cz),
        scale: 1.0,
        obstacle: true,
      });
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        plan.models.push({
          path: `${FURN}/chair.glb`,
          pos: new THREE.Vector3(cx + Math.sin(angle) * 1.2, 0, cz + Math.cos(angle) * 1.2),
          rotY: -angle + Math.PI,
          scale: 1.0,
        });
      }
      // Books on the side
      plan.models.push({
        path: `${FURN}/books.glb`,
        pos: new THREE.Vector3(cx + halfW - 0.3, 0, cz - halfD + 0.5),
        scale: 1.0,
      });
      break;

    case 'Туалет': // WC — minimal
      plan.models.push({
        path: `${FURN}/bathroomSink.glb`,
        pos: new THREE.Vector3(cx - halfW + 0.5, 0, cz),
        rotY: Math.PI / 2,
        scale: 1.0,
        obstacle: true,
      });
      plan.models.push({
        path: `${FURN}/trashcan.glb`,
        pos: new THREE.Vector3(cx + halfW - 0.5, 0, cz + halfD - 0.5),
        scale: 1.0,
      });
      break;

    case 'Кабінет': // Office — desk, chair, bookcase
      plan.models.push({
        path: `${FURN}/desk.glb`,
        pos: new THREE.Vector3(cx + halfW - 0.8, 0, cz),
        rotY: -Math.PI / 2,
        scale: 1.0,
        obstacle: true,
      });
      plan.models.push({
        path: `${FURN}/chairDesk.glb`,
        pos: new THREE.Vector3(cx + halfW - 2, 0, cz),
        rotY: Math.PI / 2,
        scale: 1.0,
      });
      plan.models.push({
        path: `${FURN}/bookcaseOpen.glb`,
        pos: new THREE.Vector3(cx - halfW + 0.3, 0, cz - halfD + 0.3),
        scale: 1.0,
        obstacle: true,
      });
      plan.models.push({
        path: `${FURN}/laptop.glb`,
        pos: new THREE.Vector3(cx + halfW - 0.8, 0.75, cz),
        scale: 1.0,
      });
      break;

    case 'Їдальня': // Cafeteria — tables and chairs
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          const tx = cx - 1.5 + col * 3;
          const tz = cz - halfD + 1.5 + row * 3;
          plan.models.push({
            path: `${FURN}/table.glb`,
            pos: new THREE.Vector3(tx, 0, tz),
            scale: 1.0,
            obstacle: true,
          });
          // 2 chairs per table
          plan.models.push({
            path: `${FURN}/chair.glb`,
            pos: new THREE.Vector3(tx - 0.6, 0, tz + 0.5),
            rotY: Math.PI,
            scale: 1.0,
          });
          plan.models.push({
            path: `${FURN}/chair.glb`,
            pos: new THREE.Vector3(tx + 0.6, 0, tz - 0.5),
            scale: 1.0,
          });
        }
      }
      break;

    case 'Комірка': // Storage — shelves, boxes
      plan.models.push({
        path: `${FURN}/bookcaseClosedWide.glb`,
        pos: new THREE.Vector3(cx - halfW + 0.3, 0, cz),
        scale: 1.0,
        obstacle: true,
      });
      plan.models.push({
        path: `${FURN}/bookcaseClosed.glb`,
        pos: new THREE.Vector3(cx + halfW - 0.3, 0, cz - 1),
        rotY: Math.PI,
        scale: 1.0,
        obstacle: true,
      });
      plan.models.push({
        path: `${FURN}/cardboardBoxClosed.glb`,
        pos: new THREE.Vector3(cx, 0, cz + halfD - 0.5),
        scale: 1.2,
      });
      plan.models.push({
        path: `${FURN}/cardboardBoxOpen.glb`,
        pos: new THREE.Vector3(cx + 0.8, 0, cz + halfD - 0.4),
        rotY: 0.4,
        scale: 1.2,
      });
      break;
  }

  return plan;
}

// Graveyard props for horror atmosphere

function makeHorrorProps(cx: number, cz: number): RoomFurniturePlan {
  return {
    models: [
      { path: `${GRAVE}/candle.glb`, pos: new THREE.Vector3(cx + 2, 0.75, cz + 1), scale: 1.5 },
      { path: `${GRAVE}/candle-multiple.glb`, pos: new THREE.Vector3(cx - 3, 0, cz - 2), scale: 1.2 },
      { path: `${GRAVE}/debris.glb`, pos: new THREE.Vector3(cx + 1, 0, cz + 3), scale: 1.0 },
      { path: `${GRAVE}/debris-wood.glb`, pos: new THREE.Vector3(cx - 2, 0, cz + 5), scale: 1.0 },
    ],
  };
}

// ── Main loader: places all furniture into the level ──

export async function loadFurnitureForLevel(
  root: THREE.Group,
  obstacles: AABBObstacle[],
  roomCenters: Map<string, THREE.Vector3>,
) {
  const plans: Array<{ name: string; plan: RoomFurniturePlan }> = [];

  // Room dimensions (approximate)
  const roomW = 9;  // X extent of side rooms
  const roomD = 5;  // Z extent of side rooms

  for (const [name, center] of roomCenters.entries()) {
    if (name === 'Коридор' || name === 'Велика Ігрова') continue;
    plans.push({ name, plan: makeRoomPlan(name, center.x, center.z, roomW, roomD) });
  }

  // Horror props in corridor
  plans.push({ name: 'horror', plan: makeHorrorProps(0, 0) });

  // Load all models in parallel per room
  for (const { plan } of plans) {
    const promises = plan.models.map(async (item) => {
      const model = await loadModel(item.path);
      if (model.children.length === 0) return; // failed to load
      placeModel(model, root, item.pos, item.rotY ?? 0, item.scale ?? 1);
      if (item.obstacle) {
        obstacles.push(aabbFromObject(model));
      }
    });
    await Promise.all(promises);
  }
}
