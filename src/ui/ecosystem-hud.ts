import { SPEEDS, formatClock, isNight, type Speed } from '../sim/clock';
import type { CreatureSpecies } from '../core/world';
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
  private readonly wolfEl = el('span', { class: 'eco-prey eco-wolves', id: 'eco-wolves', title: 'Wolves alive' });
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>();
  private lastText = '';
  private lastSpeed: Speed | null = null;
  private lastPrey = -1;
  private lastWolves = -1;

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
      this.wolfEl,
      speeds,
      el('button', { class: 'eco-nature', id: 'eco-nature', onclick: handlers.onNature }, 'Nature'),
    );
    this.root.style.display = 'none';
    container.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'flex' : 'none';
  }

  update(time: number, speed: Speed, prey: number, wolves: number): void {
    if (prey !== this.lastPrey) {
      this.lastPrey = prey;
      this.preyEl.textContent = `🐇 ${prey}`;
    }
    if (wolves !== this.lastWolves) {
      this.lastWolves = wolves;
      this.wolfEl.textContent = `🐺 ${wolves}`;
      this.wolfEl.style.display = wolves > 0 ? '' : 'none';
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
  wolves: number;
  wolfCap: number;
  tally: { born: number; hunger: number; thirst: number; age: number; eaten: number };
  /** Samples of [time, rabbits, wolves], oldest first. */
  history: Array<[number, number, number]>;
}

export interface NaturePanelHandlers {
  onOverlay: (o: Overlay) => void;
  /** Releases rabbits or wolves at the crosshair; returns how many appeared. */
  onRelease: (species: CreatureSpecies) => number;
}

const OVERLAY_INFO: Array<[Overlay, string, string]> = [
  ['none', 'Normal', 'Grass and water as they are.'],
  ['food', 'Food', 'How much grass each spot has: dark is bare, yellow is some, green is plenty.'],
  ['sky', 'Sky', 'Purple ground has blocks above it, so no food can grow there.'],
  ['water', 'Water', 'Yellow shows the shore, where creatures can drink.'],
  ['safety', 'Safety', 'Teal shows where rabbits are safe from wolves: places a wolf can neither reach nor snatch them from.'],
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
  const release = (species: CreatureSpecies, id: string, label: string, full: boolean, noun: [string, string]) =>
    el(
      'button',
      {
        class: `btn${species === 'prey' ? ' primary' : ''}`,
        id,
        disabled: full,
        title: `${noun[1][0].toUpperCase()}${noun[1].slice(1)} appear where the crosshair meets the ground`,
        onclick: () => {
          const n = handlers.onRelease(species);
          releaseNote.textContent = n > 0 ? `Released ${n} ${n === 1 ? noun[0] : noun[1]}.` : 'No room there — aim at open ground.';
          if (n > 0) panel.close();
        },
      },
      label,
    );
  panel.body.append(
    el('h3', {}, 'Animals'),
    el(
      'div',
      { class: 'stat-row' },
      stat('Rabbits', `${stats.prey}`),
      stat('Wolves', `${stats.wolves}`),
      stat('Born', `${t.born}`),
      stat('Died', `${deaths}`),
    ),
    deaths > 0
      ? el('p', { class: 'muted small', id: 'death-causes' }, `Deaths: ${t.eaten} caught by wolves · ${t.hunger} hunger · ${t.thirst} thirst · ${t.age} old age`)
      : el('span'),
    sparkline(stats.history),
    el(
      'div',
      { class: 'release-row' },
      release('prey', 'release-rabbits', 'Release rabbits', stats.prey >= stats.preyCap, ['rabbit', 'rabbits']),
      release('predator', 'release-wolves', 'Release wolves', stats.wolves >= stats.wolfCap, ['wolf', 'wolves']),
      releaseNote,
    ),
    el(
      'p',
      { class: 'muted small' },
      'Rabbits need grass and water, sleep at night and raise young when well fed. Wolves arrive late on day 1: they track rabbits by scent, lie in wait by the water, stalk and pounce. ' +
        'A wolf stands 2 blocks tall and leaps 2 up, so rabbits are safe behind a 1-high gap, or inside walls 3 blocks high. Frightened rabbits run for the nearest safe spot and sleep in one if it is close. ' +
        'Releases appear where the crosshair meets the ground.',
    ),
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

/**
 * Rabbits and wolves over time (the last few days of samples). Each line has its own scale, so the
 * much smaller wolf population still shows its rises and falls.
 */
function sparkline(history: ReadonlyArray<[number, number, number]>): HTMLElement {
  const box = el('div', { class: 'sparkline', id: 'prey-sparkline' });
  if (history.length < 2) {
    box.append(el('span', { class: 'muted small' }, 'The population graph fills in as time passes.'));
    return box;
  }
  const w = 320;
  const h = 64;
  const samples = history.slice(-360);
  const t0 = samples[0][0];
  const span = Math.max(1, samples[samples.length - 1][0] - t0);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  const last = samples[samples.length - 1];
  svg.setAttribute('aria-label', `Over time: rabbits ${samples[0][1]} to ${last[1]}, wolves ${samples[0][2]} to ${last[2]}`);
  for (const [k, cls] of [[1, 'spark-prey'], [2, 'spark-wolves']] as const) {
    const max = Math.max(k === 1 ? 10 : 4, ...samples.map((s) => s[k])) * 1.15;
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', samples.map((s) => `${(((s[0] - t0) / span) * w).toFixed(1)},${(h - (s[k] / max) * (h - 4) - 2).toFixed(1)}`).join(' '));
    line.setAttribute('class', cls);
    svg.append(line);
  }
  box.append(
    svg,
    el('div', { class: 'spark-legend muted small' }, el('span', { class: 'key-prey' }, `— rabbits (${last[1]})`), el('span', { class: 'key-wolves' }, `— wolves (${last[2]})`)),
  );
  return box;
}
