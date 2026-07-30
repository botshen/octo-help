import type {
  DesktopPetAnimationManifest,
  DesktopPetManifest,
  DesktopPetStateAnimations,
} from './octoRecall';

const LEGACY_COLUMNS = 12;
const LEGACY_ROWS = 13;
const DEFAULT_FRAME_DURATION_MS = 1000 / 8;
const CODEX_COLUMNS = 8;
const CODEX_V1_ROWS = 9;
const CODEX_V2_ROWS = 11;
const CODEX_FRAME_WIDTH = 192;
const CODEX_FRAME_HEIGHT = 208;
const MAX_GRID_SIZE = 128;
const MAX_ANIMATIONS = 64;
const MIN_FRAME_DURATION_MS = 16;
const MAX_FRAME_DURATION_MS = 60_000;

const STATE_KEYS = ['idle', 'hover', 'drag', 'dragLeft', 'dragRight'] as const;
const STATE_ALIAS_KEYS = ['default', 'hover', 'dragging', 'dragLeft', 'dragRight'] as const;
const SPRITE_ALIAS_KEYS = ['columns', 'rows', 'defaultFps'] as const;

const CODEX_STANDARD_ANIMATIONS: Record<string, DesktopPetAnimationManifest> = {
  idle: { row: 0, frames: 6, frameDurationsMs: [280, 110, 110, 140, 140, 320] },
  'running-right': {
    row: 1,
    frames: 8,
    frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  'running-left': {
    row: 2,
    frames: 8,
    frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  waving: { row: 3, frames: 4, frameDurationsMs: [140, 140, 140, 280] },
  jumping: { row: 4, frames: 5, frameDurationsMs: [140, 140, 140, 140, 280] },
  failed: {
    row: 5,
    frames: 8,
    frameDurationsMs: [140, 140, 140, 140, 140, 140, 140, 240],
  },
  waiting: { row: 6, frames: 6, frameDurationsMs: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, frames: 6, frameDurationsMs: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, frames: 6, frameDurationsMs: [150, 150, 150, 150, 150, 280] },
};

const CODEX_STATE_ANIMATIONS: Required<DesktopPetStateAnimations> = {
  idle: 'idle',
  hover: 'waving',
  drag: 'running',
  dragLeft: 'running-left',
  dragRight: 'running-right',
};

export interface ResolvedDesktopPetAnimation {
  row: number;
  frames: number[];
  frameDurationsMs: number[];
  loop: boolean;
}

export interface ResolvedDesktopPetAnimations {
  columns: number;
  rows: number;
  animations: Record<string, ResolvedDesktopPetAnimation>;
  stateAnimations: DesktopPetStateAnimations;
  format: 'custom' | 'codex-v1' | 'codex-v2' | 'legacy';
}

export type DesktopPetInteractionState = 'idle' | 'hover' | 'drag';

function requireShortString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`pet.json 缺少有效的 ${field}`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`pet.json 的 ${field} 过长`);
  }
  return normalized;
}

function safeArchivePath(rawPath: string): string {
  if (!rawPath || rawPath.includes('\\')) {
    throw new Error(`宠物包包含不安全路径：${rawPath || '(空路径)'}`);
  }
  const path = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
  if (!path || path.startsWith('/') || /^[a-zA-Z]:\//.test(path)) {
    throw new Error(`宠物包包含不安全路径：${rawPath}`);
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`宠物包包含不安全路径：${rawPath}`);
  }
  return parts.join('/');
}

function optionalInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`pet.json 的 ${field} 必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return value as number;
}

function optionalDuration(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < MIN_FRAME_DURATION_MS ||
    value > MAX_FRAME_DURATION_MS
  ) {
    throw new Error(`pet.json 的 ${field} 必须是 16 到 60000 毫秒`);
  }
  return value;
}

function optionalFps(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0.1 ||
    value > 60
  ) {
    throw new Error(`pet.json 的 ${field} 必须是 0.1 到 60`);
  }
  return value;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`pet.json 的 ${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  raw: Record<string, unknown>,
  allowedKeys: readonly string[],
  field: string,
): void {
  const unknownKeys = Object.keys(raw).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) {
    throw new Error(`pet.json 的 ${field} 包含未知字段：${unknownKeys.join('、')}`);
  }
}

