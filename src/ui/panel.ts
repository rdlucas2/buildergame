import { el } from './dom';

export interface PanelHandle {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

let current: PanelHandle | null = null;
const listeners = new Set<(open: boolean) => void>();

/** Called whenever a panel opens or closes, so the game can release pointer lock and pause input. */
export function onPanelChange(fn: (open: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isPanelOpen(): boolean {
  return current !== null;
}

export function closePanel(): void {
  if (!current) return;
  const c = current;
  current = null;
  c.root.remove();
  for (const fn of listeners) fn(false);
}

/** Opens a modal card (closing any other). Escape or the × closes it. */
export function openPanel(title: string, opts: { wide?: boolean; id?: string } = {}): PanelHandle {
  closePanel();
  const body = el('div', { class: 'panel-body' });
  const root = el(
    'div',
    { class: 'panel-backdrop', onmousedown: (e: MouseEvent) => e.target === root && closePanel() },
    el(
      'div',
      { class: `panel${opts.wide ? ' panel-wide' : ''}`, role: 'dialog', 'aria-label': title, id: opts.id },
      el('div', { class: 'panel-head' }, el('h2', {}, title), el('button', { class: 'icon-btn', onclick: closePanel, 'aria-label': 'Close' }, '×')),
      body,
    ),
  );
  document.body.appendChild(root);
  current = { root, body, close: closePanel };
  for (const fn of listeners) fn(true);
  return current;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && current) {
    e.preventDefault();
    closePanel();
  }
});
