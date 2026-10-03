import type { PerkCard } from '../core/defense-state';
import { describe, progressOf } from '../sim/defense/criteria';
import type { ActionResult, Defense, DefenseAction } from '../sim/defense/defense';
import { STRENGTH_PER_LEVEL, TIERS } from '../sim/defense/materials';
import { RARITY_COLORS, describePerk, perkName } from '../sim/defense/perks';
import { MAX_STRENGTH, TIER_UNLOCKS, WEAPON_UNLOCKS } from '../sim/defense/unlocks';
import { CLASS_NAMES, WEAPON_LIST, dps } from '../sim/defense/weapons';
import { el } from './dom';
import { closePanel, openPanel, type PanelHandle } from './panel';
import { toast } from './toast';

type Apply = (action: DefenseAction) => ActionResult;

const one = (x: number) => (Math.round(x * 10) / 10).toString();

/** A thin progress bar from 0 to 1. */
function meter(fraction: number): HTMLElement {
  const bar = el('div', { class: 'meter-fill' });
  bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  return el('div', { class: 'meter' }, bar);
}

function refuse(r: ActionResult): boolean {
  if (!r.ok) toast(r.reason ?? 'Not possible right now.', 'error', 1800);
  return r.ok;
}

/**
 * The Armory: every weapon (what unlocks the locked ones, and for unlocked ones the main weapon and
 * how many defenders carry each other one), the strength of each block tier, and the perks taken.
 */
export function openArmory(d: Defense, apply: Apply): PanelHandle {
  const panel = openPanel('Armory', { wide: true, id: 'armory' });
  const render = () => {
    panel.body.replaceChildren(
      el('p', { class: 'muted small' }, `★ ${d.points} to spend. Defenders carry the main weapon unless you give some of them another.`),
      el('h3', {}, 'Weapons'),
      el('div', { class: 'armory-list' }, ...WEAPON_LIST.map((w) => weaponRow(w.id))),
      el('h3', {}, 'Blocks'),
      el('div', { class: 'armory-list' }, ...TIERS.map((_, t) => tierRow(t))),
      el('h3', {}, `Perks (${d.perks.length})`),
      d.perks.length === 0
        ? el('p', { class: 'muted small' }, 'A perk is offered every wave from the second, and a rare one every 5 minutes survived.')
        : el('div', { class: 'perk-taken' }, ...d.perks.map((c) => el('div', { class: 'small' }, el('b', { style: `color:${RARITY_COLORS[c.rarity]}` }, perkName(c)), ` — ${describePerk(c)}`))),
    );
  };
  const act = (action: DefenseAction) => {
    if (refuse(apply(action))) render();
  };

  const weaponRow = (id: string): HTMLElement => {
    const base = WEAPON_LIST.find((w) => w.id === id)!;
    const row = el('div', { class: 'armory-row armory-weapon', 'data-weapon': id });
    if (!d.unlocked.includes(id)) {
      const c = WEAPON_UNLOCKS[id]!;
      row.classList.add('locked');
      row.append(
        el('div', { class: 'armory-name' }, `🔒 ${base.name}`, el('div', { class: 'muted small' }, CLASS_NAMES[base.class])),
        el('div', { class: 'armory-info' }, el('div', { class: 'small' }, describe(c)), meter(progressOf(c, d.progress))),
      );
      return row;
    }
    const w = d.effectiveWeapon(id);
    const main = d.mainWeapon === id;
    const carried = d.loadout[id] ?? 0;
    const extras: string[] = [];
    if ((w.pellets ?? 1) > 1) extras.push(`${w.pellets} shots`);
    if (w.pierce) extras.push(`pierces ${w.pierce}`);
    if (w.splash) extras.push(`blast ${one(w.splash)}`);
    if (w.hitscan) extras.push('beam');
    row.append(
      el('div', { class: 'armory-name' }, base.name, el('div', { class: 'muted small' }, CLASS_NAMES[base.class])),
      el(
        'div',
        { class: 'armory-info small' },
        `${one(w.damage)} damage · range ${one(w.range)} · ${one(1 / w.cooldown)} ${1 / w.cooldown === 1 ? 'shot' : 'shots'} a second · ${one(dps(w))} damage a second${extras.length ? ` · ${extras.join(', ')}` : ''}`,
      ),
      el(
        'div',
        { class: 'armory-actions' },
        main
          ? el('span', { class: 'tag armory-main-tag' }, 'Main')
          : el('button', { class: 'btn small armory-main', onclick: () => act({ type: 'equip', weapon: id }) }, 'Make main'),
        main
          ? el('span')
          : el(
              'span',
              { class: 'def-group' },
              el('button', { class: 'btn small armory-fewer', onclick: () => act({ type: 'loadout', weapon: id, count: carried - 1 }), disabled: carried === 0 }, '−'),
              el('span', { class: 'armory-count', title: 'Defenders carrying it' }, String(carried)),
              el('button', { class: 'btn small armory-more', onclick: () => act({ type: 'loadout', weapon: id, count: carried + 1 }) }, '+'),
            ),
      ),
    );
    return row;
  };

  const tierRow = (t: number): HTMLElement => {
    const tier = TIERS[t];
    const level = d.strength[t] ?? 0;
    const row = el('div', { class: 'armory-row armory-tier', 'data-tier': String(t) });
    if (t >= d.tiers) {
      const c = TIER_UNLOCKS[t]!;
      row.classList.add('locked');
      row.append(el('div', { class: 'armory-name' }, `🔒 ${tier.name}`), el('div', { class: 'armory-info' }, el('div', { class: 'small' }, describe(c)), meter(progressOf(c, d.progress))));
      return row;
    }
    const hp = Math.round(tier.hp * (1 + STRENGTH_PER_LEVEL * level) * d.modifiers.blockHp);
    const price = d.strengthPrice(t);
    row.append(
      el('div', { class: 'armory-name' }, tier.name, el('div', { class: 'muted small' }, `costs ${tier.cost} budget a block`)),
      el('div', { class: 'armory-info small' }, `${hp} hit points a block · strength ${level}/${MAX_STRENGTH}`),
      el(
        'div',
        { class: 'armory-actions' },
        Number.isFinite(price)
          ? el('button', { class: 'btn small armory-strengthen', onclick: () => act({ type: 'strengthen', tier: t }), disabled: d.points < price }, `Strengthen (${price}★)`)
          : el('span', { class: 'tag' }, 'Full strength'),
      ),
    );
    return row;
  };

  render();
  return panel;
}

