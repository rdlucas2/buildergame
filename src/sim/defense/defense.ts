import { NO_MODIFIERS, type DefenseModifiers, type DefenseOutcome, type DefenseState, type DefenseStats, type PerkCard, type SpawnOrder } from '../../core/defense-state';
import { getMaterial } from '../../core/materials';
import type { CreatureKind, CreatureState } from '../../core/world';
import { TICK_SECONDS } from '../clock';
import { Rng, hash3 } from '../rng';
import { KINDS, PREY, atHome, decidePrey, defOf, type Behaviour, type Creature, type DeathInfo, type HomeArea } from '../creatures';
import type { Ecosystem } from '../ecosystem';
import type { BreachCell, BreachCost, Cell, Navigator } from '../navigation';
import { lineOfSight } from '../senses';
import { DefenseBase } from './base';
import { Combat, EYE } from './combat';
import { BreachField, SolidSnapshot } from './field';
import type { DefenseContext } from './context';
import { makeDefender } from './defender';
import { met, type Progress } from './criteria';
import { CORE, TIERS, blockCost, tierOf } from './materials';
import { RARITIES, rollOffer, totalsOf, type PerkTotals } from './perks';
import { makeRaider } from './raider';
import { BOSS_TIMES, OPENING_SECONDS, SPAWN_DISTANCE, WAVE_INTERVAL, planWave } from './waves';
import { HAWK_ALTITUDE, makeHawk } from './hawk';
import { MAX_STRENGTH, REPAIR_HP_PER_POINT, TIER_UNLOCKS, WEAPON_UNLOCKS, strengthPrice } from './unlocks';
import { DEFAULT_WEAPON, WEAPONS, WEAPON_LIST, weaponScore, type WeaponClass, type WeaponDef } from './weapons';

export type DefenseAction =
  | { type: 'allocate'; defenders: number }
  | { type: 'callWave' }
  | { type: 'buyBudget' }
  | { type: 'place'; x: number; y: number; z: number; material: string }
  /** Several blocks at once (a library structure stamped into the warren): all of them or none. */
  | { type: 'placeMany'; blocks: Array<{ x: number; y: number; z: number; material: string }> }
  | { type: 'remove'; x: number; y: number; z: number }
  /** Takes card `index` (0–2) of the oldest perk offer. */
  | { type: 'pickPerk'; index: number }
  /** Deals the oldest perk offer again (uses one of the round's rerolls). */
  | { type: 'reroll' }
  /** The weapon defenders carry unless the loadout gives them another. */
  | { type: 'equip'; weapon: string }
  /** How many defenders carry `weapon` instead of the main weapon. */
  | { type: 'loadout'; weapon: string; count: number }
  /** Buys a strength level for a material tier. */
  | { type: 'strengthen'; tier: number }
  /** Repairs damaged blocks, the most worn first, as far as the points go. */
  | { type: 'repair' };

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export type DefenseEvent =
  | { kind: 'wave'; n: number; counts: Partial<Record<CreatureKind, number>>; name?: string; boss?: CreatureKind; budget: number }
  | { kind: 'lost'; clock: number }
  /** The core is being attacked (sent at most every `CORE_ALERT_SECONDS`). */
  | { kind: 'core'; hp: number; max: number }
  | { kind: 'unlock'; weapon: string }
  | { kind: 'tier'; tier: number }
  | { kind: 'offer'; pending: number }
  | { kind: 'milestone'; minutes: number };

/** Block budget a round starts with. */
export const START_BUDGET = 700;
/** Budget added by each purchase, and the price of the first purchase (it grows each time). */
export const BUDGET_STEP = 100;
/** Block budget every wave brings, from the first wave on, and how much more each wave after. */
export const WAVE_BUDGET = 30;
export const WAVE_BUDGET_GROWTH = 2;
/** Seconds between alerts that the core is under attack. */
const CORE_ALERT_SECONDS = 20;
/** How close (from its middle to the block's nearest face) a predator must be to gnaw the core. */
const CORE_REACH = 0.7;
const BUDGET_PRICE = 150;
const BUDGET_PRICE_GROWTH = 1.18;
/** How many rabbits a warren holds (breeding slows towards it): the colony can't grow without end. */
export const WARREN_CAPACITY = 40;
/** Defenders a round starts with. */
export const START_DEFENDERS = 4;
/** Path searches per tick in a defense round (predators plan their way in through walls). */
const WAVE_SALT = 0x3a7e;
/** Breach fields cover the buildable area and this many columns around it. */
const FIELD_MARGIN = 12;
/** Seconds a breach field is used before it is rebuilt (rabbits move, and blocks wear down). */
const FIELD_REFRESH = 2;
/** After blocks are built or broken, fields are rebuilt once they are at least this old. */
const FIELD_MIN_AGE = 0.5;
const SEARCH_BUDGET = { normal: 10, urgent: 6 };
const PERK_SALT = 0x9e4c;
/** The blocks a bear's smash reaches around the one it breaks. */
const SMASH_NEIGHBOURS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
];
/** A milestone comes every this many seconds survived (with a perk offer of rare cards or better). */
export const MILESTONE_SECONDS = 300;

export function emptyStats(): DefenseStats {
  return { kills: 0, killsWith: {}, killsOf: {}, rabbitsLost: 0, blocksBroken: 0, shots: 0, firstLoss: -1 };
}

