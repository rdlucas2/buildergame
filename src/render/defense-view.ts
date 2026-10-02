import { BoxGeometry, Color, Group, InstancedMesh, MeshBasicMaterial, Object3D } from 'three';
import { paletteEntryForMaterialId } from '../core/structure';
import type { Combat } from '../sim/defense/combat';
import type { DefenseBase } from '../sim/defense/base';
import { ChunkedGridMesh } from './chunked-grid-mesh';
import { meshPaletteFromEntries } from './mesh-palette';
import type { VoxelMaterials } from './voxel-materials';

/** Crack overlays darken blocks in three steps of wear. */
const CRACK_LEVELS = [0.18, 0.36, 0.55];
const CRACK_REFRESH = 0.25;
/** Projectile colour by weapon. */
const SHOT_COLORS: Record<string, string> = { slingshot: '#b9b4aa' };

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
  private readonly shotGeometry = new BoxGeometry(0.14, 0.14, 0.14);
  private readonly shotMaterial = new MeshBasicMaterial({ color: 0xffffff });
  private shots: InstancedMesh;
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
    this.blocks.update();
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

  /** Per frame: remesh changed chunks, refresh cracks now and then, and place shots. */
  update(dt: number, alpha: number): void {
    this.blocks.update();
    this.crackTimer -= dt;
    if (this.crackTimer <= 0 && this.crackVersion !== this.base.version) {
      this.crackTimer = CRACK_REFRESH;
      this.crackVersion = this.base.version;
      this.updateCracks();
    }
    this.updateShots(alpha);
  }

  /** Rebuilds the crack overlays right away (tests and screenshots). */
  refresh(): void {
    this.blocks.update();
    this.crackVersion = this.base.version;
    this.updateCracks();
  }

  private updateCracks(): void {
    const levels: Array<Array<{ x: number; y: number; z: number }>> = [[], [], []];
    for (const b of this.base.damaged()) levels[b.wear > 0.67 ? 2 : b.wear > 0.34 ? 1 : 0].push(b);
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
      this.tmp.position.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
      this.tmp.updateMatrix();
      this.shots.setMatrixAt(i, this.tmp.matrix);
      this.color.set(SHOT_COLORS[p.weapon] ?? '#ffffff');
      this.shots.setColorAt(i, this.color);
    });
    this.shots.count = list.length;
    this.shots.instanceMatrix.needsUpdate = true;
    if (this.shots.instanceColor) this.shots.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.base.onViewChange = undefined;
    this.blocks.dispose();
    for (const m of this.cracks) m.dispose();
    for (const m of this.crackMaterials) m.dispose();
    this.shots.dispose();
    this.cube.dispose();
    this.shotGeometry.dispose();
    this.shotMaterial.dispose();
  }
}
