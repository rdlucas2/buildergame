import type { FlyControls } from './fly-controls';
import { joystickVector, touchLookDelta } from './touch-math';

/** What the player is doing, which decides the action buttons shown. */
export type TouchContext =
  | { mode: 'structure'; canUndo: boolean; canRedo: boolean }
  | { mode: 'placing' }
  | { mode: 'world'; hovering: boolean; canUndo: boolean; canRedo: boolean };

export type TouchActionId =
  | 'place'
  | 'break'
  | 'pick'
  | 'materials'
  | 'undo'
  | 'redo'
  | 'save'
  | 'exit'
  | 'drop'
  | 'rotate'
  | 'raise'
  | 'lower'
  | 'cancel'
  | 'remove'
  | 'move';

interface ActionSpec {
  id: TouchActionId;
  label: string;
  icon: string;
  primary?: boolean;
  /** 'main' buttons sit by the right thumb; 'top' buttons sit in a smaller row at the top right. */
  group: 'main' | 'top';
  /** Fires on press and repeats while held (handled by the game); others fire on release. */
  hold?: boolean;
  disabled?: boolean;
}

export interface TouchControlsHost {
  controls: FlyControls;
  canvas: HTMLCanvasElement;
  /** `down` fires on press, `up` on release. */
  onAction(id: TouchActionId, phase: 'down' | 'up'): void;
}

const ICONS: Record<TouchActionId | 'up' | 'down', string> = {
  place: 'M12 5v14M5 12h14',
  break: 'M6 6l12 12M18 6L6 18',
  pick: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z',
  materials: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  undo: 'M9 13L4 8l5-5M4 8h10a6 6 0 0 1 0 12h-4',
  redo: 'M15 13l5-5-5-5M20 8H10a6 6 0 0 0 0 12h4',
  save: 'M5 12l5 5L20 7',
  exit: 'M15 5h4v14h-4M10 8l-4 4 4 4M6 12h10',
  drop: 'M12 4v12M6 10l6 6 6-6M5 20h14',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  raise: 'M6 15l6-6 6 6',
  lower: 'M6 9l6 6 6-6',
  cancel: 'M6 6l12 12M18 6L6 18',
  remove: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
};

