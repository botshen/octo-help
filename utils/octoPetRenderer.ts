import {
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  type DesktopPetMessage,
  type DesktopPetPlacement,
  type DesktopPetPosition,
  type DesktopPetPositionMessage,
  type StoredDesktopPet,
} from './octoRecall';
import { OCTO_SELECTORS } from './octoSelectors';
import {
  parseDesktopPetManifest,
  resolveDesktopPetAnimations,
  selectDesktopPetAnimation,
  type DesktopPetInteractionState,
  type ResolvedDesktopPetAnimation,
  type ResolvedDesktopPetAnimations,
} from './octoPetManifest';
import {
  applyBuiltInCompanion,
  showBuiltInCompanionSpeech,
  teardownBuiltInCompanion,
} from './octoBuiltInCompanion';

const ROOT_ID = 'octo-desktop-pet';
const STYLE_ID = 'octo-desktop-pet-style';
const SPRITE_CLASS = 'octo-desktop-pet-sprite';
const SPEECH_CLASS = 'octo-desktop-pet-speech';
const VIEWPORT_PADDING = 8;
const MAX_RENDERED_FRAME_SIZE = 180;
const MAX_COMPOSER_FRAME_SIZE = 72;
const SPEECH_DURATION_MS = 5_000;
const COMPOSER_SELECTOR = OCTO_SELECTORS.composer;

let animationTimer: number | undefined;
let speechTimer: number | undefined;
let loadGeneration = 0;
let lastPet: StoredDesktopPet | null = null;
let lastPosition: DesktopPetPosition | null = null;
let lastPlacement: DesktopPetPlacement = 'desktop';
let interactionState: DesktopPetInteractionState = 'idle';
let pointerHovering = false;
let dragDirection: -1 | 0 | 1 = 0;
let composerAnchor: HTMLElement | null = null;
let composerMutationObserver: MutationObserver | null = null;
let composerResizeObserver: ResizeObserver | null = null;
let composerPositionFrame: number | null = null;

interface AnimationRuntime {
  config: ResolvedDesktopPetAnimations;
  sprite: HTMLElement;
  renderedWidth: number;
  renderedHeight: number;
  currentAnimationName: string | null;
  reducedMotion: boolean;
}

let animationRuntime: AnimationRuntime | null = null;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed;
      right: 24px;
      bottom: 88px;
      z-index: 2147483000;
      display: block;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: grab;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      filter: drop-shadow(0 8px 8px rgba(20, 24, 35, 0.22));
      transition: filter 120ms ease;
    }
    #${ROOT_ID}:hover {
      filter: drop-shadow(0 10px 10px rgba(20, 24, 35, 0.3));
    }
    #${ROOT_ID}[data-dragging='true'] {
      cursor: grabbing;
      transition: none;
    }
    #${ROOT_ID}[data-placement='composer'] {
      cursor: default;
      filter: drop-shadow(0 6px 7px rgba(20, 24, 35, 0.2));
    }
    #${ROOT_ID} .${SPRITE_CLASS} {
      display: block;
      pointer-events: none;
      background-repeat: no-repeat;
      background-position: 0 0;
    }
    #${ROOT_ID} .${SPEECH_CLASS} {
      position: absolute;
      right: 0;
      bottom: calc(100% + 10px);
      box-sizing: border-box;
      width: max-content;
      max-width: min(260px, calc(100vw - 24px));
      padding: 9px 12px;
      border: 1px solid rgba(24, 31, 45, 0.12);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 8px 24px rgba(20, 24, 35, 0.18);
      color: #30343b;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-wrap: anywhere;
      white-space: normal;
      pointer-events: none;
      animation: octo-pet-speech-in 160ms ease-out;
    }
    #${ROOT_ID}[data-speech-align='left'] .${SPEECH_CLASS} {
      right: auto;
      left: 0;
    }
    #${ROOT_ID}[data-speech-placement='below'] .${SPEECH_CLASS} {
      top: calc(100% + 10px);
      bottom: auto;
    }
    body[theme-mode='dark'] #${ROOT_ID} .${SPEECH_CLASS} {
      border-color: rgba(255, 255, 255, 0.16);
      background: rgba(37, 41, 50, 0.96);
      color: #f3f4f6;
    }
    @keyframes octo-pet-speech-in {
      from { opacity: 0; transform: translateY(4px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      #${ROOT_ID} .${SPEECH_CLASS} { animation: none; }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function findComposerAnchor(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR));
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const rect = candidates[index].getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
      return candidates[index];
    }
  }
  return null;
}

