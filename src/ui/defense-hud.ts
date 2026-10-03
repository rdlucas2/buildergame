import type { DefenseStats } from '../core/defense-state';
import { el } from './dom';
import { openPanel, type PanelHandle } from './panel';

export interface DefenseHudHandlers {
  onCallWave: () => void;
  onBuyBudget: () => void;
  onAllocate: (delta: number) => void;
  onFortify: () => void;
  onPerk: () => void;
  onRepair: () => void;
  onArmory: () => void;
}

export interface DefenseHudState {
  clock: number;
  wave: number;
  nextWaveIn: number;
  points: number;
  cost: number;
  budget: number;
  budgetPrice: number;
  defenders: number;
  breeders: number;
  allocation: number;
  predators: number;
  fortifying: boolean;
  over: boolean;
  /** Perk offers waiting to be chosen. */
  offers: number;
  /** Points to repair every damaged block (0 when nothing is damaged). */
  repairPrice: number;
}

const PLURALS: Record<string, string> = { fox: 'foxes', wolf: 'wolves', boss: 'bosses' };

/** "1 fox", "3 wolves", "2 badgers". */
export function countOf(kind: string, n: number): string {
  return `${n} ${n === 1 ? kind : (PLURALS[kind] ?? `${kind}s`)}`;
}

/** "12:34" for a number of seconds. */
export function formatRoundTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The Warren Defense strip: how long the warren has held out, when the next wave comes (and a
 * button to call it early for bonus points), points, the block budget (and buying more), and how
 * the rabbits are split between defenders and breeders.
 */
export class DefenseHud {
  readonly root: HTMLElement;
  private readonly clockEl = el('span', { class: 'def-clock', id: 'def-clock', title: 'Time survived' });
  private readonly waveEl = el('span', { class: 'def-wave', id: 'def-wave' });
  private readonly callBtn: HTMLButtonElement;
  private readonly pointsEl = el('span', { class: 'def-points', id: 'def-points', title: 'Points to spend' });
  private readonly budgetEl = el('span', { class: 'def-budget', id: 'def-budget', title: 'Blocks used against the warren budget' });
  private readonly buyBtn: HTMLButtonElement;
  private readonly rolesEl = el('span', { class: 'def-roles', id: 'def-roles' });
  private readonly fortifyBtn: HTMLButtonElement;
  private readonly perkBtn: HTMLButtonElement;
  private readonly repairBtn: HTMLButtonElement;
  private last = '';

  constructor(container: HTMLElement, handlers: DefenseHudHandlers) {
    this.callBtn = el('button', { class: 'def-btn', id: 'def-call', title: 'Call the next wave now for bonus points', onclick: handlers.onCallWave }, 'Call now');
    this.buyBtn = el('button', { class: 'def-btn', id: 'def-buy', onclick: handlers.onBuyBudget }, '+');
    this.fortifyBtn = el('button', { class: 'def-btn def-fortify', id: 'def-fortify', title: 'Build and repair the warren (F)', onclick: handlers.onFortify }, 'Fortify');
    this.perkBtn = el('button', { class: 'def-btn def-perk', id: 'def-perk', title: 'Choose a perk (K)', onclick: handlers.onPerk }, 'Perk');
    this.repairBtn = el('button', { class: 'def-btn', id: 'def-repair', title: 'Repair damaged blocks, the most worn first', onclick: handlers.onRepair }, 'Repair');
    const armory = el('button', { class: 'def-btn', id: 'def-armory', title: 'Weapons, block strength and perks (U)', onclick: handlers.onArmory }, 'Armory (U)');
    const minus = el('button', { class: 'def-btn def-step', id: 'def-fewer', title: 'Fewer defenders', onclick: () => handlers.onAllocate(-1) }, '−');
    const plus = el('button', { class: 'def-btn def-step', id: 'def-more', title: 'More defenders', onclick: () => handlers.onAllocate(1) }, '+');
    this.root = el(
      'div',
      { class: 'def-strip', id: 'def-strip' },
      this.clockEl,
      el('span', { class: 'def-group' }, this.waveEl, this.callBtn),
      this.pointsEl,
      el('span', { class: 'def-group' }, this.budgetEl, this.buyBtn),
      el('span', { class: 'def-group' }, minus, this.rolesEl, plus),
      this.perkBtn,
      this.repairBtn,
      armory,
      this.fortifyBtn,
    );
    this.root.style.display = 'none';
    container.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'flex' : 'none';
  }

