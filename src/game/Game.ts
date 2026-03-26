import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Hud } from './ui/Hud';
import { InputSystem } from './systems/InputSystem';
import { PlayerController } from './systems/PlayerController';
import { EnemyController } from './systems/EnemyController';
import { WatchSystem } from './systems/WatchSystem';
import { loadLevel, type Level } from './level/loadLevel';
import { kitbashKenneyKindergarten } from './level/kitbashKenney';
import { loadFurnitureForLevel, loadMonsterModel } from './level/modelLoader';
import { AudioSystem } from './audio/AudioSystem';

export type GameState = 'MainMenu' | 'Playing' | 'GameOver' | 'Win';

export class Game {
  private readonly rootEl: HTMLElement;
  private readonly hud: Hud;
  private readonly audio: AudioSystem;
  private readonly input: InputSystem;

  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;

  private readonly clock = new THREE.Clock();
  private rafId: number | null = null;

  private composer: EffectComposer | null = null;

  private state: GameState = 'MainMenu';

  private playerRig = new THREE.Object3D();
  private playerYaw = new THREE.Object3D();
  private playerPitch = new THREE.Object3D();

  private level: Level | null = null;
  private player: PlayerController | null = null;
  private enemy: EnemyController | null = null;
  private watch: WatchSystem | null = null;

  private gameOverAtMs = 0;
  private hasKey = false;
  private doorOpen = false;
  private doorMessageCooldown = 0;
  private currentLevel: 'default' | 'kenney' = 'default';

  // Generation counter to cancel stale async work
  private loadGeneration = 0;

