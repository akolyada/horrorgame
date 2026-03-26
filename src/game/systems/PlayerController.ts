import * as THREE from 'three';
import type { JoystickVector } from './InputSystem';

export type AABBObstacle = { min: THREE.Vector3; max: THREE.Vector3 };

type PlayerControllerProps = {
  rig: THREE.Object3D;
  radius: number;
  speed: number;
  camera: THREE.PerspectiveCamera;
  obstacles: AABBObstacle[];
  getMoveVector: () => JoystickVector;
  getYawPitch: () => { yaw: number; pitch: number };
};

export class PlayerController {
  private readonly rig: THREE.Object3D;
  private readonly radius: number;
  private readonly speed: number;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly obstacles: AABBObstacle[];

  private readonly getMoveVector: () => JoystickVector;
  private readonly getYawPitch: () => { yaw: number; pitch: number };

  constructor(props: PlayerControllerProps) {
    this.rig = props.rig;
    this.radius = props.radius;
    this.speed = props.speed;
    this.camera = props.camera;
    this.obstacles = props.obstacles;
    this.getMoveVector = props.getMoveVector;
    this.getYawPitch = props.getYawPitch;
  }

  public getPosition(): THREE.Vector3 {
    return this.rig.position.clone();
  }

  public update(dt: number) {
    const move = this.getMoveVector();

    // Always derive directions from the camera itself so movement remains correct
    // after touch-drag looking (avoids sign mismatches).
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const desired = new THREE.Vector3()
      // Convention: +move.y means "forward" (W key, joystick up).
      .addScaledVector(forward, move.y)
      .addScaledVector(right, move.x);

    const moveLen = desired.length();
    if (moveLen > 1e-6) desired.multiplyScalar((this.speed * dt) / moveLen);

    const next = this.rig.position.clone().add(desired);
    this.resolveCollisions(next);

    this.rig.position.copy(next);
  }

  private resolveCollisions(pos: THREE.Vector3) {
    // Very simple sphere-vs-AABB resolution: push the sphere out from any intersecting box.
    // (Good enough for beginner levels with axis-aligned walls.)
    for (let iter = 0; iter < 4; iter++) {
      let any = false;
      for (const box of this.obstacles) {
        const closest = this.closestPointOnAabb(pos, box);
        const delta = pos.clone().sub(closest);
        const d2 = delta.lengthSq();
        if (d2 < this.radius * this.radius) {
          any = true;
          const d = Math.sqrt(Math.max(1e-9, d2));
          // If center is exactly on the surface/inside, pick a stable push direction.
          const pushDir = d > 1e-6 ? delta.multiplyScalar(1 / d) : new THREE.Vector3(0, 0, 1);
          const penetration = this.radius - d;
          pos.addScaledVector(pushDir, penetration + 1e-3);
        }
      }
      if (!any) break;
    }
  }

  private closestPointOnAabb(p: THREE.Vector3, box: AABBObstacle) {
    return new THREE.Vector3(
      THREE.MathUtils.clamp(p.x, box.min.x, box.max.x),
      THREE.MathUtils.clamp(p.y, box.min.y, box.max.y),
      THREE.MathUtils.clamp(p.z, box.min.z, box.max.z),
    );
  }
}

