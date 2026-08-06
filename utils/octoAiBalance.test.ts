import { describe, expect, it } from 'vitest';
import {
  AI_BALANCE_PRESETS,
  DEFAULT_AI_BALANCE_CONFIG,
  MIN_REFRESH_MINUTES,
  applyPreset,
  baseUrlOf,
  clampRefreshMinutes,
  describeAiBalanceForPage,
  extractBalance,
  formatBalance,
  formatBalanceBadge,
  formatBalanceValue,
  formatPercent,
  formatRelativeTime,
  isBalanceLow,
  isBalanceStale,
  maskSecret,
  parseCurlCommand,
  parseHeaderLines,
  parseJsonPath,
  parseStoredAiBalanceConfig,
  readJsonPath,
  stringifyHeaders,
  toPercent,
  validateAiBalanceConfig,
} from './octoAiBalance';
import type { AiBalanceConfig } from './octoRecall';

/** The response shape this feature was built against. */
const GATEWAY_OK = {
  success: true,
  data: { remain_quota_usd: 12.3456, used_quota_usd: 1.2 },
};
/** Same, without any total/used field to derive a percentage from. */
const GATEWAY_NO_TOTAL = { success: true, data: { remain_quota_usd: 12.3456 } };
/** Same endpoint with a dead key: HTTP 200, no number, Chinese reason. */
const GATEWAY_REJECTED = { message: '无效的令牌', success: false };

function config(overrides: Partial<AiBalanceConfig> = {}): AiBalanceConfig {
  return {
    ...DEFAULT_AI_BALANCE_CONFIG,
    url: 'https://gateway.example.com/api/v1/key/info?key=sk-test',
    ...overrides,
  };
}

describe('extractBalance', () => {
  it('reads the balance the gateway actually returns', () => {
    expect(extractBalance(GATEWAY_OK, 'data.remain_quota_usd')).toMatchObject({
      ok: true,
      value: 12.3456,
    });
  });

  it('surfaces the API wording when the key is rejected with HTTP 200', () => {
    // The endpoint answers a dead key with 200 + success:false, so "the request
    // succeeded" is not the same as "we have a balance".
    expect(extractBalance(GATEWAY_REJECTED, 'data.remain_quota_usd')).toEqual({
      ok: false,
      error: '无效的令牌',
    });
  });

  it('names the missing path when the API says nothing useful', () => {
    expect(extractBalance({ data: {} }, 'data.remain_quota_usd')).toEqual({
      ok: false,
      error: '响应里没有 data.remain_quota_usd',
    });
  });

  it('rejects a non-numeric value instead of rendering NaN', () => {
    expect(extractBalance({ data: { remain: {} } }, 'data.remain')).toEqual({
      ok: false,
      error: 'data.remain 不是数字',
    });
  });

  it('accepts numeric strings, which some gateways return', () => {
    expect(extractBalance({ balance: '8.5' }, 'balance')).toEqual({
      ok: true,
      value: 8.5,
      total: null,
      percent: null,
    });
  });

  it('applies the multiplier so cent-denominated quotas can be shown as currency', () => {
    expect(extractBalance({ balance: 1234 }, 'balance', 0.01)).toMatchObject({
      ok: true,
      value: 12.34,
    });
  });

  it('reads through array indexes', () => {
    expect(extractBalance({ items: [{ left: 3 }] }, 'items[0].left')).toMatchObject({
      ok: true,
      value: 3,
    });
  });
});

describe('readJsonPath', () => {
  it('cannot be walked into the prototype chain', () => {
    // The user-facing alternative was an eval'd extractor function; this path
    // reader is the boundary that replaces it, so prototype access must be dead.
    expect(readJsonPath({}, '__proto__.constructor')).toBeUndefined();
    expect(parseJsonPath('__proto__')).toBeNull();
    expect(parseJsonPath('a.constructor.b')).toBeNull();
  });

  it('only accepts inherited-free own properties', () => {
    expect(readJsonPath({ a: { b: 1 } }, 'a.b')).toBe(1);
    expect(readJsonPath({ a: 1 }, 'a.toString')).toBeUndefined();
  });

  it('rejects paths that are not plain member access', () => {
    for (const path of ['', '.', 'a..b', 'a b', 'a["b"]', 'a[]', 'a[-1]']) {
      expect(parseJsonPath(path), path).toBeNull();
    }
  });
});

