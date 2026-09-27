import type { PerspectiveCamera } from 'three';
import { clamp1, flyDelta } from './touch-math';

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
  /** Called only when the browser refuses pointer lock outright (every attempt failed). */
  onLockFailed?: () => void;

  private readonly keys = new Set<string>();
  /** Analog input from touch controls, each -1..1. */
  private analog = { forward: 0, strafe: 0, up: 0 };
  /** A lock request is pending on a browser whose requestPointerLock returns no promise. */
  private legacyLockPending = false;
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
    if (this.isLocked) this.legacyLockPending = false;
    this.onLockChange?.(this.isLocked);
  };
  // Promise-based browsers report failure through the promise (see `lock`), and fire this event
  // even when the fallback request then succeeds, so it only counts for promise-less browsers.
  private readonly onPointerLockError = () => {
    if (!this.legacyLockPending) return;
    this.legacyLockPending = false;
    this.onLockFailed?.();
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
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.apply();
  }

  get isLocked(): boolean {
    return document.pointerLockElement === this.domElement;
  }

  /**
   * Requests pointer lock with raw (un-accelerated) mouse input, falling back to a plain request on
   * platforms that reject raw input (e.g. Chrome on Linux and macOS). `onLockFailed` fires only when
   * the fallback fails too.
   */
  lock(): void {
    if (this.isLocked) return;
    const el = this.domElement;
    const fail = () => this.onLockFailed?.();
    const request = (options: PointerLockOptions | undefined, onReject: () => void) => {
      let result: unknown;
      try {
        result = options ? el.requestPointerLock(options) : el.requestPointerLock();
      } catch {
        onReject();
        return;
      }
      if (result && typeof (result as Promise<void>).then === 'function') (result as Promise<void>).catch(onReject);
      else this.legacyLockPending = true;
    };
    request({ unadjustedMovement: true }, () => request(undefined, fail));
  }

  unlock(): void {
    if (this.isLocked) document.exitPointerLock();
  }

  /** Rotate the view by raw mouse deltas (also used by tests). */
  look(dx: number, dy: number): void {
    this.rotate(-dx * this.sensitivity, -dy * this.sensitivity);
  }

  /** Turns the view by angles in radians; pitch is clamped just short of straight up or down. */
  rotate(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch += dPitch;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    this.apply();
  }

  /** Analog movement from a thumbstick: forward and strafe in -1..1. */
  setAnalogMove(forward: number, strafe: number): void {
    this.analog.forward = clamp1(forward);
    this.analog.strafe = clamp1(strafe);
  }

  /** Analog vertical movement: 1 rises, -1 sinks. */
  setAnalogVertical(up: number): void {
    this.analog.up = clamp1(up);
  }

  clearAnalog(): void {
    this.analog = { forward: 0, strafe: 0, up: 0 };
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
    const a = this.analog;
    const input = { forward: clamp1(fwd + a.forward), strafe: clamp1(strafe + a.strafe), up: clamp1(up + a.up) };
    if (input.forward === 0 && input.strafe === 0 && input.up === 0) return;
    // Ctrl sprints on a keyboard; pushing the thumbstick all the way out sprints on touch.
    const stickSprint = Math.hypot(a.forward, a.strafe) >= 0.95;
    const boost = k.has('ControlLeft') || k.has('ControlRight') ? 2.5 : stickSprint ? 2 : 1;
    const d = flyDelta(input, this.yaw, this.speed * boost, dt);
    const p = this.camera.position;
    p.x += d.x;
    p.y += d.y;
    p.z += d.z;
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
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    this.domElement.removeEventListener('wheel', this.onWheel);
  }
}

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
