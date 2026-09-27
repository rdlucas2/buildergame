import type { WorldSummary } from '../storage/worlds';
import { el, formatDate } from './dom';
import { openPanel, type PanelHandle } from './panel';

export interface WorldActions {
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: () => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  onSetAuthor: (name: string) => void;
  onSetSpawn: () => void;
}

export interface WorldPanelState {
  worlds: WorldSummary[];
  activeId: string | undefined;
  author: string;
  persistent: boolean;
}

export function openWorldPanel(state: WorldPanelState, actions: WorldActions): PanelHandle {
  const panel = openPanel('Worlds', { wide: true, id: 'world-panel' });
  const authorInput = el('input', { type: 'text', class: 'text-input', value: state.author, placeholder: 'Your name (stamped on structures you save)', id: 'author-input' });
  authorInput.addEventListener('change', () => actions.onSetAuthor(authorInput.value));
  authorInput.addEventListener('keydown', (e) => e.stopPropagation());
  panel.body.append(
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn primary', id: 'world-new', onclick: actions.onNew }, 'New world'),
      el('button', { class: 'btn', id: 'world-rename', onclick: actions.onRename }, 'Rename current'),
      el('button', { class: 'btn', id: 'world-spawn', onclick: actions.onSetSpawn, title: 'Use your current position as where you start in this world' }, 'Set spawn here'),
      el('button', { class: 'btn', id: 'world-export', onclick: actions.onExport }, 'Export current (.world.zip)'),
      el('button', { class: 'btn', id: 'world-import', onclick: actions.onImport }, 'Import .world.zip…'),
    ),
    el('label', { class: 'field' }, 'Author name', authorInput),
  );
  if (!state.persistent) {
    panel.body.append(el('p', { class: 'warn' }, 'Storage is unavailable in this browser session: your worlds will be lost when you close the tab. Export to keep them.'));
  }
  const list = el('div', { class: 'list', id: 'world-list' });
  for (const w of state.worlds) {
    const active = w.id === state.activeId;
    list.append(
      el(
        'div',
        { class: `list-row${active ? ' active' : ''}`, dataset: { worldId: w.id } },
        el('div', { class: 'grow' }, el('div', { class: 'card-title' }, w.name || 'Untitled', active ? el('span', { class: 'tag' }, 'current') : null), el('div', { class: 'muted small' }, `${w.placements} placement${w.placements === 1 ? '' : 's'} · ${formatDate(w.updatedAt)}`)),
        active ? null : el('button', { class: 'btn small', onclick: () => actions.onOpen(w.id), dataset: { action: 'open' } }, 'Open'),
        el('button', { class: 'btn small danger-text', onclick: () => actions.onDelete(w.id), dataset: { action: 'delete' } }, 'Delete'),
      ),
    );
  }
  panel.body.append(el('h3', {}, 'Your worlds'), list);
  return panel;
}
