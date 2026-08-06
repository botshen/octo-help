import type {
  AiBalanceCache,
  AiBalanceConfig,
  AiBalancePageState,
} from './octoRecall';

/**
 * Pure logic behind the AI balance widget: config validation, response reading
 * and formatting. No DOM, no `browser.*`, so every rule here is unit tested.
 *
 * The security-relevant part is that this file replaces what would otherwise be
 * a user-supplied extractor function. Everything that comes back from a remote
 * endpoint is untrusted input, and everything the user types is data — never
 * code. See `readJsonPath` for the one place that could have become a hole.
 */

export interface AiBalancePreset {
  id: string;
  label: string;
  /**
   * Request path relative to the user's own gateway, with `{key}` replaced by
   * their API key.
   *
   * Deliberately a path and not a full URL: the host is somebody's internal
   * deployment, and hard-coding one into a public repository publishes their
   * infrastructure. A preset describes the *shape* of an API; the user supplies
   * where it lives (once).
   */
  pathTemplate: string;
  /** Placeholder for the gateway field, never a real host. */
  baseHint: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  path: string;
  /** Where the *total* quota sits, when the API reports one. '' = auto-detect. */
  totalPath: string;
  unit: string;
  keyHint: string;
}

/**
 * Known API shapes, so the common case is "paste a gateway URL and a key".
 *
 * `llm-gateway` matches the deployment this feature was built for: the key goes
 * in the query string and the number sits on `data.remain_quota_usd`.
 */
export const AI_BALANCE_PRESETS: readonly AiBalancePreset[] = [
  {
    id: 'llm-gateway',
    label: 'LLM Gateway 自建网关',
    pathTemplate: '/api/v1/key/info?key={key}',
    baseHint: 'https://gateway.example.com',
    method: 'GET',
    headers: {},
    path: 'data.remain_quota_usd',
    totalPath: '',
    unit: '美元💵',
    keyHint: 'sk-…',
  },
  {
    id: 'openai-compatible',
    label: 'OneAPI / NewAPI',
    pathTemplate: '/api/v1/dashboard/billing/subscription',
    baseHint: 'https://gateway.example.com',
    method: 'GET',
    headers: { Authorization: 'Bearer {key}' },
    path: 'hard_limit_usd',
    totalPath: '',
    unit: '美元💵',
    keyHint: 'sk-…',
  },
];

export const CUSTOM_PRESET_ID = 'custom';

/** Refreshing more often than this is pointless and looks like abuse to the API. */
export const MIN_REFRESH_MINUTES = 5;
export const MAX_REFRESH_MINUTES = 24 * 60;
export const DEFAULT_REFRESH_MINUTES = 30;

/** Guard rails for the background fetch. */
export const BALANCE_FETCH_TIMEOUT_MS = 8_000;
export const BALANCE_MAX_RESPONSE_BYTES = 256 * 1024;

export const DEFAULT_AI_BALANCE_CONFIG: AiBalanceConfig = {
  enabled: true,
  presetId: AI_BALANCE_PRESETS[0].id,
  url: '',
  method: 'GET',
  headers: {},
  path: AI_BALANCE_PRESETS[0].path,
  totalPath: '',
  unit: AI_BALANCE_PRESETS[0].unit,
  multiplier: 1,
  decimals: 2,
  refreshMinutes: DEFAULT_REFRESH_MINUTES,
  badgePercent: true,
  lowThreshold: null,
  showInPage: false,
};

export function findAiBalancePreset(id: string): AiBalancePreset | null {
  return AI_BALANCE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Build the request from a preset plus the two things only the user knows: where
 * their gateway lives and their key. Returns null when the base URL is unusable,
 * so the caller can point at the field instead of building a broken request.
 */
export function applyPreset(
  preset: AiBalancePreset,
  baseUrl: string,
  key: string,
): { url: string; headers: Record<string, string> } | null {
  const trimmedKey = key.trim();
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(preset.headers)) {
    headers[name] = value.replaceAll('{key}', trimmedKey);
  }
  let url: string;
  try {
    // `new URL(path, base)` keeps the user's base path if they pasted one, and
    // rejects anything that is not a URL at all.
    url = new URL(
      preset.pathTemplate.replaceAll('{key}', encodeURIComponent(trimmedKey)),
      baseUrl.trim(),
    ).toString();
  } catch {
    return null;
  }
  return { url, headers };
}

