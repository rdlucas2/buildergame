import { LineBasicMaterial, Vector3 } from 'three';
import { rayPlaneY } from '../core/raycast';
import type { DefenseStats } from '../core/defense-state';
import type { CreatureKind, CreatureSpecies, EcosystemState, Placement, RabbitRole, World } from '../core/world';
import { CreatureView } from '../render/creature-view';
import { DefenseView } from '../render/defense-view';
import { OutlineBox } from '../render/highlight';
import type { SceneHost } from '../render/scene';
import type { VoxelMaterials } from '../render/voxel-materials';
import { OVERLAYS, TerrainView, type Overlay } from '../render/terrain-view';
import { DAY_SECONDS, SPEEDS, TickAccumulator, daylight, dayNumber, formatClock, timeOfDay, type Speed } from '../sim/clock';
import { SPECIES, defOf, describeActivity, kindOf, maxHpOf, pickCreature, type Activity, type Creature } from '../sim/creatures';
import type { Defense, DefenseAction, ActionResult } from '../sim/defense/defense';
import { TIERS } from '../sim/defense/materials';
import { WEAPONS } from '../sim/defense/weapons';
import { Ecosystem, PACK_SIZE } from '../sim/ecosystem';
import { cellIndex, inGround, isShore } from '../sim/terrain';
import type { StructureLibrary } from '../storage/library';
import { openArmory, openPerkOffer } from '../ui/armory';
import { countOf, DefenseHud } from '../ui/defense-hud';
import { EcosystemHud, openNaturePanel } from '../ui/ecosystem-hud';
import { toast } from '../ui/toast';
import { FortifyTool } from './fortify-tool';
import type { WorldMode } from './world-mode';

/** Seconds of real time between repaints of the terrain while the simulation runs. */
const REPAINT_INTERVAL = 1;
/** How far away the crosshair can pick out a creature. */
const CREATURE_REACH = 64;
/** Creatures released at a time from the Nature panel: a few rabbits, or a wolf pack. */
export const RELEASE_COUNT: Record<CreatureSpecies, number> = { prey: 5, predator: PACK_SIZE };

/**
 * Runs the ecosystem of the current world when it is wild: owns the simulation, the ground view,
 * the time strip and the Nature panel, keeps sky cover in sync with placements, and drives the
 * day/night lighting. Plain worlds leave it idle.
 */
