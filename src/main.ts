import { Game } from './game/game';

const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

Game.create(container)
  .then((game) => {
    window.__game = game.debug;
    document.body.dataset.ready = 'true';
  })
  .catch((err: unknown) => {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    container.innerHTML = `<div class="start-overlay"><div class="start-card"><h1>Buildergame could not start</h1><p>${escapeHtml(msg)}</p><p class="muted">This game needs WebGL. Try a current version of Chrome, Firefox, Edge or Safari.</p></div></div>`;
    document.body.dataset.ready = 'error';
  });

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
