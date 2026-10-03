import { el } from './dom';
import { openPanel } from './panel';

const SECTIONS: Array<[string, Array<[string, string]>]> = [
  [
    'Moving around',
    [
      ['Mouse', 'Look around (click the game to take control, Esc to release)'],
      ['W A S D', 'Fly forward / left / back / right'],
      ['Space / Shift', 'Rise / sink'],
      ['Ctrl', 'Hold to fly faster'],
      ['Mouse wheel', 'Change flying speed'],
    ],
  ],
  [
    'World mode',
    [
      ['Tab', 'Open the structure library: your own structures and ready-made examples'],
      ['Left click', 'Place the previewed structure (green = fits, red = blocked)'],
      ['R', 'Rotate the preview a quarter turn'],
      ['Esc / right click', 'Stop placing'],
      ['X', 'Remove the structure you are looking at'],
      ['G', 'Pick up the structure you are looking at and move it'],
      ['B', 'Enter structure mode to build something new'],
      ['M', 'World menu: switch, export or import worlds'],
      ['P', 'Save a screenshot'],
    ],
  ],
  [
    'Wild worlds',
    [
      ['N', 'Nature panel: the rules, grass cover and overlays'],
      ['O', 'Cycle overlays: food, blocked sky, water, safety from wolves'],
      ['T', 'Cycle time speed: pause, 1×, 4×, 16×'],
      ['Food', 'Grass grows only where no block is overhead; roofs starve the ground beneath'],
      ['Rabbits', 'Eat grass, drink at the shore, sleep at night (under a roof if one is near) and breed when well fed'],
      ['Aim at a rabbit', 'See what it is doing and its food, water, energy and health'],
      ['Wolves', 'Arrive late on day 1; they track rabbits by scent, wait by the water, stalk and pounce'],
      ['Keep rabbits safe', 'Wolves are 2 tall and leap 2 up: a 1-high gap or walls 3 high keep them out'],
      ['Aim at a wolf', 'See what it is up to: prowling, lying in wait, stalking or pouncing'],
      ['Nature panel', 'Population graph, and buttons to release rabbits or wolves at the crosshair'],
    ],
  ],
  [
    'Warren Defense',
    [
      ['Goal', 'Keep the rabbits alive: the round ends when the last one falls. Waves get tougher the longer you hold out'],
      ['Waves', 'The first comes at 0:30, then about one a minute; Call now brings the next one early for bonus points'],
      ['Predators', 'Foxes are small enough for 1-high gaps; wolves and badgers chew through the weakest wall instead'],
      ['Later waves', 'Tigers leap 3 high (build walls 4 high), bears smash walls, hawks dive at rabbits not under a roof'],
      ['Elites and bosses', 'Gold elites from 15:00 and a red boss at 10:00 and 20:00: tougher and worth more points'],
      ['Defenders', 'Red scarves: they man the lookout posts and shoot at predators they can see'],
      ['Breeders', 'Everyone else eats, drinks and raises young, and runs home when predators come; use − / + to set how many defend'],
      ['F', 'Fortify: build (right click) and break (left click) warren blocks inside the orange area'],
      ['Block budget', 'Stronger materials cost more and unlock later; points from kills buy +100 more budget'],
      ['Lookout Post', 'A defender post: the block on top is where a defender stands. More defenders need more posts'],
      ['Tab', 'Place a library structure to stamp it into the warren (it costs budget)'],
      ['Weapons', 'Unlock with time survived, points or kills: bow, crossbow, musket, rifle, shotgun, cannon, laser, plasma'],
      ['K', 'Choose a perk: one of three random cards every wave, and a rare one every 5 minutes'],
      ['U', 'Armory: weapons and what unlocks them, the main weapon, block strength and perks taken'],
      ['Repair', 'Mends damaged blocks for points (the 🔧 button)'],
      ['Clover', 'Earned every round for time survived, milestones, kills and achievements'],
      ['Warren Council', 'Spend Clover on permanent upgrades (from the round summary or the World menu, M)'],
    ],
  ],
  [
    'Touch screens',
    [
      ['Left stick', 'Move; push it all the way to go faster'],
      ['Drag anywhere else', 'Look around'],
      ['Up / Down', 'Fly up or down'],
      ['Place / Break', 'Build or remove the block under the crosshair; hold to repeat'],
      ['Hotbar', 'Tap a material to use it; tap it again to see every material'],
      ['Rotate / Raise / Lower', 'Adjust a structure before you place it'],
      ['Remove / Move', 'Act on the structure under the crosshair'],
    ],
  ],
  [
    'Structure mode',
    [
      ['Right click', 'Place a block against the face you are looking at'],
      ['Left click', 'Remove the block you are looking at'],
      ['1 – 9', 'Select a hotbar material'],
      ['E', 'Open the material picker for the selected slot'],
      ['Middle click / Q', 'Pick the material you are looking at'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Enter', 'Save the structure to your library'],
      ['Esc', 'Leave without saving (asks first)'],
    ],
  ],
];

export function openHelp(): void {
  const panel = openPanel('Controls', { wide: true, id: 'help-panel' });
  for (const [title, rows] of SECTIONS) {
    panel.body.append(
      el('h3', {}, title),
      el('table', { class: 'keys' }, el('tbody', {}, ...rows.map(([k, d]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, d))))),
    );
  }
  panel.body.append(
    el('h3', {}, 'Sharing'),
    el('p', {}, 'Export any structure from the library as a .structure.json file and send it to a friend; they import it from their library and place it in their world. Export a whole world from the world menu as a .world.zip bundle that carries every structure it uses.'),
  );
}
