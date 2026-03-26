import * as THREE from 'three';

/**
 * Годинник-помічник (Helper Watch)
 *
 * A toy children's watch that:
 * 1. Provides a weak flashlight (SpotLight on camera)
 * 2. Beeps when monsters are nearby (faster = closer)
 * 3. Shows navigation hints (text on screen)
 */

type WatchConfig = {
  camera: THREE.Camera;
  getEnemyPos: () => THREE.Vector3;
  getPlayerPos: () => THREE.Vector3;
  getPlayerYaw: () => number;
  exitPos: THREE.Vector3;
  roomCenters: Map<string, THREE.Vector3>;
  getAudioCtx: () => AudioContext | null;
  rootEl: HTMLElement;
};

export class WatchSystem {
  private readonly camera: THREE.Camera;
  private readonly getEnemyPos: () => THREE.Vector3;
  private readonly getPlayerPos: () => THREE.Vector3;
  private readonly getPlayerYaw: () => number;
  private readonly exitPos: THREE.Vector3;
  private readonly roomCenters: Map<string, THREE.Vector3>;
  private readonly getAudioCtx: () => AudioContext | null;

  // Flashlight
  private readonly flashlight: THREE.SpotLight;
  private readonly flashlightTarget: THREE.Object3D;

  // Beep state
  private beepInterval = 0;
  private timeSinceBeep = 0;

  // UI elements
  private readonly watchEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly proximityEl: HTMLDivElement;
  private readonly proximityDots: HTMLDivElement[] = [];

  // Navigation
  private currentHint = '';
  private hintTimer = 0;

  constructor(config: WatchConfig) {
    this.camera = config.camera;
    this.getEnemyPos = config.getEnemyPos;
    this.getPlayerPos = config.getPlayerPos;
    this.getPlayerYaw = config.getPlayerYaw;
    this.exitPos = config.exitPos;
    this.roomCenters = config.roomCenters;
    this.getAudioCtx = config.getAudioCtx;

    // ── Flashlight setup ──
    this.flashlight = new THREE.SpotLight(0xeeddaa, 7.0, 20, Math.PI * 0.2, 0.4, 1.2);
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    this.flashlight.castShadow = true;
    const shadowRes = isMobile ? 512 : 1024;
    this.flashlight.shadow.mapSize.width = shadowRes;
    this.flashlight.shadow.mapSize.height = shadowRes;
    this.flashlight.shadow.camera.near = 0.1;
    this.flashlight.shadow.camera.far = 12;
    this.flashlight.shadow.bias = -0.001;

    this.flashlightTarget = new THREE.Object3D();
    this.flashlightTarget.position.set(0, 0, -1);
    this.camera.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;

    this.flashlight.position.set(0.15, -0.15, 0);
    this.camera.add(this.flashlight);

    // ── UI setup — append to game root, not document.body ──
    this.watchEl = document.createElement('div');
    this.watchEl.className = 'watch-ui';

    this.proximityEl = document.createElement('div');
    this.proximityEl.className = 'watch-proximity';
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('div');
      dot.className = 'watch-dot';
      this.proximityDots.push(dot);
      this.proximityEl.appendChild(dot);
    }
    this.watchEl.appendChild(this.proximityEl);

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'watch-hint';
    this.watchEl.appendChild(this.hintEl);

