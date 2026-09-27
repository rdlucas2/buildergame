export interface Command {
  label: string;
  execute(): void;
  undo(): void;
}

/** Bounded undo/redo stack. `push` executes the command immediately. */
export class UndoStack {
  private done: Command[] = [];
  private undone: Command[] = [];

  constructor(readonly limit = 200) {}

  push(cmd: Command): void {
    cmd.execute();
    this.done.push(cmd);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
  }

  undo(): Command | null {
    const cmd = this.done.pop();
    if (!cmd) return null;
    cmd.undo();
    this.undone.push(cmd);
    return cmd;
  }

  redo(): Command | null {
    const cmd = this.undone.pop();
    if (!cmd) return null;
    cmd.execute();
    this.done.push(cmd);
    return cmd;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
