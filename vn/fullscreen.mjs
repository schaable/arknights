// Fullscreen is a temporary view, independent of story state and saved preferences.
export function createFullscreen({ t, onError }) {
  const root = document.documentElement, button = document.getElementById('fullscreen');
  let fallback = false, wanted = false, pending = false, active = false;
  let restore = true, scroll = { x: 0, y: 0 };
  const native = () => document.fullscreenElement === root;
  function refresh() {
    const previous = active;
    active = native() || fallback;
    document.body.classList.toggle('reader-fullscreen', active);
    button.disabled = pending;
    button.setAttribute('aria-pressed', active);
    button.setAttribute('aria-label', t(active ? 'exitFullscreen' : 'fullscreen'));
    button.title = t(active ? 'exitFullscreen' : 'fullscreen');
    if (previous && !active && restore) {
      window.scrollTo(scroll.x, scroll.y);
      if (!document.querySelector('dialog[open]') && !document.getElementById('player').hidden) button.focus({ preventScroll: true });
    }
  }
  async function exit({ restoreFocus = true } = {}) {
    wanted = fallback = false;
    restore = restoreFocus;
    refresh();
    if (native()) {
      try { await document.exitFullscreen(); }
      catch { if (native()) onError(); }
      refresh();
    }
  }
  async function toggle() {
    if (pending) return;
    if (active) { await exit(); return; }
    wanted = restore = true;
    scroll = { x: window.scrollX, y: window.scrollY };
    pending = true;
    refresh();
    try {
      if (!document.fullscreenEnabled || !root.requestFullscreen) fallback = true;
      else await root.requestFullscreen();
    } catch {
      // Embedded pages and some mobile browsers only allow a full-window view.
      fallback = wanted;
    } finally {
      pending = false;
      if (!wanted) await exit({ restoreFocus: false });
      else refresh();
    }
  }
  button.addEventListener('click', toggle);
  document.addEventListener('fullscreenchange', refresh);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !active || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    exit();
  });
  return { refresh, exit };
}
