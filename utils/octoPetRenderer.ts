import {
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  type DesktopPetMessage,
  type DesktopPetPosition,
  type DesktopPetPositionMessage,
  type StoredDesktopPet,
} from './octoRecall';

const ROOT_ID = 'octo-desktop-pet';
const STYLE_ID = 'octo-desktop-pet-style';
const SPRITE_CLASS = 'octo-desktop-pet-sprite';
const DEFAULT_COLUMNS = 12;
const DEFAULT_ROWS = 13;
const DEFAULT_FRAME_COUNT = 12;
const FRAME_DURATION_MS = 1000 / 8;
const VIEWPORT_PADDING = 8;
const MAX_RENDERED_FRAME_SIZE = 180;

let animationTimer: number | undefined;
let loadGeneration = 0;
let lastPet: StoredDesktopPet | null = null;
let lastPosition: DesktopPetPosition | null = null;

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
    #${ROOT_ID} .${SPRITE_CLASS} {
      display: block;
      pointer-events: none;
      background-repeat: no-repeat;
      background-position: 0 0;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function stopAnimation(): void {
  if (animationTimer != null) {
    window.clearInterval(animationTimer);
    animationTimer = undefined;
  }
}

function removePet(): void {
  loadGeneration += 1;
  stopAnimation();
  document.getElementById(ROOT_ID)?.remove();
  lastPet = null;
  lastPosition = null;
}

function clampPosition(
  position: DesktopPetPosition,
  width: number,
  height: number,
): DesktopPetPosition {
  return {
    x: Math.min(
      Math.max(VIEWPORT_PADDING, position.x),
      Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING),
    ),
    y: Math.min(
      Math.max(VIEWPORT_PADDING, position.y),
      Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING),
    ),
  };
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
    | { pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number }
    | undefined;

  root.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: rect.left,
      startY: rect.top,
    };
    root.dataset.dragging = 'true';
    root.setPointerCapture(event.pointerId);
  });

  root.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition(root, {
      x: drag.startX + event.clientX - drag.startClientX,
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
  root.title = `${pet.manifest.displayName}（拖拽移动）`;
  return { root, sprite: root.querySelector<HTMLElement>(`.${SPRITE_CLASS}`)! };
}

function loadSpritesheet(pet: StoredDesktopPet, position: DesktopPetPosition | null): void {
  ensureStyle();
  stopAnimation();
  const generation = ++loadGeneration;
  const { root, sprite } = ensureRoot(pet);
  sprite.style.backgroundImage = `url("${pet.spritesheetDataUrl}")`;

  const image = new Image();
  image.onload = () => {
    if (generation !== loadGeneration || !root.isConnected) return;
    const frameWidth = image.naturalWidth / DEFAULT_COLUMNS;
    const frameHeight = image.naturalHeight / DEFAULT_ROWS;
    const scale = Math.min(
      1,
      MAX_RENDERED_FRAME_SIZE / frameWidth,
      MAX_RENDERED_FRAME_SIZE / frameHeight,
    );
    const renderedWidth = Math.max(1, Math.round(frameWidth * scale));
    const renderedHeight = Math.max(1, Math.round(frameHeight * scale));
    sprite.style.width = `${renderedWidth}px`;
    sprite.style.height = `${renderedHeight}px`;
    sprite.style.backgroundSize = `${image.naturalWidth * scale}px ${image.naturalHeight * scale}px`;
    sprite.style.backgroundPosition = '0 0';

    if (position) {
      setPosition(root, position);
    } else {
      // Convert the default right/bottom placement to coordinates so a later
      // resize or drag always has a single position model.
      const rect = root.getBoundingClientRect();
      lastPosition = { x: rect.left, y: rect.top };
    }

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let frame = 0;
      animationTimer = window.setInterval(() => {
        frame = (frame + 1) % DEFAULT_FRAME_COUNT;
        sprite.style.backgroundPosition = `${-frame * renderedWidth}px 0`;
      }, FRAME_DURATION_MS);
    }
  };
  image.onerror = () => {
    if (generation === loadGeneration) removePet();
  };
  image.src = pet.spritesheetDataUrl;
}

export function applyDesktopPetState(message: DesktopPetMessage): void {
  if (!message.enabled || !message.pet) {
    removePet();
    return;
  }

  const samePet =
    lastPet?.manifest.id === message.pet.manifest.id &&
    lastPet?.spritesheetDataUrl === message.pet.spritesheetDataUrl;
  lastPet = message.pet;
  lastPosition = message.position;

  if (!samePet || !document.getElementById(ROOT_ID)) {
    loadSpritesheet(message.pet, message.position);
    return;
  }
  const root = document.getElementById(ROOT_ID);
  if (root && message.position) setPosition(root, message.position);
}

window.addEventListener('resize', () => {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const rect = root.getBoundingClientRect();
  setPosition(root, lastPosition ?? { x: rect.left, y: rect.top });
});
