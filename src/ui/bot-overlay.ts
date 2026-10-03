import { el } from './dom';

/**
 * A small panel in the corner for whoever is playing the round other than you: a test bot (its
 * persona, last decision and how sure it was) or a replay being watched. Hidden when `text` is null.
 */
export function setBotOverlay(text: string | null): void {
  let box = document.getElementById('bot-overlay');
  if (text === null) {
    box?.remove();
    return;
  }
  if (!box) {
    box = el('div', { id: 'bot-overlay', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  box.textContent = text;
}
