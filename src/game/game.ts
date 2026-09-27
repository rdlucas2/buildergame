import { decodeWorldBundle, encodeWorldBundle, resolveBundleConflicts } from '../core/format/bundle';
import { base64ToBytes, bytesToBase64 } from '../core/format/rle';
import { serializeStructure, structureDownloadName } from '../core/format/structure-file';
import { worldDownloadName } from '../core/format/world-file';
import { newId } from '../core/ids';
import { getMaterial } from '../core/materials';
import type { Vec3 } from '../core/math';
import type { Rotation } from '../core/rotation';
import { EmptyStructureError, structureBlockCount, type Structure } from '../core/structure';
import { createWorld, referencedStructureIds, touchWorld, type Placement, type World } from '../core/world';
import { buildStructureGeometry, StructureGeometryCache } from '../render/structure-geometry';
import { SceneHost } from '../render/scene';
import { renderThumbnail } from '../render/thumbnail';
import { createVoxelMaterials, type VoxelMaterials } from '../render/voxel-materials';
import { downloadBlob, downloadBytes, downloadText, pickFiles, readFileBytes, readFileText } from '../storage/files';
import { StructureLibrary } from '../storage/library';
import { WorldStore } from '../storage/worlds';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import { openHelp } from '../ui/help';
import { Hud } from '../ui/hud';
import { openLibraryPanel } from '../ui/library-panel';
import { openMaterialPicker } from '../ui/material-picker';
import { closePanel, isPanelOpen, onPanelChange } from '../ui/panel';
import { toast } from '../ui/toast';
import { openWorldPanel } from '../ui/world-panel';
import { FlyControls, isTypingTarget, type Pose } from './fly-controls';
import { DEFAULT_HOTBAR, StructureMode } from './structure-mode';
import { WorldMode } from './world-mode';

const HOLD_DELAY = 0.25;
const HOLD_REPEAT = 0.1;

export class Game {
  readonly host: SceneHost;
  readonly controls: FlyControls;
  readonly materials: VoxelMaterials;
  readonly cache = new StructureGeometryCache();
  readonly hud: Hud;
  worldMode: WorldMode;
  structureMode: StructureMode | null = null;
  hotbar: string[];

  private running = false;
  private lastTime = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private worldPoseBackup: Pose | null = null;
  private pointerLockUnavailable = false;
  private holdButton: number | null = null;
  private holdTimer = 0;
  private lastActedCell: string | null = null;
  private hudTimer = 0;
  private frameWaiters: Array<() => void> = [];

  static async create(container: HTMLElement): Promise<Game> {
    const library = new StructureLibrary();
    const worlds = new WorldStore();
    await library.open();
    await worlds.open();
    let world = worlds.activeWorldId ? worlds.get(worlds.activeWorldId) : undefined;
    if (!world) {
      const first = worlds.list()[0];
      world = first ? worlds.get(first.id) : undefined;
    }
    if (!world) {
      world = createWorld({ name: 'My World' });
      await worlds.save(world);
    }
    await worlds.setActiveWorldId(world.id);
    return new Game(container, library, worlds, world);
  }

  constructor(
    readonly container: HTMLElement,
    readonly library: StructureLibrary,
    readonly worlds: WorldStore,
    world: World,
  ) {
    this.host = new SceneHost(container);
    this.controls = new FlyControls(this.host.camera, this.host.canvas);
    this.materials = createVoxelMaterials();
    this.hotbar = [...worlds.getSetting<string[]>('hotbar', DEFAULT_HOTBAR)];
    this.hud = new Hud({
      onLibrary: () => this.openLibrary(),
      onWorld: () => this.openWorldMenu(),
      onHelp: () => openHelp(),
      onStructure: () => (this.structureMode ? void this.saveStructure() : void this.enterStructureMode()),
    });
    container.appendChild(this.hud.root);

    this.worldMode = new WorldMode(world, library, this.cache, this.materials);
    this.worldMode.onChange = () => this.scheduleSave();
    this.host.scene.add(this.worldMode.group);
    this.applyWorldPose(world);

    this.bindInput();
    this.refreshHudChrome();
    this.start();
  }

