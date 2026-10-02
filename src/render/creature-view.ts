import { BoxGeometry, Color, InstancedMesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, type BufferGeometry, type Camera } from 'three';
import { StructureBuilder } from '../core/structure-builder';
import type { CreatureKind } from '../core/world';
import { kindOf, maxHpOf, type Creature } from '../sim/creatures';
import { hash3 } from '../sim/rng';
import { buildStructureGeometry } from './structure-geometry';

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
  return modelGeometry(b, 'Rabbit', 0.1);
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
  return modelGeometry(b, 'Wolf', 0.09);
}

/** A slim fox facing +z: russet with a white chest, black socks and a bushy white-tipped tail. */
function foxGeometry(): BufferGeometry {
  const b = new StructureBuilder({ x: 4, y: 9, z: 14 });
  const fur = 'orange';
  for (const x of [0, 3]) for (const z of [2, 8]) b.fill(x, 0, z, x, 2, z, 'black');
  b.fill(0, 3, 2, 3, 5, 9, fur);
  b.fill(1, 3, 7, 2, 3, 9, 'white');
  b.fill(0, 5, 9, 3, 7, 11, fur);
  b.fill(1, 5, 12, 2, 6, 13, 'white');
  b.set(1, 6, 13, 'black').set(2, 6, 13, 'black');
  b.set(0, 7, 11, 'black').set(3, 7, 11, 'black');
  b.fill(0, 8, 9, 0, 8, 10, fur).fill(3, 8, 9, 3, 8, 10, fur);
  // Tail, held low.
  b.fill(1, 4, 0, 2, 5, 1, fur);
  b.fill(1, 3, 0, 2, 3, 0, 'white');
  return modelGeometry(b, 'Fox', 0.09);
}

/** A low, broad badger: grey back, black legs, and the black-and-white striped face. */
function badgerGeometry(): BufferGeometry {
  const b = new StructureBuilder({ x: 7, y: 7, z: 13 });
  for (const x of [0, 5]) for (const z of [2, 8]) b.fill(x, 0, z, x + 1, 1, z + 1, 'black');
  b.fill(0, 2, 1, 6, 4, 10, 'stone');
  b.fill(1, 5, 2, 5, 5, 9, 'stone');
  b.fill(1, 2, 2, 5, 2, 9, 'black');
  b.fill(1, 2, 10, 5, 5, 12, 'white');
  b.fill(1, 3, 10, 1, 5, 12, 'black').fill(5, 3, 10, 5, 5, 12, 'black');
  b.set(3, 3, 12, 'black');
  b.fill(2, 0, 0, 4, 2, 0, 'stone');
  return modelGeometry(b, 'Badger', 0.09);
}

/** Greedy-meshes a model built in voxels, centred on x and z, standing on y = 0, scaled to cells. */
function modelGeometry(b: StructureBuilder, name: string, scale: number): BufferGeometry {
  const s = b.build({ id: `creature-${name.toLowerCase()}`, name });
  const g = buildStructureGeometry(s).opaque!;
  g.translate(-s.voxels.size.x / 2, 0, -s.voxels.size.z / 2);
  g.scale(scale, scale, scale);
  return g;
}

/** Fur tints per kind (multiplied with the model's colours); a single white tint leaves them as built. */
const COATS: Record<CreatureKind, Color[]> = {
  rabbit: ['#a47b55', '#8e6a4c', '#b89572', '#9a948c', '#7d756c', '#c7b39a', '#f0ece6'].map((c) => new Color(c)),
  wolf: ['#8f8f8f', '#6e6a66', '#a39c92', '#57514b', '#c2beb6', '#7a6a58'].map((c) => new Color(c)),
  fox: ['#ffffff', '#f2d6c0', '#e6c2a0'].map((c) => new Color(c)),
  badger: [new Color('#ffffff')],
  bear: ['#6b4a2b', '#4a3420', '#3a2a1c'].map((c) => new Color(c)),
  tiger: [new Color('#e08a2c')],
  hawk: [new Color('#8a6a48')],
};

/** Models per kind; kinds without their own model yet borrow the wolf's. */
const MODELS: Partial<Record<CreatureKind, () => BufferGeometry>> = { rabbit: rabbitGeometry, wolf: wolfGeometry, fox: foxGeometry, badger: badgerGeometry };

interface KindMesh {
  mesh: InstancedMesh;
  capacity: number;
  geometry: BufferGeometry;
}

/** A height for each kind's health bar, just above the model. */
const BAR_HEIGHT: Record<CreatureKind, number> = { rabbit: 1.0, wolf: 1.5, fox: 1.0, badger: 0.85, bear: 1.9, tiger: 1.5, hawk: 1.0 };

