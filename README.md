# Buildergame

A creative voxel building game for the browser. Open your world, build anything with free access
to every material, and share what you make as files that anyone can drop into their own world.

- **Structure mode** — build a creation block by block inside a bounded volume. Its length × height ×
  depth is measured from what you place. Save it to your library and it is ready to place.
- **World mode** — fly around your world and place structures from your library. Structures snap to the
  grid, rotate in quarter turns, stack on each other, and can never overlap (voxel-precise collision
  with a green/red preview).
- **Sharing** — export a structure as a `.structure.json` file; import a friend's from the library.
  Export a whole world as a `.world.zip` bundle that carries every structure it references.

Everything is saved in the browser (IndexedDB) as you go. See `docs/FILE_FORMATS.md` for the formats.

## Controls

| Key | Action |
| --- | --- |
| Mouse | Look (click the game to take control, Esc releases) |
| W A S D · Space / Shift · Ctrl · wheel | Fly · rise / sink · boost · change speed |
| Tab | Structure library: place, edit, duplicate, rename, export, import, delete |
| B | Build a new structure (enter structure mode) |
| M | World menu: switch, create, rename, export, import worlds; author name; spawn point |
| H | Controls overlay |
| P | Save a screenshot |
| Ctrl+Z / Ctrl+Y | Undo / redo (blocks in structure mode, placements in world mode) |

World mode: **left click** places the preview, **R** rotates it, **[** / **]** lower / raise it,
**Esc** or right click cancels, **X** removes the structure you look at, **G** picks it up to move it.

Structure mode: **right click** places a block on the face you look at (or the floor), **left click**
removes one, **1–9** pick a hotbar material, **E** opens every material, **Q** / middle click copies the
material you look at, **Enter** saves, **Esc** leaves.

## How it stays fast

- Voxels live in dense typed arrays; the editor remeshes only the 16³ chunk you touched.
- Greedy meshing merges coplanar faces of the same material, with ambient occlusion baked into
  vertex colours, so even huge flat walls are a few triangles.
- Each structure is meshed once and every copy of it in the world is drawn with GPU instancing:
  draw calls scale with the number of *different* structures, not the number placed.
- Placement collision uses a spatial hash for the broad phase and only scans the overlapping region
  voxel by voxel, so checks stay cheap in worlds with thousands of structures.
- Files store voxels run-length encoded, so large structures with big uniform areas stay small.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # unit tests (vitest)
npm run e2e        # browser tests (playwright, headless chromium)
npm run build      # production build in dist/
```

The game exposes `window.__game` for automation (the end-to-end tests drive it through this API).

## Not yet

Terrain and terrain editing, walking with gravity, shaped blocks (slabs, stairs), multiplayer, and a
packaged desktop app are out of scope for this version. The core is built so those can be layered on.
