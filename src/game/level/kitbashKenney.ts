import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Level } from './loadLevel';
import type { AABBObstacle } from '../systems/PlayerController';

type AddObstacle = (min: THREE.Vector3, max: THREE.Vector3) => void;

function aabbFromWorldObject(obj: THREE.Object3D): { min: THREE.Vector3; max: THREE.Vector3 } {
  const box = new THREE.Box3().setFromObject(obj);
  return { min: box.min.clone(), max: box.max.clone() };
}

export async function kitbashKenneyKindergarten(root: THREE.Group, level: Level) {
  const loader = new GLTFLoader();

  const load = async (name: string) => {
    const url = `/assets/kenney_building-kit/Models/GLB format/${name}`;
    const gltf = await loader.loadAsync(url);
    return gltf.scene;
  };

  // Helper for placing pieces.
  const place = (obj: THREE.Object3D, pos: THREE.Vector3, rotY = 0, scale = 1) => {
    obj.position.copy(pos);
    obj.rotation.y = rotY;
    obj.scale.setScalar(scale);
    obj.updateMatrixWorld(true);
    root.add(obj);
    return obj;
  };

  // Clear any previous kitbash children (keep lights/etc that procedural level adds).
  // We'll just add on top for now.

  // Core pieces: floor + walls. (Kenney kit is stylized, but works as a school/kindergarten blockout.)
  const floorTile = await load('floor.glb');
  const wallTile = await load('wall.glb').catch(async () => load('wall-high.glb')); // fallback if naming differs

  // Some kits use different filenames; do a safer fallback for wall:
  const wall = wallTile ?? (await load('wall-high.glb'));

  // Layout units (tuned by eye; we’ll treat each tile as 1 unit grid for now).
  const tile = 2.0;
  const wallY = 1.2;

  // Build a corridor (length 6 tiles) with two side rooms.
  // Corridor centered along Z axis.
  for (let i = 0; i < 6; i++) {
    const z = -i * tile;
    place(floorTile.clone(), new THREE.Vector3(0, 0, z));
    place(floorTile.clone(), new THREE.Vector3(tile, 0, z));
    place(floorTile.clone(), new THREE.Vector3(-tile, 0, z));
  }

  // Walls: corridor sides
  for (let i = 0; i < 6; i++) {
    const z = -i * tile;
    // Left side
    place(wall.clone(), new THREE.Vector3(-tile * 1.5, wallY, z), Math.PI / 2);
    // Right side
    place(wall.clone(), new THREE.Vector3(tile * 1.5, wallY, z), -Math.PI / 2);
  }

  // End wall (dead end) and exit at the far end
  place(wall.clone(), new THREE.Vector3(0, wallY, -6 * tile), 0);
  level.exit.set(0, 0, -6 * tile + 0.6);
  level.exitMarker.position.set(level.exit.x, level.exitMarker.position.y, level.exit.z);

  // Simple “room” walls branching out (left room around z=-2 tiles, right room around z=-4 tiles)
  const room = async (side: 'left' | 'right', z0: number) => {
    const dir = side === 'left' ? -1 : 1;
    const xBase = dir * tile * 2.5;
    // Floor for room (2x2)
    place(floorTile.clone(), new THREE.Vector3(xBase, 0, z0));
    place(floorTile.clone(), new THREE.Vector3(xBase + dir * tile, 0, z0));
    place(floorTile.clone(), new THREE.Vector3(xBase, 0, z0 - tile));
    place(floorTile.clone(), new THREE.Vector3(xBase + dir * tile, 0, z0 - tile));
    // Outer walls
    place(wall.clone(), new THREE.Vector3(xBase + dir * tile, wallY, z0 - tile * 1.5), 0);
    place(wall.clone(), new THREE.Vector3(xBase + dir * tile * 1.5, wallY, z0 - tile), dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    place(wall.clone(), new THREE.Vector3(xBase + dir * tile * 1.5, wallY, z0), dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    place(wall.clone(), new THREE.Vector3(xBase, wallY, z0 + tile * 0.5), Math.PI);
  };

  await room('left', -2 * tile);
  await room('right', -4 * tile);

  // Spawns
  level.playerSpawn.set(0, level.playerHeight, 0.6);
  level.spawn.copy(level.playerSpawn);
  level.enemyRig.position.set(0.8, level.playerHeight, -2.5);

  // Collisions: generate obstacles from any mesh with "wall" in name OR from bounding boxes of placed wall clones.
  // For this kitbash, we treat all placed wall objects as obstacles.
  const newObs: AABBObstacle[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const n = obj.name.toLowerCase();
    if (n.includes('wall')) {
      const { min, max } = aabbFromWorldObject(obj);
      newObs.push({ min, max });
    }
  });

  // If names are empty (common in some GLBs), fall back: obstacle = any object that is a wall clone by material/geometry size.
  if (newObs.length === 0) {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const { min, max } = aabbFromWorldObject(obj);
      const size = new THREE.Vector3().subVectors(max, min);
      // Heuristic: thin large slabs are likely walls.
      const thin = Math.min(size.x, size.z) < 0.35;
      const tall = size.y > 1.2;
      if (thin && tall) newObs.push({ min, max });
    });
  }

  // Mutate in place so controllers keep the reference.
  level.obstacles.splice(0, level.obstacles.length, ...newObs);
}

