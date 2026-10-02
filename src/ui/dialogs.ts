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

/** What kind of world to make: a plain building world, a wild sandbox, or a Warren Defense game. */
export type WorldKind = 'plain' | 'wild' | 'defense';

/** "New world" dialog: a name and the kind of world (chosen once, when the world is created). */
export function newWorldDialog(defaultName: string): Promise<{ name: string; kind: WorldKind } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { name: string; kind: WorldKind } | null) => {
      if (settled) return;
      settled = true;
      panel.close();
      resolve(v);
    };
    const input = el('input', { type: 'text', value: defaultName, class: 'text-input', id: 'new-world-name' });
    const option = (kind: WorldKind, id: string, title: string, text: string) => {
      const radio = el('input', { type: 'radio', name: 'new-world-kind', value: kind, id, checked: kind === 'plain' });
      return { radio, label: el('label', { class: 'check-field' }, radio, el('span', {}, el('strong', {}, title), el('span', { class: 'muted small' }, text))) };
    };
    const kinds = [
      option('plain', 'new-world-plain', 'Builder', 'A flat world for building. No creatures, no day and night.'),
      option('wild', 'new-world-wild', 'Wild world', 'Ponds, streams and grass that grows only under open sky, day and night, rabbits, and wolves that hunt them.'),
      option(
        'defense',
        'new-world-defense',
        'Warren Defense',
        "Waves of predators attack your rabbits' warren. Fortify it on a block budget and split the rabbits into defenders and breeders. How long can they hold out?",
      ),
    ];
    const submit = () => finish({ name: input.value, kind: (kinds.find((k) => k.radio.checked)?.radio.value as WorldKind | undefined) ?? 'plain' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      e.stopPropagation();
    });
    const panel = openPanel('New world', { id: 'new-world-dialog' });
    panel.body.append(
      el('label', { class: 'field' }, 'World name', input),
      el('div', { class: 'kind-list', role: 'radiogroup', 'aria-label': 'Kind of world' }, ...kinds.map((k) => k.label)),
      el('p', { class: 'muted small' }, 'The kind is chosen once, when the world is created.'),
      el(
        'div',
        { class: 'row end' },
        el('button', { class: 'btn', onclick: () => finish(null) }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: submit, id: 'new-world-create' }, 'Create'),
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
