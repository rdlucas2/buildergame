import { createStructure, paletteEntryForMaterialId, type Structure } from '../../src/core/structure';
import { VoxelGrid, type Size3 } from '../../src/core/voxel-grid';

/** Builds a structure whose voxels are set wherever `solid(x,y,z)` is true, all of one material. */
export function makeStructure(
  name: string,
  size: Size3,
  solid: (x: number, y: number, z: number) => boolean = () => true,
  material = 'stone',
  id?: string,
): Structure {
  const grid = new VoxelGrid(size);
  for (let y = 0; y < size.y; y++)
    for (let z = 0; z < size.z; z++) for (let x = 0; x < size.x; x++) if (solid(x, y, z)) grid.set(x, y, z, 1);
  const opts: Parameters<typeof createStructure>[0] = { name, voxels: grid, palette: [paletteEntryForMaterialId(material)] };
  if (id) opts.id = id;
  return createStructure(opts);
}

export function cube(name: string, edge: number, id?: string): Structure {
  return makeStructure(name, { x: edge, y: edge, z: edge }, () => true, 'stone', id);
}

/** An L shape in the XZ plane: a 3x1x3 corner with the (x>0 && z>0) quadrant empty. */
export function lShape(name: string, id?: string): Structure {
  return makeStructure(name, { x: 3, y: 1, z: 3 }, (x, _y, z) => !(x > 0 && z > 0), 'brick', id);
}