/**
 * A saved round with everything later versions added filled in. World files get these defaults
 * when they are read; worlds kept in the browser are stored as they were saved, so a round saved by
 * an earlier version (before weapons, perks, the Council...) is brought up to date here.
 */
export function upgradeState(saved: DefenseState): DefenseState {
  const modifiers = { ...NO_MODIFIERS, ...defined(saved.modifiers ?? {}) };
  return {
    ...emptyProgression(modifiers),
    ...(defined(saved) as DefenseState),
    modifiers,
    stats: { ...emptyStats(), ...defined(saved.stats ?? {}) },
    orders: saved.orders ?? [],
  };
}

/** The object without its undefined properties (so they don't hide defaults when spread). */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * The in-round progression a round starts with: the slingshot (and any weapons the starting-weapon
 * upgrade adds), soft to stone blocks, no perks, and the rerolls upgrades give.
 */
export function emptyProgression(modifiers: DefenseModifiers = NO_MODIFIERS): Pick<DefenseState, 'unlocked' | 'mainWeapon' | 'loadout' | 'tiers' | 'strength' | 'perks' | 'offers' | 'offersMade' | 'milestones' | 'rerolls' | 'rewarded' | 'bosses'> {
  const unlocked = WEAPON_LIST.slice(0, 1 + Math.max(0, Math.min(WEAPON_LIST.length - 1, modifiers.startWeapon))).map((w) => w.id);
  return {
    unlocked,
    mainWeapon: unlocked[unlocked.length - 1],
    loadout: {},
    tiers: 3,
    strength: [0, 0, 0, 0, 0],
    perks: [],
    offers: [],
    offersMade: 0,
    milestones: 0,
    rerolls: modifiers.rerolls,
    rewarded: false,
    bosses: 0,
  };
}

/**
 * A Warren Defense round running inside an ecosystem: the warren, the wave schedule, defenders and
 * breeders, predators that break in, shots, points and the loss condition. Deterministic like the
 * rest of the simulation; player and bot decisions arrive through `apply` between ticks.
 */
export class Defense implements DefenseContext {
  readonly base: DefenseBase;
  readonly combat: Combat;
  readonly site: { x: number; z: number };
  clock: number;
  wave: number;
  nextWaveAt: number;
  orders: SpawnOrder[];
  points: number;
  score: number;
  budget: number;
  budgetBuys: number;
  allocation: number;
  stats: DefenseStats;
  outcome: DefenseOutcome;
  readonly modifiers: DefenseModifiers;
  unlocked: string[];
  mainWeapon: string;
  loadout: Record<string, number>;
  tiers: number;
  readonly strength: number[];
  perks: PerkCard[];
  offers: PerkCard[][];
  offersMade: number;
  milestones: number;
  rerolls: number;
  /** Set by the game once the round's rewards went to the player's profile. */
  rewarded: boolean;
  bosses: number;
  /** What the perks taken add up to. */
  private totals: PerkTotals;
  /** Weapons with perks and upgrades applied, by id (rebuilt when either changes). */
  private readonly effective = new Map<string, WeaponDef>();
  /** The weapon each defender carries. */
  private readonly weaponOf = new Map<number, string>();
  /** Things worth telling the player, collected until the view drains them. */
  events: DefenseEvent[] = [];
  private readonly postOf = new Map<number, string>();
  private readonly unreachable = new Map<number, Set<string>>();
  private roleTimer = 0;
  private safetyDirty = false;
  private lastSafety = -Infinity;
  /** The solid snapshot the breach fields are built on, and the fields built on it, by kind. */
  private snapshot: { at: number; shape: number; nav: Navigator; snap: SolidSnapshot } | null = null;
  private readonly fields = new Map<CreatureKind, BreachField>();
  /** What the fields lead to: the breeders, or (once there are none) the core. */
  private fieldGoal: 'breeders' | 'core' = 'breeders';
  private lastCoreDamage = 0;
  private lastCoreAlert = -Infinity;
  private readonly breeder: Behaviour;
  private readonly defender: Behaviour;
  private readonly raider: Behaviour;
  private readonly hawk: Behaviour;

  constructor(
    private readonly eco: Ecosystem,
    saved: DefenseState,
  ) {
    const state = upgradeState(saved);
    this.site = { ...state.site };
    this.base = new DefenseBase(state.base);
    this.clock = state.clock;
    this.wave = state.wave;
    this.nextWaveAt = state.nextWaveAt;
    this.orders = state.orders.map((o) => ({ ...o }));
    this.points = state.points;
    this.score = state.score;
    this.budget = state.budget;
    this.budgetBuys = state.budgetBuys;
    this.allocation = state.allocation;
    this.stats = structuredClone(state.stats);
    this.outcome = state.outcome;
    this.modifiers = { ...NO_MODIFIERS, ...state.modifiers };
    // Weapons this version doesn't know (from a newer file) are dropped.
    this.unlocked = state.unlocked.filter((id) => WEAPONS[id]);
    if (!this.unlocked.includes(DEFAULT_WEAPON)) this.unlocked.unshift(DEFAULT_WEAPON);
    this.mainWeapon = WEAPONS[state.mainWeapon] ? state.mainWeapon : DEFAULT_WEAPON;
    this.loadout = Object.fromEntries(Object.entries(state.loadout).filter(([id]) => WEAPONS[id]));
    this.tiers = state.tiers;
    this.strength = TIERS.map((_, i) => state.strength[i] ?? 0);
    this.perks = state.perks.map((p) => ({ ...p }));
    this.offers = state.offers.map((o) => o.map((p) => ({ ...p })));
    this.offersMade = state.offersMade;
    this.milestones = state.milestones;
    this.rerolls = state.rerolls;
    this.rewarded = state.rewarded;
    this.bosses = state.bosses;
    this.totals = totalsOf(this.perks);
    this.base.hpMultiplier = this.modifiers.blockHp;
    this.base.strength = this.strength;
    // Rounds saved before warrens had a core get one in the middle.
    if (this.outcome === 'playing' && this.base.coreCells().length === 0) this.base.placeCore(this.site.x, this.site.z);
    this.combat = new Combat(eco.population, eco.solids);
    this.breeder = {
      needs: true,
      decide: (pop, c, env) => decidePrey(pop, c, env.night, { breedBoost: this.modifiers.fertility * this.totals.fertility, home: this.home }),
      interval: PREY.interval,
    };
    this.defender = makeDefender(this);
    this.raider = makeRaider(this);
    this.hawk = makeHawk(this);
    this.install();
  }

