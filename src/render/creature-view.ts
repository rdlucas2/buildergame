import { Color, InstancedMesh, MeshLambertMaterial, Object3D, type BufferGeometry } from 'three';
import { StructureBuilder } from '../core/structure-builder';
import type { CreatureSpecies } from '../core/world';
import type { Creature } from '../sim/creatures';
import { hash3 } from '../sim/rng';
import { buildStructureGeometry } from './structure-geometry';

/** Size of one model voxel in world cells. */
const RABBIT_SCALE = 0.1;
const WOLF_SCALE = 0.09;
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
  return modelGeometry(b, 'Rabbit', RABBIT_SCALE);
}

/** A voxel wolf facing +z, two cells tall to its ears. White fur is tinted per instance. */
function wolfGeometry(): BufferGeometry {
  const b = new StructureBuilder({ x: 6, y: 14, z: 18 });
  const fur = 'white';
  // Legs.
  for (const x of [0, 4]) for (const z of [2, 11]) b.fill(x, 0, z, x + 1, 4, z + 1, fur);
  // Body with a paler belly, chest and neck.
  b.fill(0, 5, 2, 5, 9, 12, fur);
  b.fill(1, 5, 4, 4, 5, 10, 'snow');
  b.fill(1, 8, 11, 4, 11, 13, fur);
  // Head, snout, nose, eyes and ears.
  b.fill(1, 9, 13, 4, 12, 15, fur);
  b.fill(2, 9, 16, 3, 10, 17, 'snow');
  b.fill(2, 10, 17, 3, 10, 17, 'black');
  b.set(1, 11, 15, 'yellow').set(4, 11, 15, 'yellow');
  b.fill(1, 13, 13, 1, 13, 14, fur).fill(4, 13, 13, 4, 13, 14, fur);
  // Tail, drooping behind.
  b.fill(2, 7, 1, 3, 9, 1, fur).fill(2, 6, 0, 3, 8, 0, fur);
  return modelGeometry(b, 'Wolf', WOLF_SCALE);
}

/** Greedy-meshes a model built in voxels, centred on x and z, standing on y = 0, scaled to cells. */
function modelGeometry(b: StructureBuilder, name: string, scale: number): BufferGeometry {
  const s = b.build({ id: `creature-${name.toLowerCase()}`, name });
  const g = buildStructureGeometry(s).opaque!;
  g.translate(-s.voxels.size.x / 2, 0, -s.voxels.size.z / 2);
  g.scale(scale, scale, scale);
  return g;
}

/** Fur colours: rabbits are mostly browns and greys with the odd white one; wolves grey to brown. */
const COATS: Record<CreatureSpecies, Color[]> = {
  prey: ['#a47b55', '#8e6a4c', '#b89572', '#9a948c', '#7d756c', '#c7b39a', '#f0ece6'].map((c) => new Color(c)),
  predator: ['#8f8f8f', '#6e6a66', '#a39c92', '#57514b', '#c2beb6', '#7a6a58'].map((c) => new Color(c)),
};

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
    this.meshes.set('predator', this.createMesh(wolfGeometry(), 8));
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
        const coats = COATS[species];
        const coat = coats[hash3(c.id, 3, 5) % coats.length];
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
    const young = Math.min(1, 0.55 + c.age / (c.species === 'prey' ? 900 : 1600));
    t.rotation.set(0, c.heading, 0);
    if (c.deadFor >= 0) {
      const k = Math.min(1, c.deadFor / FADE_SECONDS);
      t.rotation.set(0, c.heading, Math.PI / 2);
      y -= k * 0.5;
    } else if (c.x !== c.px || c.z !== c.pz || c.y !== c.py) {
      // Rabbits hop about once a cell; wolves lope with a lower, longer stride.
      y += c.species === 'prey' ? Math.abs(Math.sin((x + z) * 2.2)) * 0.22 : Math.abs(Math.sin((x + z) * 1.3)) * 0.1;
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
