/**
 * Built-in block materials. Every material is free to use; there is no inventory or crafting.
 * Structures store a local palette (material id + colour) so files stay portable even if this list changes.
 */
export interface MaterialDef {
  /** Stable string id used in files. */
  id: string;
  name: string;
  /** Hex colour like "#8c8c8c". */
  color: string;
  /** Rendered translucent (glass-like). */
  transparent?: boolean;
  /** Glows slightly in the dark. */
  emissive?: boolean;
  /** Category used to group the material picker. */
  group: 'natural' | 'building' | 'color' | 'special';
}

export const MATERIALS: readonly MaterialDef[] = [
  { id: 'stone', name: 'Stone', color: '#8c8c8c', group: 'natural' },
  { id: 'cobblestone', name: 'Cobblestone', color: '#6e6e6e', group: 'natural' },
  { id: 'dirt', name: 'Dirt', color: '#7a5230', group: 'natural' },
  { id: 'grass', name: 'Grass', color: '#5da130', group: 'natural' },
  { id: 'sand', name: 'Sand', color: '#e2d3a0', group: 'natural' },
  { id: 'log', name: 'Oak Log', color: '#6b4a2b', group: 'natural' },
  { id: 'leaves', name: 'Leaves', color: '#3f8a2c', group: 'natural' },
  { id: 'snow', name: 'Snow', color: '#f4f8fb', group: 'natural' },
  { id: 'planks', name: 'Planks', color: '#b8894a', group: 'building' },
  { id: 'brick', name: 'Brick', color: '#a5502f', group: 'building' },
  { id: 'stone_bricks', name: 'Stone Bricks', color: '#7d7d85', group: 'building' },
  { id: 'marble', name: 'Marble', color: '#e6e3dc', group: 'building' },
  { id: 'slate', name: 'Slate', color: '#3d4450', group: 'building' },
  { id: 'iron', name: 'Iron', color: '#c9c9cf', group: 'building' },
  { id: 'gold', name: 'Gold', color: '#e8c34a', group: 'building' },
  { id: 'bronze', name: 'Bronze', color: '#8d6e4f', group: 'building' },
  { id: 'limestone', name: 'Limestone', color: '#d9d0b9', group: 'building' },
  { id: 'glass', name: 'Glass', color: '#a8d8f0', transparent: true, group: 'special' },
  { id: 'lantern', name: 'Lantern', color: '#ffd27a', emissive: true, group: 'special' },
  { id: 'lookout', name: 'Lookout Post', color: '#c8963c', group: 'special' },
  { id: 'white', name: 'White', color: '#f2f2f2', group: 'color' },
  { id: 'black', name: 'Black', color: '#1e1e1e', group: 'color' },
  { id: 'red', name: 'Red', color: '#d23c3c', group: 'color' },
  { id: 'orange', name: 'Orange', color: '#ef8a2a', group: 'color' },
  { id: 'yellow', name: 'Yellow', color: '#f2d33c', group: 'color' },
  { id: 'lime', name: 'Lime', color: '#8fd63a', group: 'color' },
  { id: 'green', name: 'Green', color: '#2f8f3a', group: 'color' },
  { id: 'cyan', name: 'Cyan', color: '#35b8c9', group: 'color' },
  { id: 'light_blue', name: 'Light Blue', color: '#6fb3f2', group: 'color' },
  { id: 'blue', name: 'Blue', color: '#3457d5', group: 'color' },
  { id: 'purple', name: 'Purple', color: '#8348c7', group: 'color' },
  { id: 'magenta', name: 'Magenta', color: '#d64fb3', group: 'color' },
  { id: 'pink', name: 'Pink', color: '#f2a0c8', group: 'color' },
  { id: 'brown', name: 'Brown', color: '#7a4b2a', group: 'color' },
];

const BY_ID: ReadonlyMap<string, MaterialDef> = new Map(MATERIALS.map((m) => [m.id, m]));

export const DEFAULT_MATERIAL_ID = 'stone';

export function getMaterial(id: string): MaterialDef | undefined {
  return BY_ID.get(id);
}

export function hasMaterial(id: string): boolean {
  return BY_ID.has(id);
}

/** Parse "#rrggbb" (or "#rgb") into 0..1 floats. Falls back to mid grey on bad input. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0.5, 0.5, 0.5];
  const n = parseInt(h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function isValidHexColor(hex: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}