function positionAtComposer(root: HTMLElement): void {
  if (lastPlacement !== 'composer') return;
  const nextAnchor = findComposerAnchor();
  if (!nextAnchor) {
    root.style.visibility = 'hidden';
    return;
  }
  root.style.visibility = 'visible';
  if (composerAnchor !== nextAnchor) {
    composerAnchor = nextAnchor;
    composerResizeObserver?.disconnect();
    composerResizeObserver = new ResizeObserver(scheduleComposerPosition);
    composerResizeObserver.observe(nextAnchor);
  }
  const rect = nextAnchor.getBoundingClientRect();
  const position = calculateComposerPetPosition(
    rect,
    { width: root.offsetWidth, height: root.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
  root.style.left = `${position.x}px`;
  root.style.top = `${position.y}px`;
  root.style.right = 'auto';
  root.style.bottom = 'auto';
}

function scheduleComposerPosition(): void {
  if (composerPositionFrame != null) return;
  composerPositionFrame = window.requestAnimationFrame(() => {
    composerPositionFrame = null;
    const root = document.getElementById(ROOT_ID);
    if (root) positionAtComposer(root);
  });
}

function stopComposerTracking(): void {
  composerMutationObserver?.disconnect();
  composerMutationObserver = null;
  composerResizeObserver?.disconnect();
  composerResizeObserver = null;
  composerAnchor = null;
  if (composerPositionFrame != null) {
    window.cancelAnimationFrame(composerPositionFrame);
    composerPositionFrame = null;
  }
  document.removeEventListener('scroll', scheduleComposerPosition, true);
}

function startComposerTracking(root: HTMLElement): void {
  stopComposerTracking();
  composerMutationObserver = new MutationObserver(scheduleComposerPosition);
  composerMutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.addEventListener('scroll', scheduleComposerPosition, true);
  positionAtComposer(root);
}

function stopAnimation(): void {
  if (animationTimer != null) {
    window.clearTimeout(animationTimer);
    animationTimer = undefined;
  }
}

function renderAnimationFrame(
  runtime: AnimationRuntime,
  animation: ResolvedDesktopPetAnimation,
  frameIndex: number,
): void {
  const column = animation.frames[frameIndex];
  runtime.sprite.style.backgroundPosition =
    `${-column * runtime.renderedWidth}px ${-animation.row * runtime.renderedHeight}px`;
}

function playAnimation(name: string): void {
  const runtime = animationRuntime;
  if (!runtime || runtime.currentAnimationName === name) return;
  const animation = runtime.config.animations[name];
  if (!animation) return;
  stopAnimation();
  runtime.currentAnimationName = name;
  let frameIndex = 0;
  renderAnimationFrame(runtime, animation, frameIndex);

  if (runtime.reducedMotion || animation.frames.length < 2) return;
  const scheduleNextFrame = () => {
    animationTimer = window.setTimeout(() => {
      if (animationRuntime !== runtime || runtime.currentAnimationName !== name) return;
      if (frameIndex === animation.frames.length - 1 && !animation.loop) return;
      frameIndex = (frameIndex + 1) % animation.frames.length;
      renderAnimationFrame(runtime, animation, frameIndex);
      scheduleNextFrame();
    }, animation.frameDurationsMs[frameIndex]);
  };
  scheduleNextFrame();
}

function syncInteractionAnimation(): void {
  if (!animationRuntime) return;
  playAnimation(
    selectDesktopPetAnimation(animationRuntime.config, interactionState, dragDirection),
  );
}

function removePet(): void {
  loadGeneration += 1;
  stopAnimation();
  if (speechTimer != null) {
    window.clearTimeout(speechTimer);
    speechTimer = undefined;
  }
  document.getElementById(ROOT_ID)?.remove();
  stopComposerTracking();
  lastPet = null;
  lastPosition = null;
  animationRuntime = null;
  interactionState = 'idle';
  pointerHovering = false;
  dragDirection = 0;
}

export function showDesktopPetSpeech(text: string): boolean {
  if (showBuiltInCompanionSpeech(text)) return true;
  const root = document.getElementById(ROOT_ID);
  if (!root || !lastPet || !text.trim()) return false;
  let speech = root.querySelector<HTMLElement>(`.${SPEECH_CLASS}`);
  if (!speech) {
    speech = document.createElement('span');
    speech.className = SPEECH_CLASS;
    speech.setAttribute('role', 'status');
    speech.setAttribute('aria-live', 'polite');
    root.appendChild(speech);
  }
  speech.textContent = text.trim();
  delete root.dataset.speechAlign;
  delete root.dataset.speechPlacement;

  const rootRect = root.getBoundingClientRect();
  const speechRect = speech.getBoundingClientRect();
  if (rootRect.right - speechRect.width < VIEWPORT_PADDING) {
    root.dataset.speechAlign = 'left';
  }
  if (rootRect.top - speechRect.height - 10 < VIEWPORT_PADDING) {
    root.dataset.speechPlacement = 'below';
  }
  if (speechTimer != null) window.clearTimeout(speechTimer);
  speechTimer = window.setTimeout(() => {
    speech?.remove();
    speechTimer = undefined;
    delete root.dataset.speechAlign;
    delete root.dataset.speechPlacement;
  }, SPEECH_DURATION_MS);
  return true;
}

function clampPositionInViewport(
  position: DesktopPetPosition,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): DesktopPetPosition {
  return {
    x: Math.min(
      Math.max(VIEWPORT_PADDING, position.x),
      Math.max(VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING),
    ),
    y: Math.min(
      Math.max(VIEWPORT_PADDING, position.y),
      Math.max(VIEWPORT_PADDING, viewportHeight - height - VIEWPORT_PADDING),
    ),
  };
}

export function calculateComposerPetPosition(
  anchor: Pick<DOMRect, 'left' | 'top' | 'width'>,
  pet: { width: number; height: number },
  viewport: { width: number; height: number },
): DesktopPetPosition {
  return clampPositionInViewport(
    {
      x: anchor.left + Math.min(24, Math.max(8, anchor.width * 0.04)),
      y: anchor.top - pet.height + 7,
    },
    pet.width,
    pet.height,
    viewport.width,
    viewport.height,
  );
}

function clampPosition(
  position: DesktopPetPosition,
  width: number,
  height: number,
): DesktopPetPosition {
  return clampPositionInViewport(
    position,
    width,
    height,
    window.innerWidth,
    window.innerHeight,
  );
}

function setPosition(root: HTMLElement, position: DesktopPetPosition): DesktopPetPosition {
  const next = clampPosition(position, root.offsetWidth, root.offsetHeight);
  root.style.left = `${next.x}px`;
  root.style.top = `${next.y}px`;
  root.style.right = 'auto';
  root.style.bottom = 'auto';
  lastPosition = next;
  return next;
}

function sendPosition(position: DesktopPetPosition): void {
  window.postMessage(
    {
      source: MESSAGE_SOURCE,
      type: MESSAGE_TYPE.desktopPetPosition,
      position,
    } satisfies DesktopPetPositionMessage,
    '*',
  );
}

function enableDragging(root: HTMLElement): void {
  let drag:
    | {
        pointerId: number;
        startClientX: number;
        startClientY: number;
        lastClientX: number;
        startX: number;
        startY: number;
      }
    | undefined;

  root.addEventListener('pointerenter', () => {
    pointerHovering = true;
    if (!drag) {
      interactionState = 'hover';
      syncInteractionAnimation();
    }
  });

  root.addEventListener('pointerleave', () => {
    pointerHovering = false;
    if (!drag) {
      interactionState = 'idle';
      syncInteractionAnimation();
    }
  });

  root.addEventListener('pointerdown', (event) => {
    if (lastPlacement === 'composer') return;
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      startX: rect.left,
      startY: rect.top,
    };
    root.dataset.dragging = 'true';
    root.setPointerCapture(event.pointerId);
    interactionState = 'drag';
    dragDirection = 0;
    syncInteractionAnimation();
  });

  root.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startClientX;
    const movementX = event.clientX - drag.lastClientX;
    drag.lastClientX = event.clientX;
    const nextDirection = movementX < -1 ? -1 : movementX > 1 ? 1 : dragDirection;
    if (nextDirection !== dragDirection) {
      dragDirection = nextDirection;
      syncInteractionAnimation();
    }
    setPosition(root, {
      x: drag.startX + deltaX,
      y: drag.startY + event.clientY - drag.startClientY,
    });
  });

  const finishDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finalPosition = setPosition(root, {
      x: root.getBoundingClientRect().left,
      y: root.getBoundingClientRect().top,
    });
    drag = undefined;
    delete root.dataset.dragging;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    pointerHovering = event.type !== 'pointercancel' && root.matches(':hover');
    interactionState = pointerHovering ? 'hover' : 'idle';
    dragDirection = 0;
    syncInteractionAnimation();
    sendPosition(finalPosition);
  };

  root.addEventListener('pointerup', finishDrag);
  root.addEventListener('pointercancel', finishDrag);
}

