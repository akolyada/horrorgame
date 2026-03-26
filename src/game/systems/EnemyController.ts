import * as THREE from 'three';
import type { AABBObstacle } from './PlayerController';

type EnemyState = 'patrol' | 'search' | 'chase';

type EnemyControllerProps = {
  rig: THREE.Object3D;
  target: () => THREE.Vector3;
  obstacles: AABBObstacle[];
  chaseSpeed: number;
  catchDistance: number;
  catchGraceMs: number;
  onCaught: () => void;
  patrolPoints: THREE.Vector3[];
};

export class EnemyController {
  private readonly rig: THREE.Object3D;
  private readonly target: () => THREE.Vector3;
  private readonly obstacles: AABBObstacle[];

  private readonly chaseSpeed: number;
  private readonly patrolSpeed: number;
  private readonly searchSpeed: number;
  private readonly catchDistance: number;
  private readonly catchGraceMs: number;
  private readonly onCaught: () => void;

  private catchAccumMs = 0;
  private readonly radius = 0.38;

  // AI state
  private state: EnemyState = 'patrol';
  private readonly patrolPoints: THREE.Vector3[];
  private patrolIndex = 0;
  private patrolWaitTimer = 0;
  private readonly patrolWaitDuration = 2.0; // seconds to pause at each point

  // Detection
  private readonly detectRange = 10;    // distance to start chasing
  private readonly loseRange = 16;      // distance to lose player and go to search
  private readonly hearRange = 6;       // always detect within this range (hearing)

  // Search state
  private searchTimer = 0;
  private readonly searchDuration = 6;  // seconds to search before returning to patrol
  private lastKnownPlayerPos = new THREE.Vector3();
  private searchWanderTimer = 0;
  private searchWanderDir = new THREE.Vector3();

  // Stun
  private stunTimer = 0;

  constructor(props: EnemyControllerProps) {
    this.rig = props.rig;
    this.target = props.target;
    this.obstacles = props.obstacles;
    this.chaseSpeed = props.chaseSpeed;
    this.patrolSpeed = props.chaseSpeed * 0.4;
    this.searchSpeed = props.chaseSpeed * 0.6;
    this.catchDistance = props.catchDistance;
    this.catchGraceMs = props.catchGraceMs;
    this.onCaught = props.onCaught;
    this.patrolPoints = props.patrolPoints.length > 0
      ? props.patrolPoints
      : [props.rig.position.clone()];
  }

  public getState(): EnemyState {
    return this.state;
  }

  public stun(duration: number) {
    this.stunTimer = duration;
  }

  public update(dt: number) {
    // Stunned — skip all AI
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this.catchAccumMs = 0;
      return;
    }

    const enemyPos = this.rig.position.clone();
    const playerPos = this.target();
    const toPlayer = playerPos.clone().sub(enemyPos);
    toPlayer.y = 0;
    const dist = toPlayer.length();

    // Catch logic (any state)
    if (dist < this.catchDistance) {
      this.catchAccumMs += dt * 1000;
      if (this.catchAccumMs >= this.catchGraceMs) this.onCaught();
    } else {
      this.catchAccumMs = 0;
    }

    // State transitions
    switch (this.state) {
      case 'patrol':
        if (dist < this.hearRange || (dist < this.detectRange && this.hasLineOfSight(enemyPos, playerPos))) {
          this.state = 'chase';
        }
        break;
      case 'chase':
        if (dist > this.loseRange) {
          this.state = 'search';
          this.searchTimer = 0;
          this.lastKnownPlayerPos.copy(playerPos);
          this.searchWanderTimer = 0;
        }
        break;
      case 'search':
        if (dist < this.hearRange || (dist < this.detectRange && this.hasLineOfSight(enemyPos, playerPos))) {
          this.state = 'chase';
        } else {
          this.searchTimer += dt;
          if (this.searchTimer >= this.searchDuration) {
            this.state = 'patrol';
            this.findNearestPatrolPoint(enemyPos);
          }
        }
        break;
    }

    // Movement by state
    switch (this.state) {
      case 'patrol':
        this.updatePatrol(dt, enemyPos);
        break;
      case 'chase':
        this.moveToward(playerPos, this.chaseSpeed, dt, enemyPos);
        this.facePosition(playerPos);
        break;
      case 'search':
        this.updateSearch(dt, enemyPos);
        break;
    }

