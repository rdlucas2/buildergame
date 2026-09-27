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
  private readonly preyEl = el('span', { class: 'eco-prey', id: 'eco-prey', title: 'Rabbits alive' });
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>();
  private lastText = '';
  private lastSpeed: Speed | null = null;
  private lastPrey = -1;

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
      this.preyEl,
      speeds,
      el('button', { class: 'eco-nature', id: 'eco-nature', onclick: handlers.onNature }, 'Nature'),
    );
    this.root.style.display = 'none';
    container.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'flex' : 'none';
  }

  update(time: number, speed: Speed, prey: number): void {
    if (prey !== this.lastPrey) {
      this.lastPrey = prey;
      this.preyEl.textContent = `🐇 ${prey}`;
    }
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
  prey: number;
  preyCap: number;
  tally: { born: number; hunger: number; thirst: number; age: number; eaten: number };
  /** Samples of [time, prey count], oldest first. */
  history: Array<[number, number]>;
}

export interface NaturePanelHandlers {
  onOverlay: (o: Overlay) => void;
  /** Releases rabbits at the crosshair; returns how many appeared. */
  onRelease: () => number;
}

const OVERLAY_INFO: Array<[Overlay, string, string]> = [
  ['none', 'Normal', 'Grass and water as they are.'],
  ['food', 'Food', 'How much grass each spot has: dark is bare, yellow is some, green is plenty.'],
  ['sky', 'Sky', 'Purple ground has blocks above it, so no food can grow there.'],
  ['water', 'Water', 'Yellow shows the shore, where creatures can drink.'],
];

/** Explains the rules of a wild world and lets the player switch overlays. */
export function openNaturePanel(stats: NatureStats, overlay: Overlay, handlers: NaturePanelHandlers): PanelHandle {
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
            handlers.onOverlay(id);
            panel.close();
          },
        },
        el('strong', {}, label),
        el('span', { class: 'muted small' }, hint),
      ),
    );
  }
  const t = stats.tally;
  const deaths = t.hunger + t.thirst + t.age + t.eaten;
  const releaseNote = el('span', { class: 'muted small', id: 'release-note' });
  const full = stats.prey >= stats.preyCap;
  panel.body.append(
    el('h3', {}, 'Rabbits'),
    el(
      'div',
      { class: 'stat-row' },
      stat('Alive', `${stats.prey}`),
      stat('Born', `${t.born}`),
      stat('Died', `${deaths}`),
    ),
    deaths > 0
      ? el('p', { class: 'muted small', id: 'death-causes' }, `Deaths: ${t.hunger} hunger · ${t.thirst} thirst · ${t.age} old age${t.eaten ? ` · ${t.eaten} caught` : ''}`)
      : el('span'),
    sparkline(stats.history, stats.preyCap),
    el(
      'div',
      { class: 'release-row' },
      el(
        'button',
        {
          class: 'btn primary',
          id: 'release-rabbits',
          disabled: full,
          title: 'Rabbits appear where the crosshair meets the ground',
          onclick: () => {
            const n = handlers.onRelease();
            releaseNote.textContent = n > 0 ? `Released ${n} rabbit${n === 1 ? '' : 's'}.` : 'No room there — aim at open ground.';
            if (n > 0) panel.close();
          },
        },
        'Release rabbits at the crosshair',
      ),
      releaseNote,
    ),
    el('p', { class: 'muted small' }, full ? `The herd is at its limit of ${stats.preyCap}.` : 'Rabbits need grass and water, rest at night (under a roof if one is near) and raise young when well fed.'),
    el('h3', {}, 'Land'),
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

/** A small line chart of the population over time (the last day or so of samples). */
function sparkline(history: ReadonlyArray<[number, number]>, cap: number): HTMLElement {
  const box = el('div', { class: 'sparkline', id: 'prey-sparkline' });
  if (history.length < 2) {
    box.append(el('span', { class: 'muted small' }, 'The population graph fills in as time passes.'));
    return box;
  }
  const w = 320;
  const h = 64;
  const samples = history.slice(-240);
  const max = Math.max(10, Math.min(cap, Math.max(...samples.map(([, n]) => n)) * 1.15));
  const t0 = samples[0][0];
  const t1 = samples[samples.length - 1][0];
  const span = Math.max(1, t1 - t0);
  const pts = samples.map(([t, n]) => `${(((t - t0) / span) * w).toFixed(1)},${(h - (n / max) * (h - 4) - 2).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Rabbits over time: ${samples[0][1]} to ${samples[samples.length - 1][1]}`);
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('class', 'spark-prey');
  svg.append(line);
  box.append(svg);
  return box;
}
