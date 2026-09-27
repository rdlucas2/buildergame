import type { PerspectiveCamera } from 'three';

export interface Pose {
  position: [number, number, number];
  yaw: number;
  pitch: number;
}

/**
 * Creative-mode fly camera: pointer-lock mouse look, WASD to move on the horizontal plane relative to
 * where you face, Space / Shift to rise and sink, mouse wheel to change speed.
 */
export class FlyControls {
  yaw = 0;
  pitch = 0;
  speed = 14;
  readonly minSpeed = 2;
  readonly maxSpeed = 120;
  sensitivity = 0.0022;
  enabled = true;
  onLockChange?: (locked: boolean) => void;

  private readonly keys = new Set<string>();
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    this.keys.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly onBlur = () => this.keys.clear();
  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.isLocked || !this.enabled) return;
    this.look(e.movementX, e.movementY);
  };
  private readonly onPointerLockChange = () => {
    this.keys.clear();
    this.onLockChange?.(this.isLocked);
  };
  private readonly onWheel = (e: WheelEvent) => {
    if (!this.isLocked) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.speed = Math.min(this.maxSpeed, Math.max(this.minSpeed, this.speed * factor));
  };

  constructor(
    readonly camera: PerspectiveCamera,
    readonly domElement: HTMLElement,
  ) {
    camera.rotation.order = 'YXZ';
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.apply();
  }

  get isLocked(): boolean {
    return document.pointerLockElement === this.domElement;
  }

  lock(): void {
    if (this.isLocked) return;
    try {
      const p = this.domElement.requestPointerLock?.({ unadjustedMovement: true } as never) as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => this.domElement.requestPointerLock());
    } catch {
      this.domElement.requestPointerLock?.();
    }
  }

  unlock(): void {
    if (this.isLocked) document.exitPointerLock();
  }

  /** Rotate the view by raw mouse deltas (also used by tests). */
  look(dx: number, dy: number): void {
    this.yaw -= dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    this.apply();
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Simulated key state for tests. */
  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const k = this.keys;
    let fwd = 0, strafe = 0, up = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) strafe += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) strafe -= 1;
    if (k.has('Space')) up += 1;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC')) up -= 1;
    if (fwd === 0 && strafe === 0 && up === 0) return;
    const boost = k.has('ControlLeft') || k.has('ControlRight') ? 2.5 : 1;
    const len = Math.hypot(fwd, strafe, up) || 1;
    const s = (this.speed * boost * dt) / len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Camera looks down -Z when yaw = 0; forward on the ground plane is (-sin, 0, -cos).
    const p = this.camera.position;
    p.x += (-sin * fwd + cos * strafe) * s;
    p.z += (-cos * fwd - sin * strafe) * s;
    p.y += up * s;
  }

  getPose(): Pose {
    const p = this.camera.position;
    return { position: [p.x, p.y, p.z], yaw: this.yaw, pitch: this.pitch };
  }

  setPose(pose: Pose): void {
    this.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
    this.apply();
  }

  private apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.removeEventListener('wheel', this.onWheel);
  }
}

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
