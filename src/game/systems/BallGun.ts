import * as THREE from 'three';
import type { AABBObstacle } from './PlayerController';

type FlyingBall = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
};

const BALL_SPEED = 18;
const GRAVITY = 9.8;
const MAX_AGE = 4; // seconds before ball is removed
const MAX_BALLS = 30;
const COOLDOWN = 0.25; // seconds between shots

const ballGeo = new THREE.SphereGeometry(0.08, 8, 8);
const ballColors = [0xff3333, 0x33ff33, 0x3333ff, 0xffff33, 0xff33ff, 0x33ffff, 0xff8800];
const ballMats = ballColors.map(c => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.3, metalness: 0.1, emissive: c, emissiveIntensity: 0.3,
}));

export class BallGun {
  private readonly scene: THREE.Object3D;
  private readonly camera: THREE.Camera;
  private readonly getAudioCtx: () => AudioContext | null;
  private readonly obstacles: AABBObstacle[];
  private balls: FlyingBall[] = [];
  private cooldown = 0;

  // Gun viewmodel (attached to camera)
  private readonly gunModel: THREE.Group;

  constructor(scene: THREE.Object3D, camera: THREE.Camera, getAudioCtx: () => AudioContext | null, obstacles: AABBObstacle[]) {
    this.scene = scene;
    this.camera = camera;
    this.getAudioCtx = getAudioCtx;
    this.obstacles = obstacles;

    // Simple gun model — barrel + handle
    this.gunModel = new THREE.Group();
    const gunMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.4, metalness: 0.3 });
    const gunDarkMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6, metalness: 0.5 });

    // Barrel (cylinder)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 8), gunDarkMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -0.12);
    this.gunModel.add(barrel);

    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.14), gunMat);
    body.position.set(0, -0.01, -0.02);
    this.gunModel.add(body);

    // Handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), gunDarkMat);
    handle.position.set(0, -0.05, 0.03);
    handle.rotation.x = 0.2;
    this.gunModel.add(handle);

    // Hopper (ball container on top)
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.06, 8), gunMat);
    hopper.position.set(0, 0.04, -0.02);
    this.gunModel.add(hopper);

    // Position in lower-right of camera view
    this.gunModel.position.set(0.22, -0.18, -0.35);
    this.gunModel.rotation.set(0, -0.05, 0);
    this.gunModel.visible = false;
    camera.add(this.gunModel);
  }

  public show() {
    this.gunModel.visible = true;
  }

  public hide() {
    this.gunModel.visible = false;
  }

  /**
   * @param ndcX normalized device X (-1..1), undefined = screen center
   * @param ndcY normalized device Y (-1..1), undefined = screen center
   */
  public shoot(ndcX?: number, ndcY?: number) {
    if (this.cooldown > 0) return;
    this.cooldown = COOLDOWN;

    // Shoot direction: if screen coords provided, unproject from click position
    const dir = new THREE.Vector3();
    if (ndcX !== undefined && ndcY !== undefined) {
      dir.set(ndcX, ndcY, 0.5).unproject(this.camera as THREE.PerspectiveCamera);
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      dir.sub(camPos).normalize();
    } else {
      this.camera.getWorldDirection(dir);
    }

    // Spawn position: slightly in front of camera
    const spawnPos = new THREE.Vector3();
    this.camera.getWorldPosition(spawnPos);
    spawnPos.addScaledVector(dir, 0.5);

    // Random ball color
    const mat = ballMats[Math.floor(Math.random() * ballMats.length)];
    const mesh = new THREE.Mesh(ballGeo, mat);
    mesh.position.copy(spawnPos);
    mesh.castShadow = true;
    this.scene.add(mesh);

    const velocity = dir.multiplyScalar(BALL_SPEED);
    this.balls.push({ mesh, velocity, age: 0 });

    // Remove oldest if too many
    while (this.balls.length > MAX_BALLS) {
      const old = this.balls.shift()!;
      this.scene.remove(old.mesh);
    }

    // Recoil animation
    this.gunModel.position.z = -0.32;
    this.gunModel.rotation.x = -0.15;

    this.playShootSound();
  }

  public update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Recoil recovery
    this.gunModel.position.z += (-0.35 - this.gunModel.position.z) * dt * 12;
    this.gunModel.rotation.x += (0 - this.gunModel.rotation.x) * dt * 10;

    // Update flying balls
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      ball.age += dt;

      // Gravity
      ball.velocity.y -= GRAVITY * dt;

      // Move
      const prevPos = ball.mesh.position.clone();
      ball.mesh.position.addScaledVector(ball.velocity, dt);

      // Bounce off floor
      if (ball.mesh.position.y < 0.08) {
        ball.mesh.position.y = 0.08;
        ball.velocity.y = Math.abs(ball.velocity.y) * 0.4;
        ball.velocity.x *= 0.7;
        ball.velocity.z *= 0.7;
      }

      // Bounce off obstacles (AABB)
      const r = 0.08;
      for (const box of this.obstacles) {
        const p = ball.mesh.position;
        // Check sphere-AABB overlap
        const cx = THREE.MathUtils.clamp(p.x, box.min.x, box.max.x);
        const cy = THREE.MathUtils.clamp(p.y, box.min.y, box.max.y);
        const cz = THREE.MathUtils.clamp(p.z, box.min.z, box.max.z);
        const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r) {
          // Determine dominant collision axis and reflect
          const pen = r - Math.sqrt(Math.max(d2, 1e-8));
          // Find which face we're closest to
          const fromMin = new THREE.Vector3(p.x - box.min.x, p.y - box.min.y, p.z - box.min.z);
          const fromMax = new THREE.Vector3(box.max.x - p.x, box.max.y - p.y, box.max.z - p.z);
          const minDists = [fromMin.x, fromMax.x, fromMin.y, fromMax.y, fromMin.z, fromMax.z];
          const minIdx = minDists.indexOf(Math.min(...minDists));
          const bounce = 0.35;

          if (minIdx < 2) { // X axis
            ball.velocity.x = -ball.velocity.x * bounce;
            p.x = prevPos.x;
          } else if (minIdx < 4) { // Y axis
            ball.velocity.y = -ball.velocity.y * bounce;
            p.y = prevPos.y;
          } else { // Z axis
            ball.velocity.z = -ball.velocity.z * bounce;
            p.z = prevPos.z;
          }
          break; // one collision per frame is enough
        }
      }

      // Remove old balls
      if (ball.age > MAX_AGE) {
        this.scene.remove(ball.mesh);
        this.balls.splice(i, 1);
      }
    }
  }

  /** Check if any recent ball hit the enemy (simple sphere check) */
  public checkHitEnemy(enemyPos: THREE.Vector3, hitRadius: number): boolean {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      if (ball.age > 2) continue; // only check recent balls
      const dist = ball.mesh.position.distanceTo(enemyPos);
      if (dist < hitRadius) {
        // Remove the ball on hit
        this.scene.remove(ball.mesh);
        this.balls.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  public dispose() {
    for (const ball of this.balls) {
      this.scene.remove(ball.mesh);
    }
    this.balls = [];
    this.camera.remove(this.gunModel);
  }

  private playShootSound() {
    const ctx = this.getAudioCtx();
    if (!ctx || ctx.state === 'suspended') return;
    const now = ctx.currentTime;

    // Pop/puff sound
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    // Noise burst for air puff
    const bufLen = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.2));
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 800;

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);

    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSrc.start(now);
  }
}
