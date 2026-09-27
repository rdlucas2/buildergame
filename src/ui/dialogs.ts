import { el } from './dom';
import { openPanel } from './panel';

/** Text prompt as a modal card. Resolves null when cancelled. */
export function promptDialog(title: string, opts: { label?: string; value?: string; okLabel?: string; placeholder?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      panel.close();
      resolve(v);
    };
    const input = el('input', { type: 'text', value: opts.value ?? '', placeholder: opts.placeholder ?? '', class: 'text-input', autofocus: true });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value);
      e.stopPropagation();
    });
    const panel = openPanel(title, { id: 'prompt-dialog' });
    panel.body.append(
      el('label', { class: 'field' }, opts.label ?? '', input),
      el(
        'div',
        { class: 'row end' },
        el('button', { class: 'btn', onclick: () => finish(null) }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: () => finish(input.value), id: 'prompt-ok' }, opts.okLabel ?? 'OK'),
      ),
    );
    const observer = new MutationObserver(() => {
      if (!document.body.contains(panel.root)) {
        observer.disconnect();
        finish(null);
      }
    });
    observer.observe(document.body, { childList: true });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

export function confirmDialog(title: string, message: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      panel.close();
      resolve(v);
    };
    const panel = openPanel(title, { id: 'confirm-dialog' });
    panel.body.append(
      el('p', {}, message),
      el(
        'div',
        { class: 'row end' },
        el('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => finish(true), id: 'confirm-ok' }, okLabel),
      ),
    );
    const observer = new MutationObserver(() => {
      if (!document.body.contains(panel.root)) {
        observer.disconnect();
        finish(false);
      }
    });
    observer.observe(document.body, { childList: true });
  });
}
