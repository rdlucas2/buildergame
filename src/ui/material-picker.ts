import { MATERIALS, type MaterialDef } from '../core/materials';
import { el } from './dom';
import { openPanel } from './panel';

const GROUPS: Array<{ key: MaterialDef['group']; title: string }> = [
  { key: 'natural', title: 'Natural' },
  { key: 'building', title: 'Building' },
  { key: 'color', title: 'Colours' },
  { key: 'special', title: 'Special' },
];

/** Grid of every material. Picking one assigns it to the active hotbar slot. */
export function openMaterialPicker(current: string, onPick: (id: string) => void): void {
  const panel = openPanel('Materials', { wide: true, id: 'material-picker' });
  panel.body.append(el('p', { class: 'muted' }, 'Every material is free. Click one to put it in your selected hotbar slot.'));
  for (const g of GROUPS) {
    const grid = el('div', { class: 'material-grid' });
    for (const m of MATERIALS.filter((x) => x.group === g.key)) {
      grid.append(
        el(
          'button',
          {
            class: `material${m.id === current ? ' selected' : ''}`,
            title: m.name,
            dataset: { material: m.id },
            onclick: () => {
              onPick(m.id);
              panel.close();
            },
          },
          el('div', { class: `swatch${m.transparent ? ' glass' : ''}`, style: { background: m.color } }),
          el('span', {}, m.name),
        ),
      );
    }
    panel.body.append(el('h3', {}, g.title), grid);
  }
}
