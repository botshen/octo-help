import type { BuiltInCompanionId } from './octoRecall';
import { OCTO_SELECTORS } from './octoSelectors';

const ROOT_ID = 'octo-built-in-companion';
const STYLE_ID = 'octo-built-in-companion-style';
const COMPOSER_SELECTOR = OCTO_SELECTORS.composer;
const SPEECH_DURATION_MS = 5_000;

const COMPANIONS: Record<
  BuiltInCompanionId,
  { emoji: string; label: string; duration: number }
> = {
  ant: { emoji: '🐜', label: '蚂蚁小队', duration: 13 },
  snail: { emoji: '🐌', label: '蜗牛巡游', duration: 22 },
  wizard: { emoji: '🧙', label: '飞行巫师', duration: 15 },
  zombie: { emoji: '🧟', label: '散步僵尸', duration: 18 },
};

let activeId: BuiltInCompanionId | null = null;
let mutationObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let anchor: HTMLElement | null = null;
let positionFrame: number | null = null;
let activeTimer: number | null = null;
let speechTimer: number | null = null;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed;
      z-index: 2147482999;
      height: 58px;
      overflow: visible;
      pointer-events: none;
      user-select: none;
      contain: layout style;
    }
    #${ROOT_ID} .octo-companion-track {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
    }
    #${ROOT_ID} .octo-companion-parade {
      position: absolute;
      left: -92px;
      bottom: 0;
      display: flex;
      align-items: flex-end;
      gap: 1px;
      width: max-content;
      animation: octo-companion-march var(--octo-companion-duration, 16s) linear infinite;
      animation-play-state: paused;
      filter: drop-shadow(0 4px 3px rgba(20, 24, 35, 0.2));
      will-change: left;
    }
    #${ROOT_ID}[data-active='true'] .octo-companion-parade {
      animation-play-state: running;
    }
    #${ROOT_ID} .octo-companion-pet {
      display: block;
      font: 30px/1 "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
      transform-origin: 50% 100%;
      animation: octo-companion-step 520ms ease-in-out infinite alternate;
    }
    #${ROOT_ID} .octo-companion-pet:nth-child(1) {
      font-size: 18px;
      opacity: 0.78;
      animation-delay: -180ms;
    }
    #${ROOT_ID} .octo-companion-pet:nth-child(2) {
      font-size: 23px;
      opacity: 0.9;
      animation-delay: -340ms;
    }
    #${ROOT_ID}[data-companion='snail'] .octo-companion-pet {
      animation-duration: 900ms;
    }
    #${ROOT_ID}[data-companion='snail'] .octo-companion-pet:nth-child(1) {
      font-size: 25px;
    }
    #${ROOT_ID}[data-companion='snail'] .octo-companion-pet:nth-child(2) {
      font-size: 33px;
    }
    #${ROOT_ID}[data-companion='snail'] .octo-companion-pet:nth-child(3) {
      font-size: 43px;
    }
    #${ROOT_ID}[data-companion='wizard'] .octo-companion-pet {
      animation-name: octo-companion-float;
      animation-duration: 760ms;
    }
    #${ROOT_ID}[data-companion='zombie'] .octo-companion-pet {
      animation-duration: 680ms;
    }
    #${ROOT_ID} .octo-companion-speech {
      position: absolute;
      right: 10px;
      bottom: calc(100% + 7px);
      box-sizing: border-box;
      width: max-content;
      max-width: min(260px, calc(100vw - 24px));
      padding: 8px 11px;
      border: 1px solid rgba(24, 31, 45, 0.12);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 8px 22px rgba(20, 24, 35, 0.16);
      color: #30343b;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    body[theme-mode='dark'] #${ROOT_ID} .octo-companion-speech {
      border-color: rgba(255, 255, 255, 0.16);
      background: rgba(37, 41, 50, 0.96);
      color: #f3f4f6;
    }
    @keyframes octo-companion-march {
      from { left: -92px; }
      to { left: calc(100% + 12px); }
    }
    @keyframes octo-companion-step {
      from { transform: translateY(0) rotate(-3deg); }
      to { transform: translateY(-4px) rotate(3deg); }
    }
    @keyframes octo-companion-float {
      from { transform: translateY(1px) rotate(-4deg); }
      to { transform: translateY(-7px) rotate(4deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      #${ROOT_ID} .octo-companion-parade {
        left: 12px;
        animation: none;
      }
      #${ROOT_ID} .octo-companion-pet { animation: none; }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function findAnchor(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR));
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const rect = candidates[index].getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
      return candidates[index];
    }
  }
  return null;
}