describe('validateAiBalanceConfig', () => {
  it('accepts the gateway configuration', () => {
    const result = validateAiBalanceConfig(config());
    expect(result.ok).toBe(true);
  });

  it('refuses http, which would put the API key on the wire in clear text', () => {
    const result = validateAiBalanceConfig(config({ url: 'http://gateway.example.com/info' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].field).toBe('url');
  });

  it('refuses a path it cannot safely read', () => {
    const result = validateAiBalanceConfig(config({ path: 'data.__proto__' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].field).toBe('path');
  });

  it('refuses header values carrying a newline (request splitting)', () => {
    const result = validateAiBalanceConfig(
      config({ headers: { Authorization: 'Bearer x\r\nX-Evil: 1' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0].field).toBe('headers');
  });

  it('clamps the refresh interval so we never hammer the endpoint', () => {
    const result = validateAiBalanceConfig(config({ refreshMinutes: 1 }));
    expect(result.ok && result.config.refreshMinutes).toBe(MIN_REFRESH_MINUTES);
    expect(clampRefreshMinutes('nonsense')).toBe(30);
    expect(clampRefreshMinutes(99_999)).toBe(24 * 60);
  });

  it('drops empty header names instead of sending a blank header', () => {
    const result = validateAiBalanceConfig(config({ headers: { '  ': 'x', 'X-Ok': ' y ' } }));
    expect(result.ok && result.config.headers).toEqual({ 'X-Ok': 'y' });
  });
});

describe('parseStoredAiBalanceConfig', () => {
  it('round-trips a validated config', () => {
    const stored = validateAiBalanceConfig(config());
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(parseStoredAiBalanceConfig(JSON.parse(JSON.stringify(stored.config)))).toEqual(
      stored.config,
    );
  });

  it('rejects junk rather than letting the background fetch it', () => {
    expect(parseStoredAiBalanceConfig(null)).toBeNull();
    expect(parseStoredAiBalanceConfig({ url: 'https://a.example.com/x' })).toBeNull();
    expect(parseStoredAiBalanceConfig({ url: 'ftp://a/x', path: 'a' })).toBeNull();
  });
});

describe('applyPreset', () => {
  it('combines the preset shape with the user\'s own gateway and key', () => {
    // Presets carry a path, never a host: the deployment URL belongs to the user
    // and has no business being in this repository.
    expect(applyPreset(AI_BALANCE_PRESETS[0], 'https://gateway.example.com', ' sk-abc ')).toEqual({
      url: 'https://gateway.example.com/api/v1/key/info?key=sk-abc',
      headers: {},
    });
    const bearer = AI_BALANCE_PRESETS[1];
    expect(applyPreset(bearer, 'https://gateway.example.com', 'sk-abc')?.headers).toEqual({
      Authorization: 'Bearer sk-abc',
    });
  });

  it('encodes the key so a pasted stray character cannot alter the query', () => {
    expect(
      applyPreset(AI_BALANCE_PRESETS[0], 'https://gateway.example.com', 'a&b=c')?.url,
    ).toContain('key=a%26b%3Dc');
  });

  it('tolerates a trailing slash or a sub-path in the gateway field', () => {
    expect(applyPreset(AI_BALANCE_PRESETS[0], 'https://gateway.example.com/', 'k')?.url).toBe(
      'https://gateway.example.com/api/v1/key/info?key=k',
    );
  });

  it('returns null instead of building a broken request', () => {
    expect(applyPreset(AI_BALANCE_PRESETS[0], 'not a url', 'k')).toBeNull();
    expect(applyPreset(AI_BALANCE_PRESETS[0], '', 'k')).toBeNull();
  });
});

describe('baseUrlOf', () => {
  it('recovers the gateway so editing shows it pre-filled', () => {
    expect(baseUrlOf('https://gateway.example.com/api/v1/key/info?key=sk-1')).toBe(
      'https://gateway.example.com',
    );
    expect(baseUrlOf('nonsense')).toBe('');
  });
});

describe('parseCurlCommand', () => {
  it('imports a copied curl command', () => {
    const parsed = parseCurlCommand(
      `curl 'https://gateway.example.com/api/v1/key/info?key=sk-1' \\\n  -H 'Accept: application/json'`,
    );
    expect(parsed).toEqual({
      url: 'https://gateway.example.com/api/v1/key/info?key=sk-1',
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  });

  it('treats a body as POST, like curl does', () => {
    expect(parseCurlCommand(`curl https://a.example.com/x -d '{"a":1}'`)?.method).toBe('POST');
  });

  it('returns null when there is no URL to use', () => {
    expect(parseCurlCommand('curl -H "Accept: */*"')).toBeNull();
  });
});

describe('headers text area', () => {
  it('round-trips through the textarea format', () => {
    const headers = { Authorization: 'Bearer sk-1', Accept: 'application/json' };
    expect(parseHeaderLines(stringifyHeaders(headers))).toEqual(headers);
  });

  it('ignores blank and separator-less lines', () => {
    expect(parseHeaderLines('\n\nAccept: x\ngarbage\n: y')).toEqual({ Accept: 'x' });
  });
});

describe('presentation', () => {
  it('formats without trailing zero noise', () => {
    expect(formatBalance(12.3456, '美元💵', 2)).toBe('12.35 美元💵');
    expect(formatBalance(12, '美元💵', 2)).toBe('12 美元💵');
    expect(formatBalance(12.5, '', 2)).toBe('12.5');
  });

  it('keeps the toolbar badge within four glyphs', () => {
    for (const value of [0.123, 9.87, 42.4, 1234, 98765]) {
      expect(formatBalanceBadge(value).length).toBeLessThanOrEqual(4);
    }
    expect(formatBalanceBadge(1234)).toBe('1k');
  });

  it('prefers a percentage on the badge, because four digits do not fit', () => {
    expect(formatBalanceBadge(1234.56, 61.6)).toBe('62%');
    expect(formatBalanceBadge(1234.56, 100)).toBe('100%');
    expect(formatBalanceBadge(1234.56, 100).length).toBeLessThanOrEqual(4);
    // No known total: fall back to the abbreviated amount.
    expect(formatBalanceBadge(1234.56, null)).toBe('1k');
  });

  it('flags a low balance only when a threshold is set', () => {
    expect(isBalanceLow(3, 5)).toBe(true);
    expect(isBalanceLow(9, 5)).toBe(false);
    expect(isBalanceLow(3, null)).toBe(false);
    expect(isBalanceLow(null, 5)).toBe(false);
  });

  it('describes staleness in the panel', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(formatRelativeTime(0, now)).toBe('还没有更新');
    expect(formatRelativeTime(now - 5_000, now)).toBe('刚刚更新');
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe('3 分钟前更新');
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe('2 小时前更新');
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe('3 天前更新');
  });

  it('masks the key so the panel never shows a reusable secret', () => {
    // Fixtures are made up on purpose: this repo is public, so a real key in a
    // test is a published key.
    expect(maskSecret('sk-EXAMPLE0000000000key')).toBe('sk-EXA••••0key');
    expect(maskSecret('short')).toBe('sh••••');
    expect(maskSecret('   ')).toBe('');
  });
});

describe('isBalanceStale', () => {
  const now = 1_000 * 60 * 60;
  it('treats a never-fetched cache as stale', () => {
    expect(isBalanceStale(null, 30, now)).toBe(true);
  });

  it('refreshes only once the interval has elapsed', () => {
    const cache = {
      value: 1,
      total: null,
      percent: null,
      unit: '',
      fetchedAt: now - 10 * 60_000,
      error: '',
      erroredAt: 0,
    };
    expect(isBalanceStale(cache, 30, now)).toBe(false);
    expect(isBalanceStale(cache, 5, now)).toBe(true);
  });
});

describe('formatBalanceValue', () => {
  it('strips only the zeros after a decimal point', () => {
    // `100` must not be shortened to `1`.
    expect(formatBalanceValue(100, 2)).toBe('100');
    expect(formatBalanceValue(12.5, 2)).toBe('12.5');
    expect(formatBalanceValue(12.004, 2)).toBe('12');
    expect(formatBalanceValue(0, 2)).toBe('0');
  });
});

describe('describeAiBalanceForPage', () => {
  const cache = {
    value: 12.3456,
    total: 13.5456,
    percent: 91.1,
    unit: '美元💵',
    fetchedAt: 1,
    error: '',
    erroredAt: 0,
  };

  it('sends nothing while the page display is off', () => {
    expect(describeAiBalanceForPage(config({ showInPage: false }), cache)).toEqual({
      text: '',
      low: false,
    });
  });

  it('sends nothing when no fetch has ever succeeded', () => {
    const failed = { ...cache, value: null, percent: null, error: '无效的令牌', fetchedAt: 0 };
    expect(describeAiBalanceForPage(config({ showInPage: true }), failed).text).toBe('');
  });

  it('formats the value once, in the extension', () => {
    // The page gets a string, never the number plus the formatting rules — and
    // never the URL or the key.
    expect(describeAiBalanceForPage(config({ showInPage: true }), cache)).toEqual({
      text: '12.35 美元💵',
      low: false,
    });
  });

  it('flags a low balance so the pill can warn', () => {
    expect(
      describeAiBalanceForPage(config({ showInPage: true, lowThreshold: 20 }), cache).low,
    ).toBe(true);
  });

  it('falls back to the config unit when the cache predates it', () => {
    expect(
      describeAiBalanceForPage(config({ showInPage: true, unit: '元' }), { ...cache, unit: '' })
        .text,
    ).toBe('12.35 元');
  });
});

describe('percentage', () => {
  it('derives the total from remaining + used when the API reports no total', () => {
    const extracted = extractBalance(GATEWAY_OK, 'data.remain_quota_usd');
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.total).toBeCloseTo(13.5456, 4);
    expect(extracted.percent).toBeCloseTo(91.14, 1);
  });

  it('prefers an explicit total path over the candidates', () => {
    const response = { data: { remain_quota_usd: 5, used_quota_usd: 5, plan_total: 20 } };
    const extracted = extractBalance(response, 'data.remain_quota_usd', 1, 'data.plan_total');
    expect(extracted.ok && extracted.percent).toBe(25);
  });

  it('reports no percentage rather than a made-up one', () => {
    const extracted = extractBalance(GATEWAY_NO_TOTAL, 'data.remain_quota_usd');
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.total).toBeNull();
    expect(extracted.percent).toBeNull();
  });

  it('applies the multiplier to the total as well, keeping the ratio honest', () => {
    // Cent-denominated gateway: 1234 remaining of 2000 granted.
    const extracted = extractBalance(
      { remain: 1234, total_quota: 2000 },
      'remain',
      0.01,
      'total_quota',
    );
    expect(extracted.ok && extracted.value).toBeCloseTo(12.34, 4);
    expect(extracted.ok && extracted.percent).toBeCloseTo(61.7, 4);
  });

  it('counts a fresh key with zero usage as 100%', () => {
    const extracted = extractBalance(
      { data: { remain_quota_usd: 20, used_quota_usd: 0 } },
      'data.remain_quota_usd',
    );
    expect(extracted.ok && extracted.percent).toBe(100);
  });

  it('clamps a stale total instead of showing 120%', () => {
    expect(toPercent(12, 10)).toBe(100);
    expect(toPercent(-1, 10)).toBe(0);
    expect(toPercent(5, 0)).toBeNull();
    expect(toPercent(5, null)).toBeNull();
  });

  it('formats the panel percentage', () => {
    expect(formatPercent(61.6)).toBe('剩余 62%');
    expect(formatPercent(null)).toBe('');
  });
});

describe('feature switch', () => {
  it('defaults a fresh config to on, with the percentage badge on', () => {
    expect(DEFAULT_AI_BALANCE_CONFIG.enabled).toBe(true);
    expect(DEFAULT_AI_BALANCE_CONFIG.badgePercent).toBe(true);
  });

  it('treats a config stored before the switch existed as on', () => {
    // Upgrading must not silently stop polling for someone who already set this
    // up, so absence means enabled — same rule as the other feature toggles.
    const stored = validateAiBalanceConfig(config());
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const legacy = { ...stored.config } as Record<string, unknown>;
    delete legacy.enabled;
    delete legacy.badgePercent;
    expect(parseStoredAiBalanceConfig(legacy)).toMatchObject({
      enabled: true,
      badgePercent: true,
    });
  });

  it('keeps the endpoint but stops feeding the page when switched off', () => {
    const cache = {
      value: 12.3456,
      total: 20,
      percent: 61.7,
      unit: '美元💵',
      fetchedAt: 1,
      error: '',
      erroredAt: 0,
    };
    // showInPage is still on: the feature switch has to win over it.
    expect(
      describeAiBalanceForPage(config({ enabled: false, showInPage: true }), cache),
    ).toEqual({ text: '', low: false });
  });

  it('round-trips an explicitly disabled config', () => {
    const parsed = parseStoredAiBalanceConfig({
      ...config(),
      enabled: false,
      badgePercent: false,
    });
    expect(parsed).toMatchObject({ enabled: false, badgePercent: false });
  });
});