  // ---- lifecycle -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.frame(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }

  private frame(dt: number): void {
    if (!isPanelOpen()) this.controls.update(dt);
    if (this.structureMode) this.structureMode.update(this.host.camera);
    else this.worldMode.update(this.host.camera);
    this.updateHold(dt);
    this.hudTimer += dt;
    if (this.hudTimer > 0.1) {
      this.hudTimer = 0;
      this.updateHudStatus();
    }
    this.host.render();
    const waiters = this.frameWaiters;
    this.frameWaiters = [];
    for (const w of waiters) w();
  }

  nextFrame(): Promise<void> {
    return new Promise((resolve) => this.frameWaiters.push(resolve));
  }

  get interactive(): boolean {
    return (this.controls.isLocked || this.pointerLockUnavailable) && !isPanelOpen();
  }

  // ---- input -----------------------------------------------------------------------------

  private bindInput(): void {
    const canvas = this.host.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (isPanelOpen()) return;
      if (!this.controls.isLocked && !this.pointerLockUnavailable) {
        this.controls.lock();
        return;
      }
      this.act(e.button);
      this.holdButton = e.button;
      this.holdTimer = 0;
      this.lastActedCell = this.currentCellKey();
    });
    document.addEventListener('mouseup', () => (this.holdButton = null));
    this.controls.onLockFailed = () => {
      this.pointerLockUnavailable = true;
      this.hud.setStartVisible(false);
      toast('Pointer lock is not available here; click the game to act, use the keys to move.', 'info');
    };
    this.controls.onLockChange = (locked) => {
      this.hud.setStartVisible(!locked && !this.pointerLockUnavailable && !isPanelOpen());
      this.holdButton = null;
    };
    onPanelChange((open) => {
      if (open) this.controls.unlock();
      this.controls.enabled = !open;
      this.hud.setStartVisible(!open && !this.controls.isLocked && !this.pointerLockUnavailable);
      this.holdButton = null;
    });
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target) || isPanelOpen()) return;
      if (this.handleKey(e.code, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })) e.preventDefault();
    });
    window.addEventListener('beforeunload', () => this.flushSave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushSave();
    });
  }

  private currentCellKey(): string | null {
    const sm = this.structureMode;
    if (!sm) return null;
    const c = this.holdButton === 0 ? sm.hover.voxel : sm.hover.place;
    return c ? `${c.x},${c.y},${c.z}` : null;
  }

  private updateHold(dt: number): void {
    if (this.holdButton === null || !this.structureMode || !this.interactive) return;
    this.holdTimer += dt;
    if (this.holdTimer < HOLD_DELAY) return;
    const key = this.currentCellKey();
    if (key && key !== this.lastActedCell) {
      this.act(this.holdButton);
      this.lastActedCell = key;
      this.holdTimer = HOLD_DELAY - HOLD_REPEAT;
    }
  }

  /** Mouse action: 0 = left, 1 = middle, 2 = right. */
  act(button: number): boolean {
    const sm = this.structureMode;
    if (sm) {
      if (button === 0) return sm.remove();
      if (button === 2) return sm.place();
      if (button === 1) {
        const m = sm.pick();
        if (m) this.hud.setHotbar(sm.hotbar, sm.selected);
        return m !== null;
      }
      return false;
    }
    const wm = this.worldMode;
    if (button === 0) {
      if (!wm.placing) return false;
      const placed = wm.confirmPlacement();
      if (placed) {
        toast(`Placed ${wm.placing?.structure.name ?? this.library.get(placed.structureId)?.name ?? 'structure'}`, 'success', 1500);
      } else if (wm.placing.check && !wm.placing.check.ok) {
        toast(describeRejection(wm.placing.check.reason), 'error', 1800);
      }
      return !!placed;
    }
    if (button === 2 && wm.placing) {
      wm.cancelPlacing();
      return true;
    }
    return false;
  }

  /** Keyboard action by KeyboardEvent.code. Returns true when handled. */
  handleKey(code: string, mods: { ctrl?: boolean; shift?: boolean } = {}): boolean {
    const sm = this.structureMode;
    if (mods.ctrl && (code === 'KeyZ' || code === 'KeyY')) {
      const stack = sm ? sm.undo : this.worldMode.undo;
      const redo = code === 'KeyY' || (code === 'KeyZ' && mods.shift);
      const cmd = redo ? stack.redo() : stack.undo();
      if (cmd) toast(`${redo ? 'Redo' : 'Undo'}: ${cmd.label}`, 'info', 1200);
      if (!sm && cmd) this.scheduleSave();
      return true;
    }
    if (code === 'KeyH') {
      openHelp();
      return true;
    }
    if (code === 'KeyP') {
      this.screenshot();
      return true;
    }
    if (sm) {
      if (/^Digit[1-9]$/.test(code)) {
        sm.selectSlot(Number(code.slice(5)) - 1);
        this.hud.setHotbar(sm.hotbar, sm.selected);
        return true;
      }
      switch (code) {
        case 'KeyE':
          openMaterialPicker(sm.selectedMaterial, (id) => {
            sm.setSlotMaterial(sm.selected, id);
            this.hotbar = [...sm.hotbar];
            void this.worlds.setSetting('hotbar', this.hotbar);
            this.hud.setHotbar(sm.hotbar, sm.selected);
          });
          return true;
        case 'KeyQ':
          if (sm.pick()) this.hud.setHotbar(sm.hotbar, sm.selected);
          return true;
        case 'Enter':
        case 'NumpadEnter':
          void this.saveStructure();
          return true;
        case 'Escape':
          void this.discardStructure();
          return true;
        case 'Tab':
          return true;
      }
      return false;
    }
    const wm = this.worldMode;
    switch (code) {
      case 'Tab':
        this.openLibrary();
        return true;
      case 'KeyM':
        this.openWorldMenu();
        return true;
      case 'KeyB':
        void this.enterStructureMode();
        return true;
      case 'KeyR':
        wm.rotatePlacing(mods.shift ? -1 : 1);
        return !!wm.placing;
      case 'BracketRight':
        wm.liftPlacing(1);
        return !!wm.placing;
      case 'BracketLeft':
        wm.liftPlacing(-1);
        return !!wm.placing;
      case 'Escape':
        if (wm.placing) {
          wm.cancelPlacing();
          return true;
        }
        return false;
      case 'KeyX': {
        const p = wm.removeHovered();
        if (p) toast(`Removed ${this.library.get(p.structureId)?.name ?? 'structure'} (Ctrl+Z to undo)`, 'info', 1800);
        return !!p;
      }
      case 'KeyG': {
        const p = wm.pickUpHovered();
        if (p) toast('Moving structure: click to drop it, Esc to put it back', 'info', 2200);
        return !!p;
      }
    }
    return false;
  }

  // ---- structure mode --------------------------------------------------------------------

  async enterStructureMode(existing?: Structure): Promise<void> {
    if (this.structureMode) return;
    closePanel();
    this.worldMode.cancelPlacing();
    this.worldPoseBackup = this.controls.getPose();
    this.worldMode.group.visible = false;
    const sm = new StructureMode(this.materials, { hotbar: this.hotbar, ...(existing ? { existing } : {}) });
    this.structureMode = sm;
    this.host.scene.add(sm.group);
    this.controls.setPose(sm.startPose());
    this.refreshHudChrome();
    toast(existing ? `Editing "${existing.name}". Enter saves, Esc leaves.` : 'Structure mode: right click places, left click removes. Enter saves.', 'info', 3500);
  }

  private leaveStructureMode(): void {
    const sm = this.structureMode;
    if (!sm) return;
    this.structureMode = null;
    this.host.scene.remove(sm.group);
    sm.dispose();
    this.worldMode.group.visible = true;
    if (this.worldPoseBackup) this.controls.setPose(this.worldPoseBackup);
    this.worldPoseBackup = null;
    this.refreshHudChrome();
  }

  async saveStructure(): Promise<Structure | null> {
    const sm = this.structureMode;
    if (!sm) return null;
    if (sm.isEmpty) {
      toast('Place at least one block before saving.', 'error');
      return null;
    }
    const name = await promptDialog('Save structure', {
      label: 'Name',
      value: sm.editing?.name ?? `Structure ${this.library.size + 1}`,
      okLabel: 'Save',
    });
    if (name === null) return null;
    return this.saveStructureAs(name.trim() || 'Untitled');
  }

  /** Saves the structure being built under `name` (no prompt), returning it. */
  async saveStructureAs(name: string): Promise<Structure | null> {
    const sm = this.structureMode;
    if (!sm) return null;
    let s: Structure;
    try {
      s = sm.toStructure(name, this.worlds.author);
    } catch (e) {
      toast(e instanceof EmptyStructureError ? e.message : `Could not save: ${(e as Error).message}`, 'error');
      return null;
    }
    try {
      const geom = buildStructureGeometry(s);
      s.thumbnail = renderThumbnail(this.host.renderer, geom, this.materials);
      geom.opaque?.dispose();
      geom.transparent?.dispose();
    } catch (e) {
      console.warn('thumbnail failed', e);
    }
    await this.library.save(s);
    this.hotbar = [...sm.hotbar];
    void this.worlds.setSetting('hotbar', this.hotbar);
    const wasEditing = !!sm.editing;
    this.leaveStructureMode();
    const size = s.voxels.size;
    if (wasEditing) {
      this.worldMode.refreshStructure(s.id);
      this.warnOverlaps(s);
      toast(`Saved "${s.name}" (${size.x}×${size.y}×${size.z})`, 'success');
    } else {
      this.worldMode.startPlacing(s);
      toast(`Saved "${s.name}" (${size.x}×${size.y}×${size.z}). Click to place it, R rotates, Esc cancels.`, 'success', 4000);
    }
    return s;
  }

  async discardStructure(): Promise<boolean> {
    const sm = this.structureMode;
    if (!sm) return false;
    if (sm.undo.canUndo && !(await confirmDialog('Leave structure mode?', 'Unsaved changes will be lost.', 'Leave', true))) return false;
    this.leaveStructureMode();
    return true;
  }

  private warnOverlaps(s: Structure): void {
    let overlapping = 0;
    for (const p of this.worldMode.placementsOf(s.id)) {
      const check = this.worldMode.evaluate(s, p.position, p.rotation);
      if (!check.ok) overlapping++;
    }
    if (overlapping) toast(`${overlapping} placement${overlapping === 1 ? '' : 's'} of "${s.name}" now overlap${overlapping === 1 ? 's' : ''} something. Move them with G.`, 'error', 5000);
  }

  // ---- panels ----------------------------------------------------------------------------

  openLibrary(): void {
    if (this.structureMode) return;
    const render = (): void => {
      openLibraryPanel(
        this.library.all(),
        {
          onPlace: (s) => {
            closePanel();
            this.worldMode.startPlacing(s);
            toast(`Placing "${s.name}": click to place, R rotates, Esc cancels.`, 'info', 3000);
          },
          onEdit: (s) => void this.enterStructureMode(s),
          onDuplicate: async (s) => {
            const copy: Structure = { ...s, id: newId(), name: `${s.name} (copy)`, voxels: s.voxels.clone(), palette: s.palette.map((p) => ({ ...p })) };
            await this.library.save(copy);
            render();
          },
          onRename: async (s) => {
            const name = await promptDialog('Rename structure', { label: 'Name', value: s.name, okLabel: 'Rename' });
            if (name === null) return render();
            await this.library.save(touchStructureName(s, name.trim() || s.name));
            render();
          },
          onExport: (s) => downloadText(structureDownloadName(s), serializeStructure(s)),
          onDelete: async (s) => {
            const placed = this.worldMode.placementsOf(s.id).length;
            const ok = await confirmDialog(
              'Delete structure?',
              placed ? `"${s.name}" is placed ${placed} time${placed === 1 ? '' : 's'} in this world; those will be removed too.` : `Delete "${s.name}" from your library?`,
              'Delete',
              true,
            );
            if (!ok) return render();
            this.worldMode.removeAllOf(s.id);
            await this.library.remove(s.id);
            this.cache.invalidate(s.id);
            render();
          },
          onImport: async () => {
            const files = await pickFiles('.json,application/json', true);
            for (const f of files) await this.importStructureText(await readFileText(f), f.name);
            render();
          },
          onNew: () => void this.enterStructureMode(),
        },
        { canPlace: true },
      );
    };
    render();
  }

  async importStructureText(text: string, label = 'file'): Promise<Structure | null> {
    try {
      const r = await this.library.importText(text);
      const msg = r.outcome === 'reused' ? `"${r.structure.name}" was already in your library` : r.outcome === 'renamed' ? `Imported "${r.structure.name}" as a new copy` : `Imported "${r.structure.name}"`;
      toast(msg, 'success');
      return r.structure;
    } catch (e) {
      toast(`${label}: ${(e as Error).message}`, 'error', 6000);
      return null;
    }
  }

  openWorldMenu(): void {
    if (this.structureMode) return;
    const render = (): void => {
      openWorldPanel(
        { worlds: this.worlds.list(), activeId: this.worldMode.world.id, author: this.worlds.author, persistent: this.library.persistent },
        {
          onOpen: (id) => void this.switchWorld(id).then(() => closePanel()),
          onNew: async () => {
            const name = await promptDialog('New world', { label: 'World name', value: `World ${this.worlds.list().length + 1}`, okLabel: 'Create' });
            if (name === null) return render();
            await this.createWorld(name.trim() || 'Untitled world');
            closePanel();
          },
          onRename: async () => {
            const w = this.worldMode.world;
            const name = await promptDialog('Rename world', { label: 'World name', value: w.name, okLabel: 'Rename' });
            if (name === null) return render();
            this.worldMode.load({ ...w, name: name.trim() || w.name });
            await this.flushSave();
            render();
          },
          onDelete: async (id) => {
            const w = this.worlds.get(id);
            if (!w) return;
            if (!(await confirmDialog('Delete world?', `Delete "${w.name}" and its ${w.placements.length} placements? Structures stay in your library.`, 'Delete', true))) return render();
            const wasActive = id === this.worldMode.world.id;
            await this.worlds.remove(id);
            if (wasActive) {
              const next = this.worlds.list()[0];
              if (next) await this.switchWorld(next.id);
              else await this.createWorld('My World');
            }
            render();
          },
          onExport: () => this.exportWorld(),
          onImport: async () => {
            const files = await pickFiles('.zip,application/zip', false);
            if (files[0]) await this.importWorldBundle(await readFileBytes(files[0]), files[0].name);
            render();
          },
          onSetAuthor: (name) => void this.worlds.setAuthor(name.trim()),
          onSetSpawn: async () => {
            const pose = this.controls.getPose();
            this.worldMode.load({ ...this.worldMode.world, spawn: { position: pose.position, yaw: pose.yaw, pitch: pose.pitch } });
            await this.flushSave();
            toast('Spawn point set to where you are.', 'success');
            render();
          },
        },
      );
    };
    render();
  }

  // ---- worlds ----------------------------------------------------------------------------

  async createWorld(name: string): Promise<World> {
    const w = createWorld({ name });
    await this.worlds.save(w);
    await this.switchWorld(w.id);
    return w;
  }

  async switchWorld(id: string): Promise<boolean> {
    const w = this.worlds.get(id);
    if (!w) return false;
    await this.flushSave();
    if (this.structureMode) this.leaveStructureMode();
    await this.worlds.setActiveWorldId(id);
    const dropped = this.worldMode.load(w);
    if (dropped.length) toast(`${dropped.length} placement${dropped.length === 1 ? '' : 's'} referenced structures that are not in your library and were dropped.`, 'error', 6000);
    this.applyWorldPose(w);
    this.refreshHudChrome();
    return true;
  }

  private applyWorldPose(w: World): void {
    const saved = this.worlds.getSetting<Pose | null>(`pose:${w.id}`, null);
    this.controls.setPose(saved ?? { position: [...w.spawn.position], yaw: w.spawn.yaw, pitch: w.spawn.pitch });
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), 400);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const w = this.worldMode.world;
    await this.worlds.save(w);
    await this.worlds.setSetting(`pose:${w.id}`, this.controls.getPose());
  }

  exportWorld(): void {
    const w = this.worldMode.world;
    downloadBytes(worldDownloadName(w), this.encodeWorldBundle());
    toast(`Exported "${w.name}" with ${referencedStructureIds(w).length} structures.`, 'success');
  }

  encodeWorldBundle(): Uint8Array {
    const w = touchWorld(this.worldMode.world);
    const structures = referencedStructureIds(w).map((id) => this.library.get(id)).filter((s): s is Structure => !!s);
    return encodeWorldBundle({ world: w, structures });
  }

  async importWorldBundle(bytes: Uint8Array, label = 'bundle'): Promise<World | null> {
    try {
      const decoded = decodeWorldBundle(bytes);
      const r = resolveBundleConflicts(decoded, (id) => this.library.get(id), (id) => this.worlds.has(id));
      await this.library.saveMany(r.bundle.structures);
      await this.worlds.save(r.bundle.world);
      await this.switchWorld(r.bundle.world.id);
      toast(`Imported world "${r.bundle.world.name}" with ${r.bundle.world.placements.length} placements (${r.bundle.structures.length} new structures).`, 'success', 5000);
      return r.bundle.world;
    } catch (e) {
      toast(`${label}: ${(e as Error).message}`, 'error', 6000);
      return null;
    }
  }

  screenshot(): void {
    const url = this.host.screenshot();
    void fetch(url)
      .then((r) => r.blob())
      .then((b) => downloadBlob(`buildergame-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, b));
    toast('Screenshot saved.', 'success', 1500);
  }

  // ---- HUD -------------------------------------------------------------------------------

  private refreshHudChrome(): void {
    const sm = this.structureMode;
    this.hud.setHotbarVisible(!!sm);
    if (sm) {
      this.hud.setMode(sm.editing ? `Structure mode — editing "${sm.editing.name}"` : 'Structure mode');
      this.hud.setHotbar(sm.hotbar, sm.selected);
      this.hud.structureBtn.textContent = 'Save structure (Enter)';
      this.hud.setHint('Right click: place · Left click: remove · 1–9: material · E: all materials · Ctrl+Z: undo · Enter: save · Esc: leave');
    } else {
      this.hud.setMode(`World: ${this.worldMode.world.name}`);
      this.hud.structureBtn.textContent = 'Build structure (B)';
      this.hud.setHint('Tab: library · B: build a structure · M: worlds · H: help');
    }
    this.updateHudStatus();
  }

  private updateHudStatus(): void {
    const p = this.host.camera.position;
    const pos = `Position ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    const sm = this.structureMode;
    if (sm) {
      const d = sm.dimensions();
      const mat = getMaterial(sm.selectedMaterial)?.name ?? sm.selectedMaterial;
      this.hud.setStatus([
        d.size ? `Size ${d.size.x} × ${d.size.y} × ${d.size.z} (L × H × D)` : 'Empty — place your first block on the floor',
        `${d.blocks} block${d.blocks === 1 ? '' : 's'} · volume ${sm.volume.x} × ${sm.volume.y} × ${sm.volume.z}`,
        `Material: ${mat}`,
        pos,
      ]);
      return;
    }
    const wm = this.worldMode;
    const lines = [`${wm.world.placements.length} structure${wm.world.placements.length === 1 ? '' : 's'} placed`, pos];
    if (wm.placing) {
      const s = wm.placing.structure;
      const size = s.voxels.size;
      const c = wm.placing.check;
      const state = !wm.placing.target ? 'aim at the ground or a structure' : c?.ok ? 'fits here' : `blocked: ${describeRejection(c?.reason)}`;
      lines.push(`Placing "${s.name}" (${size.x}×${size.y}×${size.z}) · rotation ${wm.placing.rotation * 90}° · ${state}`);
      this.hud.setHint('Left click: place · R: rotate · [ / ]: lower / raise · Right click or Esc: cancel');
    } else {
      const h = wm.hoveredPlacement();
      if (h) {
        const size = h.structure.voxels.size;
        lines.push(`Looking at "${h.structure.name}" (${size.x}×${size.y}×${size.z}, ${structureBlockCount(h.structure)} blocks)`);
        this.hud.setHint('X: remove · G: move · Tab: library · B: build a structure');
      } else {
        this.hud.setHint('Tab: library · B: build a structure · M: worlds · H: help');
      }
    }
    this.hud.setStatus(lines);
  }

  // ---- debug / automation API ------------------------------------------------------------

  get debug(): GameDebug {
    const g = this;
    return {
      game: g,
      mode: () => (g.structureMode ? 'structure' : 'world'),
      nextFrame: () => g.nextFrame(),
      getPose: () => g.controls.getPose(),
      setPose: (pose) => g.controls.setPose(pose),
      look: (dx, dy) => g.controls.look(dx, dy),
      act: (button) => g.act(button),
      key: (code, mods) => g.handleKey(code, mods),
      enterStructureMode: (id) => g.enterStructureMode(id ? g.library.get(id) : undefined),
      setVoxel: (x, y, z, material) => g.structureMode?.setVoxel({ x, y, z }, material) ?? false,
      fillBox: (min, max, material) => g.structureMode?.fillBox(min, max, material) ?? 0,
      hover: () => g.structureMode?.hover ?? null,
      dimensions: () => g.structureMode?.dimensions() ?? null,
      saveStructure: (name) => g.saveStructureAs(name),
      discardStructure: () => g.discardStructure(),
      library: () => g.library.all().map((s) => ({ id: s.id, name: s.name, size: { ...s.voxels.size }, blocks: structureBlockCount(s), hasThumbnail: !!s.thumbnail })),
      exportStructure: (id) => {
        const s = g.library.get(id);
        return s ? serializeStructure(s) : null;
      },
      importStructure: (text) => g.importStructureText(text).then((s) => s?.id ?? null),
      startPlacing: (id, rotation = 0) => {
        const s = g.library.get(id);
        if (!s) return false;
        g.worldMode.startPlacing(s, { rotation });
        return true;
      },
      placing: () => {
        const p = g.worldMode.placing;
        return p ? { structureId: p.structure.id, rotation: p.rotation, target: p.target, ok: p.check?.ok ?? null, reason: p.check?.reason ?? null, colliding: p.check?.collidingIds ?? [] } : null;
      },
      rotatePlacing: () => g.worldMode.rotatePlacing(),
      confirmPlacement: () => g.worldMode.confirmPlacement(),
      cancelPlacing: () => g.worldMode.cancelPlacing(),
      evaluate: (id, position, rotation) => {
        const s = g.library.get(id);
        if (!s) return null;
        const c = g.worldMode.evaluate(s, position, rotation);
        return { ok: c.ok, reason: c.reason ?? null, colliding: c.collidingIds };
      },
      placeAt: (id, position, rotation) => {
        const s = g.library.get(id);
        if (!s) return null;
        const c = g.worldMode.evaluate(s, position, rotation);
        if (!c.ok) return { ok: false, reason: c.reason ?? null, colliding: c.collidingIds, placementId: null };
        const p = { id: newId(), structureId: id, position: { ...position }, rotation };
        g.worldMode.addPlacement(p);
        return { ok: true, reason: null, colliding: [], placementId: p.id };
      },
      removePlacement: (id) => !!g.worldMode.removePlacement(id),
      hoveredPlacement: () => g.worldMode.hoveredPlacement()?.placement ?? null,
      world: () => JSON.parse(JSON.stringify(g.worldMode.world)) as World,
      listWorlds: () => g.worlds.list(),
      createWorld: (name) => g.createWorld(name).then((w) => w.id),
      switchWorld: (id) => g.switchWorld(id),
      flushSave: () => g.flushSave(),
      exportWorldBundleBase64: () => bytesToBase64(g.encodeWorldBundle()),
      importWorldBundleBase64: (b64) => g.importWorldBundle(base64ToBytes(b64)).then((w) => w?.id ?? null),
      stats: () => ({
        placements: g.worldMode.world.placements.length,
        rendered: g.worldMode.renderedCount,
        drawCalls: g.host.renderer.info.render.calls,
        triangles: g.host.renderer.info.render.triangles,
        persistent: g.library.persistent,
      }),
      setStartVisible: (v) => g.hud.setStartVisible(v),
      pointer: () => ({ locked: g.controls.isLocked, unavailable: g.pointerLockUnavailable }),
      frameTime: async (frames) => {
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) await g.nextFrame();
        return (performance.now() - t0) / frames;
      },
    };
  }
}

