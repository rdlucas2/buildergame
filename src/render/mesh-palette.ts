import { hexToRgb } from '../core/materials';
import type { PaletteEntry } from '../core/structure';
import type { MeshPalette } from './greedy-mesh';

/**
 * Adapts a structure palette (1-based voxel slots) to what the mesher needs. Reads the array lazily
 * so entries appended while editing are picked up without rebuilding anything; colours are cached
 * per slot and sRGB-decoded to linear.
 */
export function meshPaletteFromEntries(entries: readonly PaletteEntry[]): MeshPalette {
  const colors = new Map<number, [number, number, number]>();
  return {
    colorOf: (v) => {
      let c = colors.get(v);
      if (!c) {
        const e = entries[v - 1];
        c = e ? (hexToRgb(e.color).map(srgbToLinear) as [number, number, number]) : [1, 0, 1];
        colors.set(v, c);
      }
      return c;
    },
    isTransparent: (v) => !!entries[v - 1]?.transparent,
    isEmissive: (v) => !!entries[v - 1]?.emissive,
  };
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