export class EcosystemController {
  private eco: Ecosystem | null = null;
  private worldId: string | null = null;
  private view: TerrainView | null = null;
  private creatureView: CreatureView | null = null;
  private readonly hoverBox = new OutlineBox(new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), 0.02);
  private hoveredId: number | null = null;
  private readonly tmpDir = new Vector3();
  private readonly acc = new TickAccumulator();
  private readonly hud: EcosystemHud;
  private readonly defenseHud: DefenseHud;
  private defenseView: DefenseView | null = null;
  /** Building and breaking the warren's blocks (Warren Defense only). */
  readonly fortify = new FortifyTool();
  private repaintTimer = 0;
  private litBySim = false;
  speed: Speed = 1;
  overlay: Overlay = 'none';
  /** Called when the player changes something worth saving (speed and overlay are not saved). */
  onActivity?: () => void;
  /** Warren Defense: the round was lost (the game shows the summary). */
  onRoundOver?: () => void;
  /** Warren Defense: the Fortify button was pressed. */
  onToggleFortify?: () => void;

  constructor(
    private readonly host: SceneHost,
    private readonly worldMode: WorldMode,
    private readonly library: StructureLibrary,
    container: HTMLElement,
    private readonly materials: VoxelMaterials,
  ) {
    this.hoverBox.object.name = 'creature-hover';
    this.hud = new EcosystemHud(container, {
      onSpeed: (s) => this.setSpeed(s),
      onNature: () => this.openPanel(),
    });
    this.defenseHud = new DefenseHud(container, {
      onCallWave: () => this.report(this.applyDefense({ type: 'callWave' }), 'The next wave is on its way.'),
      onBuyBudget: () => this.report(this.applyDefense({ type: 'buyBudget' }), 'Block budget raised by 100.'),
      onAllocate: (delta) => {
        const d = this.defense;
        if (d) this.applyDefense({ type: 'allocate', defenders: d.allocation + delta });
      },
      onFortify: () => this.onToggleFortify?.(),
      onPerk: () => this.openPerks(),
      onRepair: () => this.report(this.applyDefense({ type: 'repair' }), 'Repairs done.'),
      onArmory: () => this.openArmory(),
    });
    worldMode.group.add(this.fortify.group);
    const lookup = (id: string) => this.library.get(id);
    worldMode.onPlacementAdded = (p: Placement) => {
      this.eco?.placementAdded(p, lookup);
      this.view?.requestRefresh();
    };
    worldMode.onPlacementRemoved = (id: string) => {
      this.eco?.placementRemoved(id);
      this.view?.requestRefresh();
    };
    worldMode.onPlacementsReset = (placements) => {
      this.eco?.setPlacements(placements, lookup);
      this.view?.requestRefresh();
    };
  }

  get active(): boolean {
    return this.eco !== null;
  }

  get ecosystem(): Ecosystem | null {
    return this.eco;
  }

  /** The Warren Defense round of the current world, if it is one. */
  get defense(): Defense | null {
    return this.eco?.defense ?? null;
  }

  /** Applies a defense action (from the HUD, Fortify mode or a bot) and refreshes what it changed. */
  applyDefense(action: DefenseAction): ActionResult {
    const d = this.defense;
    if (!d) return { ok: false, reason: 'Not a Warren Defense world.' };
    const r = d.apply(action);
    if (r.ok) this.onActivity?.();
    return r;
  }

  /** The Armory panel: weapons, block strength and perks. */
  openArmory(): boolean {
    const d = this.defense;
    if (!d) return false;
    openArmory(d, (a) => this.applyDefense(a));
    return true;
  }

  /** The waiting perk offer, if any. */
  openPerks(): boolean {
    const d = this.defense;
    if (!d) return false;
    openPerkOffer(d, (a) => this.applyDefense(a));
    return true;
  }

  private report(r: ActionResult, success: string): void {
    toast(r.ok ? success : (r.reason ?? 'Not possible right now.'), r.ok ? 'success' : 'error', 1800);
  }

  /** Starts (or keeps) the ecosystem for a world; stops it for plain worlds. */
  attach(world: World): void {
    if (!world.ecosystem) {
      this.detach();
      return;
    }
    if (this.eco && this.worldId === world.id) {
      this.eco.setPlacements(this.worldMode.world.placements, (id) => this.library.get(id));
      this.view?.requestRefresh();
      return;
    }
    this.detach();
    this.eco = Ecosystem.restore(world.ground.size, world.ecosystem);
    this.worldId = world.id;
    this.eco.setPlacements(this.worldMode.world.placements, (id) => this.library.get(id));
    this.view = new TerrainView(this.eco);
    this.view.setOverlay(this.overlay);
    this.worldMode.group.add(this.view.group);
    this.creatureView = new CreatureView();
    this.worldMode.group.add(this.creatureView.group, this.hoverBox.object);
    this.creatureView.update(this.eco.population.creatures, 1);
    if (this.eco.defense) {
      this.defenseView = new DefenseView(this.eco.defense.base, this.eco.defense.combat, this.materials);
      this.worldMode.group.add(this.defenseView.group);
      this.defenseHud.setVisible(true);
      document.body.classList.add('defense');
    }
    this.acc.reset();
    this.hud.setVisible(true);
    document.body.classList.add('wild');
  }

  /** Throws away the current round and attaches the world afresh (a new round in the same world). */
  reattach(world: World): void {
    this.detach();
    this.attach(world);
  }

  detach(): void {
    if (this.view) {
      this.worldMode.group.remove(this.view.group);
      this.view.dispose();
    }
    this.view = null;
    if (this.creatureView) {
      this.worldMode.group.remove(this.creatureView.group, this.hoverBox.object);
      this.creatureView.dispose();
    }
    this.creatureView = null;
    if (this.defenseView) {
      this.worldMode.group.remove(this.defenseView.group);
      this.defenseView.dispose();
    }
    this.defenseView = null;
    this.fortify.setActive(false, null);
    this.defenseHud.setVisible(false);
    document.body.classList.remove('defense');
    this.hoverBox.hide();
    this.hoveredId = null;
    this.eco = null;
    this.worldId = null;
    this.hud.setVisible(false);
    document.body.classList.remove('wild');
    if (this.litBySim) {
      this.host.resetDaylight();
      this.litBySim = false;
    }
  }

  /** Per-frame update: runs whole simulation ticks, repaints the ground now and then, lights the scene. */
  frame(realDt: number, editing: boolean): void {
    const eco = this.eco;
    if (!eco) return;
    const ticks = this.acc.consume(realDt, this.speed);
    for (let i = 0; i < ticks; i++) eco.tick();
    if (ticks > 0) {
      this.repaintTimer += realDt;
      if (this.repaintTimer >= REPAINT_INTERVAL) {
        this.repaintTimer = 0;
        this.view?.requestRefresh();
      }
    }
    this.view?.update();
    const alpha = this.speed === 0 ? 1 : this.acc.alpha;
    this.creatureView?.update(eco.population.creatures, alpha, this.host.camera);
    this.defenseView?.update(realDt, alpha);
    this.updateHover(editing || this.fortify.active);
    if (editing) {
      if (this.litBySim) this.host.resetDaylight();
      this.litBySim = false;
    } else {
      this.host.applyDaylight(timeOfDay(eco.time));
      this.litBySim = true;
    }
    this.hud.setVisible(!editing);
    this.hud.update(eco.time, this.speed, eco.population.count('prey'), eco.population.count('predator'));
    for (const e of eco.events.splice(0)) {
      if (e.kind === 'pack') toast(`A pack of ${e.count} wolves has arrived. Rabbits are only safe where wolves can't follow: behind a 1-high gap, or walls 3 blocks high.`, 'info', 7000);
    }
    const d = eco.defense;
    if (d) {
      this.defenseHud.setVisible(!editing);
      this.defenseHud.update({
        clock: d.clock,
        wave: d.wave,
        nextWaveIn: d.nextWaveIn,
        points: d.points,
        cost: d.base.cost(),
        budget: d.budget,
        budgetPrice: d.budgetPrice,
        defenders: eco.population.creatures.filter((c) => c.role === 'defender' && c.deadFor < 0).length,
        breeders: eco.population.creatures.filter((c) => c.species === 'prey' && c.role !== 'defender' && c.deadFor < 0).length,
        allocation: d.allocation,
        predators: eco.population.count('predator'),
        fortifying: this.fortify.active,
        over: d.over,
        offers: d.offers.length,
        repairPrice: d.repairPrice,
      });
      for (const e of d.events.splice(0)) {
        if (e.kind === 'wave') {
          const parts = Object.entries(e.counts).map(([k, n]) => countOf(k, n));
          toast(`Wave ${e.n}: ${parts.join(', ')}`, 'info', 3500);
        } else if (e.kind === 'lost') {
          this.onRoundOver?.();
        } else if (e.kind === 'unlock') {
          toast(`${WEAPONS[e.weapon].name} unlocked!${d.mainWeapon === e.weapon ? ' Defenders now carry it.' : ''}`, 'success', 4000);
        } else if (e.kind === 'tier') {
          toast(`${TIERS[e.tier].name} blocks unlocked for Fortify.`, 'success', 4000);
        } else if (e.kind === 'offer') {
          if (e.pending === 1) toast('A perk to choose: press K.', 'info', 3000);
        } else if (e.kind === 'milestone') {
          toast(`${e.minutes}:00 survived! A rare perk is waiting (K).`, 'success', 4500);
        }
      }
    }
  }

  /** Finds the creature under the crosshair (in front of any block or the ground) and outlines it. */
  private updateHover(editing: boolean): void {
    const eco = this.eco;
    this.hoveredId = null;
    if (eco && !editing) {
      const cam = this.host.camera;
      const dir = cam.getWorldDirection(this.tmpDir);
      const reach = Math.min(CREATURE_REACH, this.worldMode.hitDistance + 0.25);
      const hit = pickCreature(eco.population.creatures, cam.position, dir, reach);
      if (hit) {
        const c = hit.creature;
        this.hoveredId = c.id;
        const [r, h] = defOf(c).box;
        this.hoverBox.setBox({ x: c.x - r - 0.05, y: c.y, z: c.z - r - 0.05 }, { x: r * 2 + 0.1, y: h + 0.05, z: r * 2 + 0.1 });
        return;
      }
    }
    this.hoverBox.hide();
  }

  /** The creature under the crosshair, if any. */
  hovered(): Creature | null {
    if (this.hoveredId === null || !this.eco) return null;
    const c = this.eco.population.get(this.hoveredId);
    return c && c.deadFor < 0 ? c : null;
  }

  /** One status line describing the creature under the crosshair, or null. */
  hoverText(): string | null {
    const c = this.hovered();
    if (!c) return null;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const def = defOf(c);
    if (this.defense && c.species === 'predator') {
      return `${def.name} · ${describeActivity(c)} · health ${Math.ceil(c.health * maxHpOf(c))}/${maxHpOf(c)}`;
    }
    const age = c.age < def.maturity ? 'young' : `${(c.age / DAY_SECONDS).toFixed(1)} days old`;
    const role = c.role ? ` ${c.role === 'defender' ? 'defender' : 'breeder'}` : '';
    return `${def.name}${role} (${age}) · ${describeActivity(c)} · food ${pct(c.satiety)} · water ${pct(c.hydration)} · energy ${pct(c.energy)} · health ${pct(c.health)}`;
  }

  /**
   * Releases creatures where the crosshair meets the ground (or below the camera when it looks at
   * the sky). Returns how many appeared.
   */
  releaseAtCrosshair(species: CreatureSpecies = 'prey', count = RELEASE_COUNT[species]): number {
    const cam = this.host.camera;
    const dir = cam.getWorldDirection(this.tmpDir);
    const ray = { origin: { x: cam.position.x, y: cam.position.y, z: cam.position.z }, direction: { x: dir.x, y: dir.y, z: dir.z } };
    const t = rayPlaneY(ray, 0);
    const at = t !== null && t <= CREATURE_REACH * 2 ? { x: ray.origin.x + dir.x * t, z: ray.origin.z + dir.z * t } : { x: cam.position.x, z: cam.position.z };
    return this.release(species, Math.floor(at.x), Math.floor(at.z), count);
  }

  release(species: CreatureSpecies, x: number, z: number, count: number): number {
    if (!this.eco) return 0;
    const n = this.eco.release(species, x, z, count);
    if (n > 0) {
      this.creatureView?.update(this.eco.population.creatures, 1);
      this.onActivity?.();
    }
    return n;
  }

  /** A summary of the Warren Defense round (tests, debugging and bots), or null. */
  defenseInfo(): DefenseInfo | null {
    const eco = this.eco;
    const d = eco?.defense;
    if (!eco || !d) return null;
    const rabbits = eco.population.creatures.filter((c) => c.species === 'prey' && c.deadFor < 0);
    return {
      clock: d.clock,
      wave: d.wave,
      nextWaveIn: d.nextWaveIn,
      points: d.points,
      score: d.score,
      budget: d.budget,
      cost: d.base.cost(),
      blocks: d.base.blocks(),
      budgetPrice: d.budgetPrice,
      allocation: d.allocation,
      defenders: rabbits.filter((c) => c.role === 'defender').length,
      breeders: rabbits.filter((c) => c.role !== 'defender').length,
      predators: eco.population.count('predator'),
      outcome: d.outcome,
      site: { ...d.site },
      origin: { ...d.base.origin },
      posts: d.base.posts().map((p) => ({ ...p })),
      damaged: d.base.damaged().length,
      stats: structuredClone(d.stats),
      fortifying: this.fortify.active,
      unlocked: [...d.unlocked],
      mainWeapon: d.mainWeapon,
      loadout: { ...d.loadout },
      tiers: d.tiers,
      strength: [...d.strength],
      perks: d.perks.length,
      offers: d.offers.length,
      repairPrice: d.repairPrice,
    };
  }

  /** Living creatures (tests and debugging). */
  creatures(): CreatureInfo[] {
    if (!this.eco) return [];
    return this.eco.population.creatures
      .filter((c) => c.deadFor < 0)
      .map((c) => ({
        id: c.id,
        species: c.species,
        x: c.x,
        y: c.y,
        z: c.z,
        activity: c.activity,
        satiety: c.satiety,
        hydration: c.hydration,
        energy: c.energy,
        health: c.health,
        age: c.age,
        kind: kindOf(c),
        role: c.role ?? null,
      }));
  }

  /** The state to save with the world, or undefined for plain worlds. */
  snapshot(): EcosystemState | undefined {
    return this.eco?.snapshot();
  }

  setSpeed(s: Speed): void {
    this.speed = s;
    this.acc.reset();
    if (this.eco) this.hud.update(this.eco.time, s, this.eco.population.count('prey'), this.eco.population.count('predator'));
  }

  cycleSpeed(): Speed {
    const i = SPEEDS.indexOf(this.speed);
    this.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
    return this.speed;
  }

  setOverlay(o: Overlay): void {
    this.overlay = o;
    this.view?.setOverlay(o);
  }

  cycleOverlay(): Overlay {
    const i = OVERLAYS.indexOf(this.overlay);
    this.setOverlay(OVERLAYS[(i + 1) % OVERLAYS.length]);
    return this.overlay;
  }

  openPanel(): void {
    const eco = this.eco;
    if (!eco) return;
    let covered = 0;
    for (let i = 0; i < eco.vegetation.cover.length; i++) if (eco.vegetation.cover[i] > 0) covered++;
    const pop = eco.population;
    openNaturePanel(
      {
        clock: formatClock(eco.time),
        grassCoverage: eco.vegetation.coverage(),
        waterShare: eco.terrain.waterCells / (eco.size * eco.size),
        coveredCells: covered,
        prey: pop.count('prey'),
        preyCap: SPECIES.prey.cap,
        wolves: pop.count('predator'),
        wolfCap: SPECIES.predator.cap,
        tally: { ...pop.tally },
        history: pop.history.map(([t, a, b]) => [t, a, b] as [number, number, number]),
      },
      this.overlay,
      {
        onOverlay: (o) => this.setOverlay(o),
        onRelease: (species) => this.releaseAtCrosshair(species),
      },
    );
  }

  /** Runs the simulation forward immediately (tests and debugging), then repaints. */
  advance(seconds: number): void {
    if (!this.eco) return;
    this.eco.advance(seconds);
    this.view?.refreshAll();
  }

  info(): EcosystemInfo | null {
    const eco = this.eco;
    if (!eco) return null;
    let covered = 0;
    for (let i = 0; i < eco.vegetation.cover.length; i++) if (eco.vegetation.cover[i] > 0) covered++;
    return {
      seed: eco.seed,
      time: eco.time,
      day: dayNumber(eco.time),
      clock: formatClock(eco.time),
      timeOfDay: timeOfDay(eco.time),
      daylight: daylight(eco.time),
      speed: this.speed,
      overlay: this.overlay,
      waterCells: eco.terrain.waterCells,
      coveredCells: covered,
      prey: eco.population.count('prey'),
      predators: eco.population.count('predator'),
      tally: { ...eco.population.tally },
      historyLength: eco.population.history.length,
    };
  }

  cell(x: number, z: number): EcosystemCell | null {
    const eco = this.eco;
    if (!eco || !inGround(eco.size, x, z)) return null;
    const i = cellIndex(eco.size, x, z);
    return {
      water: eco.terrain.water[i] === 1,
      shore: isShore(eco.terrain, x, z),
      biomass: eco.vegetation.biomass[i],
      skylit: eco.vegetation.cover[i] === 0,
      safe: eco.safety.isSafe(x, 0, z),
      color: this.view ? this.view.colorAt(x, z) : null,
    };
  }

  /** Nearest water cell to (x, z) within `radius`, for tests and tools. */
  nearestWater(x: number, z: number, radius = 200): { x: number; z: number } | null {
    const eco = this.eco;
    if (!eco) return null;
    for (let r = 0; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = x + dx, cz = z + dz;
          if (inGround(eco.size, cx, cz) && eco.terrain.water[cellIndex(eco.size, cx, cz)]) return { x: cx, z: cz };
        }
      }
    }
    return null;
  }
}