  update(s: DefenseHudState): void {
    const key = JSON.stringify([Math.floor(s.clock), s.wave, Math.ceil(s.nextWaveIn), s.points, s.cost, s.budget, s.budgetPrice, s.defenders, s.breeders, s.allocation, s.fortifying, s.over, s.predators, s.offers, s.repairPrice]);
    if (key === this.last) return;
    this.last = key;
    this.clockEl.textContent = `⏱ ${formatRoundTime(s.clock)}`;
    this.waveEl.textContent = s.over ? 'Warren fallen' : s.wave === 0 ? `First wave in ${formatRoundTime(s.nextWaveIn)}` : `Wave ${s.wave} · next ${formatRoundTime(s.nextWaveIn)}${s.predators ? ` · ${s.predators} attacking` : ''}`;
    this.callBtn.disabled = s.over || s.nextWaveIn < 1;
    this.pointsEl.textContent = `★ ${s.points}`;
    this.budgetEl.textContent = `▣ ${s.cost}/${s.budget}`;
    this.buyBtn.textContent = `+100 (${s.budgetPrice}★)`;
    this.buyBtn.disabled = s.over || s.points < s.budgetPrice;
    this.rolesEl.textContent = `🛡 ${s.defenders} · 🥕 ${s.breeders}`;
    this.rolesEl.title = `${s.defenders} defenders (wanted: ${s.allocation}) and ${s.breeders} breeders`;
    this.fortifyBtn.classList.toggle('active', s.fortifying);
    this.fortifyBtn.textContent = s.fortifying ? 'Done (F)' : 'Fortify (F)';
    this.perkBtn.style.display = s.offers > 0 && !s.over ? '' : 'none';
    this.perkBtn.textContent = s.offers > 1 ? `🎁 ${s.offers} perks (K)` : '🎁 Perk (K)';
    this.repairBtn.style.display = s.repairPrice > 0 && !s.over ? '' : 'none';
    this.repairBtn.textContent = `🔧 ${s.repairPrice}★`;
    this.repairBtn.disabled = s.points < 1;
  }

  dispose(): void {
    this.root.remove();
  }
}

export interface RoundSummary {
  clock: number;
  waves: number;
  score: number;
  stats: DefenseStats;
  /** Clover the round earned, by source, and the achievements it earned (names). */
  reward?: { time: number; milestones: number; kills: number; achievements: number; total: number };
  earned?: string[];
  /** Clover to spend after this round. */
  clover?: number;
}

/** The end of a round: how long the warren held out and what happened, with a way to go again. */
export function openRoundSummary(s: RoundSummary, handlers: { onRestart: () => void; onCouncil?: () => void }): PanelHandle {
  const panel = openPanel('The warren has fallen', { id: 'round-summary' });
  // Elites and bosses are counted under their kind too; they get their own mention.
  const ranks = (['boss', 'elite'] as const).filter((r) => s.stats.killsOf[r]).map((r) => countOf(r, s.stats.killsOf[r]));
  const kills = Object.entries(s.stats.killsOf)
    .filter(([k]) => k !== 'elite' && k !== 'boss')
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => countOf(k, n))
    .join(', ');
  panel.body.append(
    el('p', {}, `Your rabbits held out for ${formatRoundTime(s.clock)} against ${s.waves} wave${s.waves === 1 ? '' : 's'}.`),
    el(
      'div',
      { class: 'stat-row' },
      stat('Time survived', formatRoundTime(s.clock)),
      stat('Score', String(s.score)),
      stat('Predators driven off', String(s.stats.kills)),
      stat('Rabbits lost', String(s.stats.rabbitsLost)),
      stat('Blocks broken', String(s.stats.blocksBroken)),
    ),
    kills ? el('p', { class: 'muted small', id: 'round-kills' }, `Driven off: ${kills}.${ranks.length ? ` Among them: ${ranks.join(', ')}.` : ''}`) : el('span'),
    s.reward
      ? el(
          'div',
          { class: 'round-reward', id: 'round-reward' },
          el('div', { class: 'stat-value' }, `🍀 +${s.reward.total} Clover`),
          el(
            'div',
            { class: 'muted small' },
            [`${s.reward.time} for time survived`, s.reward.milestones ? `${s.reward.milestones} for milestones` : '', s.reward.kills ? `${s.reward.kills} for kills` : '', s.reward.achievements ? `${s.reward.achievements} for achievements` : '']
              .filter(Boolean)
              .join(' · ') + (s.clover !== undefined ? `. You have ${s.clover} to spend at the Warren Council.` : '.'),
          ),
          s.earned?.length ? el('div', { class: 'small', id: 'round-achievements' }, `🏆 ${s.earned.join(', ')}`) : null,
        )
      : el('span'),
    el(
      'div',
      { class: 'row end' },
      el('button', { class: 'btn', onclick: () => panel.close() }, 'Look around'),
      handlers.onCouncil ? el('button', { class: 'btn', id: 'round-council', onclick: () => (panel.close(), handlers.onCouncil!()) }, 'Warren Council') : null,
      el('button', { class: 'btn primary', id: 'round-restart', onclick: () => (panel.close(), handlers.onRestart()) }, 'New round'),
    ),
  );
  return panel;
}

function stat(label: string, value: string): HTMLElement {
  return el('div', { class: 'stat' }, el('div', { class: 'muted small' }, label), el('div', { class: 'stat-value' }, value));
}