function resolveSameAlias<T>(
  primary: T | undefined,
  alias: T | undefined,
  primaryField: string,
  aliasField: string,
): T | undefined {
  if (primary != null && alias != null && primary !== alias) {
    throw new Error(`pet.json 的 ${primaryField} 与 ${aliasField} 配置冲突`);
  }
  return primary ?? alias;
}

function parseSpriteAliases(raw: Record<string, unknown>): {
  columns?: number;
  rows?: number;
  frameDurationMs?: number;
} {
  if (raw.sprite == null) return {};
  const sprite = requireObject(raw.sprite, 'sprite');
  rejectUnknownKeys(sprite, SPRITE_ALIAS_KEYS, 'sprite');
  const columns = optionalInteger(sprite.columns, 'sprite.columns', 1, MAX_GRID_SIZE);
  const rows = optionalInteger(sprite.rows, 'sprite.rows', 1, MAX_GRID_SIZE);
  if ((columns == null) !== (rows == null)) {
    throw new Error('pet.json 的 sprite.columns 和 sprite.rows 必须同时声明');
  }
  const defaultFps = optionalFps(sprite.defaultFps, 'sprite.defaultFps');
  return {
    ...(columns ? { columns, rows: rows! } : {}),
    ...(defaultFps == null ? {} : { frameDurationMs: 1000 / defaultFps }),
  };
}

function parseAnimation(
  value: unknown,
  name: string,
  columns: number,
  rows: number,
): DesktopPetAnimationManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`pet.json 的动画 ${name} 必须是对象`);
  }
  const raw = value as Record<string, unknown>;
  const row = optionalInteger(raw.row, `animations.${name}.row`, 0, rows - 1);
  if (row == null) throw new Error(`pet.json 的动画 ${name} 缺少 row`);

  let frames: number | number[];
  if (Array.isArray(raw.frames)) {
    if (!raw.frames.length || raw.frames.length > columns) {
      throw new Error(`pet.json 的动画 ${name}.frames 长度必须是 1 到 ${columns}`);
    }
    const parsedFrames = raw.frames.map((frame, index) => {
      const parsed = optionalInteger(
        frame,
        `animations.${name}.frames[${index}]`,
        0,
        columns - 1,
      );
      return parsed!;
    });
    if (new Set(parsedFrames).size !== parsedFrames.length) {
      throw new Error(`pet.json 的动画 ${name}.frames 不能包含重复列`);
    }
    frames = parsedFrames;
  } else {
    const frameCount = optionalInteger(raw.frames, `animations.${name}.frames`, 1, columns);
    if (frameCount == null) throw new Error(`pet.json 的动画 ${name} 缺少 frames`);
    frames = frameCount;
  }

  const fps = optionalFps(raw.fps, `animations.${name}.fps`);
  const frameDurationMs = optionalDuration(
    raw.frameDurationMs,
    `animations.${name}.frameDurationMs`,
  );
  if (fps != null && frameDurationMs != null) {
    throw new Error(`pet.json 的动画 ${name} 不能同时设置 fps 和 frameDurationMs`);
  }

  let frameDurationsMs: number[] | undefined;
  if (raw.frameDurationsMs != null) {
    if (!Array.isArray(raw.frameDurationsMs)) {
      throw new Error(`pet.json 的动画 ${name}.frameDurationsMs 必须是数组`);
    }
    const frameCount = typeof frames === 'number' ? frames : frames.length;
    if (raw.frameDurationsMs.length !== frameCount) {
      throw new Error(`pet.json 的动画 ${name}.frameDurationsMs 数量必须与 frames 一致`);
    }
    frameDurationsMs = raw.frameDurationsMs.map((duration, index) =>
      optionalDuration(duration, `animations.${name}.frameDurationsMs[${index}]`)!,
    );
  }
  if (frameDurationsMs && (fps != null || frameDurationMs != null)) {
    throw new Error(`pet.json 的动画 ${name} 不能混用逐帧时长和统一帧率`);
  }

  let loop: boolean | undefined;
  if (raw.loop != null) {
    if (typeof raw.loop !== 'boolean') {
      throw new Error(`pet.json 的动画 ${name}.loop 必须是布尔值`);
    }
    loop = raw.loop;
  }

  return {
    row,
    frames,
    ...(fps == null ? {} : { fps }),
    ...(frameDurationMs == null ? {} : { frameDurationMs }),
    ...(frameDurationsMs ? { frameDurationsMs } : {}),
    ...(loop == null ? {} : { loop }),
  };
}