/** Origin of a saved URL, so editing can show the gateway field pre-filled. */
export function baseUrlOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

// ---- config validation ----------------------------------------------------

const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/** Dotted keys plus `[0]` indexes. Anything else is rejected rather than guessed at. */
const PATH_SEGMENT_RE = /^[A-Za-z0-9_$-]+$/;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** Split `a.b[0].c` into `['a','b','0','c']`, or return null when it is not a path we accept. */
export function parseJsonPath(path: string): string[] | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const segments: string[] = [];
  for (const rawSegment of trimmed.split('.')) {
    if (!rawSegment) return null;
    // Peel `name[0][1]` into a name plus its indexes.
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(rawSegment);
    if (!match) return null;
    const [, name, indexes] = match;
    if (name) {
      if (!PATH_SEGMENT_RE.test(name)) return null;
      segments.push(name);
    } else if (!indexes) {
      return null;
    }
    for (const index of indexes.match(/\d+/g) ?? []) segments.push(index);
  }
  if (!segments.length) return null;
  // Prototype-walking segments are refused up front: `readJsonPath` also uses
  // own-property checks, but a path that can never be valid should fail loudly
  // in the settings form rather than silently return "not found" at fetch time.
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) return null;
  return segments;
}

export function isSafeJsonPath(path: string): boolean {
  return parseJsonPath(path) !== null;
}

export interface ConfigProblem {
  field: 'url' | 'path' | 'totalPath' | 'headers' | 'unit' | 'refreshMinutes' | 'multiplier';
  message: string;
}

/**
 * Validate and normalize a config coming from the settings form.
 *
 * Returns problems instead of throwing, because every one of them maps to a
 * field the user can fix, and the panel shows them inline.
 */
export function validateAiBalanceConfig(
  input: AiBalanceConfig,
): { ok: true; config: AiBalanceConfig } | { ok: false; problems: ConfigProblem[] } {
  const problems: ConfigProblem[] = [];

  let url: URL | null;
  try {
    url = new URL(input.url.trim());
  } catch {
    url = null;
  }
  // https only: the key travels in this request, and a downgraded http endpoint
  // would put it on the wire in clear text.
  if (!url || url.protocol !== 'https:') {
    problems.push({ field: 'url', message: '请填写完整的 https:// 网关地址' });
  }

  if (!isSafeJsonPath(input.path)) {
    problems.push({ field: 'path', message: '取值路径只支持 a.b[0].c 这种形式' });
  }

  // Empty is meaningful here: it means "auto-detect the total".
  const totalPath = (input.totalPath ?? '').trim();
  if (totalPath && !isSafeJsonPath(totalPath)) {
    problems.push({ field: 'totalPath', message: '总额路径只支持 a.b[0].c 这种形式' });
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    const cleanName = name.trim();
    const cleanValue = value.trim();
    if (!cleanName) continue;
    if (!HEADER_NAME_RE.test(cleanName) || /[\r\n]/.test(cleanValue)) {
      problems.push({ field: 'headers', message: `请求头「${cleanName}」格式不合法` });
      continue;
    }
    headers[cleanName] = cleanValue;
  }

  const unit = input.unit.trim().slice(0, 12);
  const multiplier = Number(input.multiplier);
  if (!Number.isFinite(multiplier) || multiplier === 0) {
    problems.push({ field: 'multiplier', message: '倍率必须是非零数字' });
  }

  if (problems.length) return { ok: false, problems };

  return {
    ok: true,
    config: {
      // Missing means on: an older stored config predates the switch, and it was
      // active back then.
      enabled: input.enabled !== false,
      presetId: input.presetId || CUSTOM_PRESET_ID,
      url: url!.toString(),
      method: input.method === 'POST' ? 'POST' : 'GET',
      headers,
      path: input.path.trim(),
      totalPath,
      unit,
      multiplier,
      decimals: clampDecimals(input.decimals),
      refreshMinutes: clampRefreshMinutes(input.refreshMinutes),
      badgePercent: input.badgePercent !== false,
      lowThreshold:
        input.lowThreshold == null || !Number.isFinite(Number(input.lowThreshold))
          ? null
          : Number(input.lowThreshold),
      showInPage: input.showInPage === true,
    },
  };
}