  /** The state of a new round: the starter warren at `site`, built into `base`. */
  static initialState(site: { x: number; z: number }, base: DefenseBase, modifiers: DefenseModifiers = NO_MODIFIERS): DefenseState {
    return {
      site: { ...site },
      base: base.toState(),
      clock: 0,
      wave: 0,
      nextWaveAt: OPENING_SECONDS,
      orders: [],
      points: 0,
      score: 0,
      budget: START_BUDGET + modifiers.budget,
      budgetBuys: 0,
      allocation: START_DEFENDERS,
      stats: emptyStats(),
      outcome: 'playing',
      modifiers: { ...modifiers },
      ...emptyProgression(modifiers),
    };
  }

  private install(): void {
    const { population: pop, solids, vegetation: veg } = this.eco;
    pop.searchBudget = { ...SEARCH_BUDGET };
    // Rabbits in a warren live on grass alone: no water needed.
    pop.needsWater = false;
    pop.caps = { prey: WARREN_CAPACITY + this.modifiers.rabbits };
    pop.behaviourFor = (c) => (c.species === 'predator' ? (defOf(c).abilities.flier ? this.hawk : this.raider) : c.role === 'defender' ? this.defender : this.breeder);
    pop.onDeath = (c, info) => this.onDeath(c, info);
    solids.setBase(this.base);
    for (let z = this.base.origin.z; z < this.base.origin.z + this.base.size.z; z++)
      for (let x = this.base.origin.x; x < this.base.origin.x + this.base.size.x; x++) if (this.base.columnCovered(x, z)) veg.setExternalCover(x, z, true);
    this.base.onChange = (x, y, z) => {
      veg.setExternalCover(x, z, this.base.columnCovered(x, z));
      this.safetyDirty = true;
      if (this.base.solidAt(x, y, z)) pop.worldChanged();
    };
    this.eco.safety.invalidate();
  }

  /** Where the rabbits live: the columns the warren spans (or around the site, if it has no blocks). */
  get home(): HomeArea {
    return this.base.footprint() ?? { x0: this.site.x - 7, z0: this.site.z - 7, x1: this.site.x + 7, z1: this.site.z + 7 };
  }

  get over(): boolean {
    return this.outcome !== 'playing';
  }

  // ---- replays ------------------------------------------------------------------------------

  /** The current tick of the round (tenths of a second survived), as replays count them. */
  get tickIndex(): number {
    return Math.round(this.clock / TICK_SECONDS);
  }

  /** Told of every action that succeeds, with the tick it was taken at (to record a replay). */
  recorder: ((tick: number, action: DefenseAction) => void) | null = null;

  /** Actions to apply at given ticks (a replay), before each tick runs. */
  private script: Array<{ tick: number; action: DefenseAction }> = [];

  /** Schedules recorded actions; each is applied when the round reaches its tick, before it runs. */
  schedule(entries: ReadonlyArray<{ tick: number; action: DefenseAction }>): void {
    this.script = [...this.script, ...entries].sort((a, b) => a.tick - b.tick);
  }

  /** Called by the ecosystem at the very start of a tick: applies what was scheduled for now. */
  beforeTick(): void {
    const now = this.tickIndex;
    while (this.script.length > 0 && this.script[0].tick <= now) {
      const { action } = this.script.shift()!;
      this.apply(action);
    }
  }

  // ---- per tick ----------------------------------------------------------------------------

  /** Runs after the population's tick: waves, shots, roles, safety and the loss check. */
  tick(): void {
    if (this.outcome !== 'playing') {
      this.combat.tick();
      return;
    }
    const dt = TICK_SECONDS;
    this.clock += dt;
    if (this.clock >= this.nextWaveAt) this.startWave();
    while (this.orders.length > 0 && this.orders[0].at <= this.clock) this.spawn(this.orders.shift()!);
    this.combat.tick();
    this.stats.shots += this.combat.fired;
    this.combat.fired = 0;
    this.roleTimer -= dt;
    if (this.roleTimer <= 0) {
      this.roleTimer = 1;
      this.checkUnlocks();
      this.checkMilestones();
      this.assignRoles();
      this.mend(1);
    }
    if (this.safetyDirty && this.clock - this.lastSafety >= 1) {
      this.safetyDirty = false;
      this.lastSafety = this.clock;
      this.eco.safety.invalidate();
    }
    // The round is lost when the core falls (the rabbits are what predators go for first).
    if (this.base.coreCells().length === 0) {
      this.outcome = 'lost';
      this.events.push({ kind: 'lost', clock: this.clock });
    } else if (this.base.coreDamage > this.lastCoreDamage) {
      if (this.clock - this.lastCoreAlert >= CORE_ALERT_SECONDS) {
        this.lastCoreAlert = this.clock;
        this.events.push({ kind: 'core', hp: Math.ceil(this.base.coreHp), max: this.base.coreMaxHp });
      }
    }
    this.lastCoreDamage = this.base.coreDamage;
  }

