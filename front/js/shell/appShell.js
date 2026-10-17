import { createViewportMotion } from './viewportMotion.js';

/** Shell alone owns global frame, menu, navigation chrome and layout mode. */
export function createAppShell({ element, onNavigate, onMenuOpen = () => {} }) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const menu = element.querySelector('#global-menu');
  const content = element.querySelector('.shell-content');
  const trigger = element.querySelector('[data-menu-trigger]');
  const backdrop = element.querySelector('.shell-backdrop');
  const title = element.querySelector('[data-page-title]');
  const navigation = [...menu.querySelectorAll('[data-page]')];
  const presentation = element.querySelector('[data-hosted-presentation]');
  const desktop = matchMedia('(min-width: 43.76rem) and (hover: hover) and (pointer: fine), (min-width: 60.01rem)');
  const viewport = window.visualViewport;
  let open = false;
  let destroyed = false;
  let scheduled = null;

  let rotating = false;
  let gesture = null;

  // Browser bounds and stage motion share a single JS clock. The renderer
  // never displays its frame outside the most recently measured visible rect.
  const frameMotion = createViewportMotion({
    reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    onFrame: ({frameTop, frameHeight, stageHeight, mode}) => {
      if (destroyed) return;
      element.style.setProperty('--shell-visible-top', `${frameTop.toFixed(2)}px`);
      element.style.setProperty('--shell-visible-height', `${frameHeight.toFixed(2)}px`);
      element.style.setProperty('--shell-stage-height', `${stageHeight.toFixed(2)}px`);
      element.dataset.viewportMotion = mode;
    }
  });
  function syncViewport() {
    if (destroyed) return;
    const visualHeight = viewport?.height;
    const fallback = window.innerHeight || document.documentElement.clientHeight || 1;
    const height = Math.max(1, Number.isFinite(visualHeight) && visualHeight > 0 ? visualHeight : fallback);
    const offset = viewport?.offsetTop;
    const top = Number.isFinite(offset) ? offset : 0;
    frameMotion.update({ height, top, orientation: rotating });
    rotating = false;
  }
  function scheduleViewport() {
    if (destroyed || scheduled !== null) return;
    scheduled = requestAnimationFrame(() => { scheduled = null; syncViewport(); });
  }

  function modal() { return open && !desktop.matches; }
  function setMenuOpen(value, { focus = true } = {}) {
    if (destroyed) return;
    const next = Boolean(value);
    if (next && !open) onMenuOpen();
    const focusWasInMenu = menu.contains(document.activeElement);
    gesture = null;
    element.style.removeProperty('--menu-drag-x');
    element.style.removeProperty('--menu-drag-progress');
    open = next;
    element.classList.toggle('menu-open', open);
    trigger.hidden = open;
    trigger.setAttribute('aria-expanded', String(open));
    menu.inert = !open;
    menu.setAttribute('aria-hidden', String(!open));
    content.inert = modal();
    presentation.inert = modal();
    backdrop.hidden = !modal();
    if (modal()) {
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-modal', 'true');
    } else {
      menu.removeAttribute('role');
      menu.removeAttribute('aria-modal');
    }
    if (focus && open) (navigation.find(button => button.getAttribute('aria-current') === 'page') ?? navigation[0]).focus();
    else if (!open && focusWasInMenu) trigger.focus();
  }
  const options = { signal };
  trigger.addEventListener('click', () => setMenuOpen(true), options);
  element.querySelectorAll('[data-menu-dismiss]').forEach(button => button.addEventListener('click', () => setMenuOpen(false), options));
  for (const button of navigation) button.addEventListener('click', () => {
    if (!desktop.matches) setMenuOpen(false);
    onNavigate(button.dataset.page);
  }, options);
  element.addEventListener('keydown', event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); }
    if (event.key !== 'Tab' || !modal()) return;
    const buttons = [...menu.querySelectorAll('button:not([hidden])')];
    const first = buttons[0]; const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }, options);
  function syncDocking() {
    element.classList.toggle('is-docked', desktop.matches);
    setMenuOpen(desktop.matches, { focus: false });
  }
  desktop.addEventListener('change', syncDocking, options);
  window.addEventListener('resize', scheduleViewport, options);
  window.addEventListener('pageshow', scheduleViewport, options);
  window.addEventListener('orientationchange', () => { rotating = true; scheduleViewport(); }, options);
  viewport?.addEventListener('resize', scheduleViewport, options);
  viewport?.addEventListener('scroll', scheduleViewport, options);

  // Drawer gesture is owned by Shell, independently from hosted-page swipes.
  menu.addEventListener('pointerdown', event => {
    if (!modal() || (event.button !== 0 && event.pointerType === 'mouse')) return;
    if (event.target.closest('button,input,textarea,select,a,[contenteditable]')) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX,
      time: performance.now(), vx: 0, horizontal: false, delta: 0 };
  }, options);
  window.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId || !modal()) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (dx >= 0 || Math.abs(dy) > Math.abs(dx) * .92) { gesture = null; return; }
      gesture.horizontal = true;
      menu.classList.add('is-dragging');
    }
    if (event.cancelable) event.preventDefault();
    const width = menu.getBoundingClientRect().width || 1;
    gesture.delta = Math.max(-width, Math.min(0, dx));
    const now = performance.now();
    const speed = (event.clientX - gesture.lastX) / Math.max(1, now - gesture.time);
    gesture.vx = gesture.vx * .68 + speed * .32;
    gesture.lastX = event.clientX; gesture.time = now;
    element.style.setProperty('--menu-drag-x', `${gesture.delta}px`);
    element.style.setProperty('--menu-drag-progress', String(1 + gesture.delta / width));
  }, { signal, passive: false });
  function finishDrawer(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const session = gesture; gesture = null;
    menu.classList.remove('is-dragging');
    element.style.removeProperty('--menu-drag-x');
    element.style.removeProperty('--menu-drag-progress');
    const width = menu.getBoundingClientRect().width || 1;
    if (session.horizontal && (Math.abs(session.delta) > width * .22 || session.vx < -.34)) setMenuOpen(false);
  }
  window.addEventListener('pointerup', finishDrawer, options);
  window.addEventListener('pointercancel', finishDrawer, options);

  element.dataset.layout = 'stacked';
  syncViewport();
  syncDocking();
  return {
    getMenuOpen: () => open,
    isModalOpen: modal,
    setMenuOpen,
    setHostedPillVisible(visible) { title.hidden=Boolean(visible); },
    setPresentationMode(mode) {
      if (!['immersive','stacked'].includes(mode)) throw new TypeError('Unknown page layout');
      element.dataset.layout = mode;
    },
    setActivePage(id) {
      let label = 'Ovll';
      for (const button of navigation) {
        if (button.dataset.page === id) { button.setAttribute('aria-current','page'); label = button.textContent.trim(); }
        else button.removeAttribute('aria-current');
      }
      title.textContent = label;
      document.title = `${label} · Ovll`;
    },
    destroy() {
      if (destroyed) return;
      setMenuOpen(false, { focus: false });
      destroyed = true;
      lifetime.abort();
      if (scheduled !== null) cancelAnimationFrame(scheduled);
      frameMotion.destroy();
      for (const key of ['--shell-visible-height','--shell-visible-top','--shell-stage-height','--menu-drag-x','--menu-drag-progress']) element.style.removeProperty(key);
    }
  };
}