/**
 * Re-validate a config read back from storage.
 *
 * Storage is not a trust boundary the way postMessage is, but this config drives
 * a cross-origin request from the background, so it gets checked again rather
 * than cast.
 */
export function parseStoredAiBalanceConfig(raw: unknown): AiBalanceConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.url !== 'string' || typeof value.path !== 'string') return null;
  const headers: Record<string, string> = {};
  if (value.headers && typeof value.headers === 'object') {
    for (const [name, headerValue] of Object.entries(value.headers as Record<string, unknown>)) {
      if (typeof headerValue === 'string') headers[name] = headerValue;
    }
  }
  const result = validateAiBalanceConfig({
    enabled: value.enabled !== false,
    presetId: typeof value.presetId === 'string' ? value.presetId : CUSTOM_PRESET_ID,
    url: value.url,
    method: value.method === 'POST' ? 'POST' : 'GET',
    headers,
    path: value.path,
    totalPath: typeof value.totalPath === 'string' ? value.totalPath : '',
    unit: typeof value.unit === 'string' ? value.unit : '',
    multiplier: typeof value.multiplier === 'number' ? value.multiplier : 1,
    decimals: typeof value.decimals === 'number' ? value.decimals : 2,
    refreshMinutes:
      typeof value.refreshMinutes === 'number' ? value.refreshMinutes : DEFAULT_REFRESH_MINUTES,
    badgePercent: value.badgePercent !== false,
    lowThreshold: typeof value.lowThreshold === 'number' ? value.lowThreshold : null,
    showInPage: value.showInPage === true,
  });
  return result.ok ? result.config : null;
}

export function parseStoredAiBalanceCache(raw: unknown): AiBalanceCache | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const finiteOrZero = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) ? input : 0;
  const finiteOrNull = (input: unknown) =>
    typeof input === 'number' && Number.isFinite(input) ? input : null;
  return {
    value: finiteOrNull(value.value),
    total: finiteOrNull(value.total),
    percent: finiteOrNull(value.percent),
    unit: typeof value.unit === 'string' ? value.unit : '',
    fetchedAt: finiteOrZero(value.fetchedAt),
    error: typeof value.error === 'string' ? value.error : '',
    erroredAt: finiteOrZero(value.erroredAt),
  };
}

export function clampRefreshMinutes(input: unknown): number {
  const minutes = Math.round(Number(input));
  if (!Number.isFinite(minutes)) return DEFAULT_REFRESH_MINUTES;
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, minutes));
}

export function clampDecimals(input: unknown): number {
  const decimals = Math.round(Number(input));
  if (!Number.isFinite(decimals)) return 2;
  return Math.min(4, Math.max(0, decimals));
}

// ---- reading the response -------------------------------------------------

/**
 * Follow a validated path through parsed JSON.
 *
 * Own-property checks only, so `__proto__` / `constructor` cannot be reached
 * even if a future caller skips `parseJsonPath`. This is the function that a
 * user-supplied `extractor` would have replaced, which is exactly why it is
 * this boring.
 */