export interface EcosystemInfo {
  seed: number;
  time: number;
  day: number;
  clock: string;
  timeOfDay: number;
  daylight: number;
  speed: Speed;
  overlay: Overlay;
  waterCells: number;
  coveredCells: number;
  prey: number;
  predators: number;
  tally: Record<string, number>;
  historyLength: number;
}

export interface DefenseInfo {
  clock: number;
  wave: number;
  nextWaveIn: number;
  points: number;
  score: number;
  budget: number;
  cost: number;
  blocks: number;
  budgetPrice: number;
  allocation: number;
  defenders: number;
  breeders: number;
  predators: number;
  outcome: string;
  site: { x: number; z: number };
  origin: { x: number; z: number };
  posts: Array<{ x: number; y: number; z: number }>;
  damaged: number;
  stats: DefenseStats;
  unlocked: string[];
  mainWeapon: string;
  loadout: Record<string, number>;
  tiers: number;
  strength: number[];
  perks: number;
  offers: number;
  repairPrice: number;
  fortifying: boolean;
}

export interface CreatureInfo {
  id: number;
  species: CreatureSpecies;
  x: number;
  y: number;
  z: number;
  activity: Activity;
  satiety: number;
  hydration: number;
  energy: number;
  health: number;
  age: number;
  kind: CreatureKind;
  role: RabbitRole | null;
}

export interface EcosystemCell {
  water: boolean;
  shore: boolean;
  biomass: number;
  skylit: boolean;
  /** Safe from predators when standing on the ground here. */
  safe: boolean;
  color: [number, number, number] | null;
}
