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
    // Only blame WebGL when it is WebGL that failed.
    const hint = /webgl/i.test(msg)
      ? 'This game needs WebGL. Try a current version of Chrome, Firefox, Edge or Safari.'
      : 'Something went wrong while starting. Your worlds and structures are still saved in this browser: try reloading the page.';
    container.innerHTML = `<div class="start-overlay"><div class="start-card"><h1>Buildergame could not start</h1><p>${escapeHtml(msg)}</p><p class="muted">${hint}</p></div></div>`;
    document.body.dataset.ready = 'error';
  });

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
