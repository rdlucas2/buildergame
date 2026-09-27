import { getMaterial } from '../core/materials';
import { el, clear } from './dom';

export interface HudButtons {
  onLibrary: () => void;
  onWorld: () => void;
  onHelp: () => void;
  onStructure: () => void;
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

  constructor(buttons: HudButtons) {
    this.structureBtn = el('button', { class: 'btn top-btn', id: 'btn-structure', onclick: buttons.onStructure }, 'Build structure (B)');
    this.root = el(
      'div',
      { class: 'hud' },
      el('div', { class: 'crosshair', 'aria-hidden': 'true' }),
      el('div', { class: 'hud-topleft' }, this.modeEl, this.statusEl),
      el(
        'div',
        { class: 'hud-topright' },
        this.structureBtn,
        el('button', { class: 'btn top-btn', id: 'btn-library', onclick: buttons.onLibrary }, 'Library (Tab)'),
        el('button', { class: 'btn top-btn', id: 'btn-world', onclick: buttons.onWorld }, 'World (M)'),
        el('button', { class: 'btn top-btn', id: 'btn-help', onclick: buttons.onHelp }, 'Help (H)'),
      ),
      el('div', { class: 'hud-bottom' }, this.hintEl, this.hotbarEl),
      this.startEl,
    );
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

  setHotbar(materialIds: string[], selected: number): void {
    clear(this.hotbarEl);
    materialIds.forEach((id, i) => {
      const m = getMaterial(id);
      this.hotbarEl.append(
        el(
          'div',
          { class: `slot${i === selected ? ' selected' : ''}`, title: m?.name ?? id, dataset: { slot: String(i) } },
          el('div', { class: `swatch${m?.transparent ? ' glass' : ''}`, style: { background: m?.color ?? '#f0f' } }),
          el('span', { class: 'slot-key' }, String(i + 1)),
          el('span', { class: 'slot-name' }, m?.name ?? id),
        ),
      );
    });
  }
}
