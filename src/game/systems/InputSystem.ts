import * as THREE from 'three';

export type JoystickVector = { x: number; y: number }; // x = left/right, y = forward/back

type Vec2 = { x: number; y: number };

export class InputSystem {
  private enabled = false;

  private yaw = 0;
  private pitch = 0;

  // Movement coming from joystick
  private move: Vec2 = { x: 0, y: 0 };

  // Keyboard fallback (desktop)
  private keyState = new Set<string>();

  // Look handling
  private lastPointerPos: Vec2 | null = null;
  private activeLookPointerId: number | null = null;

  // Joystick handling
  private joystickBase: HTMLDivElement;
  private joystickStick: HTMLDivElement;
  private joystickActivePointerId: number | null = null;
  private joystickCenter: Vec2 = { x: 0, y: 0 };
  private joystickRadius = 46;
  private readonly joystickDefault: { leftPx: number; bottomPx: number } = { leftPx: 18, bottomPx: 18 };

  constructor(rootEl: HTMLElement) {
    // Joystick UI elements (mobile)
    const joystickWrap = document.createElement('div');
    joystickWrap.style.position = 'absolute';
    joystickWrap.style.inset = '0';
    // IMPORTANT: this overlay must NOT block HUD buttons.
    // Only the joystick itself should capture input.
    joystickWrap.style.pointerEvents = 'none';
    joystickWrap.className = 'hudJoystickWrap';

    this.joystickBase = document.createElement('div');
    this.joystickBase.className = 'joystickBase';
    this.joystickBase.style.touchAction = 'none';
    this.joystickBase.style.pointerEvents = 'auto';

    this.joystickStick = document.createElement('div');
    this.joystickStick.className = 'joystickStick';

    this.joystickBase.appendChild(this.joystickStick);
    joystickWrap.appendChild(this.joystickBase);
    rootEl.appendChild(joystickWrap);

    // Allow the joystick to be positioned by touch (more “standard”).
    this.resetJoystickBasePosition();

    this.joystickBase.addEventListener('pointerdown', (e) => this.onJoystickDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    // Desktop keyboard
    window.addEventListener('keydown', (e) => {
      this.keyState.add(e.code);
      if (e.code === 'ArrowUp') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keyState.delete(e.code));

    // Desktop mouse look (drag) — touch or right mouse button
    window.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (this.shouldIgnoreTarget(e.target as EventTarget | null)) return;
      if (this.isInJoystickArea(e.clientX, e.clientY)) return;
      // Touch: always look-drag. Mouse: only left button for look.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.activeLookPointerId = e.pointerId;
      this.lastPointerPos = { x: e.clientX, y: e.clientY };
    });
    // Prevent context menu on right-click (used for look)
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.activeLookPointerId = null;
      this.lastPointerPos = null;
      this.joystickActivePointerId = null;
      this.move = { x: 0, y: 0 };
      this.setStickPosition(0, 0);
      this.resetJoystickBasePosition();
    }
  }

  public reset(_playerSpawn: THREE.Vector3) {
    // Keep it simple for a beginner: reset orientation and movement.
    this.yaw = 0;
    this.pitch = 0;
    this.move = { x: 0, y: 0 };
    this.setStickPosition(0, 0);
    this.resetJoystickBasePosition();
  }

  public getYaw() {
    return this.yaw;
  }

  public getPitch() {
    return this.pitch;
  }

  public getMoveVector(): JoystickVector {
    // Priority: touch joystick > gamepad > keyboard
    if (Math.abs(this.move.x) > 0.001 || Math.abs(this.move.y) > 0.001) return { x: this.move.x, y: this.move.y };
    if (Math.abs(this.gamepadMove.x) > 0.001 || Math.abs(this.gamepadMove.y) > 0.001) return this.gamepadMove;
    return this.keyboardMoveVector();
  }

  // Gamepad state
  private gamepadMove: Vec2 = { x: 0, y: 0 };
  private gamepadLook: Vec2 = { x: 0, y: 0 };
  private readonly gamepadLookSensitivity = 2.5;
  private readonly gamepadDeadzone = 0.15;

  public update(dt: number) {
    this.pollGamepad(dt);
  }

  private keyboardMoveVector(): Vec2 {
    let x = 0;
    let y = 0;
    if (this.keyState.has('KeyA') || this.keyState.has('ArrowLeft')) x -= 1;
    if (this.keyState.has('KeyD') || this.keyState.has('ArrowRight')) x += 1;
    if (this.keyState.has('KeyW') || this.keyState.has('ArrowUp')) y += 1;
    if (this.keyState.has('KeyS') || this.keyState.has('ArrowDown')) y -= 1;
    // Normalize diagonal
    const len = Math.hypot(x, y);
    if (len > 1e-6) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  private onJoystickDown(e: PointerEvent) {
    if (!this.enabled) return;
    if (this.shouldIgnoreTarget(e.target)) return;
    this.joystickActivePointerId = e.pointerId;
    this.positionJoystickAtTouch(e.clientX, e.clientY);
    this.setJoystickGeometry();
    this.setStickPosition(0, 0);
    // Capture keeps us getting move events while finger is down.
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  private onPointerMove(e: PointerEvent) {
    // Joystick drag
    if (this.joystickActivePointerId === e.pointerId) {
      const dx = e.clientX - this.joystickCenter.x;
      const dy = e.clientY - this.joystickCenter.y;
      const dist = Math.hypot(dx, dy);

      const max = this.joystickRadius;
      const clamped = dist > max ? max / dist : 1;
      const ndx = dx * clamped;
      const ndy = dy * clamped;

      this.move = { x: ndx / max, y: -ndy / max }; // forward = up on screen
      this.setStickPosition(ndx, ndy);
      return;
    }

    // Look drag (mouse/touch drag)
    if (this.activeLookPointerId === e.pointerId && this.enabled) {
      const prev = this.lastPointerPos;
      this.lastPointerPos = { x: e.clientX, y: e.clientY };
      if (!prev) return;

      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;

      // Sensitivity tuned for touch screens.
      const lookSensitivity = 0.0026;
      this.yaw -= dx * lookSensitivity;
      this.pitch -= dy * lookSensitivity;

      const minPitch = -1.25;
      const maxPitch = 1.1;
      this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch));
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (this.joystickActivePointerId === e.pointerId) {
      this.joystickActivePointerId = null;
      this.move = { x: 0, y: 0 };
      this.setStickPosition(0, 0);
      this.resetJoystickBasePosition();
    }
    if (this.activeLookPointerId === e.pointerId) {
      this.activeLookPointerId = null;
      this.lastPointerPos = null;
    }
  }

  private setJoystickGeometry() {
    const rect = this.joystickBase.getBoundingClientRect();
    this.joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.joystickRadius = rect.width / 2 - 4;
  }

  private setStickPosition(x: number, y: number) {
    this.joystickStick.style.transform = `translate(${x}px, ${y}px)`;
  }

  private resetJoystickBasePosition() {
    // Bottom-left default.
    this.joystickBase.style.left = `${this.joystickDefault.leftPx}px`;
    this.joystickBase.style.right = 'auto';
    this.joystickBase.style.top = 'auto';
    this.joystickBase.style.bottom = `${this.joystickDefault.bottomPx}px`;
    this.joystickBase.style.position = 'absolute';
  }

  private positionJoystickAtTouch(clientX: number, clientY: number) {
    // Keep joystick on left half of the screen (typical mobile FPS layout).
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    if (clientX > w * 0.55) return;

    const size = this.joystickBase.getBoundingClientRect();
    const half = size.width / 2 || 46;

    // Clamp to screen.
    const x = THREE.MathUtils.clamp(clientX - half, 8, w - half * 2 - 8);
    const y = THREE.MathUtils.clamp(clientY - half, 8, h - half * 2 - 8);

    this.joystickBase.style.position = 'absolute';
    this.joystickBase.style.left = `${x}px`;
    this.joystickBase.style.top = `${y}px`;
    this.joystickBase.style.right = 'auto';
    this.joystickBase.style.bottom = 'auto';
  }

  private shouldIgnoreTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest('.panel')) return true;
    if (target.closest('button')) return true;
    return false;
  }

  private isInJoystickArea(clientX: number, clientY: number): boolean {
    const rect = this.joystickBase.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  private applyDeadzone(value: number): number {
    if (Math.abs(value) < this.gamepadDeadzone) return 0;
    const sign = value > 0 ? 1 : -1;
    return sign * (Math.abs(value) - this.gamepadDeadzone) / (1 - this.gamepadDeadzone);
  }

  private pollGamepad(dt: number) {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const pad of gamepads) {
      if (pad && pad.connected) { gp = pad; break; }
    }
    if (!gp) {
      this.gamepadMove = { x: 0, y: 0 };
      this.gamepadLook = { x: 0, y: 0 };
      return;
    }

    // Left stick = movement (axes 0, 1)
    const lx = this.applyDeadzone(gp.axes[0] ?? 0);
    const ly = this.applyDeadzone(gp.axes[1] ?? 0);
    this.gamepadMove = { x: lx, y: -ly }; // invert Y: stick down = -1, we want forward = +y

    // Right stick = camera look (axes 2, 3)
    const rx = this.applyDeadzone(gp.axes[2] ?? 0);
    const ry = this.applyDeadzone(gp.axes[3] ?? 0);
    this.gamepadLook = { x: rx, y: ry };

    if (this.enabled) {
      this.yaw -= rx * this.gamepadLookSensitivity * dt;
      this.pitch -= ry * this.gamepadLookSensitivity * dt;
      this.pitch = Math.max(-1.25, Math.min(1.1, this.pitch));
    }
  }
}

