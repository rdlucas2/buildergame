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