/**
 * Draws every creature with one InstancedMesh per kind, positioned between the last two simulation
 * ticks so movement looks smooth at any frame rate. Moving rabbits hop; dead creatures roll over and
 * sink before they are removed. In a defense round, defenders wear a red scarf and wounded animals
 * show a health bar.
 */
export class CreatureView {
  readonly group = new Object3D();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly meshes = new Map<CreatureKind, KindMesh>();
  private readonly geometries = new Map<() => BufferGeometry, BufferGeometry>();
  private readonly tmp = new Object3D();
  private readonly color = new Color();
  private scarves: InstancedMesh;
  private barBack: InstancedMesh;
  private barFill: InstancedMesh;
  private readonly scarfGeometry = new BoxGeometry(0.42, 0.09, 0.3);
  private readonly barGeometry = new BoxGeometry(1, 0.08, 0.02);
  private readonly scarfMaterial = new MeshLambertMaterial({ color: 0xc0392b });
  private readonly barBackMaterial = new MeshBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 0.75, depthWrite: false });
  private readonly barFillMaterial = new MeshBasicMaterial({ color: 0xffffff, depthWrite: false });

  constructor() {
    this.group.name = 'creatures';
    for (const kind of ['rabbit', 'wolf', 'fox', 'badger'] as CreatureKind[]) this.meshes.set(kind, this.createMesh(this.geometryFor(kind), kind === 'rabbit' ? INITIAL_CAPACITY : 8));
    this.scarves = this.fixedMesh(this.scarfGeometry, this.scarfMaterial, 'defender-scarves', 32);
    this.barBack = this.fixedMesh(this.barGeometry, this.barBackMaterial, 'health-bars', 64);
    this.barFill = this.fixedMesh(this.barGeometry, this.barFillMaterial, 'health-fill', 64);
    this.barBack.renderOrder = 30;
    this.barFill.renderOrder = 31;
  }

  private geometryFor(kind: CreatureKind): BufferGeometry {
    const make = MODELS[kind] ?? wolfGeometry;
    let g = this.geometries.get(make);
    if (!g) this.geometries.set(make, (g = make()));
    return g;
  }

  private createMesh(geometry: BufferGeometry, capacity: number): KindMesh {
    const mesh = new InstancedMesh(geometry, this.material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = 'creature-instances';
    this.group.add(mesh);
    return { mesh, capacity, geometry };
  }

  private fixedMesh(geometry: BufferGeometry, material: MeshLambertMaterial | MeshBasicMaterial, name: string, capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    this.group.add(mesh);
    return mesh;
  }

  private meshFor(kind: CreatureKind, n: number): KindMesh {
    let km = this.meshes.get(kind);
    if (!km) {
      km = this.createMesh(this.geometryFor(kind), 8);
      this.meshes.set(kind, km);
    }
    if (n <= km.capacity) return km;
    let cap = km.capacity;
    while (cap < n) cap *= 2;
    this.group.remove(km.mesh);
    km.mesh.dispose();
    const next = this.createMesh(km.geometry, cap);
    this.meshes.set(kind, next);
    return next;
  }

  /** Grows a fixed mesh (scarves, bars) to hold `n` instances. */
  private grow(mesh: InstancedMesh, n: number): InstancedMesh {
    if (n <= mesh.instanceMatrix.count) return mesh;
    let cap = mesh.instanceMatrix.count;
    while (cap < n) cap *= 2;
    const next = new InstancedMesh(mesh.geometry, mesh.material, cap);
    next.count = 0;
    next.frustumCulled = false;
    next.name = mesh.name;
    next.renderOrder = mesh.renderOrder;
    this.group.remove(mesh);
    mesh.dispose();
    this.group.add(next);
    return next;
  }

  /**
   * Positions every creature, `alpha` of the way from its previous tick to its current one. With a
   * camera, wounded creatures get health bars turned to face it.
   */
  update(creatures: readonly Creature[], alpha: number, camera?: Camera): void {
    const counts = new Map<CreatureKind, number>();
    for (const c of creatures) {
      const k = kindOf(c);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const kind of new Set([...this.meshes.keys(), ...counts.keys()])) {
      const km = this.meshFor(kind, counts.get(kind) ?? 0);
      const coats = COATS[kind];
      let i = 0;
      for (const c of creatures) {
        if (kindOf(c) !== kind) continue;
        this.place(c, alpha);
        km.mesh.setMatrixAt(i, this.tmp.matrix);
        this.color.copy(coats[hash3(c.id, 3, 5) % coats.length]);
        if (c.deadFor >= 0) this.color.multiplyScalar(0.7);
        km.mesh.setColorAt(i, this.color);
        i++;
      }
      km.mesh.count = i;
      km.mesh.instanceMatrix.needsUpdate = true;
      if (km.mesh.instanceColor) km.mesh.instanceColor.needsUpdate = true;
    }
    this.updateScarves(creatures, alpha);
    this.updateBars(creatures, alpha, camera);
  }

  private updateScarves(creatures: readonly Creature[], alpha: number): void {
    const defenders = creatures.filter((c) => c.role === 'defender' && c.deadFor < 0);
    this.scarves = this.grow(this.scarves, defenders.length);
    let i = 0;
    for (const c of defenders) {
      this.place(c, alpha);
      // The scarf sits around the neck: forward of centre, at head height.
      this.tmp.translateY(0.33 / this.tmp.scale.y);
      this.tmp.translateZ(0.12);
      this.tmp.updateMatrix();
      this.scarves.setMatrixAt(i++, this.tmp.matrix);
    }
    this.scarves.count = i;
    this.scarves.instanceMatrix.needsUpdate = true;
  }

  private updateBars(creatures: readonly Creature[], alpha: number, camera?: Camera): void {
    const wounded = camera ? creatures.filter((c) => c.deadFor < 0 && c.health < 0.999 && (c.species === 'predator' || c.role)) : [];
    this.barBack = this.grow(this.barBack, wounded.length);
    this.barFill = this.grow(this.barFill, wounded.length);
    let i = 0;
    for (const c of wounded) {
      const x = c.px + (c.x - c.px) * alpha;
      const y = c.py + (c.y - c.py) * alpha + BAR_HEIGHT[kindOf(c)];
      const z = c.pz + (c.z - c.pz) * alpha;
      const width = c.species === 'predator' ? Math.min(1.4, 0.5 + maxHpOf(c) / 150) : 0.5;
      const t = this.tmp;
      t.position.set(x, y, z);
      t.quaternion.copy(camera!.quaternion);
      t.scale.set(width, 1, 1);
      t.updateMatrix();
      this.barBack.setMatrixAt(i, t.matrix);
      const h = Math.max(0, Math.min(1, c.health));
      t.translateX((-(1 - h) * width) / 2 / width);
      t.translateZ(0.01);
      t.scale.set(width * h, 1, 1);
      t.updateMatrix();
      this.barFill.setMatrixAt(i, t.matrix);
      this.color.setRGB(h < 0.5 ? 1 : 2 * (1 - h), h > 0.5 ? 1 : 2 * h, 0.15);
      this.barFill.setColorAt(i, this.color);
      i++;
    }
    this.barBack.count = i;
    this.barFill.count = i;
    this.barBack.instanceMatrix.needsUpdate = true;
    this.barFill.instanceMatrix.needsUpdate = true;
    if (this.barFill.instanceColor) this.barFill.instanceColor.needsUpdate = true;
  }

  private place(c: Creature, alpha: number): void {
    const x = c.px + (c.x - c.px) * alpha;
    const z = c.pz + (c.z - c.pz) * alpha;
    let y = c.py + (c.y - c.py) * alpha;
    const t = this.tmp;
    t.quaternion.identity();
    const young = Math.min(1, 0.55 + c.age / (c.species === 'prey' ? 900 : 1600));
    t.rotation.set(0, c.heading, 0);
    if (c.deadFor >= 0) {
      const k = Math.min(1, c.deadFor / FADE_SECONDS);
      t.rotation.set(0, c.heading, Math.PI / 2);
      y -= k * 0.5;
    } else if (c.x !== c.px || c.z !== c.pz || c.y !== c.py) {
      // Rabbits hop about once a cell; predators lope with a lower, longer stride.
      y += c.species === 'prey' ? Math.abs(Math.sin((x + z) * 2.2)) * 0.22 : Math.abs(Math.sin((x + z) * 1.3)) * 0.1;
    } else if (c.activity === 'breach') {
      // Clawing at the wall.
      y += Math.abs(Math.sin(c.age * 14)) * 0.08;
    }
    t.position.set(x, y + 0.001, z);
    t.scale.setScalar(young);
    t.updateMatrix();
  }

  dispose(): void {
    for (const km of this.meshes.values()) km.mesh.dispose();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of [this.scarves, this.barBack, this.barFill]) m.dispose();
    this.scarfGeometry.dispose();
    this.barGeometry.dispose();
    for (const m of [this.material, this.scarfMaterial, this.barBackMaterial, this.barFillMaterial]) m.dispose();
  }
}
