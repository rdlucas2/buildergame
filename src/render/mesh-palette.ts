import { hexToRgb } from '../core/materials';
import type { PaletteEntry } from '../core/structure';
import type { MeshPalette } from './greedy-mesh';

/** Adapts a structure palette (1-based voxel slots) to what the mesher needs. Colours are sRGB-decoded. */
export function meshPaletteFromEntries(entries: readonly PaletteEntry[]): MeshPalette {
  const colors = entries.map((e) => hexToRgb(e.color).map(srgbToLinear) as [number, number, number]);
  const transparent = entries.map((e) => !!e.transparent);
  const emissive = entries.map((e) => !!e.emissive);
  return {
    colorOf: (v) => colors[v - 1] ?? [1, 0, 1],
    isTransparent: (v) => transparent[v - 1] ?? false,
    isEmissive: (v) => emissive[v - 1] ?? false,
  };
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