export function readJsonPath(source: unknown, path: string): unknown {
  const segments = parseJsonPath(path);
  if (!segments) return undefined;
  let cursor: unknown = source;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Fields APIs commonly use to explain a rejection, in preference order. */
const MESSAGE_PATHS = ['message', 'msg', 'error.message', 'error', 'detail'] as const;

/** Surface the API's own wording when it has one — it is far more useful than a generic error. */
export function readApiMessage(source: unknown): string {
  for (const path of MESSAGE_PATHS) {
    const value = readJsonPath(source, path);
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  }
  return '';
}

export type BalanceExtraction =
  | { ok: true; value: number; total: number | null; percent: number | null }
  | { ok: false; error: string };

/**
 * Field names gateways use for the *total* granted quota, and for the amount
 * already spent (total = remaining + used).
 *
 * A candidate list rather than a required setting: the percentage is a nicety,
 * and demanding that every user go read their gateway's JSON to get it would
 * make the common case worse. An explicit `totalPath` always wins.
 */
const TOTAL_CANDIDATES = [
  'data.total_quota_usd',
  'data.total_quota',
  'data.quota_usd',
  'data.quota',
  'total_quota_usd',
  'total_quota',
  'hard_limit_usd',
  'total_granted',
] as const;

const USED_CANDIDATES = [
  'data.used_quota_usd',
  'data.used_quota',
  'used_quota_usd',
  'used_quota',
  'total_usage',
  'total_used',
] as const;

function readNumber(response: unknown, path: string): number | null {
  const raw = readJsonPath(response, path);
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Total quota behind a balance, either read straight from the response or
 * reconstructed as remaining + used.
 */
export function findTotalQuota(
  response: unknown,
  remaining: number,
  totalPath: string,
  multiplier = 1,
): number | null {
  if (totalPath) {
    const explicit = readNumber(response, totalPath);
    return explicit == null ? null : explicit * multiplier;
  }
  for (const candidate of TOTAL_CANDIDATES) {
    const total = readNumber(response, candidate);
    if (total != null && total > 0) return total * multiplier;
  }
  for (const candidate of USED_CANDIDATES) {
    const used = readNumber(response, candidate);
    // `used` may legitimately be 0 on a fresh key, so 0 counts as found.
    if (used != null && used >= 0) return remaining + used * multiplier;
  }
  return null;
}

/** Remaining share of the total, 0-100, or null when there is no usable total. */
export function toPercent(remaining: number, total: number | null): number | null {
  if (total == null || !(total > 0)) return null;
  // Clamped: a gateway that reports a stale total can otherwise produce 120%.
  return Math.min(100, Math.max(0, (remaining / total) * 100));
}

/**
 * Pull the balance out of a parsed response.
 *
 * The endpoint this was built against answers an invalid key with HTTP 200 and
 * `{"success":false,"message":"无效的令牌"}`, so "2xx" is not success — the
 * number has to actually be there, and when it is not, the API's own message is
 * what the user needs to see.
 */
export function extractBalance(
  response: unknown,
  path: string,
  multiplier = 1,
  totalPath = '',
): BalanceExtraction {
  const raw = readJsonPath(response, path);
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const remaining = value * multiplier;
    const total = findTotalQuota(response, remaining, totalPath, multiplier);
    return { ok: true, value: remaining, total, percent: toPercent(remaining, total) };
  }
  const apiMessage = readApiMessage(response);
  if (apiMessage) return { ok: false, error: apiMessage };
  return {
    ok: false,
    error: raw === undefined ? `响应里没有 ${path}` : `${path} 不是数字`,
  };
}

// ---- formatting -----------------------------------------------------------

export function formatBalanceValue(value: number, decimals: number): string {
  const fixed = value.toFixed(clampDecimals(decimals));
  // Trailing zeros read as false precision on a balance, but only the ones after
  // a decimal point are noise — `100` must not become `1`.
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** The string shown in the panel and (optionally) in the page. */
export function formatBalance(value: number, unit: string, decimals: number): string {
  const amount = formatBalanceValue(value, decimals);
  return unit ? `${amount} ${unit}` : amount;
}

/**
 * Toolbar badge text.
 *
 * The badge realistically fits four glyphs, and a balance like `1234.56` cannot
 * be shown there without lying about the amount. A remaining *percentage* fits
 * exactly (`7%`…`100%`) and is the more useful signal anyway; the exact figure
 * lives in the tooltip, the panel header and (optionally) the composer pill.
 * Without a known total we fall back to an abbreviated number.
 */
export function formatBalanceBadge(value: number, percent: number | null = null): string {
  if (percent != null) return `${Math.round(percent)}%`;
  const absolute = Math.abs(value);
  if (absolute >= 1_000) return `${Math.round(value / 1_000)}k`;
  if (absolute >= 100) return String(Math.round(value));
  if (absolute >= 10) return value.toFixed(1);
  return value.toFixed(2).slice(0, 4);
}

/** `剩余 62%`, or '' when no total is known. */
export function formatPercent(percent: number | null): string {
  return percent == null ? '' : `剩余 ${Math.round(percent)}%`;
}

export function isBalanceLow(value: number | null, threshold: number | null): boolean {
  return value != null && threshold != null && value < threshold;
}

/**
 * Precompute what the Octo page is allowed to see.
 *
 * The background stores this next to the cache so the content script relays a
 * ready-made string: it never reads the endpoint or the key, and it needs no
 * balance code of its own (which is also what keeps it under its 15 KB budget).
 *
 * An empty string means "show nothing" — feature off, unconfigured, or never
 * fetched successfully. A stale number with no way to tell it is stale would be
 * worse than no number.
 */
export function describeAiBalanceForPage(
  config: AiBalanceConfig | null,
  cache: AiBalanceCache | null,
): AiBalancePageState {
  if (!config?.enabled || !config.showInPage || cache?.value == null) {
    return { text: '', low: false };
  }
  return {
    text: formatBalance(cache.value, cache.unit || config.unit, config.decimals),
    low: isBalanceLow(cache.value, config.lowThreshold),
  };
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '还没有更新';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (seconds < 60) return '刚刚更新';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  return `${Math.round(hours / 24)} 天前更新`;
}

/** Whether the cached value is older than the configured refresh interval. */
export function isBalanceStale(
  cache: AiBalanceCache | null,
  refreshMinutes: number,
  now = Date.now(),
): boolean {
  if (!cache || !cache.fetchedAt) return true;
  return now - cache.fetchedAt >= clampRefreshMinutes(refreshMinutes) * 60_000;
}

/** Mask a secret for display: keep enough to recognise it, not enough to reuse it. */
export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 10) return trimmed ? `${trimmed.slice(0, 2)}••••` : '';
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`;
}

// ---- header text area <-> map --------------------------------------------

export function stringifyHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) continue;
    headers[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return headers;
}

// ---- curl import ----------------------------------------------------------

export interface ParsedCurl {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
}

/**
 * Best-effort `curl` parser, so a user who already has a working request can
 * paste it instead of re-typing five fields. Unknown flags are ignored rather
 * than rejected — the goal is to pre-fill a form the user still reviews.
 */
export function parseCurlCommand(command: string): ParsedCurl | null {
  const tokens = tokenizeShell(command);
  if (!tokens.length) return null;
  let url = '';
  let method: 'GET' | 'POST' = 'GET';
  const headers: Record<string, string> = {};
  let sawData = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === 'curl') continue;
    if (token === '-H' || token === '--header') {
      const header = tokens[++index];
      if (!header) continue;
      const separator = header.indexOf(':');
      if (separator > 0) {
        headers[header.slice(0, separator).trim()] = header.slice(separator + 1).trim();
      }
      continue;
    }
    if (token === '-X' || token === '--request') {
      const verb = (tokens[++index] ?? '').toUpperCase();
      if (verb === 'POST') method = 'POST';
      continue;
    }
    if (token === '-d' || token === '--data' || token === '--data-raw') {
      sawData = true;
      index += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    if (!url && /^https?:\/\//i.test(token)) url = token;
  }

  if (!url) return null;
  // `curl -d` without `-X` is a POST; mirroring curl here avoids a config that
  // "worked in the terminal" but not in the extension.
  if (sawData) method = 'POST';
  return { url, method, headers };
}

/** Minimal shell-ish tokenizer: quotes, escaped newlines, nothing else. */
function tokenizeShell(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === '\\' && (input[index + 1] === '\n' || input[index + 1] === '\r')) {
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || current) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
  }
  if (started || current) tokens.push(current);
  return tokens.filter((token) => token !== '');
}