    // Keep enemy on ground plane
  }

  private updatePatrol(dt: number, enemyPos: THREE.Vector3) {
    const target = this.patrolPoints[this.patrolIndex];
    const toTarget = target.clone().sub(enemyPos);
    toTarget.y = 0;
    const dist = toTarget.length();

    if (dist < 0.8) {
      // Wait at patrol point
      this.patrolWaitTimer += dt;
      if (this.patrolWaitTimer >= this.patrolWaitDuration) {
        this.patrolWaitTimer = 0;
        this.patrolIndex = (this.patrolIndex + 1) % this.patrolPoints.length;
      }
      return;
    }

    this.moveToward(target, this.patrolSpeed, dt, enemyPos);
    this.facePosition(target);
  }

  private updateSearch(dt: number, enemyPos: THREE.Vector3) {
    // Move toward last known player position first
    const toLastKnown = this.lastKnownPlayerPos.clone().sub(enemyPos);
    toLastKnown.y = 0;

    if (toLastKnown.length() > 1.5) {
      this.moveToward(this.lastKnownPlayerPos, this.searchSpeed, dt, enemyPos);
      this.facePosition(this.lastKnownPlayerPos);
    } else {
      // Wander randomly around search area
      this.searchWanderTimer -= dt;
      if (this.searchWanderTimer <= 0) {
        this.searchWanderTimer = 1.5 + Math.random() * 2;
        const angle = Math.random() * Math.PI * 2;
        this.searchWanderDir.set(Math.sin(angle), 0, Math.cos(angle));
      }
      const wanderTarget = enemyPos.clone().add(this.searchWanderDir.clone().multiplyScalar(3));
      this.moveToward(wanderTarget, this.searchSpeed * 0.7, dt, enemyPos);
      this.facePosition(wanderTarget);
    }
  }

  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    // Simple raycast check against obstacles (2D, XZ plane)
    const dir = to.clone().sub(from);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 1e-6) return true;
    dir.multiplyScalar(1 / dist);

    const steps = Math.ceil(dist / 0.5);
    const step = dist / steps;
    const probe = from.clone();

    for (let i = 1; i < steps; i++) {
      probe.addScaledVector(dir, step);
      for (const box of this.obstacles) {
        if (probe.x > box.min.x && probe.x < box.max.x &&
            probe.z > box.min.z && probe.z < box.max.z &&
            probe.y > box.min.y && probe.y < box.max.y) {
          return false;
        }
      }
    }
    return true;
  }

  private moveToward(target: THREE.Vector3, speed: number, dt: number, enemyPos: THREE.Vector3) {
    const dir = target.clone().sub(enemyPos);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 1e-6) return;
    dir.multiplyScalar(1 / dist);

    const moveForward = dir.clone().multiplyScalar(speed * dt);
    const forwardNext = enemyPos.clone().add(moveForward);

    if (!this.wouldCollide(forwardNext)) {
      this.rig.position.copy(forwardNext);
    } else {
      const leftDir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 0.35);
      const rightDir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.35);

      const leftNext = enemyPos.clone().add(leftDir.multiplyScalar(speed * dt));
      if (!this.wouldCollide(leftNext)) {
        this.rig.position.copy(leftNext);
      } else {
        const rightNext = enemyPos.clone().add(rightDir.multiplyScalar(speed * dt));
        if (!this.wouldCollide(rightNext)) this.rig.position.copy(rightNext);
      }
    }
  }

  private facePosition(target: THREE.Vector3) {
    const face = target.clone().sub(this.rig.position);
    face.y = 0;
    if (face.lengthSq() > 1e-6) {
      this.rig.rotation.y = Math.atan2(face.x, -face.z);
    }
  }

  private findNearestPatrolPoint(pos: THREE.Vector3) {
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < this.patrolPoints.length; i++) {
      const d = pos.distanceTo(this.patrolPoints[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    this.patrolIndex = bestIdx;
  }

  private wouldCollide(nextPos: THREE.Vector3): boolean {
    for (const box of this.obstacles) {
      const closest = new THREE.Vector3(
        THREE.MathUtils.clamp(nextPos.x, box.min.x, box.max.x),
        THREE.MathUtils.clamp(nextPos.y, box.min.y, box.max.y),
        THREE.MathUtils.clamp(nextPos.z, box.min.z, box.max.z),
      );
      const d2 = closest.distanceToSquared(nextPos);
      if (d2 < this.radius * this.radius) return true;
    }
    return false;
  }
}
