import { decodeWorldBundle, encodeWorldBundle, resolveBundleConflicts } from '../core/format/bundle';
import { base64ToBytes, bytesToBase64 } from '../core/format/rle';
import { serializeStructure, structureDownloadName } from '../core/format/structure-file';
import { worldDownloadName } from '../core/format/world-file';
import { decodeProfileFile, encodeProfileFile } from '../core/format/profile-file';
import type { DefenseModifiers } from '../core/defense-state';
import type { PlayerProfile } from '../core/profile';
import { newId } from '../core/ids';
import { getMaterial } from '../core/materials';
import type { Vec3 } from '../core/math';
import type { Rotation } from '../core/rotation';
import { EmptyStructureError, structureBlockCount, type Structure } from '../core/structure';
import { createWorld, placementVoxelAt, referencedStructureIds, touchWorld, type CreatureKind, type CreatureSpecies, type Placement, type PredatorRank, type World } from '../core/world';
import { aabbFromPosSize } from '../core/math';
import { rotatedSize } from '../core/rotation';
import { buildExampleStructures, exampleDescription } from '../examples';
import { buildStructureGeometry, StructureGeometryCache } from '../render/structure-geometry';
import { SceneHost } from '../render/scene';
import { renderThumbnail } from '../render/thumbnail';
import { createVoxelMaterials, type VoxelMaterials } from '../render/voxel-materials';
import { downloadBlob, downloadBytes, downloadText, pickFiles, readFileBytes, readFileText } from '../storage/files';
import { StructureLibrary } from '../storage/library';
import { WorldStore } from '../storage/worlds';
import { ProfileStore } from '../storage/profile';
import { openCouncil } from '../ui/council';
import { confirmDialog, newWorldDialog, promptDialog } from '../ui/dialogs';
import { openRoundSummary } from '../ui/defense-hud';
import { openHelp } from '../ui/help';
import { Hud } from '../ui/hud';
import { openLibraryPanel, type LibraryTab } from '../ui/library-panel';
import { openMaterialPicker } from '../ui/material-picker';
import { closePanel, isPanelOpen, onPanelChange } from '../ui/panel';
import { toast } from '../ui/toast';
import { openWorldPanel } from '../ui/world-panel';
import { FlyControls, isTypingTarget, type Pose } from './fly-controls';
import { TouchControls, type TouchActionId, type TouchContext } from './touch-controls';
import { EcosystemController, type CreatureInfo, type DefenseInfo, type EcosystemCell, type EcosystemInfo } from './ecosystem-controller';
import { START_TIME, type Speed } from '../sim/clock';
import type { ActionResult, Defense, DefenseAction } from '../sim/defense/defense';
import { buyUpgrade, modifiersFor } from '../sim/defense/council';
import { awardAchievements, finishRound, newRoundAchievements, type RoundResult, type RoundReward } from '../sim/defense/rewards';
import { blockCost, blockHp } from '../sim/defense/materials';
import { Ecosystem } from '../sim/ecosystem';
import { randomSeed } from '../sim/rng';
import type { Overlay } from '../render/terrain-view';
import { DEFAULT_HOTBAR, StructureMode } from './structure-mode';
import { WorldMode } from './world-mode';

/** Fortify mode's starting hotbar: wall materials from cheap to tough, and lookout posts. */
export const FORTIFY_HOTBAR = ['cobblestone', 'planks', 'stone_bricks', 'iron', 'lookout', 'log', 'brick', 'dirt', 'glass'];

