import { describe, expect, it } from 'vitest';
import { UndoStack } from '../../src/core/undo';

describe('UndoStack', () => {
  it('executes, undoes and redoes commands in order', () => {
    const log: string[] = [];
    const s = new UndoStack(2);
    const cmd = (n: string) => ({ label: n, execute: () => log.push(`do${n}`), undo: () => log.push(`undo${n}`) });
    s.push(cmd('A'));
    s.push(cmd('B'));
    s.push(cmd('C'));
    expect(s.undo()?.label).toBe('C');
    expect(s.undo()?.label).toBe('B');
    expect(s.undo()).toBeNull(); // A was dropped by the limit
    expect(s.redo()?.label).toBe('B');
    s.push(cmd('D'));
    expect(s.canRedo).toBe(false);
    expect(log).toEqual(['doA', 'doB', 'doC', 'undoC', 'undoB', 'doB', 'doD']);
  });
});