  /** Lookout posts with a defender standing guard on them. */
  get manned(): number {
    const posts = new Set(this.base.posts().map((p) => `${p.x},${p.y},${p.z}`));
    let n = 0;
    for (const c of this.eco.population.creatures)
      if (c.role === 'defender' && c.deadFor < 0 && c.activity === 'guard' && posts.has(`${Math.floor(c.x)},${c.y},${Math.floor(c.z)}`)) n++;
    return n;
  }

  /** Block budget the next wave brings. */
  get waveBudget(): number {
    return WAVE_BUDGET + WAVE_BUDGET_GROWTH * this.wave;
  }

  private startWave(): void {
    const income = this.waveBudget;
    this.budget += income;
    this.wave++;
    // Each wave draws from its own stream, so a seed always brings the same waves whatever the
    // creatures did in between (rounds stay comparable across players and bots).
    const boss = this.bosses < BOSS_TIMES.length && this.clock >= BOSS_TIMES[this.bosses];
    if (boss) this.bosses++;
    const plan = planWave(this.wave, this.clock, new Rng(hash3(this.eco.seed, WAVE_SALT, this.wave)), { boss });
    this.orders.push(...plan.orders);
    this.orders.sort((a, b) => a.at - b.at);
    this.nextWaveAt = this.clock + WAVE_INTERVAL;
    const counts: Partial<Record<CreatureKind, number>> = {};
    for (const o of plan.orders) counts[o.kind] = (counts[o.kind] ?? 0) + o.count;
    const event: DefenseEvent = { kind: 'wave', n: this.wave, counts, budget: income };
    if (plan.name) event.name = plan.name;
    if (plan.boss) event.boss = plan.boss;
    this.events.push(event);
    // A perk to choose from every wave after the first.
    if (this.wave >= 2) this.offerPerks(0);
  }

  // ---- progression ---------------------------------------------------------------------------

  /** This round's progress, as unlock criteria measure it. */
  get progress(): Progress {
    const s = this.stats;
    return { clock: this.clock, score: this.score, waves: this.wave, kills: s.kills, killsWith: s.killsWith, killsOf: s.killsOf };
  }

  private checkUnlocks(): void {
    const p = this.progress;
    for (const w of WEAPON_LIST) {
      if (this.unlocked.includes(w.id)) continue;
      const c = WEAPON_UNLOCKS[w.id];
      if (c && !met(c, p)) continue;
      this.unlocked.push(w.id);
      // Defenders take up the new weapon when it beats the one they carry, perks included (so a
      // well-boosted cannon isn't dropped for a fresh laser).
      if (weaponScore(this.effectiveWeapon(w.id)) > weaponScore(this.effectiveWeapon(this.mainWeapon))) this.mainWeapon = w.id;
      this.events.push({ kind: 'unlock', weapon: w.id });
      this.armDefenders();
    }
    while (this.tiers < TIERS.length) {
      const c = TIER_UNLOCKS[this.tiers];
      if (c && !met(c, p)) break;
      this.events.push({ kind: 'tier', tier: this.tiers });
      this.tiers++;
    }
  }

  private checkMilestones(): void {
    while (this.clock >= (this.milestones + 1) * MILESTONE_SECONDS) {
      this.milestones++;
      this.events.push({ kind: 'milestone', minutes: (this.milestones * MILESTONE_SECONDS) / 60 });
      this.offerPerks(2);
    }
  }

  /** Deals perk cards to choose from (seeded per offer, like waves). */
  private offerPerks(minRarity: number): void {
    this.offers.push(this.dealOffer(minRarity));
    this.events.push({ kind: 'offer', pending: this.offers.length });
  }

  private dealOffer(minRarity: number): PerkCard[] {
    const rng = new Rng(hash3(this.eco.seed, PERK_SALT, this.offersMade));
    this.offersMade++;
    const classes = [...new Set(this.unlocked.map((id) => WEAPONS[id].class))];
    return rollOffer(rng, this.clock, classes, WEAPONS[this.mainWeapon].class, minRarity, this.modifiers.cards);
  }

  /** Mends worn blocks by the perk rate over `seconds`. */
  private mend(seconds: number): void {
    const rate = this.totals.regen;
    if (rate <= 0) return;
    for (const b of this.base.damaged()) this.base.repair(b.x, b.y, b.z, this.base.maxHpAt(b.x, b.y, b.z) * rate * seconds);
  }

  /** What the perks taken add up to. */
  get perkTotals(): PerkTotals {
    return this.totals;
  }

