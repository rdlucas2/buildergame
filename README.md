# Buildergame

A creative voxel building game for the browser. Log in to your world, build anything with free access
to every material, and share what you make as files that anyone can drop into their own world.

- **Structure mode** — build a creation block by block inside a bounded volume. Its length × height ×
  depth is measured from what you place. Save it to your library.
- **World mode** — fly around your world and place structures from your library. Structures snap to the
  grid, rotate in quarter turns, and cannot overlap each other (voxel-precise collision).
- **Sharing** — export a structure as a `.structure.json` file; import a friend's. Export a whole world as
  a `.world.zip` bundle containing every structure it references.

See `docs/FILE_FORMATS.md` for the file formats.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # unit tests (vitest)
npm run e2e        # browser tests (playwright)
npm run build
```