function ensureRoot(pet: StoredDesktopPet): { root: HTMLElement; sprite: HTMLElement } {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'img');
    const sprite = document.createElement('span');
    sprite.className = SPRITE_CLASS;
    root.appendChild(sprite);
    enableDragging(root);
    (document.body || document.documentElement).appendChild(root);
  }
  root.setAttribute('aria-label', pet.manifest.displayName);
  root.dataset.placement = lastPlacement;
  root.title = lastPlacement === 'composer'
    ? `${pet.manifest.displayName}（输入框陪伴）`
    : `${pet.manifest.displayName}（拖拽移动）`;
  return { root, sprite: root.querySelector<HTMLElement>(`.${SPRITE_CLASS}`)! };
}

function loadSpritesheet(pet: StoredDesktopPet, position: DesktopPetPosition | null): void {
  ensureStyle();
  stopAnimation();
  animationRuntime = null;
  interactionState = 'idle';
  dragDirection = 0;
  const generation = ++loadGeneration;
  const { root, sprite } = ensureRoot(pet);
  if (lastPlacement === 'desktop' && !position) {
    root.style.left = 'auto';
    root.style.top = 'auto';
    root.style.right = '24px';
    root.style.bottom = '88px';
    root.style.visibility = 'visible';
  }
  sprite.style.backgroundImage = `url("${pet.spritesheetDataUrl}")`;

  const image = new Image();
  image.onload = () => {
    if (generation !== loadGeneration || !root.isConnected) return;
    let config: ResolvedDesktopPetAnimations;
    try {
      config = resolveDesktopPetAnimations(
        parseDesktopPetManifest(pet.manifest),
        image.naturalWidth,
        image.naturalHeight,
      );
    } catch {
      removePet();
      return;
    }
    const frameWidth = image.naturalWidth / config.columns;
    const frameHeight = image.naturalHeight / config.rows;
    const scale = Math.min(
      1,
      (lastPlacement === 'composer' ? MAX_COMPOSER_FRAME_SIZE : MAX_RENDERED_FRAME_SIZE) /
        frameWidth,
      (lastPlacement === 'composer' ? MAX_COMPOSER_FRAME_SIZE : MAX_RENDERED_FRAME_SIZE) /
        frameHeight,
    );
    const renderedWidth = Math.max(1, Math.round(frameWidth * scale));
    const renderedHeight = Math.max(1, Math.round(frameHeight * scale));
    sprite.style.width = `${renderedWidth}px`;
    sprite.style.height = `${renderedHeight}px`;
    sprite.style.backgroundSize =
      `${renderedWidth * config.columns}px ${renderedHeight * config.rows}px`;
    sprite.style.backgroundPosition = '0 0';

    if (lastPlacement === 'composer') {
      startComposerTracking(root);
    } else if (position) {
      setPosition(root, position);
    } else {
      // Convert the default right/bottom placement to coordinates so a later
      // resize or drag always has a single position model.
      const rect = root.getBoundingClientRect();
      lastPosition = { x: rect.left, y: rect.top };
    }

    animationRuntime = {
      config,
      sprite,
      renderedWidth,
      renderedHeight,
      currentAnimationName: null,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
    pointerHovering = root.matches(':hover');
    interactionState = pointerHovering ? 'hover' : 'idle';
    dragDirection = 0;
    syncInteractionAnimation();
  };
  image.onerror = () => {
    if (generation === loadGeneration) removePet();
  };
  image.src = pet.spritesheetDataUrl;
}

export function applyDesktopPetState(message: DesktopPetMessage): void {
  if (!message.enabled || (!message.pet && !message.builtInCompanion)) {
    removePet();
    teardownBuiltInCompanion();
    return;
  }

  if (message.builtInCompanion) {
    removePet();
    applyBuiltInCompanion(message.builtInCompanion);
    return;
  }

  teardownBuiltInCompanion();
  if (!message.pet) return;

  const placementChanged = lastPlacement !== message.placement;
  lastPlacement = message.placement;
  const samePet =
    lastPet?.manifest.id === message.pet.manifest.id &&
    JSON.stringify(lastPet?.manifest) === JSON.stringify(message.pet.manifest) &&
    lastPet?.spritesheetDataUrl === message.pet.spritesheetDataUrl;
  lastPet = message.pet;
  lastPosition = message.position;

  if (!samePet || placementChanged || !document.getElementById(ROOT_ID)) {
    loadSpritesheet(message.pet, message.position);
    return;
  }
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.dataset.placement = lastPlacement;
  if (lastPlacement === 'composer') {
    startComposerTracking(root);
  } else {
    stopComposerTracking();
    root.style.visibility = 'visible';
    if (message.position) setPosition(root, message.position);
  }
}

/** Remove all page-side pet state when the extension master switch is off. */
export function teardownDesktopPet(): void {
  removePet();
  teardownBuiltInCompanion();
  document.getElementById(STYLE_ID)?.remove();
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (lastPlacement === 'composer') {
      scheduleComposerPosition();
    } else {
      const rect = root.getBoundingClientRect();
      setPosition(root, lastPosition ?? { x: rect.left, y: rect.top });
    }
  });
}
