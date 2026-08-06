import type { PlayerWatermarkId } from './octoRecall';
import { OCTO_SELECTORS } from './octoSelectors';
import {
  bezierPoint,
  clamp,
  computeRenderRatio,
  curveControlPoint,
  distance,
  easeInOutSine,
  MAX_CANVAS_PIXELS,
  normalizeStyle,
  pickTrajectoryMode,
  type Bounds,
  type Point,
  type PhysicsState,
  stepBounce,
  type TrajectoryMode,
  trailQuality,
  type KickStyleId,
} from './octoKickMath';
import {
  Application,
  Container,
  MeshRope,
  Particle,
  ParticleContainer,
  Sprite,
  Texture,
} from 'pixi.js';
import { AdvancedBloomFilter, ShockwaveFilter } from 'pixi-filters';

/**
 * WebGL (PixiJS) implementation of the full-screen football kick effect.
 *
 * Public API is intentionally identical to the previous Canvas 2D module
 * (`setFullscreenKickStyle` / `setFullscreenKickPlayer`) so the main-world
 * wiring does not change.
 *
 * Visual features (all GPU-side):
 *  - Curveball trajectory: each click flies the ball along a randomized
 *    quadratic Bézier (banana curve), eased with easeInOutSine.
 *  - MeshRope ribbon trail that follows the curve (tinted, additive, fading).
 *  - AdvancedBloom global glow on the effects root (enabled only while active).
 *  - ShockwaveFilter ripple + expanding rings + pooled spark burst on impact.
 *  - A brief decaying shake of the effects root on impact.
 *
 * NOTE: the canvas is a transparent overlay independent of the page DOM, so
 * the shockwave/shake distort our own effects, not the underlying page.
 */

type ActivePlayerId = Exclude<PlayerWatermarkId, 'none'>;

interface PlayerLayout {
  sourceWidth: number;
  sourceHeight: number;
  ballCenterX: number;
  ballCenterY: number;
  ballSourceWidth: number;
  minWidth: number;
  viewportWidth: number;
  maxWidth: number;
}

interface KickStyleSpec {
  speed: number;
  minDuration: number;
  maxDuration: number;
  gravity: number;
  spinFactor: number;
  color: number;
  secondary: number;
  trailWidth: number;
  trailLife: number;
  trailPoints: number;
  impactRadius: number;
}

interface PixiShot {
  mode: TrajectoryMode;
  start: Point;
  target: Point;
  control: Point;
  startTime: number;
  duration: number;
  size: number;
  style: KickStyleId;
  spec: KickStyleSpec;
  spin: number;
  endScale: number;
  node: Container;
  ball: Sprite;
  glow: Sprite;
  rope: MeshRope;
  ropePoints: Point[];
  // Physics fields — only used when `mode === 'bounce'`.
  physics?: PhysicsState;
  gravity?: number;
  restitution?: number;
  bounds?: Bounds;
  bounceCount?: number;
  maxBounces?: number;
}

interface BurstParticle {
  particle: Particle;
  vx: number;
  vy: number;
  born: number;
  life: number;
}

interface ImpactRing {
  ring: Sprite;
  born: number;
  life: number;
  radius: number;
  wide: boolean;
}

const CANVAS_ID = 'octo-fullscreen-kick-canvas';
const CURSOR_STYLE_ID = 'octo-ball-cursor-style';
const BALL_CURSOR_ATTR = 'data-octo-ball-cursor';
const BALL_ASSET_CONTENT_RATIO = 140 / 160;
const MAX_ACTIVE_SHOTS = 6;
const MIN_SHOT_INTERVAL = 65;
const IMPACT_DURATION = 440;
const CANVAS_Z_INDEX = '2147483645';
const GLOW_TEXTURE_SIZE = 64;
const RIBBON_LENGTH = 96;
const RIBBON_THICKNESS = 24;
const ROPE_POINTS = 20;
const SHOCKWAVE_LIFE = 520; // ms
const SHAKE_LIFE = 200; // ms
const MAX_POOLED_PARTICLES = 240;

// Wall-bounce trajectory tuning.
const BOUNCE_MAX_LIFETIME = 2600; // ms — hard cap so a shot always resolves
const BOUNCE_MAX_WALL_HITS = 5; // resolve (final impact) after this many walls
const BOUNCE_MIN_SPEED = 140; // px/s — resolve once the ball is basically at rest

const PLAYER_LAYOUTS: Record<ActivePlayerId, PlayerLayout> = {
  messi: {
    sourceWidth: 374,
    sourceHeight: 900,
    ballCenterX: 96.5,
    ballCenterY: 850.5,
    ballSourceWidth: 101,
    minWidth: 96,
    viewportWidth: 0.08,
    maxWidth: 140,
  },
  mbappe: {
    sourceWidth: 681,
    sourceHeight: 900,
    ballCenterX: 260,
    ballCenterY: 825.5,
    ballSourceWidth: 130,
    minWidth: 174,
    viewportWidth: 0.14,
    maxWidth: 240,
  },
};