  // Previous player position for speed calculation
  private prevPlayerPos = new THREE.Vector3();

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.6;
    this.rootEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080810, 0.04);
    this.scene.background = new THREE.Color(0x010102);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 50);

    this.playerPitch.add(this.camera);
    this.playerYaw.add(this.playerPitch);
    this.playerRig.add(this.playerYaw);
    this.scene.add(this.playerRig);

    const deviceDpr = window.devicePixelRatio || 1;
    const enablePost = deviceDpr <= 1.6;
    if (enablePost) {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));

      const HorrorShader = {
        uniforms: {
          tDiffuse: { value: null },
          darkness: { value: 0.75 },
          time: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float darkness;
          uniform float time;
          varying vec2 vUv;
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            vec2 p = vUv * 2.0 - 1.0;
            float r2 = dot(p, p);
            float vig = smoothstep(0.4, 1.6, r2);
            color.rgb *= (1.0 - vig * darkness);
            float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            if (lum < 0.15) {
              color.rgb = mix(color.rgb, vec3(lum * 0.6, lum * 0.8, lum * 0.7), 0.3);
            }
            float grain = fract(sin(dot(vUv + time * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
            color.rgb += (grain - 0.5) * 0.04;
            gl_FragColor = color;
          }
        `,
      };

      const horrorPass = new ShaderPass(HorrorShader);
      composer.addPass(horrorPass);
      this.composer = composer;
    }

    this.hud = new Hud(rootEl);
    this.audio = new AudioSystem();
    this.input = new InputSystem(rootEl);

    this.hud.onStart((level) => {
      this.startGame(level).catch((err) => {
        console.error(err);
        this.hud.showError(err instanceof Error ? err.message : String(err));
      });
    });
    this.hud.onRestart(() => {
      this.startGame(this.currentLevel).catch((err) => {
        console.error(err);
        this.hud.showError(err instanceof Error ? err.message : String(err));
      });
    });
    this.hud.onSkipJumpscare(() => {
      if (this.state === 'GameOver') {
        this.setState('MainMenu');
      }
    });
  }

  public start() {
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.hud.showMainMenu();
    this.audio.startAmbience();

    this.rafId = window.requestAnimationFrame(() => this.frame());
  }

  private setState(next: GameState) {
    this.state = next;

    if (next === 'Playing') {
      this.audio.setAmbienceEnabled(true);
    } else {
      this.audio.setAmbienceEnabled(false);
      this.audio.stopMusic();
    }

    if (next === 'MainMenu') {
      this.hud.showMainMenu();
      this.watch?.hide();
    }
    if (next === 'Playing') {
      this.hud.showPlaying();
      this.watch?.show();
    }
    if (next === 'GameOver') {
      this.hud.showGameOver();
      this.watch?.hide();
    }
    if (next === 'Win') {
      this.hud.showWin();
      this.watch?.hide();
    }
  }

  private async startGame(levelType: 'default' | 'kenney' = 'default') {
    this.currentLevel = levelType;

    // Increment generation to invalidate any pending async work
    this.loadGeneration++;
    const gen = this.loadGeneration;

    // Clean up previous level — dispose GPU resources
    if (this.level) {
      this.disposeLevel(this.level);
    }
    if (this.watch) this.watch.dispose();
    this.audio.stopAll();

    this.level = loadLevel(this.scene);

    if (levelType === 'kenney') {
      await kitbashKenneyKindergarten(this.level.root, this.level);
    }

    // Load 3D models (async, non-blocking) with generation guard
    this.loadModels(gen);

    this.playerRig.position.copy(this.level.spawn);
    this.playerRig.position.y = this.level.playerHeight;
    this.prevPlayerPos.copy(this.playerRig.position);

    this.player = new PlayerController({
      rig: this.playerRig,
      radius: 0.35,
      speed: 3.8,
      camera: this.camera,
      getYawPitch: () => ({
        yaw: this.input.getYaw(),
        pitch: this.input.getPitch(),
      }),
      getMoveVector: () => this.input.getMoveVector(),
      obstacles: this.level.obstacles,
    });

    this.enemy = new EnemyController({
      rig: this.level.enemyRig,
      target: () => this.player?.getPosition() ?? new THREE.Vector3(),
      obstacles: this.level.obstacles,
      chaseSpeed: 2.3,
      catchDistance: 0.55,
      catchGraceMs: 750,
      onCaught: () => this.onCaught(),
      patrolPoints: this.level.patrolPoints,
    });

    this.watch = new WatchSystem({
      camera: this.camera,
      getEnemyPos: () => this.level!.enemyRig.position.clone(),
      getPlayerPos: () => this.player?.getPosition() ?? new THREE.Vector3(),
      getPlayerYaw: () => this.input.getYaw(),
      exitPos: this.level.exit,
      roomCenters: this.level.roomCenters,
      getAudioCtx: () => this.audio.getContext(),
      rootEl: this.rootEl,
    });

    this.input.reset(this.level.playerSpawn);
    this.audio.startEncounter();
    this.audio.startMusic();

    this.gameOverAtMs = 0;
    this.hasKey = false;
    this.doorOpen = false;
    this.doorMessageCooldown = 0;
    this.hud.setKeyStatus(false);
    this.input.setEnabled(true);
    this.setState('Playing');
  }

  private disposeLevel(level: Level) {
    this.scene.remove(level.root);
    level.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (mat && typeof mat.dispose === 'function') {
            // Dispose textures
            for (const key of Object.keys(mat)) {
              const val = (mat as any)[key];
              if (val instanceof THREE.Texture) val.dispose();
            }
            mat.dispose();
          }
        }
      }
    });
  }

  private async loadModels(gen: number) {
    if (!this.level) return;
    const levelRef = this.level;

    await loadFurnitureForLevel(levelRef.root, levelRef.obstacles, levelRef.roomCenters);

    // Check if game was restarted during loading
    if (this.loadGeneration !== gen) return;

    const monsterModel = await loadMonsterModel();

    if (this.loadGeneration !== gen) return;

    if (monsterModel.children.length > 0) {
      const enemyBody = levelRef.enemyRig.getObjectByName('enemyBody');
      if (enemyBody) {
        monsterModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            // Clone material to avoid mutating cached originals
            mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat.color) {
              mat.color.multiplyScalar(0.3);
              mat.emissive = new THREE.Color(0x200000);
              mat.emissiveIntensity = 1.5;
            }
            mesh.castShadow = true;
          }
        });
        monsterModel.scale.setScalar(1.5);
        monsterModel.position.copy(enemyBody.position);
        monsterModel.name = 'loadedMonster';
        levelRef.enemyRig.remove(enemyBody);
        levelRef.enemyRig.add(monsterModel);
      }
    }
  }

  private onCaught() {
    if (this.state !== 'Playing') return;

    this.gameOverAtMs = performance.now();
    this.setState('GameOver');
    this.hud.triggerJumpscare();
    this.audio.playScare();
    this.input.setEnabled(false);
  }

  private resize() {
    const w = this.rootEl.clientWidth;
    const h = this.rootEl.clientHeight;

    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    // Camera look
    this.playerYaw.rotation.y = this.input.getYaw();
    this.playerPitch.rotation.x = this.input.getPitch();

    if (this.state === 'Playing' && this.level && this.player && this.enemy) {
      this.input.update(dt);
      this.player.update(dt);
      this.enemy.update(dt);

      const currentPos = this.player.getPosition();
      const moveSpeed = currentPos.distanceTo(this.prevPlayerPos) / Math.max(dt, 0.001);
      this.prevPlayerPos.copy(currentPos);
      this.audio.updateFootsteps(dt, moveSpeed);

      const distToEnemy = currentPos.distanceTo(this.level.enemyRig.position);
      this.audio.updateMonsterBreathing(distToEnemy);
      this.audio.updateMusicTension(distToEnemy);

      // Key pickup
      if (!this.hasKey && this.level.keyObj.visible) {
        const distToKey = currentPos.distanceTo(this.level.keyPos);
        if (distToKey < 1.2) {
          this.hasKey = true;
          this.level.keyObj.visible = false;
          this.hud.setKeyStatus(true);
          this.hud.showMessage('Ключ знайдено!', 2000);
          this.audio.playPickup();
        }
      }

      // Door unlock
      if (this.hasKey && !this.doorOpen) {
        const distToDoor = currentPos.distanceTo(this.level.doorPos);
        if (distToDoor < 1.8) {
          this.doorOpen = true;
          const idx = this.level.obstacles.indexOf(this.level.doorObstacle);
          if (idx !== -1) this.level.obstacles.splice(idx, 1);
          this.level.doorObj.visible = false;
          this.hud.showMessage('Двері відчинено!', 2000);
          this.audio.playDoorCreak();
        }
      }

      // Locked door message — debounced
      if (!this.hasKey && !this.doorOpen) {
        this.doorMessageCooldown -= dt;
        const distToDoor = currentPos.distanceTo(this.level.doorPos);
        if (distToDoor < 1.5 && this.doorMessageCooldown <= 0) {
          this.hud.showMessage('Замкнено. Потрібен ключ.', 1500);
          this.doorMessageCooldown = 2.0; // show at most every 2 seconds
        }
      }

      this.watch?.update(dt, this.hasKey, this.doorOpen);

      // Exit trigger
      const distToExit = currentPos.distanceTo(this.level.exit);
      if (distToExit < 0.9 && this.doorOpen) {
        this.setState('Win');
        this.hud.triggerEscapeEffect();
        this.audio.playWin();
        this.input.setEnabled(false);
      }
    } else {
      this.input.update(dt);
    }

    // Enemy procedural animation — look up parts by name
    if (this.level) {
      const body = this.level.enemyRig.getObjectByName('enemyBody');
      if (body) {
        const state = this.enemy?.getState() ?? 'patrol';
        const speed = state === 'chase' ? 8 : state === 'search' ? 5 : 3;
        const amplitude = state === 'chase' ? 0.6 : state === 'search' ? 0.4 : 0.25;
        const phase = t * speed;

        const leftArm = body.getObjectByName('leftArmPivot');
        const rightArm = body.getObjectByName('rightArmPivot');
        const leftLeg = body.getObjectByName('leftLegPivot');
        const rightLeg = body.getObjectByName('rightLegPivot');
        const head = body.getObjectByName('enemyHead');
        const torso = body.getObjectByName('enemyTorso');

        if (leftArm) leftArm.rotation.x = Math.sin(phase) * amplitude;
        if (rightArm) rightArm.rotation.x = -Math.sin(phase) * amplitude;
        if (leftLeg) leftLeg.rotation.x = -Math.sin(phase) * amplitude * 0.8;
        if (rightLeg) rightLeg.rotation.x = Math.sin(phase) * amplitude * 0.8;
        if (head) head.position.y = 1.6 + Math.abs(Math.sin(phase * 2)) * 0.02;
        if (torso) torso.rotation.x = Math.sin(phase) * 0.03;
      }
    }

    // Flicker room lights
    if (this.level) {
      const now = performance.now() * 0.001;
      for (const fl of this.level.flickerLights) {
        const slow = Math.sin(now * 1.3 + fl.phase) * 0.15;
        const med = Math.sin(now * 4.7 + fl.phase * 3) * 0.1;
        const fast = Math.sin(now * 17 + fl.phase * 7) * 0.08;
        const dip = Math.sin(now * 0.4 + fl.phase * 2) > 0.92 ? -0.5 : 0;
        fl.light.intensity = fl.baseIntensity * Math.max(0.15, 1 + slow + med + fast + dip);
      }
    }

    if (this.composer) {
      const passes = (this.composer as any).passes;
      if (passes && passes.length > 1 && passes[1].uniforms?.time) {
        passes[1].uniforms.time.value = t;
      }
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.rafId = window.requestAnimationFrame(() => this.frame());

    if (this.state === 'GameOver') {
      if (performance.now() - this.gameOverAtMs > 2200) {
        this.setState('MainMenu');
        this.input.setEnabled(false);
      }
    }
  }
}
