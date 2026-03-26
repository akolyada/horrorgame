import * as THREE from 'three';

const PARTICLE_COUNT = 200;
const BOX_X = 6;
const BOX_Y = 3;
const BOX_Z = 6;

export class DustParticles {
  private readonly points: THREE.Points;
  private readonly velocities: Float32Array;
  private readonly phases: Float32Array;

  constructor(scene: THREE.Scene) {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    this.velocities = new Float32Array(PARTICLE_COUNT * 3);
    this.phases = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * BOX_X;
      positions[i * 3 + 1] = Math.random() * BOX_Y;
      positions[i * 3 + 2] = (Math.random() - 0.5) * BOX_Z;

      this.velocities[i * 3]     = (Math.random() - 0.5) * 0.04;
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.04;

      this.phases[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xccbbaa,
      size: 0.015,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.points.position.copy(playerPos);
    this.points.position.y = 0;

    const posAttr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const t = performance.now() * 0.001;

    const halfX = BOX_X / 2;
    const halfZ = BOX_Z / 2;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      // Drift with slight sine wobble
      const wobble = Math.sin(t * 0.7 + this.phases[i]) * 0.01;
      positions[i3]     += (this.velocities[i3]     + wobble) * dt * 60;
      positions[i3 + 1] += this.velocities[i3 + 1] * dt * 60;
      positions[i3 + 2] += (this.velocities[i3 + 2] + wobble * 0.7) * dt * 60;

      // Wrap around the box
      if (positions[i3]     >  halfX) positions[i3]     -= BOX_X;
      if (positions[i3]     < -halfX) positions[i3]     += BOX_X;
      if (positions[i3 + 1] >  BOX_Y) positions[i3 + 1] -= BOX_Y;
      if (positions[i3 + 1] <  0)     positions[i3 + 1] += BOX_Y;
      if (positions[i3 + 2] >  halfZ) positions[i3 + 2] -= BOX_Z;
      if (positions[i3 + 2] < -halfZ) positions[i3 + 2] += BOX_Z;
    }

    posAttr.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.PointsMaterial).dispose();
    this.points.parent?.remove(this.points);
  }
}
