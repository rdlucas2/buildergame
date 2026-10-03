import { getMaterial } from '../core/materials';
import { el, clear } from './dom';

export interface HudButtons {
  onLibrary: () => void;
  onWorld: () => void;
  onHelp: () => void;
  onStructure: () => void;
  /** A hotbar slot was clicked or tapped. */
  onSlot: (index: number) => void;
}

/** Button text with its keyboard shortcut in a span that touch mode hides. */
function labelWithKey(text: string, key: string): Node[] {
  return [document.createTextNode(text), el('span', { class: 'key-hint' }, ` (${key})`)];
}

/** Always-visible overlay: crosshair, mode + status text, hotbar, hint line and the top buttons. */
export class Hud {
  readonly root: HTMLElement;
  private readonly modeEl = el('div', { class: 'hud-mode', id: 'hud-mode' });
  private readonly statusEl = el('div', { class: 'hud-status', id: 'hud-status' });
  private readonly hintEl = el('div', { class: 'hud-hint', id: 'hud-hint' });
  private readonly hotbarEl = el('div', { class: 'hotbar', id: 'hotbar' });
  private readonly startEl = el('div', { class: 'start-overlay', id: 'start-overlay' }, el('div', { class: 'start-card' }, el('h1', {}, 'Buildergame'), el('p', {}, 'Click to take control. Move with WASD, fly with Space / Shift, look with the mouse.'), el('p', {}, 'Press Tab to open the library and place an example, or B to build your own.'), el('p', { class: 'muted' }, 'Press H any time for the full list of controls.')));
  readonly structureBtn: HTMLButtonElement;
  private readonly onSlot: (index: number) => void;

  constructor(buttons: HudButtons) {
    this.onSlot = buttons.onSlot;
    this.structureBtn = el('button', { class: 'btn top-btn', id: 'btn-structure', onclick: buttons.onStructure }, ...labelWithKey('Build structure', 'B'));
    this.root = el(
      'div',
      { class: 'hud' },
      el('div', { class: 'crosshair', 'aria-hidden': 'true' }),
      el('div', { class: 'hud-topleft' }, this.modeEl, this.statusEl),
      el(
        'div',
        { class: 'hud-topright' },
        this.structureBtn,
        el('button', { class: 'btn top-btn', id: 'btn-library', onclick: buttons.onLibrary }, ...labelWithKey('Library', 'Tab')),
        el('button', { class: 'btn top-btn', id: 'btn-world', onclick: buttons.onWorld }, ...labelWithKey('World', 'M')),
        el('button', { class: 'btn top-btn', id: 'btn-help', onclick: buttons.onHelp }, ...labelWithKey('Help', 'H')),
      ),
      el('div', { class: 'hud-bottom' }, this.hintEl, this.hotbarEl),
      this.startEl,
    );
  }

  setStructureButton(text: string, key: string): void {
    this.structureBtn.replaceChildren(...labelWithKey(text, key));
  }

  setMode(text: string): void {
    this.modeEl.textContent = text;
  }

  setStatus(lines: string[]): void {
    clear(this.statusEl);
    for (const l of lines) this.statusEl.append(el('div', {}, l));
  }

  setHint(text: string): void {
    this.hintEl.textContent = text;
  }

  setStartVisible(visible: boolean): void {
    this.startEl.style.display = visible ? 'flex' : 'none';
  }

  setHotbarVisible(visible: boolean): void {
    this.hotbarEl.style.display = visible ? 'flex' : 'none';
  }

  /**
   * Fortify's bar: the warren blocks, each with its name, cost and hit points, and a lock on the
   * ones not unlocked yet. The lookout post carries a flag, as it does in the world.
   */
  setBlockBar(slots: ReadonlyArray<{ material: string; name: string; cost: number; hp: number; locked: string | null; role: string; post: boolean }>, selected: number): void {
    clear(this.hotbarEl);
    slots.forEach((b, i) => {
      const m = getMaterial(b.material);
      const title = `${b.name}: ${b.role} Costs ${b.cost} budget, ${b.hp} hit points.${b.locked ? ` Locked: ${b.locked}` : ''}`;
      this.hotbarEl.append(
        el(
          'div',
          { class: `slot block-slot${i === selected ? ' selected' : ''}${b.locked ? ' locked' : ''}${b.post ? ' post' : ''}`, title, dataset: { slot: String(i), material: b.material }, onclick: () => this.onSlot(i) },
          el('div', { class: 'swatch', style: { background: m?.color ?? '#f0f' } }, b.post ? el('span', { class: 'post-flag', 'aria-hidden': 'true' }, '⚑') : null, b.locked ? el('span', { class: 'slot-lock', 'aria-hidden': 'true' }, '🔒') : null),
          el('span', { class: 'slot-key' }, String(i + 1)),
          el('span', { class: 'slot-name' }, b.name),
          el('span', { class: 'slot-cost' }, `▣${b.cost} · ${b.hp}hp`),
        ),
      );
    });
  }

  setHotbar(materialIds: string[], selected: number): void {
    clear(this.hotbarEl);
    materialIds.forEach((id, i) => {
      const m = getMaterial(id);
      this.hotbarEl.append(
        el(
          'div',
          { class: `slot${i === selected ? ' selected' : ''}`, title: m?.name ?? id, dataset: { slot: String(i) }, onclick: () => this.onSlot(i) },
          el('div', { class: `swatch${m?.transparent ? ' glass' : ''}`, style: { background: m?.color ?? '#f0f' } }),
          el('span', { class: 'slot-key' }, String(i + 1)),
          el('span', { class: 'slot-name' }, m?.name ?? id),
        ),
      );
    });
  }
}