  /** A weapon as defenders actually fire it, with perks and upgrades applied. */
  effectiveWeapon(id: string): WeaponDef {
    let w = this.effective.get(id);
    if (w) return w;
    const base = WEAPONS[id] ?? WEAPONS[DEFAULT_WEAPON];
    const k: WeaponClass = base.class;
    const t = this.totals;
    const pellets = (base.pellets ?? 1) + t.multishot[k];
    w = {
      ...base,
      damage: base.damage * this.modifiers.damage * t.damage[k],
      cooldown: base.cooldown / t.rate[k],
      range: base.range + t.range[k],
      pellets,
      spread: base.spread ?? (pellets > 1 ? 0.08 * (pellets - 1) : 0),
      pierce: (base.pierce ?? 0) + t.pierce[k],
      splash: (base.splash ?? 0) + t.splash[k],
    };
    this.effective.set(id, w);
    return w;
  }

  /** Gives each defender its weapon: specialists per the loadout (strongest first), the rest the main weapon. */
  private armDefenders(): void {
    this.weaponOf.clear();
    const defenders = this.eco.population.creatures.filter((c) => c.role === 'defender' && c.deadFor < 0).sort((a, b) => a.id - b.id);
    let i = 0;
    for (const w of [...WEAPON_LIST].reverse()) {
      const n = this.unlocked.includes(w.id) && w.id !== this.mainWeapon ? (this.loadout[w.id] ?? 0) : 0;
      for (let k = 0; k < n && i < defenders.length; k++) this.weaponOf.set(defenders[i++].id, w.id);
    }
    for (; i < defenders.length; i++) this.weaponOf.set(defenders[i].id, this.mainWeapon);
  }

  /** Points to repair every damaged block. */
  get repairPrice(): number {
    return Math.ceil(this.base.totalDamage() / REPAIR_HP_PER_POINT);
  }

  /** Points for the next strength level of a tier (Infinity when it is maxed out). */
  strengthPrice(tier: number): number {
    const level = this.strength[tier] ?? 0;
    return level >= MAX_STRENGTH ? Infinity : strengthPrice(tier, level);
  }

  /** Brings a group of predators in from the edge of the land, `SPAWN_DISTANCE` from the warren. */
  private spawn(o: SpawnOrder): void {
    const { population: pop, nav, terrain, rng } = this.eco;
    const def = KINDS[o.kind];
    const half = terrain.half - 4;
    let made = 0;
    for (let r = SPAWN_DISTANCE; r >= 20 && made < o.count; r -= 6) {
      const cx = Math.max(-half, Math.min(half, this.site.x + Math.sin(o.angle) * r));
      const cz = Math.max(-half, Math.min(half, this.site.z + Math.cos(o.angle) * r));
      for (let attempt = 0; attempt < o.count * 6 && made < o.count; attempt++) {
        const x = Math.round(cx + rng.range(-3, 3));
        const z = Math.round(cz + rng.range(-3, 3));
        if (!nav.inBounds(x, z) || nav.isWater(x, z) || !nav.standable(x, 0, z, def.body)) continue;
        const init: Partial<CreatureState> = { maxHp: Math.round(def.maxHp * o.hpScale), age: def.maturity * 2, satiety: 1, hydration: 1 };
        if (o.rank) init.rank = o.rank;
        // Fliers come in high.
        pop.spawnKind(o.kind, x, def.abilities.flier ? HAWK_ALTITUDE : 0, z, init);
        made++;
      }
    }
  }

  /** Keeps the number of defenders at the allocation, preferring rabbits that already defend. */
  private assignRoles(): void {
    const rabbits = this.eco.population.creatures.filter((c) => c.species === 'prey' && c.deadFor < 0);
    const maturity = KINDS.rabbit.maturity;
    const eligible = (c: Creature) => c.age >= maturity && c.health > 0.35;
    let changed = false;
    const setRole = (c: Creature, role: 'breeder' | 'defender') => {
      if (c.role === role) return;
      c.role = role;
      changed = true;
      c.activity = 'idle';
      c.path = [];
      c.think = 0;
      if (role === 'breeder') this.postOf.delete(c.id);
    };
    for (const c of rabbits) if (!c.role || (c.role === 'defender' && !eligible(c))) setRole(c, 'breeder');
    const defenders = rabbits.filter((c) => c.role === 'defender');
    const want = Math.min(this.allocation, rabbits.filter(eligible).length);
    for (let i = defenders.length - 1; i >= want; i--) setRole(defenders[i], 'breeder');
    let missing = want - Math.min(want, defenders.length);
    // New defenders come from the rabbits at home first.
    const home = this.home;
    const away = (c: Creature) => (atHome(home, Math.floor(c.x), Math.floor(c.z)) ? 0 : 1);
    for (const c of missing > 0 ? [...rabbits].sort((a, b) => away(a) - away(b)) : []) {
      if (missing <= 0) break;
      if (c.role === 'breeder' && eligible(c)) {
        setRole(c, 'defender');
        missing--;
      }
    }
    if (changed || this.weaponOf.size === 0) this.armDefenders();
  }

  private onDeath(c: Creature, info: DeathInfo): void {
    if (c.species === 'predator') {
      if (info.cause !== 'slain') return;
      const kind = defOf(c).kind;
      this.stats.kills++;
      if (info.weapon) this.stats.killsWith[info.weapon] = (this.stats.killsWith[info.weapon] ?? 0) + 1;
      this.stats.killsOf[kind] = (this.stats.killsOf[kind] ?? 0) + 1;
      // Elites and bosses count as kinds of their own too (for achievements), and pay more.
      if (c.rank) this.stats.killsOf[c.rank] = (this.stats.killsOf[c.rank] ?? 0) + 1;
      const bonus = c.rank === 'boss' ? 10 : c.rank === 'elite' ? 3 : 1;
      const earned = Math.round(KINDS[kind].points * (1 + this.clock / 600) * this.totals.bounty * bonus);
      this.points += earned;
      this.score += earned;
      return;
    }
    this.postOf.delete(c.id);
    if (info.cause !== 'eaten') return;
    this.stats.rabbitsLost++;
    if (this.stats.firstLoss < 0) this.stats.firstLoss = Math.round(this.clock * 10) / 10;
  }

