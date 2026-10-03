import type { PlayerProfile } from '../core/profile';
import { ACHIEVEMENTS } from '../sim/defense/achievements';
import { UPGRADES, upgradePrice } from '../sim/defense/council';
import { describe, progressOf } from '../sim/defense/criteria';
import { lifetimeProgress } from '../sim/defense/rewards';
import { el } from './dom';
import { formatRoundTime } from './defense-hud';
import { openPanel, type PanelHandle } from './panel';
import { toast } from './toast';

export interface CouncilHandlers {
  /** Buys the next level of an upgrade; resolves with why it couldn't, or null. */
  buy: (id: string) => Promise<string | null>;
  exportProfile: () => void;
  importProfile: () => Promise<void>;
}

function meter(fraction: number): HTMLElement {
  const bar = el('div', { class: 'meter-fill' });
  bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  return el('div', { class: 'meter' }, bar);
}

/**
 * The Warren Council: spend Clover on permanent upgrades that make every later round easier, and
 * see the achievements earned so far. Upgrades take effect from the next round.
 */
export function openCouncil(profile: () => PlayerProfile, handlers: CouncilHandlers): PanelHandle {
  const panel = openPanel('Warren Council', { wide: true, id: 'council' });
  const render = () => {
    const p = profile();
    const life = lifetimeProgress(p.stats);
    const earned = ACHIEVEMENTS.filter((a) => p.achievements[a.id]).length;
    panel.body.replaceChildren(
      el(
        'div',
        { class: 'stat-row' },
        stat('Clover', `🍀 ${p.clover}`, 'council-clover'),
        stat('Rounds played', String(p.stats.rounds)),
        stat('Best time', formatRoundTime(p.stats.bestTime)),
        stat('Achievements', `${earned}/${ACHIEVEMENTS.length}`),
      ),
      el('p', { class: 'muted small' }, 'Rounds earn Clover for time survived, milestones, kills and achievements. Upgrades apply from the next round you start.'),
      el('h3', {}, 'Upgrades'),
      el(
        'div',
        { class: 'armory-list' },
        ...UPGRADES.map((u) => {
          const level = p.upgrades[u.id] ?? 0;
          const price = upgradePrice(u.id, level);
          const maxed = !Number.isFinite(price);
          return el(
            'div',
            { class: 'armory-row council-upgrade', 'data-upgrade': u.id },
            el('div', { class: 'armory-name' }, u.name, el('div', { class: 'muted small' }, `level ${level}/${u.maxLevel}`)),
            el('div', { class: 'armory-info small' }, level > 0 ? u.effect(level) : 'Not bought yet', maxed ? null : el('div', { class: 'muted' }, `Next: ${u.effect(level + 1)}`)),
            el(
              'div',
              { class: 'armory-actions' },
              maxed
                ? el('span', { class: 'tag' }, 'Maxed')
                : el(
                    'button',
                    {
                      class: 'btn small council-buy',
                      disabled: p.clover < price,
                      onclick: async () => {
                        const why = await handlers.buy(u.id);
                        if (why) toast(why, 'error', 1800);
                        else toast(`${u.name} is now level ${level + 1}.`, 'success', 1800);
                        render();
                      },
                    },
                    `Buy (${price} 🍀)`,
                  ),
            ),
          );
        }),
      ),
      el('h3', {}, 'Achievements'),
      el(
        'div',
        { class: 'armory-list' },
        ...ACHIEVEMENTS.map((a) => {
          const when = p.achievements[a.id];
          const where = a.scope === 'round' ? 'in one round' : 'over every round';
          return el(
            'div',
            { class: `armory-row council-achievement${when ? '' : ' locked'}`, 'data-achievement': a.id },
            el('div', { class: 'armory-name' }, `${when ? '🏆' : '🔒'} ${a.name}`, el('div', { class: 'muted small' }, `${a.clover} 🍀`)),
            el(
              'div',
              { class: 'armory-info small' },
              `${describe(a.criterion)} (${where})`,
              when ? el('div', { class: 'muted' }, `Earned ${new Date(when).toLocaleDateString()}`) : a.scope === 'lifetime' ? meter(progressOf(a.criterion, life)) : null,
            ),
          );
        }),
      ),
      el(
        'div',
        { class: 'row end' },
        el('button', { class: 'btn', id: 'council-export', onclick: handlers.exportProfile }, 'Export progress'),
        el('button', { class: 'btn', id: 'council-import', onclick: () => void handlers.importProfile().then(render) }, 'Import progress…'),
      ),
    );
  };
  render();
  return panel;
}

function stat(label: string, value: string, id?: string): HTMLElement {
  return el('div', { class: 'stat' }, el('div', { class: 'muted small' }, label), el('div', { class: 'stat-value', id }, value));
}
