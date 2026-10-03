import { BoxGeometry, Color, Group, InstancedMesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { paletteEntryForMaterialId } from '../core/structure';
import type { Combat } from '../sim/defense/combat';
import type { DefenseBase } from '../sim/defense/base';
import { WEAPONS } from '../sim/defense/weapons';
import { ChunkedGridMesh } from './chunked-grid-mesh';
import { meshPaletteFromEntries } from './mesh-palette';
import type { VoxelMaterials } from './voxel-materials';

/** Crack overlays darken blocks in three steps of wear. */
const CRACK_LEVELS = [0.18, 0.36, 0.55];
const CRACK_REFRESH = 0.25;
/** Shots are drawn as cubes of this size, scaled to each weapon's. */
const SHOT_SIZE = 0.14;
/** Every lookout post flies a flag, so posts stand out from the walls at a glance. */
const FLAG_POLE = { height: 1.5, width: 0.07, inset: 0.12 };
const FLAG = { width: 0.5, height: 0.3, depth: 0.04, color: 0xe8453c };

/**
 * Draws a defense round: the warren's blocks (remeshed chunk by chunk as they are built or
 * broken), cracks on damaged blocks, and shots in flight.
 */
export class DefenseView {
  readonly group = new Group();
  private readonly blocks: ChunkedGridMesh;
  private paletteSize: number;
  private readonly cracks: InstancedMesh[] = [];
  private readonly crackMaterials: MeshBasicMaterial[] = [];
  private readonly cube = new BoxGeometry(1.02, 1.02, 1.02);
  private readonly shotGeometry = new BoxGeometry(SHOT_SIZE, SHOT_SIZE, SHOT_SIZE);
  private readonly shotMaterial = new MeshBasicMaterial({ color: 0xffffff });
  private shots: InstancedMesh;
  private readonly beamGeometry = new BoxGeometry(1, 1, 1);
  private readonly beamMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
  private beams: InstancedMesh;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly poleGeometry = new BoxGeometry(FLAG_POLE.width, FLAG_POLE.height, FLAG_POLE.width);
  private readonly flagGeometry = new BoxGeometry(FLAG.width, FLAG.height, FLAG.depth);
  private readonly poleMaterial = new MeshBasicMaterial({ color: 0x3a2a1a });
  private readonly flagMaterial = new MeshBasicMaterial({ color: FLAG.color });
  private poles: InstancedMesh;
  private flags: InstancedMesh;
  private flagShape = -1;
  private crackVersion = -1;
  private crackTimer = 0;
  private readonly tmp = new Object3D();
  private readonly color = new Color();

  constructor(
    private readonly base: DefenseBase,
    private readonly combat: Combat,
    materials: VoxelMaterials,
  ) {
    this.group.name = 'defense';
    this.blocks = new ChunkedGridMesh(base.grid, this.meshPalette(), materials);
    this.paletteSize = base.palette.length;
    this.blocks.group.position.set(base.origin.x, 0, base.origin.z);
    this.blocks.group.name = 'warren-blocks';
    this.group.add(this.blocks.group);
    base.onViewChange = (x, y, z) => {
      if (base.palette.length !== this.paletteSize) {
        this.paletteSize = base.palette.length;
        this.blocks.setPalette(this.meshPalette());
      }
      this.blocks.markVoxel(x - base.origin.x, y, z - base.origin.z);
    };
    for (const opacity of CRACK_LEVELS) {
      const material = new MeshBasicMaterial({ color: 0x1a120c, transparent: true, opacity, depthWrite: false });
      this.crackMaterials.push(material);
      const mesh = new InstancedMesh(this.cube, material, 64);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = 'warren-cracks';
      mesh.renderOrder = 5;
      this.cracks.push(mesh);
      this.group.add(mesh);
    }
    this.shots = this.newShots(64);
    this.beams = this.newBeams(16);
    this.poles = this.newFlags(this.poleGeometry, this.poleMaterial, 32, 'post-poles');
    this.flags = this.newFlags(this.flagGeometry, this.flagMaterial, 32, 'post-flags');
    this.blocks.update();
    this.updateFlags();
  }

  private newFlags(geometry: BoxGeometry, material: MeshBasicMaterial, capacity: number, name: string): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    this.group.add(mesh);
    return mesh;
  }

  /** A pole and a red flag at the corner of every lookout post. */
  private updateFlags(): void {
    this.flagShape = this.base.shape;
    const posts = this.base.posts();
    if (posts.length > this.poles.instanceMatrix.count) {
      for (const m of [this.poles, this.flags]) {
        this.group.remove(m);
        m.dispose();
      }
      this.poles = this.newFlags(this.poleGeometry, this.poleMaterial, posts.length * 2, 'post-poles');
      this.flags = this.newFlags(this.flagGeometry, this.flagMaterial, posts.length * 2, 'post-flags');
    }
    posts.forEach((p, i) => {
      const x = p.x + FLAG_POLE.inset;
      const z = p.z + FLAG_POLE.inset;
      this.tmp.position.set(x, p.y + FLAG_POLE.height / 2, z);
      this.tmp.updateMatrix();
      this.poles.setMatrixAt(i, this.tmp.matrix);
      this.tmp.position.set(x + FLAG.width / 2, p.y + FLAG_POLE.height - FLAG.height / 2, z);
      this.tmp.updateMatrix();
      this.flags.setMatrixAt(i, this.tmp.matrix);
    });
    this.poles.count = this.flags.count = posts.length;
    this.poles.instanceMatrix.needsUpdate = this.flags.instanceMatrix.needsUpdate = true;
  }

  private meshPalette() {
    return meshPaletteFromEntries(this.base.palette.map((m) => paletteEntryForMaterialId(m)));
  }

  private newShots(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.shotGeometry, this.shotMaterial, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = 'projectiles';
    this.group.add(mesh);
    return mesh;
  }

  private newBeams(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.beamGeometry, this.beamMaterial, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = 'beams';
    mesh.renderOrder = 6;
    this.group.add(mesh);
    return mesh;
  }

  /** Per frame: remesh changed chunks, refresh cracks now and then, and place shots. */
  update(dt: number, alpha: number): void {
    this.blocks.update();
    if (this.flagShape !== this.base.shape) this.updateFlags();
    this.crackTimer -= dt;
    if (this.crackTimer <= 0 && this.crackVersion !== this.base.version) {
      this.crackTimer = CRACK_REFRESH;
      this.crackVersion = this.base.version;
      this.updateCracks();
    }
    this.updateShots(alpha);
    this.updateBeams();
  }

  /** Rebuilds the crack overlays right away (tests and screenshots). */
  refresh(): void {
    this.blocks.update();
    this.updateFlags();
    this.crackVersion = this.base.version;
    this.updateCracks();
  }

  private updateCracks(): void {
    const levels: Array<Array<{ x: number; y: number; z: number }>> = [[], [], []];
    const core = this.base.coreCells();
    for (const b of this.base.damaged()) {
      const level = levels[b.wear > 0.67 ? 2 : b.wear > 0.34 ? 1 : 0];
      // The core wears as one: crack every block of it.
      if (core.length && this.base.materialAt(b.x, b.y, b.z) === 'core') level.push(...core);
      else level.push(b);
    }
    levels.forEach((cells, k) => {
      let mesh = this.cracks[k];
      if (cells.length > mesh.instanceMatrix.count) {
        this.group.remove(mesh);
        mesh.dispose();
        mesh = new InstancedMesh(this.cube, this.crackMaterials[k], Math.max(cells.length, mesh.instanceMatrix.count * 2));
        mesh.frustumCulled = false;
        mesh.name = 'warren-cracks';
        mesh.renderOrder = 5;
        this.cracks[k] = mesh;
        this.group.add(mesh);
      }
      cells.forEach((c, i) => {
        this.tmp.position.set(c.x + 0.5, c.y + 0.5, c.z + 0.5);
        this.tmp.updateMatrix();
        mesh.setMatrixAt(i, this.tmp.matrix);
      });
      mesh.count = cells.length;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private updateShots(alpha: number): void {
    const list = this.combat.projectiles;
    if (list.length > this.shots.instanceMatrix.count) {
      this.group.remove(this.shots);
      this.shots.dispose();
      this.shots = this.newShots(list.length * 2);
    }
    list.forEach((p, i) => {
      const w = WEAPONS[p.weapon];
      this.tmp.position.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
      this.tmp.scale.setScalar((w?.size ?? SHOT_SIZE) / SHOT_SIZE);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.updateMatrix();
      this.shots.setMatrixAt(i, this.tmp.matrix);
      this.color.set(w?.color ?? '#ffffff');
      this.shots.setColorAt(i, this.color);
    });
    this.tmp.scale.setScalar(1);
    this.shots.count = list.length;
    this.shots.instanceMatrix.needsUpdate = true;
    if (this.shots.instanceColor) this.shots.instanceColor.needsUpdate = true;
  }

  /** Hitscan beams: thin bars from the shooter to where the beam stopped. */
  private updateBeams(): void {
    const list = this.combat.beams;
    if (list.length > this.beams.instanceMatrix.count) {
      this.group.remove(this.beams);
      this.beams.dispose();
      this.beams = this.newBeams(list.length * 2);
    }
    list.forEach((b, i) => {
      this.from.set(b.x0, b.y0, b.z0);
      this.to.set(b.x1, b.y1, b.z1);
      const w = WEAPONS[b.weapon];
      const thick = w?.size ?? 0.06;
      this.tmp.position.copy(this.from).add(this.to).multiplyScalar(0.5);
      this.tmp.lookAt(this.to);
      this.tmp.scale.set(thick, thick, Math.max(0.01, this.from.distanceTo(this.to)));
      this.tmp.updateMatrix();
      this.beams.setMatrixAt(i, this.tmp.matrix);
      this.color.set(w?.color ?? '#ffffff');
      this.beams.setColorAt(i, this.color);
    });
    this.tmp.scale.setScalar(1);
    this.tmp.rotation.set(0, 0, 0);
    this.beams.count = list.length;
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.base.onViewChange = undefined;
    this.blocks.dispose();
    for (const m of this.cracks) m.dispose();
    for (const m of this.crackMaterials) m.dispose();
    this.shots.dispose();
    this.beams.dispose();
    this.beamGeometry.dispose();
    this.beamMaterial.dispose();
    this.cube.dispose();
    this.shotGeometry.dispose();
    this.shotMaterial.dispose();
    for (const m of [this.poles, this.flags]) m.dispose();
    this.poleGeometry.dispose();
    this.flagGeometry.dispose();
    this.poleMaterial.dispose();
    this.flagMaterial.dispose();
  }
}