/** One perk card as a button. */
function card(c: PerkCard, onPick: () => void): HTMLElement {
  const color = RARITY_COLORS[c.rarity];
  const b = el(
    'button',
    { class: `perk-card perk-${c.rarity}`, onclick: onPick },
    el('div', { class: 'perk-rarity', style: `color:${color}` }, c.rarity),
    el('div', { class: 'perk-name' }, perkName(c)),
    el('div', { class: 'perk-text small' }, describePerk(c)),
  );
  b.style.borderColor = color;
  return b;
}

/** The oldest perk offer: three cards, pick one. Shows the next offer if more are waiting. */
export function openPerkOffer(d: Defense, apply: Apply): PanelHandle | null {
  if (d.offers.length === 0) {
    toast('No perk to choose right now: one comes with every wave.', 'info', 2000);
    return null;
  }
  const panel = openPanel('Choose a perk', { wide: true, id: 'perk-offer' });
  const render = () => {
    const offer = d.offers[0];
    if (!offer) return closePanel();
    panel.body.replaceChildren(
      el('p', { class: 'muted small' }, d.offers.length > 1 ? `${d.offers.length - 1} more waiting after this one.` : 'Bonuses last until the end of the round.'),
      el(
        'div',
        { class: 'perk-cards' },
        ...offer.map((c, i) =>
          card(c, () => {
            if (!refuse(apply({ type: 'pickPerk', index: i }))) return;
            toast(`${perkName(c)}: ${describePerk(c)}.`, 'success', 2500);
            render();
          }),
        ),
      ),
    );
  };
  render();
  return panel;
}
