import type { PerkCard } from '../core/defense-state';
import { EXPANSION_GAP, expansionPlan } from '../sim/defense/advisor';
import { describe, progressOf } from '../sim/defense/criteria';
import type { ActionResult, Defense, DefenseAction } from '../sim/defense/defense';
import { RARITY_COLORS, describePerk, perkName } from '../sim/defense/perks';
import { MAX_STRENGTH, WEAPON_UNLOCKS } from '../sim/defense/unlocks';
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
 * The Shop: everything points buy, in one place. The warren (more block budget, a new ring of walls
 * for more rabbits, repairs, and reinforcing every block and the core), then the weapons (defenders always carry the best one
 * unlocked; locked ones show what unlocks them) and the perks taken.
 */
export function openShop(d: Defense, apply: Apply): PanelHandle {
  const panel = openPanel('Shop', { wide: true, id: 'shop' });
  const render = () => {
    const core = d.base.coreMaxHp ? `❤ ${Math.ceil(d.base.coreHp)}/${d.base.coreMaxHp}` : '';
    const damaged = d.base.damaged().length;
    const level = d.base.reinforced;
    const reinforce = d.reinforcePrice;
    const ring = expansionPlan(d);
    const free = d.budget - d.base.cost();
    panel.body.replaceChildren(
      el('p', { class: 'muted small', id: 'shop-points' }, `★ ${d.points} to spend · ▣ ${d.base.cost()}/${d.budget} block budget. The round is paused while you shop.`),
      el('h3', {}, 'Warren'),
      el(
        'div',
        { class: 'armory-list' },
        item('shop-budget', 'More block budget', `+100 budget to build with (every wave adds ${d.waveBudget} too).`, `Buy (${d.budgetPrice}★)`, d.points >= d.budgetPrice, () => act({ type: 'buyBudget' })),
        item(
          'shop-expand',
          'Expand the warren',
          ring
            ? `A new ring of stone walls ${EXPANSION_GAP} blocks out, with ${ring.posts} lookout posts on top and a rabbit gap in each side: room for ${ring.room} rabbits (${d.room} now), and posts for more defenders. Uses ▣ ${ring.cost} of the block budget (${free} left).`
            : `The warren has room for ${d.room} rabbits, as many as it can: there is no space for another ring.`,
          ring ? `Build (▣ ${ring.cost})` : 'Full size',
          ring !== null && free >= ring.cost,
          () => {
            if (ring && refuse(apply(ring.action))) {
              toast(`The warren has room for ${d.room} rabbits now.`, 'success', 2500);
              render();
            }
          },
        ),
        item(
          'shop-repair',
          'Repair everything',
          damaged ? `Mends the most worn blocks first${d.base.coreDamage > 0 ? `, and the core (${core})` : ''}: ${damaged} damaged.` : 'Nothing is damaged.',
          damaged ? `Repair (${d.repairPrice}★)` : 'Repair',
          damaged > 0 && d.points >= 1,
          () => act({ type: 'repair' }),
        ),
        item(
          'shop-reinforce',
          'Reinforce the warren',
          `Every block and the core gets +25% hit points. Level ${level}/${MAX_STRENGTH}.`,
          Number.isFinite(reinforce) ? `Reinforce (${reinforce}★)` : 'Fully reinforced',
          Number.isFinite(reinforce) && d.points >= reinforce,
          () => act({ type: 'reinforce' }),
        ),
      ),
      el('h3', {}, 'Weapons'),
      el('p', { class: 'muted small' }, 'Defenders always carry the best weapon unlocked. New ones unlock as the round goes on.'),
      el('div', { class: 'armory-list' }, ...WEAPON_LIST.map((w) => weaponRow(w.id))),
      el('h3', {}, `Perks (${d.perks.length})`),
      d.perks.length === 0
        ? el('p', { class: 'muted small' }, 'A perk is offered every wave from the second, and a rare one every 5 minutes survived.')
        : el('div', { class: 'perk-taken' }, ...d.perks.map((c) => el('div', { class: 'small' }, el('b', { style: `color:${RARITY_COLORS[c.rarity]}` }, perkName(c)), ` — ${describePerk(c)}`))),
    );
  };
  const act = (action: DefenseAction) => {
    if (refuse(apply(action))) render();
  };
  const item = (id: string, name: string, text: string, label: string, enabled: boolean, onBuy: () => void): HTMLElement =>
    el(
      'div',
      { class: 'armory-row shop-item', id },
      el('div', { class: 'armory-name' }, name),
      el('div', { class: 'armory-info small' }, text),
      el('div', { class: 'armory-actions' }, el('button', { class: 'btn small shop-buy', onclick: onBuy, disabled: !enabled }, label)),
    );

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
        `${one(w.damage)} damage · range ${one(w.range)} · ${one(dps(w))} damage a second${extras.length ? ` · ${extras.join(', ')}` : ''}`,
      ),
      el('div', { class: 'armory-actions' }, d.mainWeapon === id ? el('span', { class: 'tag armory-main-tag' }, 'Carried') : el('span')),
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