/** Ground size of Warren Defense worlds: plenty of room around the warren, and quick to simulate. */
export const DEFENSE_GROUND = 512;

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
  private libraryTab: LibraryTab = 'mine';
  readonly touch: TouchControls;
  readonly eco: EcosystemController;
  private ecoSaveTimer = 0;
  /** On-screen touch controls are active (no pointer lock, no click-to-start overlay). */
  touchMode = false;
  /** `?touch=1` or `?touch=0` pins the mode; otherwise it follows the last input device used. */
  private readonly touchForced: boolean | null;

  static async create(container: HTMLElement): Promise<Game> {
    const library = new StructureLibrary(buildExampleStructures());
    const worlds = new WorldStore();
    const profile = new ProfileStore();
    await library.open();
    await worlds.open();
    await profile.open();
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
    return new Game(container, library, worlds, world, profile);
  }

  constructor(
    readonly container: HTMLElement,
    readonly library: StructureLibrary,
    readonly worlds: WorldStore,
    world: World,
    readonly profile: ProfileStore = new ProfileStore(),
  ) {
    this.host = new SceneHost(container);
    this.controls = new FlyControls(this.host.camera, this.host.canvas);
    this.materials = createVoxelMaterials();
    this.hotbar = [...worlds.getSetting<string[]>('hotbar', DEFAULT_HOTBAR)];
    this.fortifyHotbar = [...worlds.getSetting<string[]>('fortifyHotbar', FORTIFY_HOTBAR)];
    this.hud = new Hud({
      onLibrary: () => this.openLibrary(),
      onWorld: () => this.openWorldMenu(),
      onHelp: () => openHelp(),
      onStructure: () => (this.structureMode ? void this.saveStructure() : void this.enterStructureMode()),
      onSlot: (i) => this.selectHotbarSlot(i),
    });
    container.appendChild(this.hud.root);
    this.touch = new TouchControls(container, {
      controls: this.controls,
      canvas: this.host.canvas,
      onAction: (id, phase) => this.onTouchAction(id, phase),
    });
    const param = new URLSearchParams(window.location.search).get('touch');
    this.touchForced = param === '1' ? true : param === '0' ? false : null;

    this.worldMode = new WorldMode(world, library, this.cache, this.materials);
    this.worldMode.onChange = () => this.scheduleSave();
    this.host.scene.add(this.worldMode.group);
    this.eco = new EcosystemController(this.host, this.worldMode, library, container, this.materials);
    this.eco.onActivity = () => this.scheduleSave();
    this.eco.onToggleFortify = () => this.toggleFortify();
    this.eco.onRoundOver = () => this.showRoundSummary();
    this.eco.onRoundSecond = (d) => this.checkAchievements(d);
    this.eco.attach(world);
    this.applyWorldPose(world);

    this.bindInput();
    this.setTouchMode(this.touchForced ?? window.matchMedia?.('(pointer: coarse)').matches ?? false);
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
    else {
      this.worldMode.update(this.host.camera);
      this.eco.fortify.update(this.host.camera, this.eco.defense, this.fortifyMaterial);
    }
    this.updateHold(dt);
    this.eco.frame(dt, !!this.structureMode);
    if (this.eco.active) {
      // Wild worlds change on their own, so save them regularly as well as on edits.
      this.ecoSaveTimer += dt;
      if (this.ecoSaveTimer > 30) {
        this.ecoSaveTimer = 0;
        void this.flushSave();
      }
    }
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
    return (this.controls.isLocked || this.pointerLockUnavailable || this.touchMode) && !isPanelOpen();
  }

  /** Switches between desktop (pointer lock) and touch (on-screen controls) input. */
  setTouchMode(on: boolean): void {
    this.touchMode = on;
    document.body.classList.toggle('touch', on);
    if (on) this.controls.unlock();
    this.touch.setVisible(on && !isPanelOpen());
    this.holdButton = null;
    this.updateStartOverlay();
    this.refreshHudChrome();
  }

  private updateStartOverlay(): void {
    this.hud.setStartVisible(!this.touchMode && !this.controls.isLocked && !this.pointerLockUnavailable && !isPanelOpen());
  }

  /** Starts a mouse-button style action that repeats while held (touch Place / Break buttons). */
  pressAction(button: number): void {
    if (!this.interactive) return;
    this.act(button);
    this.holdButton = button;
    this.holdTimer = 0;
    this.lastActedCell = this.currentCellKey();
  }

  releaseAction(): void {
    this.holdButton = null;
  }

  private onTouchAction(id: TouchActionId, phase: 'down' | 'up'): void {
    if (id === 'place' || id === 'break') {
      if (phase === 'down') this.pressAction(id === 'place' ? 2 : 0);
      else this.releaseAction();
      return;
    }
    if (phase !== 'up' || isPanelOpen()) return;
    const keys: Partial<Record<TouchActionId, [string, { ctrl?: boolean }?]>> = {
      materials: ['KeyE'],
      undo: ['KeyZ', { ctrl: true }],
      redo: ['KeyY', { ctrl: true }],
      save: ['Enter'],
      exit: ['Escape'],
      rotate: ['KeyR'],
      raise: ['BracketRight'],
      lower: ['BracketLeft'],
      cancel: ['Escape'],
      remove: ['KeyX'],
      move: ['KeyG'],
    };
    if (id === 'pick') this.act(1);
    else if (id === 'drop') this.act(0);
    else {
      const k = keys[id];
      if (k) this.handleKey(k[0], k[1] ?? {});
    }
    this.updateHudStatus();
  }

  /** Hotbar click or tap: select a slot, or open every material when the slot is already selected. */
  private selectHotbarSlot(i: number): void {
    if (this.eco.fortify.active) {
      if (i === this.fortifySlot) this.handleKey('KeyE');
      else {
        this.fortifySlot = i;
        this.hud.setHotbar(this.fortifyHotbar, this.fortifySlot);
      }
      return;
    }
    const sm = this.structureMode;
    if (!sm) return;
    if (i === sm.selected) {
      this.handleKey('KeyE');
      return;
    }
    sm.selectSlot(i);
    this.hud.setHotbar(sm.hotbar, sm.selected);
  }

  /** Picks the wording for the current input device: keyboard and mouse, or touch buttons. */
  private say(desktop: string, touch: string): string {
    return this.touchMode ? touch : desktop;
  }

  private touchContext(): TouchContext {
    const sm = this.structureMode;
    if (sm) return { mode: 'structure', canUndo: sm.undo.canUndo, canRedo: sm.undo.canRedo };
    if (this.eco.fortify.active) return { mode: 'structure', canUndo: false, canRedo: false };
    const wm = this.worldMode;
    if (wm.placing) return { mode: 'placing' };
    return { mode: 'world', hovering: !!wm.hoveredId, canUndo: wm.undo.canUndo, canRedo: wm.undo.canRedo };
  }

  // ---- input -----------------------------------------------------------------------------

  private bindInput(): void {
    const canvas = this.host.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (isPanelOpen() || this.touchMode) return;
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
    this.controls.onLockChange = () => {
      this.updateStartOverlay();
      this.holdButton = null;
    };
    onPanelChange((open) => {
      if (open) this.controls.unlock();
      this.controls.enabled = !open;
      this.touch.setVisible(this.touchMode && !open);
      if (open) this.controls.clearAnalog();
      this.updateStartOverlay();
      this.holdButton = null;
    });
    // Follow the input device actually in use, unless the URL pins the mode.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (this.touchForced !== null) return;
        if (e.pointerType === 'touch' && !this.touchMode) this.setTouchMode(true);
        else if (e.pointerType === 'mouse' && this.touchMode) this.setTouchMode(false);
      },
      { capture: true },
    );
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
    const f = this.eco.fortify;
    const c = sm ? (this.holdButton === 0 ? sm.hover.voxel : sm.hover.place) : f.active ? (this.holdButton === 0 ? f.voxel : f.place) : null;
    return c ? `${c.x},${c.y},${c.z}` : null;
  }

  private updateHold(dt: number): void {
    if (this.holdButton === null || !(this.structureMode || this.eco.fortify.active) || !this.interactive) return;
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
    const defense = this.eco.defense;
    if (defense && this.eco.fortify.active) {
      if (button === 1) {
        const m = this.eco.fortify.pick(defense);
        if (m) {
          const i = this.fortifyHotbar.indexOf(m);
          if (i >= 0) this.fortifySlot = i;
          else this.fortifyHotbar[this.fortifySlot] = m;
          this.hud.setHotbar(this.fortifyHotbar, this.fortifySlot);
        }
        return m !== null;
      }
      const r = button === 0 ? this.eco.fortify.breakBlock(defense) : button === 2 ? this.eco.fortify.build(defense, this.fortifyMaterial) : null;
      if (!r) return false;
      if (r.ok) this.scheduleSave();
      else if (this.holdButton === null) toast(r.reason ?? 'Not possible here.', 'error', 1500);
      return r.ok;
    }
    const wm = this.worldMode;
    if (button === 0 && wm.placing && defense) return this.stampPlacing();
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
    if (!sm && code === 'KeyF' && this.eco.defense) {
      this.toggleFortify();
      return true;
    }
    if (!sm && code === 'KeyU' && this.eco.defense) return this.eco.openArmory();
    if (!sm && code === 'KeyK' && this.eco.defense) return this.eco.openPerks();
    if (!sm && this.eco.fortify.active) {
      if (/^Digit[1-9]$/.test(code)) {
        this.fortifySlot = Number(code.slice(5)) - 1;
        this.hud.setHotbar(this.fortifyHotbar, this.fortifySlot);
        return true;
      }
      switch (code) {
        case 'KeyE':
          openMaterialPicker(this.fortifyMaterial, (id) => {
            this.fortifyHotbar[this.fortifySlot] = id;
            void this.worlds.setSetting('fortifyHotbar', this.fortifyHotbar);
            this.hud.setHotbar(this.fortifyHotbar, this.fortifySlot);
          });
          return true;
        case 'KeyQ':
          return this.act(1);
        case 'Escape':
        case 'Enter':
          this.toggleFortify(false);
          return true;
      }
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
        if (p) toast(`Removed ${this.library.get(p.structureId)?.name ?? 'structure'} ${this.say('(Ctrl+Z to undo)', '(Undo brings it back)')}`, 'info', 1800);
        return !!p;
      }
      case 'KeyN':
        if (!this.eco.active) return false;
        this.eco.openPanel();
        return true;
      case 'KeyO':
        if (!this.eco.active) return false;
        toast(`Overlay: ${this.eco.cycleOverlay()}`, 'info', 1200);
        return true;
      case 'KeyT': {
        if (!this.eco.active) return false;
        const sp = this.eco.cycleSpeed();
        toast(sp === 0 ? 'Time paused' : `Time speed ${sp}×`, 'info', 1200);
        return true;
      }
      case 'KeyG': {
        const p = wm.pickUpHovered();
        if (p) toast(this.say('Moving structure: click to drop it, Esc to put it back', 'Moving structure: tap Place to drop it, Cancel to put it back'), 'info', 2200);
        return !!p;
      }
    }
    return false;
  }

  // ---- structure mode --------------------------------------------------------------------

  /** Opens the editor, optionally on an existing structure. Built-in examples always open as a copy. */
  async enterStructureMode(existing?: Structure, opts: { asCopy?: boolean } = {}): Promise<void> {
    if (this.structureMode) return;
    closePanel();
    this.worldMode.cancelPlacing();
    this.worldPoseBackup = this.controls.getPose();
    this.worldMode.group.visible = false;
    const asCopy = !!existing && (opts.asCopy ?? this.library.isExample(existing.id));
    const sm = new StructureMode(this.materials, { hotbar: this.hotbar, asCopy, ...(existing ? { existing } : {}) });
    this.structureMode = sm;
    this.host.scene.add(sm.group);
    this.controls.setPose(sm.startPose());
    this.refreshHudChrome();
    toast(
      !existing
        ? this.say('Structure mode: right click places, left click removes. Enter saves.', 'Structure mode: aim at the floor and tap Place. Save when you are done.')
        : asCopy
          ? `Editing a copy of "${existing.name}". ${this.say('Enter saves it as a new structure, Esc leaves.', 'Save keeps it as a new structure.')}`
          : `Editing "${existing.name}". ${this.say('Enter saves, Esc leaves.', 'Tap Save when you are done.')}`,
      'info',
      3500,
    );
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
      value: sm.editing ? (sm.asCopy ? `${sm.editing.name} (copy)` : sm.editing.name) : `Structure ${this.library.size + 1}`,
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
    const wasEditing = !!sm.editing && !sm.asCopy;
    this.leaveStructureMode();
    const size = s.voxels.size;
    if (wasEditing) {
      this.worldMode.refreshStructure(s.id);
      this.warnOverlaps(s);
      toast(`Saved "${s.name}" (${size.x}×${size.y}×${size.z})`, 'success');
    } else {
      this.worldMode.startPlacing(s);
      toast(`Saved "${s.name}" (${size.x}×${size.y}×${size.z}). ${this.say('Click to place it, R rotates, Esc cancels.', 'Aim and tap Place to put it in your world.')}`, 'success', 4000);
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
    if (overlapping) toast(`${overlapping} placement${overlapping === 1 ? '' : 's'} of "${s.name}" now overlap${overlapping === 1 ? 's' : ''} something. Move them with ${this.say('G', 'Move')}.`, 'error', 5000);
  }

  // ---- panels ----------------------------------------------------------------------------

  /** Renders library thumbnails for built-in examples the first time they are needed. */
  private ensureExampleThumbnails(): void {
    for (const s of this.library.examples()) {
      if (s.thumbnail) continue;
      try {
        s.thumbnail = renderThumbnail(this.host.renderer, this.cache.get(s), this.materials);
      } catch (e) {
        console.warn('example thumbnail failed', e);
      }
    }
  }

  openLibrary(tab?: LibraryTab): void {
    if (this.structureMode) return;
    if (tab) this.libraryTab = tab;
    this.ensureExampleThumbnails();
    const render = (): void => {
      openLibraryPanel(
        { mine: this.library.all(), examples: this.library.examples(), describe: exampleDescription, tab: this.libraryTab },
        {
          onTab: (t) => {
            this.libraryTab = t;
            render();
          },
          onEditCopy: (s) => void this.enterStructureMode(s, { asCopy: true }),
          onPlace: (s) => {
            closePanel();
            this.toggleFortify(false);
            this.worldMode.startPlacing(s);
            const how = this.say('click to place, R rotates, Esc cancels.', 'aim, then tap Place. Rotate turns it.');
            toast(this.eco.defense ? `Building "${s.name}" into the warren: ${how} Its blocks count against the budget.` : `Placing "${s.name}": ${how}`, 'info', 3000);
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
            const r = await newWorldDialog(`World ${this.worlds.list().length + 1}`);
            if (r === null) return render();
            await this.createWorld(r.name.trim() || 'Untitled world', { wild: r.kind === 'wild', defense: r.kind === 'defense' });
            closePanel();
          },
          onRename: async () => {
            const w = this.currentWorld();
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
          onCouncil: () => this.openCouncil(),
          onSetSpawn: async () => {
            const pose = this.controls.getPose();
            this.worldMode.load({ ...this.currentWorld(), spawn: { position: pose.position, yaw: pose.yaw, pitch: pose.pitch } });
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

  /**
   * Creates and opens a new world. Wild worlds get terrain, grass and day/night from a fresh seed;
   * Warren Defense worlds also get a walled warren and the first round of waves.
   */
  async createWorld(name: string, opts: { wild?: boolean; defense?: boolean; seed?: number } = {}): Promise<World> {
    const seed = opts.seed ?? randomSeed();
    const w = opts.defense ? newDefenseWorld(name, seed, this.roundModifiers()) : createWorld({ name, ...(opts.wild ? { ecosystem: { seed, time: START_TIME } } : {}) });
    await this.worlds.save(w);
    await this.switchWorld(w.id);
    return w;
  }

  /** Starts a fresh round in the current Warren Defense world (a new seed, the starter warren). */
  async restartRound(seed = randomSeed()): Promise<void> {
    const current = this.currentWorld();
    if (!current.ecosystem?.defense) return;
    this.toggleFortify(false);
    // A round given up part-way still counts: its time, kills and achievements are paid first.
    const d = this.eco.defense;
    if (d && d.clock > 0) await this.rewardRound(d);
    const fresh = newDefenseWorld(current.name, seed, this.roundModifiers());
    const w: World = { ...current, ecosystem: fresh.ecosystem, spawn: fresh.spawn, placements: [] };
    this.worldMode.load(w);
    this.eco.reattach(w);
    this.controls.setPose({ position: [...w.spawn.position], yaw: w.spawn.yaw, pitch: w.spawn.pitch });
    await this.flushSave();
    this.refreshHudChrome();
  }

  private async showRoundSummary(): Promise<void> {
    const d = this.eco.defense;
    if (!d) return;
    this.toggleFortify(false);
    const paid = await this.rewardRound(d);
    openRoundSummary(
      { clock: d.clock, waves: d.wave, score: d.score, stats: d.stats, reward: paid?.reward, earned: paid?.earned, clover: this.profile.profile.clover },
      { onRestart: () => void this.restartRound(), onCouncil: () => this.openCouncil() },
    );
  }

  // ---- Warren Defense: progress across rounds --------------------------------------------

  /** Modifiers for a new round, from the Warren Council upgrades bought. */
  private roundModifiers(): DefenseModifiers {
    return modifiersFor(this.profile.profile.upgrades);
  }

  private roundResult(d: Defense): RoundResult {
    return { clock: d.clock, score: d.score, wave: d.wave, stats: d.stats, unlocked: d.unlocked.length, milestones: d.milestones };
  }

  /** Pays a round's Clover and achievements into the profile, once (the round remembers it was paid). */
  private async rewardRound(d: Defense): Promise<{ reward: RoundReward; earned: string[] } | null> {
    if (d.rewarded) return null;
    const r = finishRound(this.profile.profile, this.roundResult(d), new Date().toISOString());
    d.rewarded = true;
    await this.profile.save(r.profile);
    await this.flushSave();
    return { reward: r.reward, earned: r.earned.map((a) => a.name) };
  }

  /** Awards round achievements as soon as they are met, so leaving mid-round doesn't lose them. */
  private checkAchievements(d: Defense): void {
    if (d.rewarded || d.over) return;
    const list = newRoundAchievements(this.profile.profile, this.roundResult(d));
    if (list.length === 0) return;
    void this.profile.save(awardAchievements(this.profile.profile, list, new Date().toISOString()));
    for (const a of list) toast(`🏆 Achievement: ${a.name} (+${a.clover} Clover)`, 'success', 4500);
  }

  /** The Warren Council: permanent upgrades and achievements. */
  openCouncil(): void {
    openCouncil(() => this.profile.profile, {
      buy: (id) => this.buyUpgrade(id),
      exportProfile: () => downloadText('buildergame.profile.json', JSON.stringify(encodeProfileFile(this.profile.profile), null, 2)),
      importProfile: async () => {
        const files = await pickFiles('.json,application/json', false);
        if (!files[0]) return;
        try {
          const p = decodeProfileFile(JSON.parse(await readFileText(files[0])));
          if (!(await confirmDialog('Import progress', 'Replace your Clover, upgrades and achievements with the imported file?', 'Replace'))) return;
          await this.profile.save(p);
          toast('Progress imported.', 'success');
        } catch (e) {
          toast((e as Error).message, 'error', 4000);
        }
      },
    });
  }

  /** Buys a Warren Council upgrade; returns why it couldn't, or null. */
  async buyUpgrade(id: string): Promise<string | null> {
    const r = buyUpgrade(this.profile.profile, id);
    if (!r.ok) return r.reason;
    await this.profile.save(r.profile);
    return null;
  }

  // ---- Warren Defense: fortify ----------------------------------------------------------

  private fortifySlot = 0;
  /** Fortify mode keeps its own hotbar of building materials, separate from structure mode's. */
  private fortifyHotbar: string[] = [];

  private get fortifyMaterial(): string {
    return this.fortifyHotbar[this.fortifySlot] ?? 'cobblestone';
  }

  /** Turns Fortify mode (building the warren) on or off; with no argument, toggles it. */
  toggleFortify(on = !this.eco.fortify.active): void {
    const defense = this.eco.defense;
    if (on && (!defense || this.structureMode || defense.over)) return;
    if (on && this.worldMode.placing) this.worldMode.cancelPlacing();
    this.eco.fortify.setActive(on, defense);
    this.refreshHudChrome();
  }

  /** Stamps the structure being placed into the warren as blocks (Warren Defense has no placements). */
  private stampPlacing(): boolean {
    const wm = this.worldMode;
    const p = wm.placing;
    if (!p || !p.target) return false;
    const s = p.structure;
    const size = rotatedSize(s.voxels.size, p.rotation);
    const placement = { id: 'stamp', structureId: s.id, position: p.target, rotation: p.rotation };
    const bounds = aabbFromPosSize(p.target, size);
    const blocks: Array<{ x: number; y: number; z: number; material: string }> = [];
    for (let y = bounds.min.y; y < bounds.max.y; y++)
      for (let z = bounds.min.z; z < bounds.max.z; z++)
        for (let x = bounds.min.x; x < bounds.max.x; x++) {
          const v = placementVoxelAt(s, placement, x, y, z);
          if (v !== 0) blocks.push({ x, y, z, material: s.palette[v - 1].material });
        }
    const r = this.eco.applyDefense({ type: 'placeMany', blocks });
    if (r.ok) {
      toast(`Built "${s.name}" into the warren (${blocks.length} blocks).`, 'success', 1800);
      wm.cancelPlacing();
      this.scheduleSave();
    } else toast(r.reason ?? 'It does not fit.', 'error', 2200);
    return r.ok;
  }

  async switchWorld(id: string): Promise<boolean> {
    const w = this.worlds.get(id);
    if (!w) return false;
    await this.flushSave();
    if (this.structureMode) this.leaveStructureMode();
    await this.worlds.setActiveWorldId(id);
    const dropped = this.worldMode.load(w);
    this.eco.attach(w);
    this.ecoSaveTimer = 0;
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
    const w = this.currentWorld();
    await this.worlds.save(w);
    await this.worlds.setSetting(`pose:${w.id}`, this.controls.getPose());
  }

  /** The current world including the live ecosystem state (for saving and exporting). */
  currentWorld(): World {
    const w = this.worldMode.world;
    const eco = this.eco?.snapshot();
    return eco ? { ...w, ecosystem: eco } : w;
  }

  exportWorld(): void {
    const w = this.worldMode.world;
    downloadBytes(worldDownloadName(w), this.encodeWorldBundle());
    toast(`Exported "${w.name}" with ${referencedStructureIds(w).length} structures.`, 'success');
  }

  encodeWorldBundle(): Uint8Array {
    const w = touchWorld(this.currentWorld());
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
    const fortifying = !sm && this.eco.fortify.active;
    this.hud.setHotbarVisible(!!sm || fortifying);
    if (fortifying) {
      this.hud.setMode(`Warren Defense: ${this.worldMode.world.name} — Fortify`);
      this.hud.setHotbar(this.fortifyHotbar, this.fortifySlot);
      this.hud.setStructureButton('Build structure', 'B');
      this.hud.setHint('Right click: build · Left click: remove · 1–9: material · E: all materials · F or Esc: done');
    } else if (sm) {
      this.hud.setMode(
        !sm.editing ? 'Structure mode' : sm.asCopy ? `Structure mode — copy of "${sm.editing.name}"` : `Structure mode — editing "${sm.editing.name}"`,
      );
      this.hud.setHotbar(sm.hotbar, sm.selected);
      this.hud.setStructureButton('Save structure', 'Enter');
      this.hud.setHint('Right click: place · Left click: remove · 1–9: material · E: all materials · Ctrl+Z: undo · Enter: save · Esc: leave');
    } else {
      this.hud.setMode(`${this.eco.defense ? 'Warren Defense' : this.eco.active ? 'Wild world' : 'World'}: ${this.worldMode.world.name}`);
      this.hud.setStructureButton('Build structure', 'B');
      this.hud.setHint('Tab: library · B: build a structure · M: worlds · H: help');
    }
    this.updateHudStatus();
  }

  private updateHudStatus(): void {
    this.touch.setContext(this.touchContext());
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
    const defense = this.eco.defense;
    if (defense && this.eco.fortify.active) {
      const f = this.eco.fortify;
      const at = f.voxel ? defense.base.materialAt(f.voxel.x, f.voxel.y, f.voxel.z) : null;
      const hp = f.voxel && at ? ` · ${Math.ceil(defense.base.hpAt(f.voxel.x, f.voxel.y, f.voxel.z))}/${defense.base.maxHpAt(f.voxel.x, f.voxel.y, f.voxel.z)} hp` : '';
      this.hud.setStatus([
        `Budget ${defense.base.cost()}/${defense.budget} · ${defense.base.blocks()} blocks`,
        `Building with ${getMaterial(this.fortifyMaterial)?.name ?? this.fortifyMaterial} (cost ${blockCost(this.fortifyMaterial)}, ${blockHp(this.fortifyMaterial, defense.base.strength, defense.base.hpMultiplier)} hp)`,
        at ? `Aiming at ${getMaterial(at)?.name ?? at}${hp}` : f.place ? 'Aiming at an empty spot' : 'Aim inside the orange outline',
        pos,
      ]);
      return;
    }
    const lines = [defense ? `Warren: ${defense.base.blocks()} blocks · budget ${defense.base.cost()}/${defense.budget}` : `${wm.world.placements.length} structure${wm.world.placements.length === 1 ? '' : 's'} placed`, pos];
    if (wm.placing) {
      const s = wm.placing.structure;
      const size = s.voxels.size;
      const c = wm.placing.check;
      const state = !wm.placing.target ? 'aim at the ground or a structure' : c?.ok ? 'fits here' : `blocked: ${describeRejection(c?.reason)}`;
      lines.push(`Placing "${s.name}" (${size.x}×${size.y}×${size.z}) · rotation ${wm.placing.rotation * 90}° · ${state}`);
      this.hud.setHint('Left click: place · R: rotate · [ / ]: lower / raise · Right click or Esc: cancel');
    } else {
      const h = wm.hoveredPlacement();
      const creature = this.eco.hoverText();
      if (creature) {
        lines.push(creature);
      } else if (h) {
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
      enterStructureMode: (id, asCopy) => g.enterStructureMode(id ? g.library.get(id) : undefined, asCopy === undefined ? {} : { asCopy }),
      examples: () => g.library.examples().map((s) => ({ id: s.id, name: s.name, size: { ...s.voxels.size }, blocks: structureBlockCount(s), hasThumbnail: !!s.thumbnail })),
      openLibrary: (tab) => g.openLibrary(tab),
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
      createWorld: (name, wild, seed) =>
        g.createWorld(name, { wild: wild === true || wild === 'wild', defense: wild === 'defense', ...(seed !== undefined ? { seed } : {}) }).then((w) => w.id),
      eco: () => g.eco.info(),
      ecoCell: (x, z) => g.eco.cell(x, z),
      ecoAdvance: (seconds) => g.eco.advance(seconds),
      ecoSpeed: (sp) => g.eco.setSpeed(sp),
      ecoOverlay: (o) => g.eco.setOverlay(o),
      ecoNearestWater: (x, z) => g.eco.nearestWater(x, z),
      ecoCreatures: () => g.eco.creatures(),
      ecoRelease: (species, x, z, count) => g.eco.release(species, x, z, count),
      defenseSpawn: (kind, x, z, rank) => g.eco.spawnPredator(kind, x, z, rank),
      ecoReleaseAtCrosshair: (count, species = 'prey') => g.eco.releaseAtCrosshair(species, count),
      ecoSafe: (x, y, z) => g.eco.ecosystem?.safety.isSafe(x, y, z) ?? false,
      ecoHovered: () => g.eco.hovered()?.id ?? null,
      defense: () => g.eco.defenseInfo(),
      defenseApply: (action) => g.eco.applyDefense(action),
      fortify: (on) => g.toggleFortify(on),
      fortifyAim: () => (g.eco.fortify.active ? { voxel: g.eco.fortify.voxel, place: g.eco.fortify.place } : null),
      restartRound: (seed) => g.restartRound(seed),
      profile: () => structuredClone(g.profile.profile),
      councilBuy: (id) => g.buyUpgrade(id),
      council: () => g.openCouncil(),
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
      touch: () => ({ mode: g.touchMode, ...g.touch.state() }),
      setTouchMode: (on) => g.setTouchMode(on),
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
  /** Opens the editor; with an id, edits that structure (examples always as a copy unless `asCopy` says otherwise). */
  enterStructureMode(id?: string, asCopy?: boolean): Promise<void>;
  examples(): Array<{ id: string; name: string; size: { x: number; y: number; z: number }; blocks: number; hasThumbnail: boolean }>;
  openLibrary(tab?: LibraryTab): void;
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
  /**
   * Creates and opens a world. `true` or `'wild'` adds terrain, grass, day/night and creatures;
   * `'defense'` makes a Warren Defense world. A seed makes it reproducible.
   */
  createWorld(name: string, wild?: boolean | 'wild' | 'defense', seed?: number): Promise<string>;
  eco(): EcosystemInfo | null;
  ecoCell(x: number, z: number): EcosystemCell | null;
  /** Runs the ecosystem forward immediately by this many simulation seconds. */
  ecoAdvance(seconds: number): void;
  ecoSpeed(speed: Speed): void;
  ecoOverlay(overlay: Overlay): void;
  ecoNearestWater(x: number, z: number): { x: number; z: number } | null;
  ecoCreatures(): CreatureInfo[];
  /** Releases up to `count` creatures around cell (x, z); returns how many appeared. */
  ecoRelease(species: CreatureSpecies, x: number, z: number, count: number): number;
  ecoReleaseAtCrosshair(count?: number, species?: CreatureSpecies): number;
  /** Is a creature standing at (x, y, z) out of every predator's reach? */
  ecoSafe(x: number, y: number, z: number): boolean;
  /** Id of the creature under the crosshair, if any. */
  ecoHovered(): number | null;
  /** The Warren Defense round, or null in other worlds. */
  defense(): DefenseInfo | null;
  /** Brings in one predator of a kind at (x, z), optionally an elite or a boss; returns its id. */
  defenseSpawn(kind: CreatureKind, x: number, z: number, rank?: PredatorRank): number | null;
  /** Applies a Warren Defense action as the player would (allocate, call a wave, build...). */
  defenseApply(action: DefenseAction): ActionResult;
  fortify(on: boolean): void;
  /** Where Fortify mode is aiming: the block under the crosshair and where a new one would go. */
  fortifyAim(): { voxel: Vec3 | null; place: Vec3 | null } | null;
  /** Starts a new round in the current Warren Defense world. */
  restartRound(seed?: number): Promise<void>;
  /** The player's Warren Defense progress: Clover, upgrades, achievements, lifetime totals. */
  profile(): PlayerProfile;
  /** Buys a Warren Council upgrade level; resolves with why it couldn't, or null. */
  councilBuy(id: string): Promise<string | null>;
  /** Opens the Warren Council panel. */
  council(): void;
  switchWorld(id: string): Promise<boolean>;
  flushSave(): Promise<void>;
  exportWorldBundleBase64(): string;
  importWorldBundleBase64(b64: string): Promise<string | null>;
  stats(): { placements: number; rendered: number; drawCalls: number; triangles: number; persistent: boolean };
  setStartVisible(visible: boolean): void;
  /** Pointer-lock state: whether the mouse is captured, and whether the game gave up on capturing it. */
  pointer(): { locked: boolean; unavailable: boolean };
  /** Touch-control state: whether touch mode is on, the overlay is visible, and which action buttons show. */
  touch(): { mode: boolean; visible: boolean; actions: Array<{ id: string; disabled: boolean }> };
  setTouchMode(on: boolean): void;
  /** Average milliseconds per frame over the next `frames` frames. */
  frameTime(frames: number): Promise<number>;
}

declare global {
  interface Window {
    __game?: GameDebug;
  }
}

/**
 * A new Warren Defense world: wild terrain, the starter warren beside the water with the herd
 * inside, and a spawn point looking down on it.
 */
export function newDefenseWorld(name: string, seed: number, modifiers: Partial<DefenseModifiers> = {}): World {
  const eco = Ecosystem.create(DEFENSE_GROUND, seed, { defense: modifiers });
  const site = eco.defense!.site;
  return createWorld({
    name,
    ground: { material: 'grass', size: DEFENSE_GROUND },
    spawn: { position: [site.x, 24, site.z + 30], yaw: 0, pitch: -0.62 },
    ecosystem: eco.snapshot(),
  });
}