    config.rootEl.appendChild(this.watchEl);
  }

  private hasKey = false;
  private doorOpen = false;

  public update(dt: number, hasKey?: boolean, doorOpen?: boolean, moveSpeed?: number) {
    if (hasKey !== undefined) this.hasKey = hasKey;
    if (doorOpen !== undefined) this.doorOpen = doorOpen;
    const playerPos = this.getPlayerPos();
    const enemyPos = this.getEnemyPos();

    // ── Monster proximity ──
    const distToEnemy = playerPos.distanceTo(enemyPos);
    const maxDetectRange = 15;
    const proximity = Math.max(0, 1 - distToEnemy / maxDetectRange);

    const activeDots = Math.round(proximity * 5);
    for (let i = 0; i < 5; i++) {
      if (i < activeDots) {
        this.proximityDots[i].classList.add('active');
        const t = i / 4;
        const r = 255;
        const g = Math.round(255 * (1 - t));
        this.proximityDots[i].style.background = `rgb(${r},${g},0)`;
      } else {
        this.proximityDots[i].classList.remove('active');
        this.proximityDots[i].style.background = '';
      }
    }

    if (proximity > 0.05) {
      this.beepInterval = 2.0 - proximity * 1.85;
      this.timeSinceBeep += dt;

      if (this.timeSinceBeep >= this.beepInterval) {
        this.timeSinceBeep = 0;
        this.playBeep(proximity);
      }
    } else {
      this.timeSinceBeep = 0;
      this.beepInterval = 0;
    }

    // ── Navigation hints ──
    this.hintTimer += dt;
    if (this.hintTimer > 15) {
      this.hintTimer = 0;
      this.updateNavigationHint(playerPos);
    }

    // Flashlight flicker
    const now = performance.now() * 0.001;
    const flicker = 1.0 + Math.sin(now * 3.0) * 0.05
      + Math.sin(now * 17.0) * 0.08;
    this.flashlight.intensity = 5.0 * Math.max(0.7, flicker);

    // Flashlight sway — amplified when walking
    const swayMul = (moveSpeed ?? 0) > 0.5 ? 3.0 : 1.0;
    const swayX = (Math.sin(now * 1.1) * 0.008 + Math.sin(now * 2.7) * 0.004) * swayMul;
    const swayY = (Math.sin(now * 0.9) * 0.006 + Math.cos(now * 2.3) * 0.003) * swayMul;
    this.flashlightTarget.position.set(swayX, swayY, -1);
  }

  private updateNavigationHint(playerPos: THREE.Vector3) {
    const distToExit = playerPos.distanceTo(this.exitPos);

    if (this.hasKey && distToExit < 3) {
      this.setHint('Вихід поруч!');
      return;
    }

    if (!this.hasKey) {
      const hints = [
        'Знайди ключ...',
        'Ключ десь у кімнатах...',
        'Шукай ключ від дверей...',
      ];
      this.setHint(hints[Math.floor(Math.random() * hints.length)]);
      return;
    }

    if (!this.doorOpen) {
      const hints = [
        'Відкрий замкнені двері...',
        'Знайди замкнену кімнату...',
      ];
      this.setHint(hints[Math.floor(Math.random() * hints.length)]);
      return;
    }

    // Door open — guide to exit using camera-relative direction
    const toExit = this.exitPos.clone().sub(playerPos);
    toExit.y = 0;

    // Compute angle relative to player's camera facing direction
    const yaw = this.getPlayerYaw();
    const worldAngle = Math.atan2(toExit.x, -toExit.z);
    let relAngle = worldAngle - yaw;
    // Normalize to [-PI, PI]
    while (relAngle > Math.PI) relAngle -= Math.PI * 2;
    while (relAngle < -Math.PI) relAngle += Math.PI * 2;

    let dirHint = '';
    if (Math.abs(relAngle) < Math.PI / 4) dirHint = 'прямо';
    else if (relAngle > Math.PI / 4 && relAngle < 3 * Math.PI / 4) dirHint = 'праворуч';
    else if (relAngle < -Math.PI / 4 && relAngle > -3 * Math.PI / 4) dirHint = 'ліворуч';
    else dirHint = 'назад';

    const hints = [
      `Вихід — ${dirHint}...`,
      `Тікай ${dirHint}!`,
    ];
    this.setHint(hints[Math.floor(Math.random() * hints.length)]);
  }

  private setHint(text: string) {
    if (text === this.currentHint) return;
    this.currentHint = text;
    this.hintEl.textContent = text;
    this.hintEl.style.opacity = '0';
    requestAnimationFrame(() => {
      this.hintEl.style.opacity = '1';
    });
  }

  private playBeep(proximity: number) {
    const ctx = this.getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;

    const freq = 800 + proximity * 1200;
    const duration = 0.04 + (1 - proximity) * 0.06;
    const volume = 0.08 + proximity * 0.15;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  public show() {
    this.watchEl.style.display = 'block';
  }

  public hide() {
    this.watchEl.style.display = 'none';
    this.hintEl.textContent = '';
    this.currentHint = '';
  }

  public dispose() {
    this.camera.remove(this.flashlight);
    this.camera.remove(this.flashlightTarget);
    this.watchEl.remove();
  }
}
