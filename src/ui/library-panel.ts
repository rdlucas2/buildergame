import { structureBlockCount, type Structure } from '../core/structure';
import { el, formatDate } from './dom';
import { openPanel, type PanelHandle } from './panel';

export interface LibraryActions {
  onPlace: (s: Structure) => void;
  onEdit: (s: Structure) => void;
  onDuplicate: (s: Structure) => void;
  onRename: (s: Structure) => void;
  onExport: (s: Structure) => void;
  onDelete: (s: Structure) => void;
  onImport: () => void;
  onNew: () => void;
}

/** Gallery of saved structures with thumbnails and actions. */
export function openLibraryPanel(structures: Structure[], actions: LibraryActions, opts: { canPlace: boolean }): PanelHandle {
  const panel = openPanel('Structure library', { wide: true, id: 'library-panel' });
  panel.body.append(
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn primary', id: 'library-new', onclick: () => actions.onNew() }, 'Build new structure'),
      el('button', { class: 'btn', id: 'library-import', onclick: () => actions.onImport() }, 'Import .structure.json…'),
      el('span', { class: 'muted grow right' }, `${structures.length} structure${structures.length === 1 ? '' : 's'}`),
    ),
  );
  if (structures.length === 0) {
    panel.body.append(el('p', { class: 'empty' }, 'Nothing here yet. Build a structure or import one from a friend.'));
    return panel;
  }
  const grid = el('div', { class: 'card-grid', id: 'library-grid' });
  for (const s of structures) {
    const size = s.voxels.size;
    grid.append(
      el(
        'div',
        { class: 'card', dataset: { structureId: s.id, structureName: s.name } },
        s.thumbnail ? el('img', { class: 'thumb', src: s.thumbnail, alt: '' }) : el('div', { class: 'thumb placeholder' }, 'no preview'),
        el('div', { class: 'card-title' }, s.name || 'Untitled'),
        el('div', { class: 'muted small' }, `${size.x} × ${size.y} × ${size.z} · ${structureBlockCount(s)} blocks`),
        el('div', { class: 'muted small' }, `${s.author ? `by ${s.author} · ` : ''}${formatDate(s.updatedAt)}`),
        el(
          'div',
          { class: 'card-actions' },
          opts.canPlace ? el('button', { class: 'btn primary small', onclick: () => actions.onPlace(s), dataset: { action: 'place' } }, 'Place') : null,
          el('button', { class: 'btn small', onclick: () => actions.onEdit(s), dataset: { action: 'edit' } }, 'Edit'),
          el('button', { class: 'btn small', onclick: () => actions.onDuplicate(s), dataset: { action: 'duplicate' } }, 'Duplicate'),
          el('button', { class: 'btn small', onclick: () => actions.onRename(s), dataset: { action: 'rename' } }, 'Rename'),
          el('button', { class: 'btn small', onclick: () => actions.onExport(s), dataset: { action: 'export' } }, 'Export'),
          el('button', { class: 'btn small danger-text', onclick: () => actions.onDelete(s), dataset: { action: 'delete' } }, 'Delete'),
        ),
      ),
    );
  }
  panel.body.append(grid);
  return panel;
}
