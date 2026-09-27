import { el } from './dom';

let host: HTMLElement | null = null;

export type ToastKind = 'info' | 'success' | 'error';

/** Small transient message in the corner. */
export function toast(message: string, kind: ToastKind = 'info', ms = 3200): void {
  if (!host) {
    host = el('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const node = el('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, ms);
}
