import { structureBlockCount, type Structure } from '../core/structure';
import { el, formatDate } from './dom';
import { openPanel, type PanelHandle } from './panel';

export type LibraryTab = 'mine' | 'examples';

export interface LibraryActions {
  onTab: (tab: LibraryTab) => void;
  onPlace: (s: Structure) => void;
  onEdit: (s: Structure) => void;
  onEditCopy: (s: Structure) => void;
  onDuplicate: (s: Structure) => void;
  onRename: (s: Structure) => void;
  onExport: (s: Structure) => void;
  onDelete: (s: Structure) => void;
  onImport: () => void;
  onNew: () => void;
}

export interface LibraryState {
  mine: Structure[];
  examples: Structure[];
  /** One-line description for an example, by id. */
  describe: (id: string) => string;
  tab: LibraryTab;
}

/** Gallery of the player's structures and the built-in examples, with actions for each. */
export function openLibraryPanel(state: LibraryState, actions: LibraryActions): PanelHandle {
  const panel = openPanel('Structure library', { wide: true, id: 'library-panel' });
  const tabButton = (tab: LibraryTab, label: string) =>
    el(
      'button',
      {
        class: `tab${state.tab === tab ? ' active' : ''}`,
        role: 'tab',
        'aria-selected': state.tab === tab ? 'true' : 'false',
        dataset: { tab },
        onclick: () => state.tab !== tab && actions.onTab(tab),
      },
      label,
    );
  panel.body.append(
    el('div', { class: 'tabs', role: 'tablist' }, tabButton('mine', `My structures (${state.mine.length})`), tabButton('examples', `Examples (${state.examples.length})`)),
  );
  if (state.tab === 'examples') renderExamples(panel.body, state, actions);
  else renderMine(panel.body, state, actions);
  return panel;
}

function renderMine(body: HTMLElement, state: LibraryState, actions: LibraryActions): void {
  const list = state.mine;
  body.append(
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn primary', id: 'library-new', onclick: () => actions.onNew() }, 'Build new structure'),
      el('button', { class: 'btn', id: 'library-import', onclick: () => actions.onImport() }, 'Import .structure.json…'),
    ),
  );
  if (list.length === 0) {
    body.append(
      el(
        'p',
        { class: 'empty' },
        'Nothing here yet. Build a structure, import one from a friend, or ',
        el('button', { class: 'link-btn', onclick: () => actions.onTab('examples') }, 'start from an example'),
        '.',
      ),
    );
    return;
  }
  const grid = el('div', { class: 'card-grid', id: 'library-grid' });
  for (const s of list) {
    grid.append(
      card(s, `${s.author ? `by ${s.author} · ` : ''}${formatDate(s.updatedAt)}`, [
        el('button', { class: 'btn primary small', onclick: () => actions.onPlace(s), dataset: { action: 'place' } }, 'Place'),
        el('button', { class: 'btn small', onclick: () => actions.onEdit(s), dataset: { action: 'edit' } }, 'Edit'),
        el('button', { class: 'btn small', onclick: () => actions.onDuplicate(s), dataset: { action: 'duplicate' } }, 'Duplicate'),
        el('button', { class: 'btn small', onclick: () => actions.onRename(s), dataset: { action: 'rename' } }, 'Rename'),
        el('button', { class: 'btn small', onclick: () => actions.onExport(s), dataset: { action: 'export' } }, 'Export'),
        el('button', { class: 'btn small danger-text', onclick: () => actions.onDelete(s), dataset: { action: 'delete' } }, 'Delete'),
      ]),
    );
  }
  body.append(grid);
}

function renderExamples(body: HTMLElement, state: LibraryState, actions: LibraryActions): void {
  body.append(el('p', { class: 'muted' }, 'Ready-made structures to place in your world. Editing one makes your own copy; the original stays here.'));
  const grid = el('div', { class: 'card-grid', id: 'examples-grid' });
  for (const s of state.examples) {
    grid.append(
      card(s, state.describe(s.id), [
        el('button', { class: 'btn primary small', onclick: () => actions.onPlace(s), dataset: { action: 'place' } }, 'Place'),
        el('button', { class: 'btn small', onclick: () => actions.onEditCopy(s), dataset: { action: 'edit-copy' } }, 'Edit a copy'),
        el('button', { class: 'btn small', onclick: () => actions.onExport(s), dataset: { action: 'export' } }, 'Export'),
      ]),
    );
  }
  body.append(grid);
}

function card(s: Structure, subtitle: string, buttons: HTMLElement[]): HTMLElement {
  const size = s.voxels.size;
  return el(
    'div',
    { class: 'card', dataset: { structureId: s.id, structureName: s.name } },
    s.thumbnail ? el('img', { class: 'thumb', src: s.thumbnail, alt: '' }) : el('div', { class: 'thumb placeholder' }, 'no preview'),
    el('div', { class: 'card-title' }, s.name || 'Untitled'),
    el('div', { class: 'muted small' }, `${size.x} × ${size.y} × ${size.z} · ${structureBlockCount(s)} blocks`),
    el('div', { class: 'muted small card-sub' }, subtitle),
    el('div', { class: 'card-actions' }, ...buttons),
  );
}
