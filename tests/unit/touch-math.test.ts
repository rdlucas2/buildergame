import { describe, expect, it } from 'vitest';
import { flyDelta, joystickVector, touchLookDelta } from '../../src/game/touch-math';

describe('joystickVector', () => {
  it('ignores tiny movements inside the deadzone', () => {
    expect(joystickVector(0, 0, 60)).toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(joystickVector(5, 0, 60, 0.12).magnitude).toBe(0);
  });

  it('maps screen up to forward and right to right, clamped at the radius', () => {
    const up = joystickVector(0, -60, 60);
    expect(up.y).toBeCloseTo(1);
    expect(up.x).toBeCloseTo(0);
    const far = joystickVector(300, 0, 60);
    expect(far.magnitude).toBe(1);
    expect(far.x).toBeCloseTo(1);
    const diag = joystickVector(30, 30, 60, 0);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(diag.magnitude);
    expect(diag.y).toBeLessThan(0); // pulled down means backwards
  });

  it('ramps smoothly from the deadzone edge', () => {
    const half = joystickVector(0, -30, 60, 0);
    expect(half.magnitude).toBeCloseTo(0.5);
    expect(joystickVector(0, -60 * 0.12 - 0.01, 60, 0.12).magnitude).toBeLessThan(0.01);
  });
});

describe('flyDelta', () => {
  it('moves forward along -z at yaw 0 and along -x at yaw 90 degrees', () => {
    const f = flyDelta({ forward: 1, strafe: 0, up: 0 }, 0, 10, 0.5);
    expect(f.z).toBeCloseTo(-5);
    expect(f.x).toBeCloseTo(0);
    const left = flyDelta({ forward: 1, strafe: 0, up: 0 }, Math.PI / 2, 10, 1);
    expect(left.x).toBeCloseTo(-10);
    expect(left.z).toBeCloseTo(0);
  });

  it('normalises diagonal key input but keeps partial analog input slower', () => {
    const diag = flyDelta({ forward: 1, strafe: 1, up: 0 }, 0, 10, 1);
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(10);
    const gentle = flyDelta({ forward: 0.25, strafe: 0, up: 0 }, 0, 10, 1);
    expect(gentle.z).toBeCloseTo(-2.5);
    expect(flyDelta({ forward: 0, strafe: 0, up: -1 }, 0, 10, 1).y).toBeCloseTo(-10);
    expect(flyDelta({ forward: 0, strafe: 0, up: 0 }, 1, 10, 1)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('touchLookDelta', () => {
  it('turns 180 degrees over a full-width drag, in the natural direction', () => {
    const d = touchLookDelta(915, 0, 915);
    expect(d.yaw).toBeCloseTo(-Math.PI);
    expect(touchLookDelta(0, 100, 1000).pitch).toBeCloseTo(-Math.PI / 10);
    expect(Math.abs(touchLookDelta(100, 0, 100).yaw)).toBeCloseTo(Math.PI * 100 / 320); // narrow views are clamped
  });
});