  // ---- actions ------------------------------------------------------------------------------

  /** The price of the next budget increase. */
  get budgetPrice(): number {
    return Math.round(BUDGET_PRICE * BUDGET_PRICE_GROWTH ** this.budgetBuys);
  }

  /** Seconds until the next wave. */
  get nextWaveIn(): number {
    return Math.max(0, this.nextWaveAt - this.clock);
  }

  /** Applies a player's (or bot's) decision. Never throws; reports why when it can't. */
  apply(action: DefenseAction): ActionResult {
    const r = this.applyNow(action);
    if (r.ok) this.recorder?.(this.tickIndex, structuredClone(action));
    return r;
  }

  private applyNow(action: DefenseAction): ActionResult {
    if (this.outcome !== 'playing') return { ok: false, reason: 'The round is over.' };
    switch (action.type) {
      case 'allocate': {
        const rabbits = this.eco.population.count('prey');
        this.allocation = Math.max(0, Math.min(rabbits, Math.round(action.defenders)));
        this.assignRoles();
        return { ok: true };
      }
      case 'callWave': {
        const early = this.nextWaveIn;
        if (early < 1) return { ok: false, reason: 'The next wave is already coming.' };
        const bonus = Math.round(early * 2 * (1 + this.wave / 5));
        this.points += bonus;
        this.score += bonus;
        this.nextWaveAt = this.clock;
        return { ok: true };
      }
      case 'buyBudget': {
        const price = this.budgetPrice;
        if (this.points < price) return { ok: false, reason: `Needs ${price} points.` };
        this.points -= price;
        this.budget += BUDGET_STEP;
        this.budgetBuys++;
        return { ok: true };
      }
      case 'place':
        return this.place(action.x, action.y, action.z, action.material);
      case 'placeMany':
        return this.placeMany(action.blocks);
      case 'remove': {
        const { x, y, z } = action;
        if (!this.base.contains(x, y, z)) return { ok: false, reason: 'Outside the warren.' };
        if (!this.base.solidAt(x, y, z)) return { ok: false, reason: 'Nothing there.' };
        if (this.base.materialAt(x, y, z) === CORE) return { ok: false, reason: "The core can't be removed: it is what the warren defends." };
        this.base.set(x, y, z, null);
        return { ok: true };
      }
      case 'pickPerk': {
        const offer = this.offers[0];
        const card = offer?.[action.index];
        if (!card) return { ok: false, reason: offer ? 'No such card.' : 'No perk to pick.' };
        this.offers.shift();
        this.perks.push({ ...card });
        if (card.kind === 'budget') this.budget += card.amount;
        this.totals = totalsOf(this.perks);
        this.effective.clear();
        return { ok: true };
      }
      case 'reroll': {
        if (this.offers.length === 0) return { ok: false, reason: 'No perk to redeal.' };
        if (this.rerolls <= 0) return { ok: false, reason: 'No rerolls left this round.' };
        // A redeal keeps the floor of the offer it replaces (milestone offers stay rare).
        const floor = Math.min(...this.offers[0].map((c) => RARITIES.indexOf(c.rarity)));
        this.offers[0] = this.dealOffer(Math.max(0, Math.min(2, floor)));
        this.rerolls--;
        return { ok: true };
      }
      case 'equip': {
        if (!this.unlocked.includes(action.weapon)) return { ok: false, reason: 'That weapon is not unlocked yet.' };
        this.mainWeapon = action.weapon;
        this.armDefenders();
        return { ok: true };
      }
      case 'loadout': {
        if (!this.unlocked.includes(action.weapon)) return { ok: false, reason: 'That weapon is not unlocked yet.' };
        const n = Math.max(0, Math.min(1000, Math.round(action.count)));
        if (n === 0) delete this.loadout[action.weapon];
        else this.loadout[action.weapon] = n;
        this.armDefenders();
        return { ok: true };
      }
      case 'strengthen': {
        const t = action.tier;
        if (!(t >= 0 && t < TIERS.length)) return { ok: false, reason: 'No such tier.' };
        if (t >= this.tiers) return { ok: false, reason: `${TIERS[t].name} blocks are not unlocked yet.` };
        const price = this.strengthPrice(t);
        if (!Number.isFinite(price)) return { ok: false, reason: 'Already as strong as it gets.' };
        if (this.points < price) return { ok: false, reason: `Needs ${price} points.` };
        this.points -= price;
        this.strength[t]++;
        this.base.version++;
        return { ok: true };
      }
      case 'repair': {
        const damaged = this.base.damaged().sort((a, b) => b.wear - a.wear);
        if (damaged.length === 0) return { ok: false, reason: 'Nothing needs repairing.' };
        if (this.points < 1) return { ok: false, reason: 'No points to spend.' };
        let spent = 0;
        for (const b of damaged) {
          const hp = Math.min(this.base.maxHpAt(b.x, b.y, b.z) * b.wear, (this.points - spent) * REPAIR_HP_PER_POINT);
          if (hp <= 0) break;
          spent += this.base.repair(b.x, b.y, b.z, hp) / REPAIR_HP_PER_POINT;
        }
        this.points -= Math.ceil(spent);
        return { ok: true };
      }
    }
  }

