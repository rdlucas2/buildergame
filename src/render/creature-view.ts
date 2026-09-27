import { Color, InstancedMesh, MeshLambertMaterial, Object3D, type BufferGeometry } from 'three';
import { StructureBuilder } from '../core/structure-builder';
import type { CreatureSpecies } from '../core/world';
import type { Creature } from '../sim/creatures';
import { hash3 } from '../sim/rng';
import { buildStructureGeometry } from './structure-geometry';

/** Size of one model voxel in world cells. */
const MODEL_SCALE = 0.1;
const INITIAL_CAPACITY = 64;
const FADE_SECONDS = 3;

/** A small voxel rabbit facing +z, built in model voxels. White fur is tinted per instance. */
function rabbitGeometry(): BufferGeometry {
  const b = new StructureBuilder({ x: 5, y: 8, z: 8 });
  const fur = 'white';
  // Hind feet, front paws.
  b.fill(0, 0, 1, 1, 0, 3, fur).fill(3, 0, 1, 4, 0, 3, fur);
  b.set(1, 0, 5, fur).set(3, 0, 5, fur);
  // Body with rounded top corners, and a tail.
  b.fill(0, 1, 1, 4, 3, 5, fur);
  for (const [x, z] of [[0, 1], [4, 1], [0, 5], [4, 5]]) b.set(x, 3, z, null);
  b.fill(1, 2, 0, 3, 3, 0, fur);
  // Head with eyes and a nose.
  b.fill(1, 3, 5, 3, 5, 7, fur);
  b.set(1, 5, 7, null).set(3, 5, 7, null);
  b.set(0, 4, 6, 'black').set(4, 4, 6, 'black');
  b.set(2, 4, 7, 'pink');
  // Ears.
  b.fill(1, 6, 5, 1, 7, 5, fur).fill(3, 6, 5, 3, 7, 5, fur);
  b.set(1, 6, 6, 'pink').set(3, 6, 6, 'pink');
  const s = b.build({ id: 'creature-rabbit', name: 'Rabbit' });
  const g = buildStructureGeometry(s).opaque!;
  g.translate(-2.5, 0, -4);
  g.scale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
  return g;
}

/** Fur colours for rabbits: mostly browns and greys, the odd white one. */
const RABBIT_COATS = ['#a47b55', '#8e6a4c', '#b89572', '#9a948c', '#7d756c', '#c7b39a', '#f0ece6'].map((c) => new Color(c));

interface SpeciesMesh {
  mesh: InstancedMesh;
  capacity: number;
  geometry: BufferGeometry;
}

/**
 * Draws every creature with one InstancedMesh per species, positioned between the last two
 * simulation ticks so movement looks smooth at any frame rate. Moving rabbits hop; dead creatures
 * roll over and sink into the ground before they are removed.
 */
export class CreatureView {
  readonly group = new Object3D();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly meshes = new Map<CreatureSpecies, SpeciesMesh>();
  private readonly tmp = new Object3D();
  private readonly color = new Color();

  constructor() {
    this.group.name = 'creatures';
    this.meshes.set('prey', this.createMesh(rabbitGeometry(), INITIAL_CAPACITY));
  }

  private createMesh(geometry: BufferGeometry, capacity: number): SpeciesMesh {
    const mesh = new InstancedMesh(geometry, this.material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = 'creature-instances';
    this.group.add(mesh);
    return { mesh, capacity, geometry };
  }

  private ensureCapacity(species: CreatureSpecies, n: number): SpeciesMesh | null {
    const sm = this.meshes.get(species);
    if (!sm) return null;
    if (n <= sm.capacity) return sm;
    let cap = sm.capacity;
    while (cap < n) cap *= 2;
    this.group.remove(sm.mesh);
    sm.mesh.dispose();
    const next = this.createMesh(sm.geometry, cap);
    this.meshes.set(species, next);
    return next;
  }

  /** Positions every creature, `alpha` of the way from its previous tick to its current one. */
  update(creatures: readonly Creature[], alpha: number): void {
    const counts = new Map<CreatureSpecies, number>();
    for (const c of creatures) counts.set(c.species, (counts.get(c.species) ?? 0) + 1);
    for (const [species, sm0] of this.meshes) {
      const n = counts.get(species) ?? 0;
      const sm = this.ensureCapacity(species, n) ?? sm0;
      let i = 0;
      for (const c of creatures) {
        if (c.species !== species) continue;
        this.place(c, alpha);
        sm.mesh.setMatrixAt(i, this.tmp.matrix);
        const coat = RABBIT_COATS[hash3(c.id, 3, 5) % RABBIT_COATS.length];
        this.color.copy(coat);
        if (c.deadFor >= 0) this.color.multiplyScalar(0.7);
        sm.mesh.setColorAt(i, this.color);
        i++;
      }
      sm.mesh.count = i;
      sm.mesh.instanceMatrix.needsUpdate = true;
      if (sm.mesh.instanceColor) sm.mesh.instanceColor.needsUpdate = true;
    }
  }

  private place(c: Creature, alpha: number): void {
    const x = c.px + (c.x - c.px) * alpha;
    const z = c.pz + (c.z - c.pz) * alpha;
    let y = c.py + (c.y - c.py) * alpha;
    const t = this.tmp;
    const young = Math.min(1, 0.55 + c.age / 900);
    t.rotation.set(0, c.heading, 0);
    if (c.deadFor >= 0) {
      const k = Math.min(1, c.deadFor / FADE_SECONDS);
      t.rotation.set(0, c.heading, Math.PI / 2);
      y -= k * 0.5;
    } else if (c.x !== c.px || c.z !== c.pz || c.y !== c.py) {
      // A hop per cell or so, driven by position so it stays in step with the movement.
      y += Math.abs(Math.sin((x + z) * 2.2)) * 0.22;
    }
    t.position.set(x, y + 0.001, z);
    t.scale.setScalar(young);
    t.updateMatrix();
  }

  dispose(): void {
    for (const sm of this.meshes.values()) {
      sm.mesh.dispose();
      sm.geometry.dispose();
    }
    this.material.dispose();
  }
}
