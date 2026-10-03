# Buildergame

A creative voxel building game for the browser. Open your world, build anything with free access
to every material, and share what you make as files that anyone can drop into their own world.

- **Structure mode** — build a creation block by block inside a bounded volume. Its length × height ×
  depth is measured from what you place. Save it to your library and it is ready to place.
- **World mode** — fly around your world and place structures from your library. Structures snap to the
  grid, rotate in quarter turns, stack on each other, and can never overlap (voxel-precise collision
  with a green/red preview).
- **Examples** — the library's Examples tab has ready-made structures to place: a cottage, a
  farmhouse, a modern house, the Eiffel Tower, the Arc de Triomphe and a rabbit warren for wild
  worlds. Editing one saves your own copy; the built-in original never changes. They are defined in code under `src/examples/`.
- **Wild worlds**: choose "Wild" when creating a world to get generated ponds and streams,
  grass, and a day/night cycle with pause, 1×, 4× and 16× speed. Grass grows only where sunlight
  reaches the ground, so roofs starve the ground beneath them while open courtyards stay green. The
  Nature panel, opened with N, explains the rules and switches between overlays for food, blocked sky,
  water and safety from wolves.
- **Rabbits**: a wild world starts with a herd of rabbits near water.
  - They graze, drink, sleep at night (under a roof if one is near) and raise young when well fed.
  - They die of hunger, thirst or old age.
  - They find their way around, through and over what you build: they can hop up one block and
    squeeze through 1-high gaps.
  - Aim at a rabbit to see what it is doing and how it is. The Nature panel graphs the population
    and releases more rabbits at the crosshair.
- **Wolves**: a pack of 3 arrives late on day 1, and a new pack wanders in whenever wolves have died out.
  - Wolves track rabbits by scent, lie in wait by the water, stalk what they see and pounce in a
    short sprint. A catch feeds a wolf for about a day.
  - Rabbits see nearly all around and hear wolves that come close. They run for the nearest place
    wolves can't follow, and sleep in one when it is near.
  - Wolves stand 2 blocks tall and leap 2 up. So a **1-high gap** lets rabbits through but not
    wolves, and **walls 3 blocks high** keep wolves out.
  - The **Safety** overlay colours every spot where rabbits are safe (teal). The *Rabbit Warren*
    example is a ready-made safe pen: it is open to the sky so grass still grows inside.
  - The Nature panel graphs both populations and can release wolves too.
- **Warren Defense**: choose "Warren Defense" when creating a world for a tower defense round on top
  of the wild-world simulation. Rabbits hold a walled warren against waves of predators that get
  tougher the longer the warren stands.
  - Waves come on a clock: the first at 0:30, then about one a minute, whether or not the last one
    is beaten. **Call now** brings the next wave early for bonus points.
  - Foxes are fast and weak, and the only predators that fit through 1-high gaps. Wolves and badgers
    find the weakest stretch of wall (counting damage already done) and chew through it; badgers
    dig fastest. The waves for a seed are always the same.
  - Rabbits are **defenders** (red scarves), which man the lookout posts and shoot at predators
    they can see, or **breeders**, which keep eating, drinking and raising young, and run
    back inside the warren when predators come. The − and + buttons set how many defend. Extra
    defenders need extra Lookout Posts to shoot from. A warren holds up to 40 rabbits.
  - **Fortify** (F) builds and breaks warren blocks inside the orange area, against a block budget.
    Stronger materials hold out longer and cost more: soft blocks, wood, stone, masonry and metal.
    Masonry unlocks at 3:00 (or 600 points) and metal at 8:00 (or 3000 points). A **Lookout Post**
    block makes a defender post on top of it. Library structures can be stamped into the warren
    too.
  - **Weapons** unlock as the round goes on: slingshot, bow, crossbow, musket, rifle, shotgun,
    cannon, laser and plasma rifle. Each unlocks with time survived, or sooner with points, kills
    with the weapon before it, or kills of a particular predator. Defenders take up a stronger
    weapon as soon as it unlocks.
  - **Perks**: every wave from the second offers three random cards to choose one from (press
    **K**), and every 5 minutes survived brings a rare one. They boost a weapon family's damage,
    rate of fire, range, piercing, blast or shots at a time, or help the warren: mending blocks,
    thicker fur, more young, more budget or more points. The longer the warren holds, the rarer and
    stronger the cards.
  - The **Armory** (**U**) shows every weapon and what unlocks it, sets the main weapon and how many
    defenders carry others, and buys strength for each block tier (+25% hit points a level).
    **Repair** mends damaged blocks for points.
  - Kills and waves earn points. The round ends when the last rabbit falls, and the summary shows
    how long the warren held out. Predators get tougher every minute, and from 20:00 every wave is
    far tougher than the last.
- **Sharing** — export a structure as a `.structure.json` file; import a friend's from the library.
  Export a whole world as a `.world.zip` bundle that carries every structure it references.

Everything is saved in the browser (IndexedDB) as you go. See `docs/FILE_FORMATS.md` for the formats.

## Play online

The game is a static site with no server, hosted on GitHub Pages at
**https://rdlucas2.github.io/buildergame/**.

- Every push to the default branch rebuilds and redeploys it (`.github/workflows/deploy-pages.yml`).
- One-time setup: in the repository go to Settings → Pages → Build and deployment and set
  Source to **GitHub Actions**.
- Each player's worlds and structures are saved in their own browser. Export files to move or share them.

## Controls

| Key | Action |
| --- | --- |
| Mouse | Look (click the game to take control, Esc releases) |
| W A S D · Space / Shift · Ctrl · wheel | Fly · rise / sink · boost · change speed |
| Tab | Structure library: place, edit, duplicate, rename, export, import, delete |
| B | Build a new structure (enter structure mode) |
| F | Fortify the warren (Warren Defense worlds) |
| U · K | Armory · choose a perk (Warren Defense worlds) |
| M | World menu: switch, create, rename, export, import worlds; author name; spawn point |
| H | Controls overlay |
| P | Save a screenshot |
| Ctrl+Z / Ctrl+Y | Undo / redo (blocks in structure mode, placements in world mode) |

On phones and tablets the game switches to touch controls automatically: a left thumbstick to
move, drag anywhere else to look, up and down buttons to fly, and on-screen buttons such as Place,
Break, Rotate and Undo that act on whatever is under the centre crosshair. Tap a hotbar slot to pick
a material. Add `?touch=1` or `?touch=0` to the URL to force touch controls on or off.

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
npm run balance    # headless Warren Defense rounds over many seeds, per policy and upgrade profile
```

The game exposes `window.__game` for automation (the end-to-end tests drive it through this API).

## Not yet

Terrain and terrain editing, walking with gravity, shaped blocks (slabs, stairs), multiplayer, and a
packaged desktop app are out of scope for this version. The core is built so those can be layered on.
