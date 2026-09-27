import type { EcosystemState, Placement, World } from '../core/world';
import type { SceneHost } from '../render/scene';
import { OVERLAYS, TerrainView, type Overlay } from '../render/terrain-view';
import { SPEEDS, TickAccumulator, daylight, dayNumber, formatClock, timeOfDay, type Speed } from '../sim/clock';
import { Ecosystem } from '../sim/ecosystem';
import { cellIndex, inGround, isShore } from '../sim/terrain';
import type { StructureLibrary } from '../storage/library';
import { EcosystemHud, openNaturePanel } from '../ui/ecosystem-hud';
import type { WorldMode } from './world-mode';

/** Seconds of real time between repaints of the terrain while the simulation runs. */
const REPAINT_INTERVAL = 1;

/**
 * Runs the ecosystem of the current world when it is wild: owns the simulation, the ground view,
 * the time strip and the Nature panel, keeps sky cover in sync with placements, and drives the
 * day/night lighting. Plain worlds leave it idle.
 */
export class EcosystemController {
  private eco: Ecosystem | null = null;
  private worldId: string | null = null;
  private view: TerrainView | null = null;
  private readonly acc = new TickAccumulator();
  private readonly hud: EcosystemHud;
  private repaintTimer = 0;
  private litBySim = false;
  speed: Speed = 1;
  overlay: Overlay = 'none';
  /** Called when the player changes something worth saving (speed and overlay are not saved). */
  onActivity?: () => void;

  constructor(
    private readonly host: SceneHost,
    private readonly worldMode: WorldMode,
    private readonly library: StructureLibrary,
    container: HTMLElement,
  ) {
    this.hud = new EcosystemHud(container, {
      onSpeed: (s) => this.setSpeed(s),
      onNature: () => this.openPanel(),
    });
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
    this.acc.reset();
    this.hud.setVisible(true);
    document.body.classList.add('wild');
  }

  detach(): void {
    if (this.view) {
      this.worldMode.group.remove(this.view.group);
      this.view.dispose();
    }
    this.view = null;
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
    if (editing) {
      if (this.litBySim) this.host.resetDaylight();
      this.litBySim = false;
    } else {
      this.host.applyDaylight(timeOfDay(eco.time));
      this.litBySim = true;
    }
    this.hud.setVisible(!editing);
    this.hud.update(eco.time, this.speed);
  }

  /** The state to save with the world, or undefined for plain worlds. */
  snapshot(): EcosystemState | undefined {
    return this.eco?.snapshot();
  }

  setSpeed(s: Speed): void {
    this.speed = s;
    this.acc.reset();
    if (this.eco) this.hud.update(this.eco.time, s);
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
    openNaturePanel(
      {
        clock: formatClock(eco.time),
        grassCoverage: eco.vegetation.coverage(),
        waterShare: eco.terrain.waterCells / (eco.size * eco.size),
        coveredCells: covered,
      },
      this.overlay,
      (o) => this.setOverlay(o),
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
}

export interface EcosystemCell {
  water: boolean;
  shore: boolean;
  biomass: number;
  skylit: boolean;
  color: [number, number, number] | null;
}