function touchStructureName(s: Structure, name: string): Structure {
  return { ...s, name, updatedAt: new Date().toISOString() };
}

export function describeRejection(reason: string | undefined): string {
  switch (reason) {
    case 'overlap':
      return 'it would overlap another structure';
    case 'below-ground':
      return 'it would go below the ground';
    case 'out-of-bounds':
      return 'it is outside the world';
    default:
      return 'cannot place here';
  }
}

export interface GameDebug {
  game: Game;
  mode(): 'structure' | 'world';
  nextFrame(): Promise<void>;
  getPose(): Pose;
  setPose(pose: Pose): void;
  look(dx: number, dy: number): void;
  act(button: number): boolean;
  key(code: string, mods?: { ctrl?: boolean; shift?: boolean }): boolean;
  enterStructureMode(id?: string): Promise<void>;
  setVoxel(x: number, y: number, z: number, material: string | null): boolean;
  fillBox(min: Vec3, max: Vec3, material: string | null): number;
  hover(): { voxel: Vec3 | null; place: Vec3 | null } | null;
  dimensions(): { size: { x: number; y: number; z: number } | null; blocks: number } | null;
  saveStructure(name: string): Promise<Structure | null>;
  discardStructure(): Promise<boolean>;
  library(): Array<{ id: string; name: string; size: { x: number; y: number; z: number }; blocks: number; hasThumbnail: boolean }>;
  exportStructure(id: string): string | null;
  importStructure(text: string): Promise<string | null>;
  startPlacing(id: string, rotation?: Rotation): boolean;
  placing(): { structureId: string; rotation: Rotation; target: Vec3 | null; ok: boolean | null; reason: string | null; colliding: string[] } | null;
  rotatePlacing(): void;
  confirmPlacement(): Placement | null;
  cancelPlacing(): void;
  evaluate(id: string, position: Vec3, rotation: Rotation): { ok: boolean; reason: string | null; colliding: string[] } | null;
  placeAt(id: string, position: Vec3, rotation: Rotation): { ok: boolean; reason: string | null; colliding: string[]; placementId: string | null } | null;
  removePlacement(id: string): boolean;
  hoveredPlacement(): Placement | null;
  world(): World;
  listWorlds(): Array<{ id: string; name: string; updatedAt: string; placements: number }>;
  createWorld(name: string): Promise<string>;
  switchWorld(id: string): Promise<boolean>;
  flushSave(): Promise<void>;
  exportWorldBundleBase64(): string;
  importWorldBundleBase64(b64: string): Promise<string | null>;
  stats(): { placements: number; rendered: number; drawCalls: number; triangles: number; persistent: boolean };
  setStartVisible(visible: boolean): void;
  /** Pointer-lock state: whether the mouse is captured, and whether the game gave up on capturing it. */
  pointer(): { locked: boolean; unavailable: boolean };
  /** Average milliseconds per frame over the next `frames` frames. */
  frameTime(frames: number): Promise<number>;
}

declare global {
  interface Window {
    __game?: GameDebug;
  }
}
