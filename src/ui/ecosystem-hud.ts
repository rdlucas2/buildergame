import { SPEEDS, formatClock, isNight, type Speed } from '../sim/clock';
import type { Overlay } from '../render/terrain-view';
import { el } from './dom';
import { openPanel, type PanelHandle } from './panel';

export interface EcosystemHudHandlers {
  onSpeed: (speed: Speed) => void;
  onNature: () => void;
}

const SPEED_LABEL: Record<Speed, string> = { 0: '❚❚', 1: '1×', 4: '4×', 16: '16×' };

/** The time strip shown in wild worlds: clock, playback speed and a button for the Nature panel. */
export class EcosystemHud {
  readonly root: HTMLElement;
  private readonly clockEl = el('span', { class: 'eco-clock', id: 'eco-clock' });
  private readonly iconEl = el('span', { class: 'eco-icon', 'aria-hidden': 'true' });
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>();
  private lastText = '';
  private lastSpeed: Speed | null = null;

  constructor(container: HTMLElement, handlers: EcosystemHudHandlers) {
    const speeds = el('div', { class: 'eco-speeds', role: 'group', 'aria-label': 'Time speed' });
    for (const s of SPEEDS) {
      const b = el('button', { class: 'eco-speed', dataset: { speed: String(s) }, title: s === 0 ? 'Pause' : `${s}× speed`, onclick: () => handlers.onSpeed(s) }, SPEED_LABEL[s]);
      this.speedButtons.set(s, b);
      speeds.append(b);
    }
    this.root = el(
      'div',
      { class: 'eco-strip', id: 'eco-strip' },
      this.iconEl,
      this.clockEl,
      speeds,
      el('button', { class: 'eco-nature', id: 'eco-nature', onclick: handlers.onNature }, 'Nature'),
    );
    this.root.style.display = 'none';
    container.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'flex' : 'none';
  }

  update(time: number, speed: Speed): void {
    const text = formatClock(time);
    if (text !== this.lastText) {
      this.lastText = text;
      this.clockEl.textContent = text;
      this.iconEl.textContent = isNight(time) ? '☾' : '☀';
      this.root.classList.toggle('night', isNight(time));
    }
    if (speed !== this.lastSpeed) {
      this.lastSpeed = speed;
      for (const [s, b] of this.speedButtons) b.classList.toggle('active', s === speed);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

export interface NatureStats {
  clock: string;
  grassCoverage: number;
  waterShare: number;
  coveredCells: number;
}

const OVERLAY_INFO: Array<[Overlay, string, string]> = [
  ['none', 'Normal', 'Grass and water as they are.'],
  ['food', 'Food', 'How much grass each spot has: dark is bare, yellow is some, green is plenty.'],
  ['sky', 'Sky', 'Purple ground has blocks above it, so no food can grow there.'],
  ['water', 'Water', 'Yellow shows the shore, where creatures can drink.'],
];

/** Explains the rules of a wild world and lets the player switch overlays. */
export function openNaturePanel(stats: NatureStats, overlay: Overlay, onOverlay: (o: Overlay) => void): PanelHandle {
  const panel = openPanel('Nature', { id: 'nature-panel' });
  const list = el('div', { class: 'overlay-list', role: 'radiogroup', 'aria-label': 'Overlay' });
  for (const [id, label, hint] of OVERLAY_INFO) {
    list.append(
      el(
        'button',
        {
          class: `overlay-option${id === overlay ? ' active' : ''}`,
          role: 'radio',
          'aria-checked': id === overlay ? 'true' : 'false',
          dataset: { overlay: id },
          onclick: () => {
            onOverlay(id);
            panel.close();
          },
        },
        el('strong', {}, label),
        el('span', { class: 'muted small' }, hint),
      ),
    );
  }
  panel.body.append(
    el('p', {}, 'Grass grows only where sunlight reaches the ground. Roofs, floors and anything overhead block it, but a courtyard open to the sky still grows food. Water comes from ponds and streams.'),
    el(
      'div',
      { class: 'stat-row' },
      stat('Time', stats.clock),
      stat('Grass cover', `${Math.round(stats.grassCoverage * 100)}%`),
      stat('Water', `${(stats.waterShare * 100).toFixed(1)}%`),
      stat('Shaded ground', `${stats.coveredCells} cells`),
    ),
    el('h3', {}, 'Overlay'),
    list,
  );
  return panel;
}

function stat(label: string, value: string): HTMLElement {
  return el('div', { class: 'stat' }, el('div', { class: 'muted small' }, label), el('div', { class: 'stat-value' }, value));
}