const STYLE_SPECS: Record<KickStyleId, KickStyleSpec> = {
  lightning: {
    speed: 2150,
    minDuration: 280,
    maxDuration: 620,
    gravity: 460,
    spinFactor: 0.82,
    color: 0x69d5ff,
    secondary: 0xf4fcff,
    trailWidth: 4,
    trailLife: 160,
    trailPoints: 10,
    impactRadius: 64,
  },
  fire: {
    speed: 1550,
    minDuration: 380,
    maxDuration: 760,
    gravity: 650,
    spinFactor: 0.72,
    color: 0xff5426,
    secondary: 0xffd166,
    trailWidth: 9,
    trailLife: 210,
    trailPoints: 14,
    impactRadius: 72,
  },
  bullet: {
    speed: 1050,
    minDuration: 520,
    maxDuration: 980,
    gravity: 170,
    spinFactor: 0.95,
    color: 0xbdd4ff,
    secondary: 0xffffff,
    trailWidth: 3,
    trailLife: 260,
    trailPoints: 12,
    impactRadius: 56,
  },
  comet: {
    speed: 1320,
    minDuration: 430,
    maxDuration: 850,
    gravity: 540,
    spinFactor: 0.78,
    color: 0x8d6dff,
    secondary: 0xf2edff,
    trailWidth: 12,
    trailLife: 260,
    trailPoints: 16,
    impactRadius: 78,
  },
  cannon: {
    speed: 2350,
    minDuration: 260,
    maxDuration: 580,
    gravity: 780,
    spinFactor: 0.68,
    color: 0xf04444,
    secondary: 0xffd166,
    trailWidth: 14,
    trailLife: 145,
    trailPoints: 9,
    impactRadius: 96,
  },
};

// ---- module state ---------------------------------------------------------

let playerId: ActivePlayerId | null = null;
let currentStyle: KickStyleId = 'lightning';
let ballCursorEnabled = true;
let ballImageUrl = '';
let ballTexture: Texture | null = null;
let ballAspect = 1;
let ballTexWidth = 1;
let ballTexHeight = 1;

let app: Application | null = null;
let initializing = false;
let ready = false;
let bound = false;

let glowTexture: Texture | null = null;
let ribbonTexture: Texture | null = null;

let fxRoot: Container | null = null; // filtered (bloom / shockwave / shake) root
let ropeLayer: Container | null = null; // MeshRope trails
let shotsLayer: Container | null = null; // ball + per-ball glow
let impactLayer: Container | null = null; // expanding impact rings
let burstLayer: ParticleContainer | null = null; // impact sparks (pooled)
let cursorSprite: Sprite | null = null; // crisp, unfiltered, on top

let bloomFilter: AdvancedBloomFilter | null = null;
let shockwaveFilter: ShockwaveFilter | null = null;
let shockwaveActive = false;
let shockwaveBorn = 0;

let shakeUntil = 0;
let shakeAmplitude = 0;

let shots: PixiShot[] = [];
let burstParticles: BurstParticle[] = [];
let impactRings: ImpactRing[] = [];
const particlePool: Particle[] = [];

let recoilTimer: number | undefined;
let queuedShotTimer: number | undefined;
let cursorRestoreTimer: number | undefined;
let queuedShotTarget: Point | null = null;
let lastShotAt = -Infinity;

let cursorPoint: Point | null = null;
let previousCursorPoint: Point | null = null;
let cursorRotation = 0;
let cursorVisible = false;
let cursorSuppressedUntil = 0;
let cursorSuppressedPoint: Point | null = null;

// ---- environment guards ---------------------------------------------------

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function supportsFinePointer(): boolean {
  return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches !== false;
}

// ---- cursor style (no universal selector) ---------------------------------

