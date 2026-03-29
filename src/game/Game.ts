import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Hud } from './ui/Hud';
import { InputSystem } from './systems/InputSystem';
import { PlayerController } from './systems/PlayerController';
import { EnemyController } from './systems/EnemyController';
import { WatchSystem } from './systems/WatchSystem';
import { loadLevel, type Level, type OpenableDoor } from './level/loadLevel';
import { AudioSystem } from './audio/AudioSystem';
import { DustParticles } from './systems/DustParticles';
import { BallGun } from './systems/BallGun';
import { Inventory } from './ui/Inventory';

export type GameState = 'MainMenu' | 'Playing' | 'GameOver' | 'Win';

export class Game {
  private readonly rootEl: HTMLElement;
  private readonly hud: Hud;
  private readonly audio: AudioSystem;
  private readonly input: InputSystem;
  private readonly inventory: Inventory;

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
  private dust: DustParticles | null = null;
  private ballGun: BallGun | null = null;
  private hasGun = false;
  private shootRequested = false;
  private shootNdc: { x: number; y: number } | null = null;

  private gameOverAtMs = 0;
  private hasKey = false;
  private doorOpen = false;
  private doorMessageCooldown = 0;
  private secretDoorOpen = false;
  private hasGenKey = false;
  private genDoorOpen = false;
  private stgDoorOpen = false;
  private labDoorOpen = false;
  private ventOpen = false;
  private hasYellowBulb = false;
  private hasBlueBulb = false;
  private yellowBulbInstalled = false;
  private blueBulbInstalled = false;
  private enteredGenRoom = false;
  private genDoorSealed = false;
  private prone = false;
  private proneTransition = 0; // 0 = standing, 1 = fully prone
  private noclip = false;
  private noclipBuffer = '';
  private noclipSpeed = 8;
  private damageFlash = 0;
  private enemyMixer: THREE.AnimationMixer | null = null;
  private enemyModelLoaded = false;
  private enemyMonsterMeshes: THREE.Mesh[] = [];
  private enemyBodyRef: THREE.Object3D | null = null;
  private enemyPartsCache: {
    leftArm?: THREE.Object3D;
    rightArm?: THREE.Object3D;
    leftLeg?: THREE.Object3D;
    rightLeg?: THREE.Object3D;
    head?: THREE.Object3D;
    torso?: THREE.Object3D;
    eLight?: THREE.PointLight;
  } = {};

  // Generation counter to cancel stale async work

  // Previous player position for speed calculation
  private prevPlayerPos = new THREE.Vector3();

  // Interaction system
  private interactTarget: 'key' | 'door' | 'gun' | 'openable-door' | 'gen-key' | 'gen-door' | 'yellow-bulb' | 'blue-bulb' | 'install-bulb' | 'stg-door' | 'lab-door' | 'vent' | null = null;
  private interactRequested = false;
  private interactOpenableDoor: OpenableDoor | null = null;

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl;

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    this.renderer = new THREE.WebGLRenderer({
      antialias: !isMobile,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = isMobile ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2.8;
    this.rootEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080810, 0.025);
    this.scene.background = new THREE.Color(0x010102);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 50);

    this.playerPitch.add(this.camera);
    this.playerYaw.add(this.playerPitch);
    this.playerRig.add(this.playerYaw);
    this.scene.add(this.playerRig);