function parseAnimations(
  raw: Record<string, unknown>,
  columns: number | undefined,
  rows: number | undefined,
): Record<string, DesktopPetAnimationManifest> | undefined {
  const sources = [raw.animations, raw.actions].filter((value) => value != null);
  if (!sources.length) return undefined;
  if (columns == null || rows == null) {
    throw new Error('pet.json 使用 animations/actions 时必须同时声明 columns 和 rows');
  }

  const merged: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('pet.json 的 animations/actions 必须是动作映射对象');
    }
    for (const [rawName, animation] of Object.entries(source as Record<string, unknown>)) {
      const name = requireShortString(rawName, '动画名称', 64);
      if (Object.prototype.hasOwnProperty.call(merged, name)) {
        throw new Error(`pet.json 的动画名称重复：${name}`);
      }
      merged[name] = animation;
    }
  }

  const entries = Object.entries(merged);
  if (!entries.length || entries.length > MAX_ANIMATIONS) {
    throw new Error(`pet.json 的动画数量必须是 1 到 ${MAX_ANIMATIONS}`);
  }
  return Object.fromEntries(
    entries.map(([name, animation]) => [name, parseAnimation(animation, name, columns, rows)]),
  );
}

function parseStateAnimations(
  value: unknown,
  animations: Record<string, DesktopPetAnimationManifest> | undefined,
): DesktopPetStateAnimations | undefined {
  if (value == null) return undefined;
  if (!animations) {
    throw new Error('pet.json 使用 stateAnimations 时必须声明 animations/actions');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('pet.json 的 stateAnimations 必须是对象');
  }
  const raw = value as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter(
    (key) => !STATE_KEYS.includes(key as (typeof STATE_KEYS)[number]),
  );
  if (unknownKeys.length) {
    throw new Error(`pet.json 的 stateAnimations 包含未知状态：${unknownKeys.join('、')}`);
  }

  const result: DesktopPetStateAnimations = {};
  for (const key of STATE_KEYS) {
    if (raw[key] == null) continue;
    const name = requireShortString(raw[key], `stateAnimations.${key}`, 64);
    if (!Object.prototype.hasOwnProperty.call(animations, name)) {
      throw new Error(`pet.json 的 stateAnimations.${key} 引用了不存在的动画：${name}`);
    }
    result[key] = name;
  }
  return result;
}

function parseStateAliases(
  value: unknown,
  animations: Record<string, DesktopPetAnimationManifest> | undefined,
): DesktopPetStateAnimations | undefined {
  if (value == null) return undefined;
  if (!animations) {
    throw new Error('pet.json 使用 states 时必须声明 animations/actions');
  }
  const raw = requireObject(value, 'states');
  rejectUnknownKeys(raw, STATE_ALIAS_KEYS, 'states');
  const aliases: Array<[keyof DesktopPetStateAnimations, (typeof STATE_ALIAS_KEYS)[number]]> = [
    ['idle', 'default'],
    ['hover', 'hover'],
    ['drag', 'dragging'],
    ['dragLeft', 'dragLeft'],
    ['dragRight', 'dragRight'],
  ];
  const result: DesktopPetStateAnimations = {};
  for (const [stateKey, aliasKey] of aliases) {
    if (raw[aliasKey] == null) continue;
    const name = requireShortString(raw[aliasKey], `states.${aliasKey}`, 64);
    if (!Object.prototype.hasOwnProperty.call(animations, name)) {
      throw new Error(`pet.json 的 states.${aliasKey} 引用了不存在的动画：${name}`);
    }
    result[stateKey] = name;
  }
  return result;
}

function mergeStateAliases(
  primary: DesktopPetStateAnimations | undefined,
  alias: DesktopPetStateAnimations | undefined,
): DesktopPetStateAnimations | undefined {
  if (!primary) return alias;
  if (!alias) return primary;
  const result = { ...alias, ...primary };
  for (const key of STATE_KEYS) {
    if (primary[key] && alias[key] && primary[key] !== alias[key]) {
      throw new Error(`pet.json 的 stateAnimations.${key} 与 states 别名配置冲突`);
    }
  }
  return result;
}

