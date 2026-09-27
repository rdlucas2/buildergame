import type { StructureBuilder } from '../core/structure-builder';
import type { Structure } from '../core/structure';
import { buildArcDeTriomphe } from './arc-de-triomphe';
import { buildCottage } from './cottage';
import { buildEiffelTower } from './eiffel-tower';
import { buildFarmhouse } from './farmhouse';
import { buildModernHouse } from './modern-house';
import { buildRabbitWarren } from './rabbit-warren';

/** Ids of built-in examples all start with this prefix. */
export const EXAMPLE_ID_PREFIX = 'example-';
/** Fixed timestamps so examples are identical on every machine (and cache and compare cleanly). */
const EXAMPLE_TIME = '2026-09-27T00:00:00.000Z';

export interface ExampleDef {
  id: string;
  name: string;
  description: string;
  build: () => StructureBuilder;
}

export const EXAMPLES: readonly ExampleDef[] = [
  { id: 'example-cottage', name: 'Cottage', description: 'Timber and stone cottage with a brick roof and chimney.', build: buildCottage },
  { id: 'example-farmhouse', name: 'Farmhouse', description: 'Two-storey timber-frame house with a covered porch.', build: buildFarmhouse },
  { id: 'example-modern-house', name: 'Modern House', description: 'Glass ground floor, cantilevered upper floor, deck and pool.', build: buildModernHouse },
  { id: 'example-eiffel-tower', name: 'Eiffel Tower', description: 'Iron lattice tower on four arched legs, about 1:2.75 scale.', build: buildEiffelTower },
  { id: 'example-arc-de-triomphe', name: 'Arc de Triomphe', description: 'Triumphal arch with reliefs and an eternal flame, about 1:1 scale.', build: buildArcDeTriomphe },
  {
    id: 'example-rabbit-warren',
    name: 'Rabbit Warren',
    description: 'Walled pen for wild worlds: 3-high walls and 1-high gaps keep wolves out, open sky keeps grass growing.',
    build: buildRabbitWarren,
  },
];

export function isExampleId(id: string): boolean {
  return id.startsWith(EXAMPLE_ID_PREFIX);
}

export function buildExample(def: ExampleDef): Structure {
  return def.build().build({ id: def.id, name: def.name, author: 'Buildergame', createdAt: EXAMPLE_TIME, updatedAt: EXAMPLE_TIME });
}

/** Builds every example structure. Deterministic: the same input always yields identical voxels. */
export function buildExampleStructures(): Structure[] {
  return EXAMPLES.map(buildExample);
}

export function exampleDescription(id: string): string {
  return EXAMPLES.find((e) => e.id === id)?.description ?? '';
}