  /** Why a material can't be built with yet, or null when it can. */
  private locked(material: string): string | null {
    const t = tierOf(material);
    return t < this.tiers ? null : `${TIERS[t].name} blocks are not unlocked yet.`;
  }

  private placeMany(blocks: ReadonlyArray<{ x: number; y: number; z: number; material: string }>): ActionResult {
    if (blocks.length === 0) return { ok: false, reason: 'Nothing to place.' };
    let cost = 0;
    for (const b of blocks) {
      if (!getMaterial(b.material)) return { ok: false, reason: 'Unknown material.' };
      const locked = this.locked(b.material);
      if (locked) return { ok: false, reason: locked };
      if (!this.base.contains(b.x, b.y, b.z)) return { ok: false, reason: 'It does not fit inside the warren area.' };
      if (this.base.solidAt(b.x, b.y, b.z)) return { ok: false, reason: 'It overlaps blocks already there.' };
      if (b.material === CORE) return { ok: false, reason: 'The core is part of the warren already.' };
      cost += blockCost(b.material);
    }
    if (this.base.cost() + cost > this.budget) return { ok: false, reason: `Needs ${cost} budget; ${this.budget - this.base.cost()} left.` };
    for (const b of blocks) this.base.set(b.x, b.y, b.z, b.material);
    return { ok: true };
  }

  private place(x: number, y: number, z: number, material: string): ActionResult {
    if (!getMaterial(material)) return { ok: false, reason: 'Unknown material.' };
    if (material === CORE) return { ok: false, reason: 'The core is part of the warren already.' };
    const locked = this.locked(material);
    if (locked) return { ok: false, reason: locked };
    if (!this.base.contains(x, y, z)) return { ok: false, reason: 'Outside the warren area.' };
    if (this.base.solidAt(x, y, z)) return { ok: false, reason: 'There is already a block there.' };
    const cost = blockCost(material);
    if (this.base.cost() + cost > this.budget) return { ok: false, reason: 'Over the block budget.' };
    for (const c of this.eco.population.creatures) {
      if (c.deadFor >= 0 || Math.floor(c.x) !== x || Math.floor(c.z) !== z) continue;
      if (y >= c.y && y < c.y + defOf(c).body.height) return { ok: false, reason: 'An animal is standing there.' };
    }
    this.base.set(x, y, z, material);
    return { ok: true };
  }

  // ---- DefenseContext ------------------------------------------------------------------------

  inWave(): boolean {
    return this.orders.length > 0 || this.eco.population.count('predator') > 0;
  }

  postFor(c: Creature): Cell | null {
    const posts = this.base.posts();
    const key = this.postOf.get(c.id);
    if (key) {
      const p = posts.find((q) => `${q.x},${q.y},${q.z}` === key);
      if (p) return p;
      this.postOf.delete(c.id);
    }
    const taken = new Set(this.postOf.values());
    const blocked = this.unreachable.get(c.id);
    let best: Cell | null = null;
    let bestD = Infinity;
    for (const p of posts) {
      const k = `${p.x},${p.y},${p.z}`;
      if (taken.has(k) || blocked?.has(k)) continue;
      const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2 + (p.y - c.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) this.postOf.set(c.id, `${best.x},${best.y},${best.z}`);
    return best;
  }

  postUnreachable(c: Creature): void {
    const key = this.postOf.get(c.id);
    if (!key) return;
    this.postOf.delete(c.id);
    let set = this.unreachable.get(c.id);
    if (!set) this.unreachable.set(c.id, (set = new Set()));
    set.add(key);
  }

  weaponFor(c: Creature): WeaponDef {
    return this.effectiveWeapon(this.weaponOf.get(c.id) ?? this.mainWeapon);
  }

  critChance(_c: Creature, w: WeaponDef): number {
    return this.totals.crit[w.class];
  }

  findTarget(c: Creature, _w: WeaponDef, range: number): Creature | null {
    const solids = this.eco.solids;
    const ex = c.x;
    const ey = c.y + EYE;
    const ez = c.z;
    let best: Creature | null = null;
    let bestScore = Infinity;
    for (const p of this.eco.population.creatures) {
      if (p.species !== 'predator' || p.deadFor >= 0) continue;
      const def = defOf(p);
      const reach = range * (1 - 0.5 * (def.abilities.stealth ?? 0));
      const d = Math.hypot(p.x - ex, p.y + def.box[1] * 0.5 - ey, p.z - ez);
      if (d > reach) continue;
      // Predators already at the walls or the rabbits come first.
      const score = d - (p.activity === 'breach' || p.activity === 'bite' ? 6 : 0);
      if (score >= bestScore) continue;
      if (!lineOfSight(solids, ex, ey, ez, p.x, p.y + def.box[1] * 0.5, p.z)) continue;
      best = p;
      bestScore = score;
    }
    return best;
  }

  breachCost(c: Creature): BreachCost {
    const def = defOf(c);
    const rate = Math.max(0.5, def.blockDamage);
    return (x, y, z) => (this.base.solidAt(x, y, z) ? (this.base.hpAt(x, y, z) / rate) * def.speed : null);
  }

  fieldPath(c: Creature, max: number): BreachCell[] {
    const field = this.fieldFor(c);
    return field ? field.descend(this.eco.nav, { x: Math.floor(c.x), y: c.y, z: Math.floor(c.z) }, max) : [];
  }

  /**
   * The breach field for this predator's kind. Fields are rebuilt every `FIELD_REFRESH` seconds, as
   * the rabbits move and blocks wear, and sooner when blocks are built or broken.
   */
  fieldFor(c: Creature): BreachField | null {
    const snap = this.snapshot;
    const age = snap ? this.clock - snap.at : Infinity;
    const goal = this.breedersLeft() ? 'breeders' : 'core';
    if (!snap || age >= FIELD_REFRESH || (snap.shape !== this.base.shape && age >= FIELD_MIN_AGE) || goal !== this.fieldGoal) {
      this.fieldGoal = goal;
      const { origin, size } = this.base;
      const s = new SolidSnapshot(this.eco.solids, origin.x - FIELD_MARGIN, origin.z - FIELD_MARGIN, size.x + FIELD_MARGIN * 2, size.z + FIELD_MARGIN * 2, Math.min(31, size.y + 3));
      this.snapshot = { at: this.clock, shape: this.base.shape, nav: s.navigator(this.eco.terrain), snap: s };
      this.fields.clear();
    }
    const kind = defOf(c).kind;
    let field = this.fields.get(kind);
    if (!field) {
      const { snap: s, nav } = this.snapshot!;
      field = new BreachField(s, nav, defOf(c).body, this.breachCost(c), this.goals());
      this.fields.set(kind, field);
    }
    return field;
  }

  /** True while any breeder (a rabbit not defending) is alive: predators go for those first. */
  breedersLeft(): boolean {
    return this.eco.population.creatures.some((r) => r.species === 'prey' && r.deadFor < 0 && r.role !== 'defender');
  }

  /** Where predators are heading: the breeders, or once they are gone, the core. */
  private goals(): Cell[] {
    if (this.breedersLeft())
      return this.eco.population.creatures.filter((r) => r.species === 'prey' && r.deadFor < 0 && r.role !== 'defender').map((r) => ({ x: Math.floor(r.x), y: r.y, z: Math.floor(r.z) }));
    // The ground beside the core and the top of it: wherever a predator can stand and gnaw.
    const cells = this.base.coreCells();
    const core = new Set(cells.map((c) => `${c.x},${c.z}`));
    const out: Cell[] = [];
    for (const c of cells) {
      if (c.y === 0)
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!core.has(`${c.x + dx},${c.z + dz}`)) out.push({ x: c.x + dx, y: 0, z: c.z + dz });
      if (!this.base.solidAt(c.x, c.y + 1, c.z)) out.push({ x: c.x, y: c.y + 1, z: c.z });
    }
    return out;
  }