export function parseDesktopPetManifest(value: unknown): DesktopPetManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('pet.json 必须是 JSON 对象');
  }
  const raw = value as Record<string, unknown>;
  const description =
    raw.description == null
      ? undefined
      : requireShortString(raw.description, 'description', 1000);
  const spriteVersionNumber = optionalInteger(raw.spriteVersionNumber, 'spriteVersionNumber', 1, 2) as
    | 1
    | 2
    | undefined;
  const spriteAliases = parseSpriteAliases(raw);
  const topLevelColumns = optionalInteger(raw.columns, 'columns', 1, MAX_GRID_SIZE);
  const topLevelRows = optionalInteger(raw.rows, 'rows', 1, MAX_GRID_SIZE);
  if ((topLevelColumns == null) !== (topLevelRows == null)) {
    throw new Error('pet.json 的 columns 和 rows 必须同时声明');
  }
  const columns = resolveSameAlias(
    topLevelColumns,
    spriteAliases.columns,
    'columns',
    'sprite.columns',
  );
  const rows = resolveSameAlias(topLevelRows, spriteAliases.rows, 'rows', 'sprite.rows');
  const topLevelFrameDurationMs = optionalDuration(raw.frameDurationMs, 'frameDurationMs');
  const frameDurationMs = resolveSameAlias(
    topLevelFrameDurationMs,
    spriteAliases.frameDurationMs,
    'frameDurationMs',
    'sprite.defaultFps',
  );
  const animations = parseAnimations(raw, columns, rows);
  const stateAnimations = mergeStateAliases(
    parseStateAnimations(raw.stateAnimations, animations),
    parseStateAliases(raw.states, animations),
  );

  return {
    id: requireShortString(raw.id, 'id', 100),
    displayName: requireShortString(raw.displayName, 'displayName', 100),
    ...(description ? { description } : {}),
    spritesheetPath: safeArchivePath(
      requireShortString(raw.spritesheetPath, 'spritesheetPath', 512),
    ),
    ...(spriteVersionNumber ? { spriteVersionNumber } : {}),
    ...(columns ? { columns, rows: rows! } : {}),
    ...(frameDurationMs == null ? {} : { frameDurationMs }),
    ...(animations ? { animations } : {}),
    ...(stateAnimations ? { stateAnimations } : {}),
  };
}

function resolveAnimation(
  animation: DesktopPetAnimationManifest,
  defaultFrameDurationMs: number,
): ResolvedDesktopPetAnimation {
  const frames =
    typeof animation.frames === 'number'
      ? Array.from({ length: animation.frames }, (_, index) => index)
      : [...animation.frames];
  const duration =
    animation.frameDurationMs ??
    (animation.fps == null ? defaultFrameDurationMs : 1000 / animation.fps);
  return {
    row: animation.row,
    frames,
    frameDurationsMs: animation.frameDurationsMs
      ? [...animation.frameDurationsMs]
      : frames.map(() => duration),
    loop: animation.loop !== false,
  };
}

function codexAnimations(version: 1 | 2): Record<string, DesktopPetAnimationManifest> {
  const animations: Record<string, DesktopPetAnimationManifest> = Object.fromEntries(
    Object.entries(CODEX_STANDARD_ANIMATIONS).map(([name, animation]) => [
      name,
      { ...animation, frameDurationsMs: animation.frameDurationsMs?.slice() },
    ]),
  );
  if (version === 2) {
    const directions = [
      '000', '022.5', '045', '067.5', '090', '112.5', '135', '157.5',
      '180', '202.5', '225', '247.5', '270', '292.5', '315', '337.5',
    ];
    directions.forEach((direction, index) => {
      animations[`look-${direction}`] = {
        row: index < 8 ? 9 : 10,
        frames: [index % 8],
        loop: false,
      };
    });
  }
  return animations;
}

function isCodexV1Dimensions(width: number, height: number): boolean {
  return width === CODEX_COLUMNS * CODEX_FRAME_WIDTH && height === CODEX_V1_ROWS * CODEX_FRAME_HEIGHT;
}