function installCursorStyle(): void {
  if (!document.getElementById(CURSOR_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = CURSOR_STYLE_ID;
    style.textContent = `
      html[${BALL_CURSOR_ATTR}="true"],
      html[${BALL_CURSOR_ATTR}="true"] body {
        cursor: none !important;
      }
      html[${BALL_CURSOR_ATTR}="true"] a,
      html[${BALL_CURSOR_ATTR}="true"] button,
      html[${BALL_CURSOR_ATTR}="true"] input,
      html[${BALL_CURSOR_ATTR}="true"] textarea,
      html[${BALL_CURSOR_ATTR}="true"] select,
      html[${BALL_CURSOR_ATTR}="true"] label,
      html[${BALL_CURSOR_ATTR}="true"] summary,
      html[${BALL_CURSOR_ATTR}="true"] [role="button"],
      html[${BALL_CURSOR_ATTR}="true"] [role="link"],
      html[${BALL_CURSOR_ATTR}="true"] [contenteditable],
      html[${BALL_CURSOR_ATTR}="true"] [class*="cursor"] {
        cursor: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  updateCursorMode();
}

/**
 * The football cursor is now an independent setting: it only hijacks the
 * native cursor when the ball-cursor toggle is on, a player is active, and the
 * device has a fine pointer. Clicking to shoot still works when it's off.
 */
function updateCursorMode(): void {
  if (ballCursorEnabled && playerId && supportsFinePointer()) {
    document.documentElement.setAttribute(BALL_CURSOR_ATTR, 'true');
  } else {
    document.documentElement.removeAttribute(BALL_CURSOR_ATTR);
  }
}

function restoreNativeCursor(): void {
  document.documentElement.removeAttribute(BALL_CURSOR_ATTR);
}

// ---- textures -------------------------------------------------------------

/** Soft round radial glow, used tinted + additive for ball glow / rings / sparks. */
function createGlowTexture(): Texture {
  const size = GLOW_TEXTURE_SIZE;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  if (ctx) {
    const r = size / 2;
    const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return Texture.from(cv);
}

/**
 * Ribbon texture for the MeshRope trail: transparent at the tail end (left),
 * bright at the head end (right), feathered across the thickness (top/bottom)
 * so the streak has soft edges and fades out behind the ball.
 */
function createRibbonTexture(): Texture {
  const w = RIBBON_LENGTH;
  const h = RIBBON_THICKNESS;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (ctx) {
    // Length fade (tail -> head).
    const along = ctx.createLinearGradient(0, 0, w, 0);
    along.addColorStop(0, 'rgba(255,255,255,0)');
    along.addColorStop(0.55, 'rgba(255,255,255,0.5)');
    along.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = along;
    ctx.fillRect(0, 0, w, h);
    // Feather across the thickness by punching alpha with a vertical gradient.
    const across = ctx.createLinearGradient(0, 0, 0, h);
    across.addColorStop(0, 'rgba(0,0,0,1)');
    across.addColorStop(0.5, 'rgba(0,0,0,0)');
    across.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, w, h);
  }
  return Texture.from(cv);
}

// ---- app lifecycle --------------------------------------------------------

function renderResolution(): number {
  return computeRenderRatio(
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio || 1,
    MAX_CANVAS_PIXELS,
  );
}

function ensureApp(): void {
  if (app || initializing) return;
  initializing = true;
  const instance = new Application();
  void instance
    .init({
      backgroundAlpha: 0,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: renderResolution(),
      preference: 'webgl',
      powerPreference: 'high-performance',
    })
    .then(() => {
      initializing = false;
      if (!playerId) {
        instance.destroy(true, { children: true, texture: true });
        return;
      }
      app = instance;
      // We never use Pixi interaction (the canvas is pointer-events:none and
      // input is handled via window listeners), so disable the event system's
      // per-frame hit-testing overhead.
      instance.stage.eventMode = 'none';
      instance.stage.interactiveChildren = false;
      const canvas = instance.canvas;
      canvas.id = CANVAS_ID;
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, {
        position: 'fixed',
        inset: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: CANVAS_Z_INDEX,
      });
      canvas.addEventListener('webglcontextlost', handleContextLost, false);
      (document.body || document.documentElement).appendChild(canvas);

      glowTexture = createGlowTexture();
      ribbonTexture = createRibbonTexture();

      ropeLayer = new Container();
      shotsLayer = new Container();
      impactLayer = new Container();
      burstLayer = new ParticleContainer({
        dynamicProperties: { position: true, scale: true, rotation: false, color: true },
      });
      burstLayer.blendMode = 'add';

      fxRoot = new Container();
      fxRoot.addChild(ropeLayer, shotsLayer, impactLayer, burstLayer);
      instance.stage.addChild(fxRoot);

      bloomFilter = new AdvancedBloomFilter({
        threshold: 0.3,
        bloomScale: 1.1,
        brightness: 1.1,
        blur: 8,
        quality: 3,
        // Downsample the blur passes — roughly halves the bloom cost per frame
        // with a barely-perceptible softening of the glow.
        pixelSize: { x: 2, y: 2 },
      });
      shockwaveFilter = new ShockwaveFilter({
        amplitude: 24,
        wavelength: 120,
        speed: 900,
        brightness: 1.05,
        radius: -1,
        center: { x: 0, y: 0 },
      });

      cursorSprite = new Sprite();
      cursorSprite.anchor.set(0.5);
      cursorSprite.alpha = 0;
      cursorSprite.eventMode = 'none';
      if (ballTexture) cursorSprite.texture = ballTexture;
      instance.stage.addChild(cursorSprite);

      instance.ticker.add(tick);
      instance.ticker.stop();
      ready = true;
      refreshCursor();
      instance.render();
    })
    .catch(() => {
      initializing = false;
    });
}

function handleContextLost(event: Event): void {
  event.preventDefault();
}

function startTicker(): void {
  if (app && !app.ticker.started) app.ticker.start();
}

function hasActivity(): boolean {
  return (
    shots.length > 0 ||
    burstParticles.length > 0 ||
    impactRings.length > 0 ||
    shockwaveActive ||
    performance.now() < shakeUntil
  );
}

/** Toggle the (relatively expensive) fxRoot filters so idle frames stay cheap. */
function updateFxFilters(): void {
  if (!fxRoot) return;
  if (!hasActivity()) {
    fxRoot.filters = [];
    return;
  }
  if (shockwaveActive && shockwaveFilter && bloomFilter) {
    fxRoot.filters = [shockwaveFilter, bloomFilter];
  } else if (bloomFilter) {
    fxRoot.filters = [bloomFilter];
  }
}

// ---- particle pool --------------------------------------------------------

function acquireParticle(
  texture: Texture,
  x: number,
  y: number,
  scale: number,
  tint: number,
  alpha: number,
): Particle {
  const pooled = particlePool.pop();
  if (pooled) {
    pooled.texture = texture;
    pooled.x = x;
    pooled.y = y;
    pooled.scaleX = scale;
    pooled.scaleY = scale;
    pooled.anchorX = 0.5;
    pooled.anchorY = 0.5;
    pooled.rotation = 0;
    pooled.tint = tint;
    pooled.alpha = alpha;
    return pooled;
  }
  return new Particle({
    texture,
    x,
    y,
    anchorX: 0.5,
    anchorY: 0.5,
    scaleX: scale,
    scaleY: scale,
    tint,
    alpha,
  });
}

function releaseParticle(particle: Particle): void {
  if (particlePool.length < MAX_POOLED_PARTICLES) particlePool.push(particle);
}

// ---- geometry -------------------------------------------------------------

function getPlayerGeometry(): { start: Point; ballSize: number } | null {
  if (!playerId) return null;
  const host = document.querySelector<HTMLElement>(OCTO_SELECTORS.conversation);
  if (!host) return null;
  const rect = host.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const layout = PLAYER_LAYOUTS[playerId];
  const playerWidth = clamp(
    layout.minWidth,
    window.innerWidth * layout.viewportWidth,
    layout.maxWidth,
  );
  const playerHeight = playerWidth * (layout.sourceHeight / layout.sourceWidth);
  const rightInset = clamp(20, window.innerWidth * 0.024, 40);
  const playerRight = rect.right - rightInset;
  const playerBottom = rect.bottom - 22;
  const playerLeft = playerRight - playerWidth;
  const playerTop = playerBottom - playerHeight;
  const visualBallSize = playerWidth * (layout.ballSourceWidth / layout.sourceWidth);

  return {
    start: {
      x: playerLeft + playerWidth * (layout.ballCenterX / layout.sourceWidth),
      y: playerTop + playerHeight * (layout.ballCenterY / layout.sourceHeight),
    },
    ballSize: visualBallSize / BALL_ASSET_CONTENT_RATIO,
  };
}

function cursorSize(): number {
  const visualSize = clamp(30, Math.min(window.innerWidth, window.innerHeight) * 0.045, 42);
  return visualSize / BALL_ASSET_CONTENT_RATIO;
}

// ---- cursor ---------------------------------------------------------------

function refreshCursor(now = performance.now()): void {
  if (!cursorSprite) return;
  if (!ballCursorEnabled || !playerId || !cursorPoint || !ballTexture || !supportsFinePointer()) {
    cursorSprite.alpha = 0;
    return;
  }
  const suppressed =
    now < cursorSuppressedUntil &&
    cursorSuppressedPoint !== null &&
    distance(cursorPoint, cursorSuppressedPoint) < 9;
  const size = cursorSize();
  cursorSprite.texture = ballTexture;
  cursorSprite.width = size;
  cursorSprite.height = size / ballAspect;
  cursorSprite.position.set(cursorPoint.x, cursorPoint.y);
  cursorSprite.rotation = cursorRotation;
  cursorSprite.alpha = cursorVisible && !suppressed ? 1 : 0;
  if (app && !app.ticker.started) app.render();
}

// ---- ball + rope factory --------------------------------------------------

function makeShotNode(size: number, color: number): { node: Container; ball: Sprite; glow: Sprite } {
  const node = new Container();
  const glow = new Sprite(glowTexture ?? Texture.WHITE);
  glow.anchor.set(0.5);
  glow.tint = color;
  glow.blendMode = 'add';
  glow.alpha = 0.4;
  glow.width = size * 2.1;
  glow.height = size * 2.1;
  const ball = new Sprite(ballTexture ?? Texture.WHITE);
  ball.anchor.set(0.5);
  ball.width = size;
  ball.height = size / ballAspect;
  node.addChild(glow, ball);
  return { node, ball, glow };
}

function makeRope(start: Point, color: number, thickness: number): { rope: MeshRope; points: Point[] } {
  const points: Point[] = [];
  for (let i = 0; i < ROPE_POINTS; i++) points.push({ x: start.x, y: start.y });
  const rope = new MeshRope({
    texture: ribbonTexture ?? Texture.WHITE,
    points,
    width: thickness,
  });
  rope.tint = color;
  rope.blendMode = 'add';
  rope.alpha = 0.9;
  return { rope, points };
}

// ---- impact ---------------------------------------------------------------

function spawnImpact(shot: PixiShot, now: number, quality: number): void {
  if (!burstLayer || !impactLayer || !glowTexture) return;

  const ring = new Sprite(glowTexture);
  ring.anchor.set(0.5);
  ring.tint = shot.spec.color;
  ring.blendMode = 'add';
  ring.position.set(shot.target.x, shot.target.y);
  ring.alpha = 0.9;
  impactLayer.addChild(ring);
  impactRings.push({
    ring,
    born: now,
    life: IMPACT_DURATION,
    radius: shot.spec.impactRadius,
    wide: shot.style === 'cannon' || shot.style === 'comet',
  });

  const count = Math.round(
    (shot.style === 'cannon' ? 16 : 11) * (quality >= 0.9 ? 1 : quality >= 0.6 ? 0.75 : 0.5),
  );
  const speed = shot.spec.impactRadius * 2.6;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const v = speed * (0.6 + Math.random() * 0.5);
    const scale = ((shot.style === 'cannon' ? 5 : 3.5) + Math.random() * 2) / GLOW_TEXTURE_SIZE;
    const particle = acquireParticle(
      glowTexture,
      shot.target.x,
      shot.target.y,
      scale,
      i % 2 ? shot.spec.secondary : shot.spec.color,
      0.95,
    );
    burstLayer.addParticle(particle);
    burstParticles.push({
      particle,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      born: now,
      life: IMPACT_DURATION * (0.7 + Math.random() * 0.3),
    });
  }

  // Shockwave ripple (distorts our own effects, restart on each impact).
  if (shockwaveFilter) {
    shockwaveFilter.center = { x: shot.target.x, y: shot.target.y };
    shockwaveFilter.time = 0;
    shockwaveFilter.amplitude = shot.style === 'cannon' ? 34 : 22;
    shockwaveActive = true;
    shockwaveBorn = now;
  }

  // Impact shake of the effects root.
  shakeAmplitude = clamp(3, shot.spec.impactRadius * 0.09, 9);
  shakeUntil = now + SHAKE_LIFE;

  updateFxFilters();
}

/**
 * Lighter-weight effect for a wall ricochet: a small expanding ring plus a few
 * sparks and a faint shake, but no shockwave — bounces happen often, so this
 * stays cheap while still reading as a physical hit against the edge.
 */
function spawnBounceEffect(point: Point, spec: KickStyleSpec, now: number, quality: number): void {
  if (!burstLayer || !impactLayer || !glowTexture) return;

  const ring = new Sprite(glowTexture);
  ring.anchor.set(0.5);
  ring.tint = spec.secondary;
  ring.blendMode = 'add';
  ring.position.set(point.x, point.y);
  ring.alpha = 0.8;
  impactLayer.addChild(ring);
  impactRings.push({
    ring,
    born: now,
    life: IMPACT_DURATION * 0.6,
    radius: spec.impactRadius * 0.5,
    wide: false,
  });

  const count = Math.max(3, Math.round(6 * (quality >= 0.9 ? 1 : quality >= 0.6 ? 0.7 : 0.45)));
  const speed = spec.impactRadius * 1.8;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const v = speed * (0.5 + Math.random() * 0.5);
    const scale = (2.5 + Math.random() * 1.5) / GLOW_TEXTURE_SIZE;
    const particle = acquireParticle(
      glowTexture,
      point.x,
      point.y,
      scale,
      i % 2 ? spec.secondary : spec.color,
      0.85,
    );
    burstLayer.addParticle(particle);
    burstParticles.push({
      particle,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      born: now,
      life: IMPACT_DURATION * (0.4 + Math.random() * 0.3),
    });
  }

  shakeAmplitude = clamp(2, spec.impactRadius * 0.05, 5);
  shakeUntil = now + SHAKE_LIFE * 0.6;
  updateFxFilters();
}

function updateBurstParticles(now: number, dtSeconds: number): void {
  if (!burstLayer) return;
  const alive: BurstParticle[] = [];
  for (const bp of burstParticles) {
    const age = (now - bp.born) / bp.life;
    if (age >= 1) {
      burstLayer.removeParticle(bp.particle);
      releaseParticle(bp.particle);
      continue;
    }
    const drag = 1 - age;
    bp.particle.x += bp.vx * dtSeconds * drag;
    bp.particle.y += bp.vy * dtSeconds * drag + 40 * dtSeconds * age;
    bp.particle.alpha = drag * 0.95;
    alive.push(bp);
  }
  burstParticles = alive;
}

function updateImpactRings(now: number): void {
  const alive: ImpactRing[] = [];
  for (const ir of impactRings) {
    const progress = (now - ir.born) / ir.life;
    if (progress >= 1) {
      ir.ring.destroy();
      continue;
    }
    const eased = 1 - Math.pow(1 - progress, 3);
    const diameter = (10 + ir.radius * (ir.wide ? 2.7 : 2.1) * eased) * 2;
    ir.ring.width = diameter;
    ir.ring.height = diameter;
    ir.ring.alpha = (1 - progress) * 0.9;
    alive.push(ir);
  }
  impactRings = alive;
}

// ---- rope trail update ----------------------------------------------------

/**
 * Slide the rope so its head sits at the ball and older points trail behind,
 * tracing the curve. Points are mutated in place (fixed-length geometry).
 */
function updateRope(shot: PixiShot, head: Point): void {
  const pts = shot.ropePoints;
  for (let i = 0; i < pts.length - 1; i++) {
    pts[i].x = pts[i + 1].x;
    pts[i].y = pts[i + 1].y;
  }
  pts[pts.length - 1].x = head.x;
  pts[pts.length - 1].y = head.y;
}

// ---- ticker ---------------------------------------------------------------

let lastTickAt = 0;

/**
 * Shared per-frame visual update for a flying ball: perspective scale, launch
 * and impact squash pulses, spin and glow sizing. `progress` (0..1) drives the
 * pulses/perspective; `elapsed` (ms) drives the spin. Position comes from the
 * caller (Bézier point for straight/curve, physics point for bounce).
 */
function applyShotVisual(shot: PixiShot, point: Point, progress: number, elapsed: number): void {
  const perspectiveScale = 1 + (shot.endScale - 1) * progress;
  const launchPulse = progress < 0.08 ? Math.sin((progress / 0.08) * Math.PI) : 0;
  const impactPulse = progress > 0.93 ? Math.sin(((progress - 0.93) / 0.07) * Math.PI) : 0;
  const drawn = shot.size * perspectiveScale;
  shot.node.position.set(point.x, point.y);
  // Scale directly from cached texture dims (avoids the width/height -> scale
  // recompute Pixi does on every setter call each frame).
  const baseScaleX = drawn / ballTexWidth;
  const baseScaleY = drawn / ballAspect / ballTexHeight;
  shot.ball.scale.set(
    baseScaleX * (1 + launchPulse * 0.18 - impactPulse * 0.18),
    baseScaleY * (1 - launchPulse * 0.12 + impactPulse * 0.24),
  );
  shot.ball.rotation = shot.spin * (elapsed / 1000);
  const glowSize = drawn * 2.1;
  shot.glow.width = glowSize;
  shot.glow.height = glowSize;
  shot.rope.alpha = 0.9;
}

function tick(): void {
  if (!ready || !app || !fxRoot) return;
  const now = performance.now();
  const dtSeconds = lastTickAt ? Math.min(0.05, (now - lastTickAt) / 1000) : 0.016;
  lastTickAt = now;

  const quality = trailQuality(shots.length);
  const liveShots: PixiShot[] = [];
  for (const shot of shots) {
    const elapsed = now - shot.startTime;

    // Wall-bounce: integrate the physics projectile, spawn a light ricochet
    // effect on each wall hit, and resolve (final impact) once it runs out of
    // bounces, drops below resting speed, or hits the lifetime cap.
    if (shot.mode === 'bounce' && shot.physics && shot.bounds) {
      const next = stepBounce(
        shot.physics,
        shot.gravity ?? 0,
        dtSeconds,
        shot.bounds,
        shot.restitution ?? 0.7,
      );
      shot.physics = next.state;
      const point: Point = { x: next.state.x, y: next.state.y };
      if (next.bounces > 0) {
        shot.bounceCount = (shot.bounceCount ?? 0) + next.bounces;
        spawnBounceEffect(point, shot.spec, now, quality);
      }
      updateRope(shot, point);

      const speed = Math.hypot(next.state.vx, next.state.vy);
      const resolved =
        elapsed >= BOUNCE_MAX_LIFETIME ||
        (shot.bounceCount ?? 0) >= (shot.maxBounces ?? BOUNCE_MAX_WALL_HITS) ||
        (speed < BOUNCE_MIN_SPEED && (shot.bounceCount ?? 0) > 0);
      if (!resolved) {
        applyShotVisual(shot, point, clamp(0, elapsed / BOUNCE_MAX_LIFETIME, 1), elapsed);
        liveShots.push(shot);
        continue;
      }
      // Final impact where the ball comes to rest.
      shot.target = point;
      spawnImpact(shot, now, quality);
      shot.node.destroy({ children: true });
      shot.rope.destroy();
      continue;
    }

    const progress = clamp(0, elapsed / shot.duration, 1);
    if (progress < 1) {
      const t = easeInOutSine(progress);
      const point = bezierPoint(shot.start, shot.control, shot.target, t);
      updateRope(shot, point);
      applyShotVisual(shot, point, progress, elapsed);
      liveShots.push(shot);
      continue;
    }

    spawnImpact(shot, now, quality);
    shot.node.destroy({ children: true });
    shot.rope.destroy();
  }
  shots = liveShots;

  updateBurstParticles(now, dtSeconds);
  updateImpactRings(now);

  // Shockwave time advance.
  if (shockwaveActive && shockwaveFilter) {
    shockwaveFilter.time = (now - shockwaveBorn) / 1000;
    if (now - shockwaveBorn >= SHOCKWAVE_LIFE) shockwaveActive = false;
  }

  // Decaying impact shake of the effects root.
  if (now < shakeUntil) {
    const k = (shakeUntil - now) / SHAKE_LIFE;
    fxRoot.position.set(
      (Math.random() * 2 - 1) * shakeAmplitude * k,
      (Math.random() * 2 - 1) * shakeAmplitude * k,
    );
  } else {
    fxRoot.position.set(0, 0);
  }

  if (!hasActivity()) {
    lastTickAt = 0;
    updateFxFilters();
    app.render();
    app.ticker.stop();
  } else {
    updateFxFilters();
  }
}

// ---- recoil ---------------------------------------------------------------

function triggerPlayerRecoil(): void {
  const body = document.body;
  if (!body) return;
  if (recoilTimer) window.clearTimeout(recoilTimer);
  body.removeAttribute('data-octo-player-kicking');
  void body.offsetWidth;
  body.setAttribute('data-octo-player-kicking', 'true');
  recoilTimer = window.setTimeout(() => {
    body.removeAttribute('data-octo-player-kicking');
    recoilTimer = undefined;
  }, 360);
}

// ---- shooting -------------------------------------------------------------

function createShot(target: Point): void {
  if (!ready || !playerId || !ballTexture || prefersReducedMotion()) return;
  if (!shotsLayer || !ropeLayer) return;
  const geometry = getPlayerGeometry();
  if (!geometry) return;

  const now = performance.now();
  const style = currentStyle;
  const spec = STYLE_SPECS[style];
  const travelDistance = distance(geometry.start, target);
  const duration = clamp(spec.minDuration, (travelDistance / spec.speed) * 1000, spec.maxDuration);
  const durationSeconds = duration / 1000;

  // Randomize the flight path each click so it isn't always the same banana.
  const mode = pickTrajectoryMode();

  // Curve shape. `straight` pins the control point to the chord midpoint (a flat
  // laser); `curve`/`bounce` bend it into a banana. Faster styles bend less.
  const flatness = clamp(0.45, spec.speed / 1600, 1);
  const bendSign = Math.random() < 0.5 ? -1 : 1;
  const curviness = mode === 'straight' ? 0 : (0.16 + Math.random() * 0.3) / flatness;
  const lateral = bendSign * travelDistance * curviness;
  const lift = mode === 'straight' ? 0 : travelDistance * (0.05 + Math.random() * 0.16);
  const control = curveControlPoint(geometry.start, target, lateral, lift);

  // Wall-bounce: launch a physics projectile from the player toward the click,
  // biased slightly upward so gravity arcs it down into the walls. The Bézier
  // path is unused for this mode — the ticker integrates `physics` instead.
  let physics: PhysicsState | undefined;
  let bounds: Bounds | undefined;
  let flightDuration = duration;
  if (mode === 'bounce') {
    const dx = target.x - geometry.start.x;
    const dy = target.y - geometry.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const launchSpeed = spec.speed * (0.7 + Math.random() * 0.2);
    physics = {
      x: geometry.start.x,
      y: geometry.start.y,
      vx: (dx / len) * launchSpeed,
      vy: (dy / len) * launchSpeed - launchSpeed * (0.3 + Math.random() * 0.25),
    };
    // Confine the ball fully on-screen (inset by its radius).
    const inset = geometry.ballSize / 2;
    bounds = {
      minX: inset,
      minY: inset,
      maxX: Math.max(inset, window.innerWidth - inset),
      maxY: Math.max(inset, window.innerHeight - inset),
    };
    flightDuration = BOUNCE_MAX_LIFETIME;
  }

  const pathSpeed = travelDistance / Math.max(0.001, durationSeconds);
  const spin = clamp(
    10,
    (pathSpeed / Math.max(14, geometry.ballSize * 0.5)) * spec.spinFactor,
    46,
  );
  const endScale = clamp(0.74, 0.8 + (target.y / Math.max(1, window.innerHeight)) * 0.24, 1.05);

  const { node, ball, glow } = makeShotNode(geometry.ballSize, spec.color);
  node.position.set(geometry.start.x, geometry.start.y);
  shotsLayer.addChild(node);

  const { rope, points } = makeRope(geometry.start, spec.color, spec.trailWidth * 2.4);
  ropeLayer.addChild(rope);

  shots.push({
    mode,
    start: geometry.start,
    target,
    control,
    startTime: now,
    duration: flightDuration,
    size: geometry.ballSize,
    style,
    spec,
    spin,
    endScale,
    node,
    ball,
    glow,
    rope,
    ropePoints: points,
    physics,
    gravity: spec.gravity,
    restitution: 0.62 + Math.random() * 0.16,
    bounds,
    bounceCount: 0,
    maxBounces: BOUNCE_MAX_WALL_HITS,
  });
  if (shots.length > MAX_ACTIVE_SHOTS) {
    const dropped = shots.splice(0, shots.length - MAX_ACTIVE_SHOTS);
    dropped.forEach((s) => {
      s.node.destroy({ children: true });
      s.rope.destroy();
    });
  }

  lastShotAt = now;
  cursorSuppressedPoint = target;
  cursorSuppressedUntil = now + flightDuration + 80;
  if (cursorRestoreTimer) window.clearTimeout(cursorRestoreTimer);
  cursorRestoreTimer = window.setTimeout(() => {
    cursorRestoreTimer = undefined;
    refreshCursor();
  }, flightDuration + 90);
  refreshCursor(now);
  triggerPlayerRecoil();
  updateFxFilters();
  startTicker();
}

function shoot(target: Point): void {
  const now = performance.now();
  const remaining = MIN_SHOT_INTERVAL - (now - lastShotAt);
  if (remaining <= 0) {
    createShot(target);
    return;
  }
  queuedShotTarget = target;
  if (queuedShotTimer) return;
  queuedShotTimer = window.setTimeout(() => {
    queuedShotTimer = undefined;
    const queued = queuedShotTarget;
    queuedShotTarget = null;
    if (queued) shoot(queued);
  }, remaining);
}

// ---- pointer / window events ----------------------------------------------

function handlePointerMove(event: PointerEvent): void {
  if (!event.isPrimary) return;
  const next = { x: event.clientX, y: event.clientY };
  if (previousCursorPoint) {
    const movement = distance(previousCursorPoint, next);
    const direction = next.x >= previousCursorPoint.x ? 1 : -1;
    cursorRotation += movement * 0.045 * direction;
  }
  previousCursorPoint = next;
  cursorPoint = next;
  cursorVisible = event.pointerType !== 'touch';
  if (cursorSuppressedPoint && distance(cursorSuppressedPoint, next) >= 9) {
    cursorSuppressedUntil = 0;
    cursorSuppressedPoint = null;
    if (cursorRestoreTimer) {
      window.clearTimeout(cursorRestoreTimer);
      cursorRestoreTimer = undefined;
    }
  }
  refreshCursor();
}

function handlePointerDown(event: PointerEvent): void {
  if (!event.isPrimary || event.button !== 0 || !event.isTrusted) return;
  const target = { x: event.clientX, y: event.clientY };
  cursorPoint = target;
  refreshCursor();
  shoot(target);
}

function handlePointerEnter(event: PointerEvent): void {
  if (!event.isPrimary || event.pointerType === 'touch') return;
  cursorVisible = true;
  refreshCursor();
}

function handlePointerLeave(): void {
  cursorVisible = false;
  refreshCursor();
}

function handleWindowFocus(): void {
  refreshCursor();
}

function handleWindowBlur(): void {
  cursorVisible = false;
  refreshCursor();
}

function handleVisibilityChange(): void {
  if (document.hidden) cursorVisible = false;
  refreshCursor();
}

function handleResize(): void {
  if (app) app.renderer.resolution = renderResolution();
  refreshCursor();
}

function bindEvents(): void {
  if (bound) return;
  bound = true;
  // No `scroll` listener — the canvas is viewport-fixed (perf fix, Task 2).
  window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
  window.addEventListener('pointerover', handlePointerEnter, { capture: true, passive: true });
  document.documentElement.addEventListener('pointerleave', handlePointerLeave, { passive: true });
  window.addEventListener('focus', handleWindowFocus, { passive: true });
  window.addEventListener('blur', handleWindowBlur, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });
  window.addEventListener('resize', handleResize, { passive: true });
}

function unbindEvents(): void {
  if (!bound) return;
  bound = false;
  window.removeEventListener('pointermove', handlePointerMove, true);
  window.removeEventListener('pointerdown', handlePointerDown, true);
  window.removeEventListener('pointerover', handlePointerEnter, true);
  document.documentElement.removeEventListener('pointerleave', handlePointerLeave);
  window.removeEventListener('focus', handleWindowFocus);
  window.removeEventListener('blur', handleWindowBlur);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('resize', handleResize);
}

// ---- teardown -------------------------------------------------------------

function teardown(): void {
  unbindEvents();
  restoreNativeCursor();
  if (recoilTimer) window.clearTimeout(recoilTimer);
  if (queuedShotTimer) window.clearTimeout(queuedShotTimer);
  if (cursorRestoreTimer) window.clearTimeout(cursorRestoreTimer);
  recoilTimer = undefined;
  queuedShotTimer = undefined;
  cursorRestoreTimer = undefined;
  queuedShotTarget = null;
  lastShotAt = -Infinity;
  lastTickAt = 0;

  shots = [];
  burstParticles = [];
  impactRings = [];
  particlePool.length = 0;

  shockwaveActive = false;
  shakeUntil = 0;

  cursorPoint = null;
  previousCursorPoint = null;
  cursorVisible = false;
  cursorSuppressedUntil = 0;
  cursorSuppressedPoint = null;

  const instance = app;
  app = null;
  ready = false;
  fxRoot = null;
  ropeLayer = null;
  shotsLayer = null;
  impactLayer = null;
  burstLayer = null;
  cursorSprite = null;
  bloomFilter = null;
  shockwaveFilter = null;
  if (instance) {
    instance.canvas.removeEventListener('webglcontextlost', handleContextLost, false);
    instance.destroy(true, { children: true, texture: true });
  }
  glowTexture?.destroy(true);
  glowTexture = null;
  ribbonTexture?.destroy(true);
  ribbonTexture = null;
  ballTexture?.destroy(true);
  ballTexture = null;
  ballImageUrl = '';
  document.body?.removeAttribute('data-octo-player-kicking');
}

// ---- public API (unchanged signatures) ------------------------------------

export function setFullscreenKickStyle(styleId: string): void {
  currentStyle = normalizeStyle(styleId);
}

/** Independent toggle: replace the OS cursor with a football (default on). */
export function setFullscreenKickBallCursor(enabled: boolean): void {
  ballCursorEnabled = enabled;
  updateCursorMode();
  refreshCursor();
}

export function setFullscreenKickPlayer(
  nextPlayerId: PlayerWatermarkId,
  nextBallImageUrl: string,
): void {
  if (nextPlayerId === 'none') {
    playerId = null;
    teardown();
    return;
  }

  playerId = nextPlayerId;
  ensureApp();
  installCursorStyle();
  bindEvents();

  if (nextBallImageUrl === ballImageUrl && ballTexture) {
    refreshCursor();
    return;
  }

  ballImageUrl = nextBallImageUrl;
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    if (ballImageUrl !== nextBallImageUrl) return;
    ballTexture?.destroy(true);
    ballTexture = Texture.from(image);
    ballAspect = image.naturalWidth / Math.max(1, image.naturalHeight);
    ballTexWidth = Math.max(1, image.naturalWidth);
    ballTexHeight = Math.max(1, image.naturalHeight);
    if (cursorSprite) cursorSprite.texture = ballTexture;
    refreshCursor();
  };
  image.src = nextBallImageUrl;
}
