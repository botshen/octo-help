import { OCTO_SELECTORS } from './octoSelectors';

/**
 * The optional AI-balance pill above the Octo composer.
 *
 * It receives an already-formatted string and nothing else: the endpoint, the
 * headers and the API key stay in the extension. This file runs in the MAIN
 * world, which shares a realm with Octo's own scripts, so a secret arriving here
 * would be a secret published to the page.
 *
 * Positioning mirrors the built-in companion (same composer anchor, same
 * rAF-throttled reposition) because both hang off an element Octo re-renders
 * whenever the conversation changes.
 */

const ROOT_ID = 'octo-ai-balance-pill';
const STYLE_ID = 'octo-ai-balance-pill-style';
const COMPOSER_SELECTOR = OCTO_SELECTORS.composer;

let currentText = '';
let currentLow = false;
let mutationObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let anchor: HTMLElement | null = null;
let positionFrame: number | null = null;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed;
      z-index: 2147482998;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      box-sizing: border-box;
      max-width: 240px;
      padding: 3px 9px;
      border: 1px solid rgba(111, 94, 232, 0.28);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 4px 12px rgba(20, 24, 35, 0.12);
      color: #4b3fd0;
      font: 600 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    }
    #${ROOT_ID}[data-low='true'] {
      border-color: rgba(229, 72, 77, 0.35);
      background: rgba(255, 245, 245, 0.96);
      color: #c2262b;
    }
    body[theme-mode='dark'] #${ROOT_ID} {
      border-color: rgba(255, 255, 255, 0.16);
      background: rgba(37, 41, 50, 0.94);
      color: #c9c2ff;
    }
    body[theme-mode='dark'] #${ROOT_ID}[data-low='true'] {
      border-color: rgba(229, 72, 77, 0.45);
      background: rgba(60, 34, 38, 0.94);
      color: #ff9ea1;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

/** Newest visible composer, same rule the companion uses. */
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

/**
 * Where the pill sits: pinned to the composer's top-right corner, clamped into
 * the viewport.
 *
 * Exported and pure so the arithmetic is testable without a page — the same
 * reason `calculateComposerPetPosition` exists in the pet renderer.
 */
export function calculateAiBalancePillPosition(
  composer: { left: number; right: number; top: number },
  pillWidth: number,
  viewport: { width: number },
): { x: number; y: number } {
  const maxX = Math.max(8, viewport.width - pillWidth - 8);
  return {
    x: Math.min(Math.max(8, composer.right - pillWidth - 4), maxX),
    y: Math.max(8, composer.top - 28),
  };
}

function updatePosition(): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
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
  const { x, y } = calculateAiBalancePillPosition(
    { left: rect.left, right: rect.right, top: rect.top },
    root.offsetWidth || 96,
    { width: window.innerWidth },
  );
  root.style.left = `${x}px`;
  root.style.top = `${y}px`;
}

function schedulePosition(): void {
  if (positionFrame != null) return;
  positionFrame = window.requestAnimationFrame(() => {
    positionFrame = null;
    updatePosition();
  });
}

function startTracking(): void {
  if (mutationObserver) return;
  mutationObserver = new MutationObserver(schedulePosition);
  mutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener('scroll', schedulePosition, true);
  window.addEventListener('resize', schedulePosition);
}

function stopTracking(): void {
  mutationObserver?.disconnect();
  mutationObserver = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  anchor = null;
  if (positionFrame != null) window.cancelAnimationFrame(positionFrame);
  positionFrame = null;
  document.removeEventListener('scroll', schedulePosition, true);
  window.removeEventListener('resize', schedulePosition);
}

/**
 * Show `text` next to the composer, or remove the pill when it is empty.
 *
 * Text only, set via `textContent` — this is page-privileged code, so there is
 * no template to inject into.
 */
export function setAiBalancePill(text: string, low: boolean): void {
  const trimmed = typeof text === 'string' ? text.trim().slice(0, 40) : '';
  if (!trimmed) {
    teardownAiBalancePill();
    return;
  }
  currentText = trimmed;
  currentLow = low === true;
  ensureStyle();
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '💰';
    const label = document.createElement('span');
    label.className = 'octo-ai-balance-text';
    root.append(icon, label);
    (document.body || document.documentElement).appendChild(root);
  }
  root.dataset.low = String(currentLow);
  const label = root.querySelector<HTMLElement>('.octo-ai-balance-text');
  if (label) label.textContent = currentText;
  startTracking();
  updatePosition();
}

export function teardownAiBalancePill(): void {
  stopTracking();
  currentText = '';
  currentLow = false;
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
}
