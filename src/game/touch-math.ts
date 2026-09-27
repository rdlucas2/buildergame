/** Pure input maths shared by the keyboard and touch controls (no DOM, unit-tested). */

export interface StickVector {
  /** Right is positive. */
  x: number;
  /** Forward (up on screen) is positive. */
  y: number;
  /** 0..1 after the deadzone. */
  magnitude: number;
}

/**
 * Converts a thumbstick offset in screen pixels (dx right, dy down) into a direction whose
 * magnitude ramps from 0 at the deadzone edge to 1 at `radius`, and is clamped there.
 */
export function joystickVector(dx: number, dy: number, radius: number, deadzone = 0.12): StickVector {
  const dist = Math.hypot(dx, dy);
  if (!(radius > 0) || dist === 0) return { x: 0, y: 0, magnitude: 0 };
  const raw = Math.min(1, dist / radius);
  if (raw <= deadzone) return { x: 0, y: 0, magnitude: 0 };
  const magnitude = (raw - deadzone) / (1 - deadzone);
  return { x: (dx / dist) * magnitude, y: (-dy / dist) * magnitude, magnitude };
}

export interface FlyInput {
  /** -1..1, forward positive. */
  forward: number;
  /** -1..1, right positive. */
  strafe: number;
  /** -1..1, up positive. */
  up: number;
}

/**
 * World-space displacement for one frame of flying. Forward and strafe are relative to the view's
 * yaw (yaw 0 looks down -z). Combined input longer than 1, such as two keys at once, is normalised
 * so diagonals are not faster, while partial analog input moves proportionally slower.
 */
export function flyDelta(input: FlyInput, yaw: number, speed: number, dt: number): { x: number; y: number; z: number } {
  const { forward, strafe, up } = input;
  const len = Math.hypot(forward, strafe, up);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  const s = (speed * dt) / Math.max(1, len);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { x: (-sin * forward + cos * strafe) * s, y: up * s, z: (-cos * forward - sin * strafe) * s };
}

/** Radians to turn for a one-finger drag: a drag across the whole view width turns 180 degrees. */
export function touchLookDelta(dxPx: number, dyPx: number, viewportWidth: number): { yaw: number; pitch: number } {
  const k = Math.PI / Math.max(320, viewportWidth);
  return { yaw: -dxPx * k, pitch: -dyPx * k };
}

export function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