export function validateDesktopPetSpritesheetDimensions(
  manifest: DesktopPetManifest,
  width: number,
  height: number,
): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('spritesheet 图片尺寸无效');
  }
  if (width < LEGACY_COLUMNS || height < LEGACY_ROWS) {
    throw new Error('spritesheet 图片尺寸过小');
  }
  if (manifest.spriteVersionNumber) {
    const expectedRows = manifest.spriteVersionNumber === 2 ? CODEX_V2_ROWS : CODEX_V1_ROWS;
    const expectedWidth = CODEX_COLUMNS * CODEX_FRAME_WIDTH;
    const expectedHeight = expectedRows * CODEX_FRAME_HEIGHT;
    if (width !== expectedWidth || height !== expectedHeight) {
      throw new Error(
        `Codex v${manifest.spriteVersionNumber} spritesheet 必须是 ${expectedWidth}×${expectedHeight}`,
      );
    }
    return;
  }
  if (manifest.columns && manifest.rows) {
    if (width % manifest.columns !== 0 || height % manifest.rows !== 0) {
      throw new Error(`spritesheet 尺寸必须能被 ${manifest.columns}×${manifest.rows} 网格整除`);
    }
    return;
  }
  if (width === CODEX_COLUMNS * CODEX_FRAME_WIDTH && height === CODEX_V2_ROWS * CODEX_FRAME_HEIGHT) {
    throw new Error('Codex v2 宠物必须在 pet.json 声明 spriteVersionNumber: 2');
  }
}

export function resolveDesktopPetAnimations(
  manifest: DesktopPetManifest,
  imageWidth: number,
  imageHeight: number,
): ResolvedDesktopPetAnimations {
  validateDesktopPetSpritesheetDimensions(manifest, imageWidth, imageHeight);
  let columns = LEGACY_COLUMNS;
  let rows = LEGACY_ROWS;
  let animations: Record<string, DesktopPetAnimationManifest> = {
    idle: { row: 0, frames: LEGACY_COLUMNS },
  };
  let stateAnimations: DesktopPetStateAnimations = { idle: 'idle' };
  let format: ResolvedDesktopPetAnimations['format'] = 'legacy';

  const codexVersion = manifest.spriteVersionNumber ??
    (isCodexV1Dimensions(imageWidth, imageHeight) ? 1 : undefined);
  if (codexVersion) {
    columns = CODEX_COLUMNS;
    rows = codexVersion === 2 ? CODEX_V2_ROWS : CODEX_V1_ROWS;
    animations = codexAnimations(codexVersion);
    stateAnimations = { ...CODEX_STATE_ANIMATIONS };
    format = codexVersion === 2 ? 'codex-v2' : 'codex-v1';
  }

  if (manifest.columns && manifest.rows) {
    columns = manifest.columns;
    rows = manifest.rows;
    animations = manifest.animations ?? { idle: { row: 0, frames: columns } };
    stateAnimations = manifest.stateAnimations ?? {};
    format = 'custom';
  }

  const defaultDuration = manifest.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;
  return {
    columns,
    rows,
    animations: Object.fromEntries(
      Object.entries(animations).map(([name, animation]) => [
        name,
        resolveAnimation(animation, defaultDuration),
      ]),
    ),
    stateAnimations,
    format,
  };
}

function firstExistingAnimation(
  config: ResolvedDesktopPetAnimations,
  names: Array<string | undefined>,
): string {
  return names.find(
    (name): name is string =>
      !!name && Object.prototype.hasOwnProperty.call(config.animations, name),
  ) ??
    Object.keys(config.animations)[0];
}

export function selectDesktopPetAnimation(
  config: ResolvedDesktopPetAnimations,
  state: DesktopPetInteractionState,
  dragDirection: -1 | 0 | 1 = 0,
): string {
  if (state === 'idle') {
    return firstExistingAnimation(config, [
      config.stateAnimations.idle,
      'idle',
      'default',
    ]);
  }
  if (state === 'hover') {
    return firstExistingAnimation(config, [
      config.stateAnimations.hover,
      'hover',
      'happy',
      'waving',
      'wave',
      config.stateAnimations.idle,
      'idle',
    ]);
  }
  const directional = dragDirection < 0
    ? [config.stateAnimations.dragLeft, 'drag-left', 'grabbed-left', 'running-left']
    : dragDirection > 0
      ? [config.stateAnimations.dragRight, 'drag-right', 'grabbed-right', 'running-right']
      : [];
  return firstExistingAnimation(config, [
    ...directional,
    config.stateAnimations.drag,
    'drag',
    'grabbed',
    'running',
    config.stateAnimations.hover,
    'hover',
    'happy',
    config.stateAnimations.idle,
    'idle',
  ]);
}