    {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: isMobile ? THREE.UnsignedByteType : THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      const composer = new EffectComposer(this.renderer, renderTarget);
      composer.addPass(new RenderPass(this.scene, this.camera));

      const HorrorShader = {
        uniforms: {
          tDiffuse: { value: null },
          darkness: { value: 0.35 },
          time: { value: 0 },
          enemyProximity: { value: 0 },
          damageFlash: { value: 0 },
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
          uniform float enemyProximity;
          uniform float damageFlash;
          varying vec2 vUv;

          float hash(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
          }

          void main() {
            vec2 center = vUv - 0.5;
            float distFromCenter = length(center);

            // Chromatic aberration — stronger at edges, amplified by enemy proximity
            float caBase = 0.001;
            float caStrength = caBase + enemyProximity * 0.003;
            vec2 caOffset = center * distFromCenter * caStrength;
            float r = texture2D(tDiffuse, vUv + caOffset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - caOffset).b;
            vec3 color = vec3(r, g, b);

            // Scanline distortion when enemy is close
            if (enemyProximity > 0.5) {
              float scanline = sin(vUv.y * 200.0 + time * 8.0) * (enemyProximity - 0.5) * 0.006;
              vec2 distortedUv = vUv + vec2(scanline, 0.0);
              color = vec3(
                texture2D(tDiffuse, distortedUv + caOffset).r,
                texture2D(tDiffuse, distortedUv).g,
                texture2D(tDiffuse, distortedUv - caOffset).b
              );
            }

            // Desaturation for muted horror palette
            float lum = dot(color, vec3(0.299, 0.587, 0.114));
            color = mix(color, vec3(lum), 0.15);

            // Smooth blue/teal color grading in shadows
            vec3 shadowTint = vec3(lum * 0.65, lum * 0.78, lum * 0.74);
            float shadowMix = smoothstep(0.15, 0.0, lum) * 0.25;
            color = mix(color, shadowTint, shadowMix);

            // Vignette with softer falloff
            float r2 = dot(center * 1.6, center * 1.6);
            float vig = smoothstep(0.5, 2.0, r2);
            // Red vignette tint when enemy is near
            vec3 vigColor = mix(vec3(0.0), vec3(0.15, 0.0, 0.0), enemyProximity);
            color = mix(color, vigColor, vig * darkness);

            // Film grain — improved hash
            float grain = hash(vUv * 512.0 + time * 7.13);
            float grainStrength = 0.06 + enemyProximity * 0.04;
            color += (grain - 0.5) * grainStrength;

            // Damage flash — red overlay
            color = mix(color, vec3(0.6, 0.0, 0.0), damageFlash * 0.7);

            gl_FragColor = vec4(color, 1.0);
          }
        `,
      };

      if (!isMobile) {
        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(window.innerWidth, window.innerHeight),
          0.2,   // strength — very subtle
          0.4,   // radius
          1.2    // threshold — only very bright things bloom
        );
        composer.addPass(bloomPass);
      }

      const horrorPass = new ShaderPass(HorrorShader);
      composer.addPass(horrorPass);
      this.composer = composer;
    }

    this.hud = new Hud(rootEl);
    this.audio = new AudioSystem();
    this.input = new InputSystem(rootEl);
    this.inventory = new Inventory(rootEl);

    // When player selects inventory item
    this.inventory.onSelect((itemId) => {
      // Show/hide ball gun viewmodel based on selection
      if (itemId === 'gun' && this.ballGun) {
        this.ballGun.show();
      } else {
        this.ballGun?.hide();
      }
    });

    // Convert pointer event to NDC coords
    const pointerToNdc = (e: PointerEvent | MouseEvent): { x: number; y: number } => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
      };
    };

    // Interact on tap / 'E' key; Shoot on touch tap (when gun equipped + no interact target)
    window.addEventListener('pointerup', (e) => {
      if (this.state !== 'Playing') return;
      if (e.target instanceof HTMLElement && (e.target.closest('.panel') || e.target.closest('button') || e.target.closest('.joystickBase'))) return;
      if (this.interactTarget) {
        this.interactRequested = true;
      } else if (e.pointerType === 'touch' && this.hasGun && this.inventory.getActiveItemId() === 'gun') {
        this.shootRequested = true;
        this.shootNdc = pointerToNdc(e);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'Playing') return;
      if (e.code === 'KeyE' || e.code === 'KeyF') {
        this.interactRequested = true;
      }
      if (e.code === 'KeyZ') {
        this.prone = !this.prone;
      }
      // Number keys 1-5 select inventory slots (skip when keypad is open)
      const slotKey = parseInt(e.key);
      if (!this.hud.isKeypadVisible() && slotKey >= 1 && slotKey <= 5) {
        this.inventory.clickSlot(slotKey - 1);
      }
      // Secret noclip code: type "5152" during gameplay
      if (!this.hud.isKeypadVisible() && e.key >= '0' && e.key <= '9') {
        this.noclipBuffer += e.key;
        if (this.noclipBuffer.length > 4) this.noclipBuffer = this.noclipBuffer.slice(-4);
        if (this.noclipBuffer === '5152') {
          this.noclip = !this.noclip;
          this.noclipBuffer = '';
          this.hud.showMessage(this.noclip ? 'NOCLIP ON' : 'NOCLIP OFF', 2000);
        }
      } else if (!(e.key >= '0' && e.key <= '9')) {
        this.noclipBuffer = '';
      }
    });
    // Desktop: right mouse button fires gun
    window.addEventListener('mousedown', (e) => {
      if (this.state !== 'Playing' || !this.hasGun || e.button !== 2) return;
      if (this.inventory.getActiveItemId() !== 'gun') return;
      if (e.target instanceof HTMLElement && (e.target.closest('.panel') || e.target.closest('button'))) return;
      this.shootRequested = true;
      this.shootNdc = pointerToNdc(e);
    });

    this.hud.onStart(() => {
      this.startGame().catch((err) => {
        console.error(err);
        this.hud.showError(err instanceof Error ? err.message : String(err));
      });
    });
    this.hud.onRestart(() => {
      this.startGame().catch((err) => {
        console.error(err);
        this.hud.showError(err instanceof Error ? err.message : String(err));
      });
    });
    this.hud.onSkipJumpscare(() => {
      if (this.state === 'GameOver') {
        if (this.enteredGenRoom && this.level) {
          this.respawnInGenRoom();
        } else {
          this.setState('MainMenu');
        }
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
      this.inventory.hide();
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

  private async startGame() {
    // Clean up previous level — dispose GPU resources
    if (this.level) {
      this.disposeLevel(this.level);
    }
    if (this.watch) this.watch.dispose();
    if (this.dust) this.dust.dispose();
    if (this.ballGun) this.ballGun.dispose();
    this.ballGun = null;
    this.hasGun = false;
    this.prone = false;
    this.proneTransition = 0;
    this.audio.stopAll();

    this.level = loadLevel(this.scene);


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

    // Cache enemy part references to avoid per-frame getObjectByName
    this.enemyBodyRef = this.level.enemyRig.getObjectByName('enemyBody') ?? null;
    if (this.enemyBodyRef) {
      this.enemyPartsCache = {
        leftArm: this.enemyBodyRef.getObjectByName('leftArmPivot'),
        rightArm: this.enemyBodyRef.getObjectByName('rightArmPivot'),
        leftLeg: this.enemyBodyRef.getObjectByName('leftLegPivot'),
        rightLeg: this.enemyBodyRef.getObjectByName('rightLegPivot'),
        head: this.enemyBodyRef.getObjectByName('enemyHead'),
        torso: this.enemyBodyRef.getObjectByName('enemyTorso'),
        eLight: this.level.enemyRig.getObjectByName('enemyLight') as THREE.PointLight | undefined,
      };
    }

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

    this.dust = new DustParticles(this.scene);

    // Pre-compile all shaders to avoid stutter on first visibility change
    this.renderer.compile(this.scene, this.camera);

    this.input.reset(this.level.playerSpawn);
    this.audio.startEncounter();
    this.audio.startMusic();

    this.gameOverAtMs = 0;
    this.hasKey = false;
    this.doorOpen = false;
    this.secretDoorOpen = false;
    this.hasGenKey = false;
    this.genDoorOpen = false;
    this.enteredGenRoom = false;
    this.genDoorSealed = false;
    this.stgDoorOpen = false;
    this.labDoorOpen = false;
    this.hasYellowBulb = false;
    this.hasBlueBulb = false;
    this.yellowBulbInstalled = false;
    this.blueBulbInstalled = false;
    this.doorMessageCooldown = 0;
    this.hud.setKeyStatus(false);
    this.inventory.clear();
    this.inventory.show();

    // Pre-render 3D thumbnails for inventory items (after clear, while objects are visible)
    this.inventory.preRenderThumbnail('key', this.level.keyObj);
    this.inventory.preRenderThumbnail('gun', this.level.gunObj);
    this.inventory.preRenderThumbnail('gen-key', this.level.genKeyObj);
    this.inventory.preRenderThumbnail('yellow-bulb', this.level.yellowBulbObj);
    this.inventory.preRenderThumbnail('blue-bulb', this.level.blueBulbObj);
    this.input.setEnabled(true);
    this.setState('Playing');

    // Load monster GLB model asynchronously (non-blocking)
    this.enemyMixer = null;
    this.enemyModelLoaded = false;
    this.loadMonsterModel();
  }

  private async loadMonsterModel() {
    if (!this.level) return;
    const levelRef = this.level;

    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('./assets/Meshy_AI_Baby_biped_Animation_Unsteady_Walk_withSkin.glb');
      const model = gltf.scene;

      // Check the game is still running with this level
      if (this.level !== levelRef || this.state !== 'Playing') return;

      // Remove the procedural enemy body
      const enemyBody = levelRef.enemyRig.getObjectByName('enemyBody');
      if (enemyBody) levelRef.enemyRig.remove(enemyBody);

      // Set up the model — rotate 180° so it faces forward
      model.name = 'loadedMonster';
      model.rotation.y = Math.PI;
      model.position.y = -levelRef.playerHeight;

      // Darken and add horror emissive
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat && mat.color) {
            mesh.material = mat.clone();
            const m = mesh.material as THREE.MeshStandardMaterial;
            m.color.multiplyScalar(0.35);
            m.emissive = new THREE.Color(0x200000);
            m.emissiveIntensity = 1.5;
          }
        }
      });

      // Auto-scale: fit model to ~1.6 units tall
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const modelHeight = box.max.y - box.min.y;
      const targetHeight = 1.6;
      if (modelHeight > 0.01) {
        const s = targetHeight / modelHeight;
        model.scale.setScalar(s);
      }

      // Ground the model
      model.updateMatrixWorld(true);
      const boxAfter = new THREE.Box3().setFromObject(model);
      model.position.y += (-levelRef.playerHeight) - boxAfter.min.y;

      levelRef.enemyRig.add(model);

      // Set up animation mixer
      if (gltf.animations.length > 0) {
        this.enemyMixer = new THREE.AnimationMixer(model);
        const clip = gltf.animations[0]; // walk animation
        const action = this.enemyMixer.clipAction(clip);
        action.play();
      }

      // Cache mesh references for per-frame emissive updates (avoid traverse)
      this.enemyMonsterMeshes = [];
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) this.enemyMonsterMeshes.push(child as THREE.Mesh);
      });

      this.enemyModelLoaded = true;
      this.enemyBodyRef = null; // procedural body removed
      this.renderer.compile(this.scene, this.camera);
    } catch (e) {
      console.warn('Failed to load monster model, keeping procedural body', e);
    }
  }

  private disposeLevel(level: Level) {
    if (this.enemyMixer) {
      this.enemyMixer.stopAllAction();
      this.enemyMixer = null;
    }
    this.enemyModelLoaded = false;
    this.enemyMonsterMeshes = [];
    this.enemyBodyRef = null;
    this.enemyPartsCache = {};
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

  private onCaught() {
    if (this.state !== 'Playing' || this.noclip) return;

    this.damageFlash = 1.0;
    this.gameOverAtMs = performance.now();
    this.setState('GameOver');
    this.hud.triggerJumpscare();
    this.audio.playScare();
    this.input.setEnabled(false);
  }

  private respawnInGenRoom() {
    if (!this.level) return;
    const genCenter = this.level.roomCenters.get('Генераторна');
    if (!genCenter) return;

    const spawnPos = genCenter.clone();
    spawnPos.y = this.level.playerHeight;

    // Move player to generator room
    this.playerRig.position.copy(spawnPos);
    this.prevPlayerPos.copy(spawnPos);
    this.input.reset(spawnPos);

    // Move enemy back to main building patrol
    this.level.enemyRig.position.set(0, this.level.playerHeight, 0);

    // Reset damage flash
    this.damageFlash = 0;

    // Resume playing
    this.setState('Playing');
    this.input.setEnabled(true);
    this.audio.startEncounter();
    this.audio.startMusic();
  }

  private resize() {
    const w = this.rootEl.clientWidth;
    const h = this.rootEl.clientHeight;

    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  private frame() {
    const frameStart = performance.now();
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    // Camera look
    this.playerYaw.rotation.y = this.input.getYaw();
    this.playerPitch.rotation.x = this.input.getPitch();

    if (this.state === 'Playing' && this.level && this.player && this.enemy) {
      this.input.update(dt);
      if (this.noclip) {
        // Noclip: fly through walls, no collisions
        const move = this.input.getMoveVector();
        const cam = this.camera;
        const fwd = new THREE.Vector3();
        cam.getWorldDirection(fwd); // includes pitch
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        const vel = new THREE.Vector3()
          .addScaledVector(fwd, move.y)
          .addScaledVector(right, move.x);
        // Space = up, ShiftLeft = down
        if (this.input.isKeyDown('Space')) vel.y += 1;
        if (this.input.isKeyDown('ShiftLeft')) vel.y -= 1;
        const len = vel.length();
        if (len > 1e-6) vel.multiplyScalar(this.noclipSpeed * dt / len);
        this.playerRig.position.add(vel);
      } else {
        // Prone slows movement
        this.player.setSpeedMultiplier(this.proneTransition > 0.1 ? 0.4 : 1.0);
        this.player.update(dt);
      }
      this.enemy.update(dt);

      // Smooth prone transition
      const proneTarget = this.prone ? 1 : 0;
      this.proneTransition += (proneTarget - this.proneTransition) * Math.min(1, dt * 6);
      // Interpolate player height: standing = playerHeight, prone = 0.3
      const standHeight = this.level.playerHeight;
      const proneHeight = 0.3;
      this.playerRig.position.y = standHeight + (proneHeight - standHeight) * this.proneTransition;

      const currentPos = this.player.getPosition();
      const moveSpeed = currentPos.distanceTo(this.prevPlayerPos) / Math.max(dt, 0.001);
      this.prevPlayerPos.copy(currentPos);
      this.audio.updateFootsteps(dt, moveSpeed);

      const distToEnemy = currentPos.distanceTo(this.level.enemyRig.position);
      this.audio.updateMonsterBreathing(distToEnemy);
      this.audio.updateMusicTension(distToEnemy);

      // ── Interaction system: distance + look direction ──
      this.interactTarget = null;
      // Skip all interaction while keypad is visible
      const keypadOpen = this.hud.isKeypadVisible();
      if (keypadOpen) this.interactRequested = false;
      const interactRange = 2.5;
      const lookThreshold = 0.5; // dot product threshold (~60 degree cone)

      // Get camera forward direction in world space
      const camForward = new THREE.Vector3(0, 0, -1);
      this.camera.getWorldDirection(camForward);
      camForward.y = 0;
      camForward.normalize();

      // Helper: check if player is near AND looking toward target
      const canInteract = (targetPos: THREE.Vector3): boolean => {
        if (keypadOpen) return false;
        const dist = currentPos.distanceTo(targetPos);
        if (dist > interactRange) return false;
        const toTarget = targetPos.clone().sub(currentPos);
        toTarget.y = 0;
        toTarget.normalize();
        return camForward.dot(toTarget) > lookThreshold;
      };

      // Check key
      if (!this.hasKey && this.level.keyObj.visible && canInteract(this.level.keyPos)) {
        this.interactTarget = 'key';
      }

      // Check door
      if (!this.doorOpen && this.level.doorObj.visible && canInteract(this.level.doorPos)) {
        this.interactTarget = 'door';
      }

      // Check gun pickup
      if (!this.hasGun && this.level.gunObj.visible && canInteract(this.level.gunPos)) {
        this.interactTarget = 'gun';
      }

      // Check generator key
      if (!this.hasGenKey && this.level.genKeyObj.visible && canInteract(this.level.genKeyPos)) {
        this.interactTarget = 'gen-key';
      }

      // Check generator door
      if (!this.genDoorOpen && this.level.genDoorObj.visible && canInteract(this.level.genDoorPos)) {
        this.interactTarget = 'gen-door';
      }

      // Check bulb pickups
      if (!this.hasYellowBulb && !this.yellowBulbInstalled && this.level.yellowBulbObj.visible && canInteract(this.level.yellowBulbPos)) {
        this.interactTarget = 'yellow-bulb';
      }
      if (!this.hasBlueBulb && !this.blueBulbInstalled && this.level.blueBulbObj.visible && canInteract(this.level.blueBulbPos)) {
        this.interactTarget = 'blue-bulb';
      }

      // Check generator slots (install bulb)
      if ((this.hasYellowBulb || this.hasBlueBulb) && canInteract(this.level.generatorSlotsPos)) {
        this.interactTarget = 'install-bulb';
      }

      // Check locked doors (only show prompt, can't open manually)
      if (!this.stgDoorOpen && this.level.stgDoorObj.visible && canInteract(this.level.stgDoorPos)) {
        this.interactTarget = 'stg-door';
      }
      if (!this.labDoorOpen && this.level.labDoorObj.visible && canInteract(this.level.labDoorPos)) {
        this.interactTarget = 'lab-door';
      }

      // Check ventilation grate in storage room
      if (!this.ventOpen && this.level.ventObj.visible && canInteract(this.level.ventPos)) {
        this.interactTarget = 'vent';
      }

      // Check openable doors (both open and closed)
      this.interactOpenableDoor = null;
      if (!this.interactTarget) {
        for (const od of this.level.openableDoors) {
          if (od.animProgress > 0 && od.animProgress < 1) continue; // animating, skip
          if (canInteract(od.pos)) {
            this.interactTarget = 'openable-door';
            this.interactOpenableDoor = od;
            break;
          }
        }
      }

      // Show/hide interact prompt
      if (this.interactTarget === 'gun') {
        this.hud.showInteractPrompt('[E] Підібрати пушку');
      } else if (this.interactTarget === 'key') {
        this.hud.showInteractPrompt('[E] Підібрати ключ');
      } else if (this.interactTarget === 'door' && this.hasKey) {
        this.hud.showInteractPrompt('[E] Відчинити двері');
      } else if (this.interactTarget === 'door' && !this.hasKey) {
        this.hud.showInteractPrompt('Замкнено. Потрібен ключ.');
      } else if (this.interactTarget === 'gen-key') {
        this.hud.showInteractPrompt('[E] Підібрати ключ');
      } else if (this.interactTarget === 'gen-door' && this.hasGenKey) {
        this.hud.showInteractPrompt('[E] Відчинити двері');
      } else if (this.interactTarget === 'gen-door' && !this.hasGenKey) {
        this.hud.showInteractPrompt('Замкнено. Потрібен ключ.');
      } else if (this.interactTarget === 'yellow-bulb') {
        this.hud.showInteractPrompt('[E] Підібрати жовту лампочку');
      } else if (this.interactTarget === 'blue-bulb') {
        this.hud.showInteractPrompt('[E] Підібрати синю лампочку');
      } else if (this.interactTarget === 'install-bulb') {
        const bulbs: string[] = [];
        if (this.hasYellowBulb) bulbs.push('жовту');
        if (this.hasBlueBulb) bulbs.push('синю');
        this.hud.showInteractPrompt(`[E] Вставити ${bulbs.join(' і ')} лампочку`);
      } else if (this.interactTarget === 'stg-door') {
        this.hud.showInteractPrompt('Замкнено. Потрібна синя лампочка на генераторі.');
      } else if (this.interactTarget === 'lab-door') {
        this.hud.showInteractPrompt('Замкнено. Потрібна жовта лампочка на генераторі.');
      } else if (this.interactTarget === 'vent') {
        this.hud.showInteractPrompt('[E] Ввести код вентиляції');
      } else if (this.interactTarget === 'openable-door' && this.interactOpenableDoor) {
        this.hud.showInteractPrompt(this.interactOpenableDoor.isOpen ? '[E] Зачинити двері' : '[E] Відчинити двері');
      } else {
        this.hud.hideInteractPrompt();
      }

      // Process interaction
      if (this.interactRequested && this.interactTarget) {
        this.interactRequested = false;
        const t0 = performance.now();
        const what = this.interactTarget;

        if (this.interactTarget === 'gun') {
          this.hasGun = true;
          // Render thumbnail BEFORE hiding
          this.inventory.addItem({ id: 'gun', name: 'Кулькова пушка', icon: '🔫' });
          this.level.gunObj.position.y = -999;
          this.ballGun = new BallGun(this.level.root, this.camera, () => this.audio.getContext(), this.level.obstacles);
          this.inventory.selectItem('gun');
          this.hud.showMessage('Кулькова пушка!', 2000);
          this.audio.playPickup();
          this.hud.hideInteractPrompt();
        } else if (this.interactTarget === 'key') {
          this.hasKey = true;
          // Render thumbnail BEFORE hiding
          this.inventory.addItem({ id: 'key', name: 'Ключ', icon: '🔑' });
          this.level.keyObj.position.y = -999;
          this.hud.setKeyStatus(true);
          this.hud.showMessage('Ключ знайдено!', 2000);
          this.audio.playPickup();
          this.hud.hideInteractPrompt();
        } else if (this.interactTarget === 'door' && this.hasKey) {
          this.doorOpen = true;
          const idx = this.level.obstacles.indexOf(this.level.doorObstacle);
          if (idx !== -1) this.level.obstacles.splice(idx, 1);
          this.level.doorObj.position.y = -999;
          this.inventory.removeItem('key'); // key consumed
          this.hud.setKeyStatus(false);
          this.hud.showMessage('Двері відчинено!', 2000);
          this.audio.playDoorCreak();
          this.hud.hideInteractPrompt();
        } else if (this.interactTarget === 'gen-key') {
          this.hasGenKey = true;
          this.inventory.addItem({ id: 'gen-key', name: 'Ключ від генераторної', icon: '🔑' });
          this.level.genKeyObj.position.y = -999;
          this.hud.showMessage('Ключ від генераторної!', 2000);
          this.audio.playPickup();
          this.hud.hideInteractPrompt();
        } else if (this.interactTarget === 'gen-door' && this.hasGenKey) {
          this.genDoorOpen = true;
          const idx = this.level.obstacles.indexOf(this.level.genDoorObstacle);
          if (idx !== -1) this.level.obstacles.splice(idx, 1);
          this.level.genDoorObj.position.y = -999;
          this.inventory.removeItem('gen-key');
          this.hud.showMessage('Двері до генераторної відчинено!', 2000);
          this.audio.playDoorCreak();
          this.hud.hideInteractPrompt();
        } else if (this.interactTarget === 'yellow-bulb') {
          this.hasYellowBulb = true;
          this.inventory.addItem({ id: 'yellow-bulb', name: 'Жовта лампочка', icon: '💡' });
          this.level.yellowBulbObj.position.y = -999;
          this.hud.showMessage('Жовта лампочка! Встав у генератор.', 2500);
          this.audio.playPickup();
          this.hud.hideInteractPrompt();
        } else if (this.interactTarget === 'blue-bulb') {
          this.hasBlueBulb = true;
          this.inventory.addItem({ id: 'blue-bulb', name: 'Синя лампочка', icon: '💡' });
          this.level.blueBulbObj.position.y = -999;
          this.hud.showMessage('Синя лампочка! Встав у генератор.', 2500);
          this.audio.playPickup();
          this.hud.hideInteractPrompt();
        } else if (this.interactTarget === 'install-bulb') {
          // Install all carried bulbs
          if (this.hasYellowBulb) {
            this.hasYellowBulb = false;
            this.yellowBulbInstalled = true;
            this.inventory.removeItem('yellow-bulb');
            // Light up yellow slot on generator
            (this.level.genSlotYellow.material as any).color.set(0xffcc00);
            (this.level.genSlotYellow.material as any).emissive.set(0xffaa00);
            (this.level.genSlotYellow.material as any).emissiveIntensity = 2.0;
            // Light up yellow indicator on lab door
            (this.level.labDoorIndicator.material as any).color.set(0xffcc00);
            (this.level.labDoorIndicator.material as any).emissive.set(0xffaa00);
            (this.level.labDoorIndicator.material as any).emissiveIntensity = 2.0;
            // Open lab door
            this.labDoorOpen = true;
            const idx = this.level.obstacles.indexOf(this.level.labDoorObstacle);
            if (idx !== -1) this.level.obstacles.splice(idx, 1);
            this.level.labDoorObj.position.y = -999;
            this.hud.showMessage('Жовта лампочка встановлена! Лабораторію відчинено!', 3000);
          }
          if (this.hasBlueBulb) {
            this.hasBlueBulb = false;
            this.blueBulbInstalled = true;
            this.inventory.removeItem('blue-bulb');
            // Light up blue slot on generator
            (this.level.genSlotBlue.material as any).color.set(0x4444ff);
            (this.level.genSlotBlue.material as any).emissive.set(0x2222ff);
            (this.level.genSlotBlue.material as any).emissiveIntensity = 2.0;
            // Light up blue indicator on storage door
            (this.level.stgDoorIndicator.material as any).color.set(0x4444ff);
            (this.level.stgDoorIndicator.material as any).emissive.set(0x2222ff);
            (this.level.stgDoorIndicator.material as any).emissiveIntensity = 2.0;
            // Open storage door
            this.stgDoorOpen = true;
            const idx = this.level.obstacles.indexOf(this.level.stgDoorObstacle);
            if (idx !== -1) this.level.obstacles.splice(idx, 1);
            this.level.stgDoorObj.position.y = -999;
            this.hud.showMessage('Синя лампочка встановлена! Склад відчинено!', 3000);
          }
          this.audio.playDoorCreak();
          this.hud.hideInteractPrompt();
        } else if (this.interactTarget === 'vent') {
          // Show keypad UI
          this.hud.showKeypad((code: string) => {
            if (code === this.level!.ventCode) {
              // Correct code — open vent
              this.ventOpen = true;
              const idx = this.level!.obstacles.indexOf(this.level!.ventObstacle);
              if (idx !== -1) this.level!.obstacles.splice(idx, 1);
              this.level!.ventObj.position.y = -999;
              this.hud.hideKeypad();
              this.hud.showMessage('Код вірний! Вентиляцію відчинено!', 3000);
              this.audio.playDoorCreak();
            } else {
              // Wrong code
              this.hud.showMessage('Невірний код!', 2000);
              this.hud.hideKeypad();
            }
          });
          this.hud.hideInteractPrompt();
        } else if (this.interactTarget === 'openable-door' && this.interactOpenableDoor) {
          const od = this.interactOpenableDoor;
          if (od.isOpen) {
            // Close
            od.isOpen = false;
            od.animProgress = 1; // will animate toward 0
            if (!this.level.obstacles.includes(od.obstacle)) {
              this.level.obstacles.push(od.obstacle);
            }
          } else {
            // Open
            od.isOpen = true;
            od.animProgress = 0; // will animate toward 1
            const idx = this.level.obstacles.indexOf(od.obstacle);
            if (idx !== -1) this.level.obstacles.splice(idx, 1);
          }
          this.audio.playDoorCreak();
          this.hud.hideInteractPrompt();
        }
        console.log(`[interact:${what}] ${(performance.now() - t0).toFixed(1)}ms`);
      }
      this.interactRequested = false;

      // ── Animate openable doors (open & close) ──
      for (const od of this.level.openableDoors) {
        if (od.isOpen && od.animProgress < 1) {
          od.animProgress = Math.min(1, od.animProgress + dt * 2.0);
        } else if (!od.isOpen && od.animProgress > 0) {
          od.animProgress = Math.max(0, od.animProgress - dt * 2.5);
        }
        const t = 1 - Math.pow(1 - od.animProgress, 3);
        od.pivot.rotation.y = od.openDir * t * (Math.PI / 2);
      }

      // ── Enemy opens doors when nearby ──
      const enemyPos3 = this.level.enemyRig.position;
      for (const od of this.level.openableDoors) {
        if (od.isOpen) continue;
        const dx = enemyPos3.x - od.pos.x;
        const dz = enemyPos3.z - od.pos.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 1.5 * 1.5) {
          od.isOpen = true;
          const idx = this.level.obstacles.indexOf(od.obstacle);
          if (idx !== -1) this.level.obstacles.splice(idx, 1);
          this.audio.playDoorCreak();
        }
      }

      // ── Generator room: seal door when player enters ──
      if (this.genDoorOpen && !this.genDoorSealed) {
        const px = currentPos.x;
        // X_MIN = -12, player fully inside gen room
        if (px < -12.5) {
          this.enteredGenRoom = true;
          this.genDoorSealed = true;
          // Re-add door visually and as obstacle
          this.level.genDoorObj.position.y = 0;
          if (!this.level.obstacles.includes(this.level.genDoorObstacle)) {
            this.level.obstacles.push(this.level.genDoorObstacle);
          }
          this.audio.playDoorCreak();
          this.hud.showMessage('Двері зачинились...', 2000);
        }
      }

      // ── Ball gun: shoot + update + enemy hit ──
      if (this.ballGun) {
        const gunActive = this.inventory.getActiveItemId() === 'gun';
        if (this.shootRequested && gunActive) {
          this.shootRequested = false;
          if (this.shootNdc) {
            this.ballGun.shoot(this.shootNdc.x, this.shootNdc.y);
          } else {
            this.ballGun.shoot();
          }
          this.shootNdc = null;
        }
        this.ballGun.update(dt);

        // Check if ball hit shooting target FIRST (before enemy consumes the ball)
        if (!this.secretDoorOpen) {
          if (this.ballGun.checkHitEnemy(this.level.targetPos, 1.0)) {
            this.secretDoorOpen = true;
            this.level.secretDoorObj.position.y = -999;
            const sIdx = this.level.obstacles.indexOf(this.level.secretDoorObstacle);
            if (sIdx !== -1) this.level.obstacles.splice(sIdx, 1);
            this.audio.playDoorCreak();
          }
        }

        // Check if ball hit enemy — stun it briefly
        if (this.ballGun.checkHitEnemy(this.level.enemyRig.position, 0.6)) {
          this.enemy.stun(2.0);
          this.hud.showMessage('Влучив!', 1000);
        }
      }
      this.shootRequested = false;

      // Head bob
      if (moveSpeed > 0.5) {
        const bobPhase = t * 7.5;
        this.camera.position.y = Math.sin(bobPhase * 2) * 0.025;
        this.camera.position.x = Math.sin(bobPhase) * 0.012;
      } else {
        this.camera.position.y *= 0.9;
        this.camera.position.x *= 0.9;
      }

      this.dust?.update(dt, currentPos);
      this.watch?.update(dt, this.hasKey, this.doorOpen, moveSpeed);

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

    // Enemy animation
    if (this.level) {
      const state = this.enemy?.getState() ?? 'patrol';

      // GLB model animation (AnimationMixer)
      if (this.enemyMixer) {
        const timeScale = state === 'chase' ? 2.0 : state === 'search' ? 1.3 : 0.8;
        this.enemyMixer.timeScale = timeScale;
        this.enemyMixer.update(dt);

        // Pulse emissive on loaded model (cached mesh list, no traverse)
        const emissiveVal = state === 'chase'
          ? 2.5 + Math.sin(t * 8) * 1.0
          : state === 'search'
            ? 1.8 + Math.sin(t * 4) * 0.5
            : 1.0 + Math.sin(t * 2) * 0.3;
        for (const mesh of this.enemyMonsterMeshes) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat.emissive) mat.emissiveIntensity = emissiveVal;
        }
      }

      // Procedural animation fallback (cached refs, if GLB not loaded)
      if (this.enemyBodyRef) {
        const speed = state === 'chase' ? 8 : state === 'search' ? 5 : 3;
        const amplitude = state === 'chase' ? 0.6 : state === 'search' ? 0.4 : 0.25;
        const phase = t * speed;
        const p = this.enemyPartsCache;

        if (p.leftArm) p.leftArm.rotation.x = Math.sin(phase) * amplitude;
        if (p.rightArm) p.rightArm.rotation.x = -Math.sin(phase) * amplitude;
        if (p.leftLeg) p.leftLeg.rotation.x = -Math.sin(phase) * amplitude * 0.8;
        if (p.rightLeg) p.rightLeg.rotation.x = Math.sin(phase) * amplitude * 0.8;
        if (p.head) p.head.position.y = 1.6 + Math.abs(Math.sin(phase * 2)) * 0.02;
        if (p.torso) p.torso.rotation.x = Math.sin(phase) * 0.03;

        // Pulsing emissive intensity based on AI state
        if (p.torso && (p.torso as THREE.Mesh).isMesh) {
          const mat = (p.torso as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat.emissive) {
            mat.emissiveIntensity = state === 'chase'
              ? 2.5 + Math.sin(t * 8) * 1.0
              : state === 'search'
                ? 1.8 + Math.sin(t * 4) * 0.5
                : 1.0 + Math.sin(t * 2) * 0.3;
          }
        }
      }

      // Pulse enemy red light (cached ref)
      const eLight = this.enemyPartsCache.eLight;
      if (eLight) {
        eLight.intensity = state === 'chase'
          ? 2.0 + Math.sin(t * 8) * 0.8
          : 1.2 + Math.sin(t * 2) * 0.3;
      }
    }

    const logicMs = performance.now() - frameStart;
    if (logicMs > 30) console.warn(`[slow logic] ${logicMs.toFixed(1)}ms`);

    // Animate ground fog
    if (this.level) {
      const fogMat = (this.level.root as any)._fogMaterial as THREE.ShaderMaterial | undefined;
      if (fogMat) fogMat.uniforms.uTime.value = t;
    }

    // Flicker room lights
    if (this.level) {
      const now = performance.now() * 0.001;
      for (const fl of this.level.flickerLights) {
        const slow = Math.sin(now * 1.3 + fl.phase) * 0.15;
        const med = Math.sin(now * 4.7 + fl.phase * 3) * 0.1;
        const fast = Math.sin(now * 17 + fl.phase * 7) * 0.08;
        const dip = Math.sin(now * 0.4 + fl.phase * 2) > 0.92 ? -0.5 : 0;
        fl.light.intensity = fl.baseIntensity * Math.max(0.5, 1 + slow + med + fast + dip);
      }
    }

    // Decay damage flash
    this.damageFlash = Math.max(0, this.damageFlash - dt * 3.0);

    if (this.composer) {
      const passes = (this.composer as any).passes;
      const horrorIdx = passes.length - 1;
      if (passes && passes.length > 1 && passes[horrorIdx].uniforms) {
        const u = passes[horrorIdx].uniforms;
        u.time.value = t;
        // Enemy proximity for shader effects
        if (this.level && this.player) {
          const dist = this.player.getPosition().distanceTo(this.level.enemyRig.position);
          u.enemyProximity.value = Math.max(0, 1 - dist / 8);
        }
        u.damageFlash.value = this.damageFlash;
      }
      const r0 = performance.now();
      this.composer.render();
      const renderMs = performance.now() - r0;
      if (renderMs > 30) console.warn(`[slow render] ${renderMs.toFixed(1)}ms`);
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    const frameDur = performance.now() - frameStart;
    if (frameDur > 30) console.warn(`[slow frame] ${frameDur.toFixed(1)}ms (render logged above if slow)`);

    this.rafId = window.requestAnimationFrame(() => this.frame());

    if (this.state === 'GameOver') {
      if (performance.now() - this.gameOverAtMs > 2200) {
        if (this.enteredGenRoom && this.level) {
          // Respawn in generator room
          this.respawnInGenRoom();
        } else {
          this.setState('MainMenu');
          this.input.setEnabled(false);
        }
      }
    }
  }
}