function updatePosition(): void {
  const root = document.getElementById(ROOT_ID);
  if (!root || !activeId) return;
  const nextAnchor = findAnchor();
  if (!nextAnchor) {
    root.style.visibility = 'hidden';
    return;
  }
  root.style.visibility = 'visible';
  if (anchor !== nextAnchor) {
    anchor = nextAnchor;
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(schedulePosition);
    resizeObserver.observe(nextAnchor);
  }
  const rect = nextAnchor.getBoundingClientRect();
  root.style.left = `${Math.max(8, rect.left)}px`;
  root.style.top = `${Math.max(8, rect.top - 56)}px`;
  root.style.width = `${Math.max(
    0,
    Math.min(rect.width, window.innerWidth - Math.max(8, rect.left) - 8),
  )}px`;
}

function schedulePosition(): void {
  if (positionFrame != null) return;
  positionFrame = window.requestAnimationFrame(() => {
    positionFrame = null;
    updatePosition();
  });
}

function setActive(active: boolean): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.dataset.active = String(active);
  if (!active) {
    const parade = root.querySelector<HTMLElement>('.octo-companion-parade');
    if (parade) {
      // A paused CSS animation keeps its current progress. Restart it so an
      // idle companion always waits just outside the composer's left edge.
      parade.style.animation = 'none';
      void parade.offsetWidth;
      parade.style.removeProperty('animation');
    }
  }
}

export function getCompanionPassDurationMs(id: BuiltInCompanionId): number {
  return COMPANIONS[id].duration * 1_000;
}

function wake(duration?: number): void {
  if (!activeId) return;
  setActive(true);
  if (activeTimer != null) window.clearTimeout(activeTimer);
  const activeDuration = Math.max(duration ?? 0, getCompanionPassDurationMs(activeId));
  activeTimer = window.setTimeout(() => {
    activeTimer = null;
    const focused = document.activeElement?.closest?.(COMPOSER_SELECTOR);
    if (!focused) setActive(false);
  }, activeDuration);
}

function onFocusIn(event: FocusEvent): void {
  if ((event.target as Element | null)?.closest?.(COMPOSER_SELECTOR)) wake(60_000);
}

function onFocusOut(): void {
  window.setTimeout(() => {
    if (!document.activeElement?.closest?.(COMPOSER_SELECTOR)) setActive(false);
  }, 0);
}

function stopTracking(): void {
  mutationObserver?.disconnect();
  mutationObserver = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  anchor = null;
  if (positionFrame != null) window.cancelAnimationFrame(positionFrame);
  positionFrame = null;
  if (activeTimer != null) window.clearTimeout(activeTimer);
  activeTimer = null;
  if (speechTimer != null) window.clearTimeout(speechTimer);
  speechTimer = null;
  document.removeEventListener('scroll', schedulePosition, true);
  document.removeEventListener('focusin', onFocusIn, true);
  document.removeEventListener('focusout', onFocusOut, true);
}

export function applyBuiltInCompanion(id: BuiltInCompanionId | null): void {
  if (!id) {
    teardownBuiltInCompanion();
    return;
  }
  activeId = id;
  ensureStyle();
  const companion = COMPANIONS[id];
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'img');
    (document.body || document.documentElement).appendChild(root);
  }
  root.dataset.companion = id;
  root.dataset.active = 'false';
  root.setAttribute('aria-label', companion.label);
  root.style.setProperty('--octo-companion-duration', `${companion.duration}s`);
  root.innerHTML = `
    <div class="octo-companion-track" aria-hidden="true">
      <div class="octo-companion-parade">
        <span class="octo-companion-pet">${companion.emoji}</span>
        <span class="octo-companion-pet">${companion.emoji}</span>
        <span class="octo-companion-pet">${companion.emoji}</span>
      </div>
    </div>
  `;
  stopTracking();
  mutationObserver = new MutationObserver(schedulePosition);
  mutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener('scroll', schedulePosition, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  updatePosition();
  wake();
}

export function showBuiltInCompanionSpeech(text: string): boolean {
  const root = document.getElementById(ROOT_ID);
  if (!root || !activeId || !text.trim()) return false;
  let speech = root.querySelector<HTMLElement>('.octo-companion-speech');
  if (!speech) {
    speech = document.createElement('span');
    speech.className = 'octo-companion-speech';
    speech.setAttribute('role', 'status');
    speech.setAttribute('aria-live', 'polite');
    root.appendChild(speech);
  }
  speech.textContent = text.trim();
  wake();
  if (speechTimer != null) window.clearTimeout(speechTimer);
  speechTimer = window.setTimeout(() => {
    speech?.remove();
    speechTimer = null;
  }, SPEECH_DURATION_MS);
  return true;
}

export function teardownBuiltInCompanion(): void {
  stopTracking();
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  activeId = null;
}

export const BUILT_IN_COMPANIONS = COMPANIONS;