  /** A core block this predator is touching (beside it or standing on it), or null. */
  coreNear(c: Creature): Cell | null {
    const h = defOf(c).body.height;
    for (const b of this.base.coreCells()) {
      const dx = Math.max(b.x - c.x, 0, c.x - (b.x + 1));
      const dz = Math.max(b.z - c.z, 0, c.z - (b.z + 1));
      if (Math.hypot(dx, dz) > CORE_REACH) continue;
      if (b.y === c.y - 1 || (b.y >= c.y && b.y < c.y + h)) return b;
    }
    return null;
  }

  /** The middle of the core and the cell on top of it, or null once it has fallen. */
  coreSpot(): { x: number; z: number; top: number } | null {
    const cells = this.base.coreCells();
    if (cells.length === 0) return null;
    let x = 0;
    let z = 0;
    let top = 0;
    for (const c of cells) {
      x += c.x + 0.5;
      z += c.z + 0.5;
      top = Math.max(top, c.y + 1);
    }
    return { x: x / cells.length, z: z / cells.length, top };
  }

  chew(c: Creature, x: number, y: number, z: number, amount: number): void {
    if (this.base.damage(x, y, z, amount) === 'broken') this.stats.blocksBroken++;
    // Bears smash: the blocks beside the one they break crack too.
    const smash = defOf(c).abilities.smash ?? 0;
    if (smash <= 0) return;
    for (const [dx, dy, dz] of SMASH_NEIGHBOURS) if (this.base.damage(x + dx, y + dy, z + dz, amount * smash) === 'broken') this.stats.blocksBroken++;
  }

  biteMult(): number {
    return this.modifiers.armour * this.totals.armour;
  }

  // ---- saving --------------------------------------------------------------------------------

  toState(): DefenseState {
    return {
      site: { ...this.site },
      base: this.base.toState(),
      clock: Math.round(this.clock * 10) / 10,
      wave: this.wave,
      nextWaveAt: Math.round(this.nextWaveAt * 10) / 10,
      orders: this.orders.map((o) => ({ ...o })),
      points: this.points,
      score: this.score,
      budget: this.budget,
      budgetBuys: this.budgetBuys,
      allocation: this.allocation,
      stats: structuredClone(this.stats),
      outcome: this.outcome,
      modifiers: { ...this.modifiers },
      unlocked: [...this.unlocked],
      mainWeapon: this.mainWeapon,
      loadout: { ...this.loadout },
      tiers: this.tiers,
      strength: [...this.strength],
      perks: this.perks.map((p) => ({ ...p })),
      offers: this.offers.map((o) => o.map((p) => ({ ...p }))),
      offersMade: this.offersMade,
      milestones: this.milestones,
      rerolls: this.rerolls,
      rewarded: this.rewarded,
      bosses: this.bosses,
    };
  }
}