function actionsFor(ctx: TouchContext): ActionSpec[] {
  switch (ctx.mode) {
    case 'structure':
      return [
        { id: 'place', label: 'Place', icon: ICONS.place, primary: true, hold: true, group: 'main' },
        { id: 'break', label: 'Break', icon: ICONS.break, hold: true, group: 'main' },
        { id: 'pick', label: 'Pick', icon: ICONS.pick, group: 'top' },
        { id: 'materials', label: 'Blocks', icon: ICONS.materials, group: 'top' },
        { id: 'undo', label: 'Undo', icon: ICONS.undo, disabled: !ctx.canUndo, group: 'top' },
        { id: 'redo', label: 'Redo', icon: ICONS.redo, disabled: !ctx.canRedo, group: 'top' },
        { id: 'save', label: 'Save', icon: ICONS.save, group: 'top' },
        { id: 'exit', label: 'Leave', icon: ICONS.exit, group: 'top' },
      ];
    case 'placing':
      return [
        { id: 'drop', label: 'Place', icon: ICONS.drop, primary: true, group: 'main' },
        { id: 'rotate', label: 'Rotate', icon: ICONS.rotate, group: 'main' },
        { id: 'raise', label: 'Raise', icon: ICONS.raise, group: 'top' },
        { id: 'lower', label: 'Lower', icon: ICONS.lower, group: 'top' },
        { id: 'cancel', label: 'Cancel', icon: ICONS.cancel, group: 'top' },
      ];
    case 'world':
      return [
        { id: 'remove', label: 'Remove', icon: ICONS.remove, disabled: !ctx.hovering, group: 'main' },
        { id: 'move', label: 'Move', icon: ICONS.move, disabled: !ctx.hovering, group: 'main' },
        { id: 'undo', label: 'Undo', icon: ICONS.undo, disabled: !ctx.canUndo, group: 'top' },
        { id: 'redo', label: 'Redo', icon: ICONS.redo, disabled: !ctx.canRedo, group: 'top' },
      ];
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

function touchButton(className: string, label: string, path: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.setAttribute('aria-label', label);
  b.append(icon(path));
  const span = document.createElement('span');
  span.textContent = label;
  b.append(span);
  return b;
}

/** Keeps the browser from turning a touch into scrolling, zooming, text selection or mouse events. */
function swallow(e: Event): void {
  if (e.cancelable) e.preventDefault();
}

/**
 * On-screen controls for touch devices: a left thumbstick to move, drag anywhere else to look,
 * up/down buttons to fly, and context action buttons. Aiming stays on the centre crosshair, so all
 * actions reuse the desktop code paths.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private readonly secondaryEl: HTMLElement;
  private buttons = new Map<TouchActionId, HTMLButtonElement>();
  private visible = false;
  private contextKey = '';
  private current: ActionSpec[] = [];
  private stickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private readonly flyHeld = new Map<number, number>();
  private readonly pressed = new Map<number, { id: TouchActionId; el: HTMLElement }>();

  constructor(
    container: HTMLElement,
    private readonly host: TouchControlsHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    this.root.id = 'touch-ui';

    this.stick = document.createElement('div');
    this.stick.className = 'stick';
    this.stick.id = 'touch-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.stick.append(this.knob);

    const fly = document.createElement('div');
    fly.className = 'touch-fly';
    const upBtn = touchButton('tbtn fly', 'Up', ICONS.up);
    upBtn.dataset.action = 'fly-up';
    const downBtn = touchButton('tbtn fly', 'Down', ICONS.down);
    downBtn.dataset.action = 'fly-down';
    fly.append(upBtn, downBtn);

    this.actionsEl = document.createElement('div');
    this.actionsEl.className = 'touch-actions';
    this.actionsEl.id = 'touch-actions';
    this.secondaryEl = document.createElement('div');
    this.secondaryEl.className = 'touch-secondary';
    this.secondaryEl.id = 'touch-secondary';

    this.root.append(this.stick, this.actionsEl, this.secondaryEl, fly);
    container.append(this.root);

    this.bindStick();
    this.bindFly(upBtn, 1);
    this.bindFly(downBtn, -1);
    this.bindLook();
    this.root.addEventListener('contextmenu', swallow);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
    if (!visible) this.reset();
  }

  /** Releases every finger: stops movement, flying, looking and any held action. */
  reset(): void {
    this.stickPointer = null;
    this.lookPointer = null;
    this.flyHeld.clear();
    this.knob.style.transform = '';
    this.host.controls.clearAnalog();
    for (const { id, el } of this.pressed.values()) {
      el.classList.remove('pressed');
      this.host.onAction(id, 'up');
    }
    this.pressed.clear();
  }

  setContext(ctx: TouchContext): void {
    const key = JSON.stringify(ctx);
    if (key === this.contextKey) return;
    const modeChanged = !this.contextKey || JSON.parse(this.contextKey).mode !== ctx.mode;
    this.contextKey = key;
    const next = actionsFor(ctx);
    if (!modeChanged && next.every((spec) => this.buttons.has(spec.id))) {
      // Same buttons: just refresh enabled states so a held button is not rebuilt under the finger.
      for (const spec of next) this.buttons.get(spec.id)!.disabled = !!spec.disabled;
      this.current = next;
      return;
    }
    for (const { id } of this.pressed.values()) this.host.onAction(id, 'up');
    this.pressed.clear();
    this.current = next;
    this.buttons = new Map(next.map((spec) => [spec.id, this.actionButton(spec)]));
    this.actionsEl.replaceChildren(...next.filter((a) => a.group === 'main').map((a) => this.buttons.get(a.id)!));
    this.secondaryEl.replaceChildren(...next.filter((a) => a.group === 'top').map((a) => this.buttons.get(a.id)!));
  }

  /** For tests and diagnostics. */
  state(): { visible: boolean; actions: Array<{ id: TouchActionId; disabled: boolean }> } {
    return { visible: this.visible, actions: this.current.map((a) => ({ id: a.id, disabled: !!a.disabled })) };
  }

  private actionButton(spec: ActionSpec): HTMLButtonElement {
    const b = touchButton(`tbtn${spec.primary ? ' primary' : ''}${spec.group === 'top' ? ' small' : ''}`, spec.label, spec.icon);
    b.dataset.action = spec.id;
    b.disabled = !!spec.disabled;
    b.addEventListener('pointerdown', (e) => {
      swallow(e);
      if (b.disabled) return;
      b.setPointerCapture?.(e.pointerId);
      b.classList.add('pressed');
      this.pressed.set(e.pointerId, { id: spec.id, el: b });
      if (spec.hold) this.host.onAction(spec.id, 'down');
    });
    const release = (e: PointerEvent, fire: boolean) => {
      const p = this.pressed.get(e.pointerId);
      if (!p) return;
      this.pressed.delete(e.pointerId);
      b.classList.remove('pressed');
      if (spec.hold) this.host.onAction(spec.id, 'up');
      else if (fire) this.host.onAction(spec.id, 'up');
    };
    b.addEventListener('pointerup', (e) => release(e, true));
    b.addEventListener('pointercancel', (e) => release(e, false));
    return b;
  }

  private bindStick(): void {
    const radius = () => this.stick.clientWidth / 2 - 8;
    const update = (e: PointerEvent) => {
      const r = this.stick.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const rad = radius();
      const v = joystickVector(dx, dy, rad);
      const dist = Math.min(Math.hypot(dx, dy), rad);
      const ang = Math.atan2(dy, dx);
      this.knob.style.transform = `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px)`;
      this.host.controls.setAnalogMove(v.y, v.x);
    };
    this.stick.addEventListener('pointerdown', (e) => {
      swallow(e);
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      this.stick.setPointerCapture?.(e.pointerId);
      this.stick.classList.add('active');
      update(e);
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) update(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.stick.classList.remove('active');
      this.knob.style.transform = '';
      this.host.controls.setAnalogMove(0, 0);
    };
    this.stick.addEventListener('pointerup', end);
    this.stick.addEventListener('pointercancel', end);
  }

  private bindFly(button: HTMLButtonElement, dir: number): void {
    const apply = () => {
      let v = 0;
      for (const d of this.flyHeld.values()) v += d;
      this.host.controls.setAnalogVertical(v);
    };
    button.addEventListener('pointerdown', (e) => {
      swallow(e);
      button.setPointerCapture?.(e.pointerId);
      button.classList.add('pressed');
      this.flyHeld.set(e.pointerId, dir);
      apply();
    });
    const end = (e: PointerEvent) => {
      if (!this.flyHeld.delete(e.pointerId)) return;
      button.classList.remove('pressed');
      apply();
    };
    button.addEventListener('pointerup', end);
    button.addEventListener('pointercancel', end);
  }

  /** One finger dragging on the game view turns the camera. */
  private bindLook(): void {
    const canvas = this.host.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.visible) return;
      swallow(e);
      if (this.lookPointer !== null) return;
      this.lookPointer = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      const d = touchLookDelta(e.clientX - this.lookLast.x, e.clientY - this.lookLast.y, canvas.clientWidth);
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.host.controls.rotate(d.yaw, d.pitch);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.lookPointer) this.lookPointer = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }
}
