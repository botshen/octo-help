import { browser, defineBackground } from '#imports';
import {
  AI_BALANCE_CACHE_STORAGE_KEY,
  AI_BALANCE_CONFIG_STORAGE_KEY,
  AI_BALANCE_PAGE_STORAGE_KEY,
  MASTER_STORAGE_KEY,
  RUNTIME_MESSAGE_TYPE,
  type AiBalanceCache,
  type AiBalanceConfig,
  type AiBalanceProbeResult,
  type RuntimeRequest,
} from '@/utils/octoRecall';
import {
  BALANCE_FETCH_TIMEOUT_MS,
  BALANCE_MAX_RESPONSE_BYTES,
  describeAiBalanceForPage,
  extractBalance,
  formatBalance,
  formatBalanceBadge,
  formatPercent,
  isBalanceLow,
  isBalanceStale,
  parseStoredAiBalanceCache,
  parseStoredAiBalanceConfig,
} from '@/utils/octoAiBalance';

const BALANCE_ALARM = 'octo-ai-balance-refresh';

export default defineBackground(() => {
  // Clicking the extension action opens the global Chrome side panel.
  if (browser.sidePanel?.setPanelBehavior) {
    void browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.warn('Unable to enable side panel action click', error));
  }

  /**
   * AI balance polling.
   *
   * This lives in the background rather than the Side Panel or the content
   * script for three reasons, in order of importance:
   *
   * 1. The API key must never enter the Octo tab. The MAIN-world script shares a
   *    realm with the page, so anything sent there is readable by Octo's own
   *    scripts; only the formatted number is relayed to the page.
   * 2. The panel is closed most of the time, and an alarm keeps the cached value
   *    fresh (and the toolbar badge meaningful) without it.
   * 3. Cross-origin fetches happen here, against the one URL the user configured,
   *    rather than from a page subject to CORS.
   */

  /**
   * The config only when the balance should actually be polled.
   *
   * Two switches gate it, and both mean "stop the side effects, keep the
   * configuration":
   *
   * - the feature's own switch, so turning it back on is one click and not a
   *   re-setup;
   * - the master switch, because it promises the extension looks uninstalled —
   *   a badge still counting down on the toolbar icon would break that promise
   *   just as much as leftover styles on the page.
   *
   * Every side effect goes through here, so "off" is enforced in one place.
   */
  async function readActiveConfig(): Promise<AiBalanceConfig | null> {
    const stored = await browser.storage.local.get([
      AI_BALANCE_CONFIG_STORAGE_KEY,
      MASTER_STORAGE_KEY,
    ]);
    // Missing master key means enabled, matching every other reader.
    if (stored[MASTER_STORAGE_KEY] === false) return null;
    const config = parseStoredAiBalanceConfig(stored[AI_BALANCE_CONFIG_STORAGE_KEY]);
    return config?.enabled ? config : null;
  }

  async function readCache(): Promise<AiBalanceCache | null> {
    const stored = await browser.storage.local.get(AI_BALANCE_CACHE_STORAGE_KEY);
    return parseStoredAiBalanceCache(stored[AI_BALANCE_CACHE_STORAGE_KEY]);
  }

  /**
   * One fetch attempt. Never throws: every failure mode becomes a message the
   * panel can show, because "the balance is stale and we don't know why" is the
   * worst possible outcome for this feature.
   */
  async function probeBalance(config: AiBalanceConfig): Promise<AiBalanceProbeResult> {
    const fetchedAt = Date.now();
    const fail = (error: string): AiBalanceProbeResult => ({
      ok: false,
      value: null,
      total: null,
      percent: null,
      unit: config.unit,
      error,
      fetchedAt,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BALANCE_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
      });
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      return fail(aborted ? '请求超时（8 秒）' : '请求失败，请检查地址或网络');
    } finally {
      clearTimeout(timeout);
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      return fail('读取响应失败');
    }
    // A balance endpoint answers with a small JSON object. Anything huge is a
    // login page or a misconfigured URL, and parsing it wastes the worker.
    if (text.length > BALANCE_MAX_RESPONSE_BYTES) {
      return fail('响应过大，可能填错了地址');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail(
        response.ok
          ? '响应不是 JSON，可能填错了地址'
          : `接口返回 HTTP ${response.status}`,
      );
    }

    const extracted = extractBalance(parsed, config.path, config.multiplier, config.totalPath);
    if (!extracted.ok) {
      // An HTTP error code is worth naming, but the API's own message (which
      // extractBalance prefers) is usually the actionable part.
      return fail(response.ok ? extracted.error : `HTTP ${response.status}：${extracted.error}`);
    }
    return {
      ok: true,
      value: extracted.value,
      total: extracted.total,
      percent: extracted.percent,
      unit: config.unit,
      error: '',
      fetchedAt,
    };
  }

  /**
   * Publish what the Octo page may see.
   *
   * Written here rather than derived in the content script so the
   * always-injected script never reads the config key that holds the API key
   * (and needs no formatting code of its own).
   */
  async function publishPageState(
    config: AiBalanceConfig | null,
    cache: AiBalanceCache | null,
  ): Promise<void> {
    const state = describeAiBalanceForPage(config, cache);
    if (!state.text) {
      await browser.storage.local.remove(AI_BALANCE_PAGE_STORAGE_KEY);
      return;
    }
    await browser.storage.local.set({ [AI_BALANCE_PAGE_STORAGE_KEY]: state });
  }

  async function updateBadge(
    config: AiBalanceConfig | null,
    cache: AiBalanceCache | null,
  ): Promise<void> {
    if (!browser.action?.setBadgeText) return;
    const value = cache?.value ?? null;
    if (!config || value == null) {
      await browser.action.setBadgeText({ text: '' }).catch(() => {});
      return;
    }
    const low = isBalanceLow(value, config.lowThreshold);
    // Percentage when the user wants it and we know a total: `1234.56` cannot be
    // shown in four glyphs, `62%` can. The exact figure goes in the tooltip.
    const badgePercent = config.badgePercent ? (cache?.percent ?? null) : null;
    await browser.action
      .setBadgeText({ text: formatBalanceBadge(value, badgePercent) })
      .catch(() => {});
    await browser.action
      .setBadgeBackgroundColor({ color: low ? '#e5484d' : '#6f5ee8' })
      .catch(() => {});
    // The badge is four glyphs at best, so the unit and the warning live in the
    // tooltip instead of being truncated into meaninglessness.
    const percentSuffix = cache?.percent == null ? '' : ` · ${formatPercent(cache.percent)}`;
    await browser.action
      .setTitle({
        title: `AI 余额 ${formatBalance(value, config.unit, config.decimals)}${percentSuffix}${
          low ? '（偏低）' : ''
        }`,
      })
      .catch(() => {});
  }

  /** Fetch, persist and reflect the result. Returns what happened for the caller. */
  async function refreshBalance(): Promise<AiBalanceProbeResult | null> {
    const config = await readActiveConfig();
    if (!config) {
      await browser.storage.local.remove([
        AI_BALANCE_CACHE_STORAGE_KEY,
        AI_BALANCE_PAGE_STORAGE_KEY,
      ]);
      await updateBadge(null, null);
      return null;
    }
    const result = await probeBalance(config);
    const previous = await readCache();
    // A failed refresh keeps the last known value: a transient network blip
    // should not blank out a number the user still wants to see.
    const next: AiBalanceCache = result.ok
      ? {
          value: result.value,
          total: result.total,
          percent: result.percent,
          unit: result.unit,
          fetchedAt: result.fetchedAt,
          error: '',
          erroredAt: 0,
        }
      : {
          value: previous?.value ?? null,
          total: previous?.total ?? null,
          percent: previous?.percent ?? null,
          unit: previous?.unit ?? config.unit,
          fetchedAt: previous?.fetchedAt ?? 0,
          error: result.error,
          erroredAt: result.fetchedAt,
        };
    await browser.storage.local.set({ [AI_BALANCE_CACHE_STORAGE_KEY]: next });
    await updateBadge(config, next);
    await publishPageState(config, next);
    return result;
  }

  async function rescheduleAlarm(): Promise<void> {
    if (!browser.alarms) return;
    const config = await readActiveConfig();
    await browser.alarms.clear(BALANCE_ALARM).catch(() => {});
    if (!config) {
      await updateBadge(null, null);
      await publishPageState(null, null);
      return;
    }
    browser.alarms.create(BALANCE_ALARM, {
      periodInMinutes: config.refreshMinutes,
      // Not `when: now`: saving the form already triggers an explicit refresh,
      // and firing again immediately would double every save into two requests.
      delayInMinutes: config.refreshMinutes,
    });
  }

  /** Refresh on boot only when the cached value has already aged out. */
  async function refreshIfStale(): Promise<void> {
    const config = await readActiveConfig();
    if (!config) return;
    const cache = await readCache();
    await updateBadge(config, cache);
    // The 「在页面显示」 toggle only rewrites the config, so republish here too:
    // otherwise flipping it on would show nothing until the next fetch.
    await publishPageState(config, cache);
    if (isBalanceStale(cache, config.refreshMinutes)) await refreshBalance();
  }

  browser.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === BALANCE_ALARM) void refreshBalance();
  });

  browser.runtime.onInstalled.addListener(() => {
    void rescheduleAlarm();
    void refreshIfStale();
  });
  browser.runtime.onStartup?.addListener(() => {
    void rescheduleAlarm();
    void refreshIfStale();
  });

  // The Side Panel owns the config; the alarm interval and the badge have to
  // follow it without the panel having to remember to ask.
  browser.storage.local.onChanged.addListener((changes) => {
    // The master switch matters here too: pausing must clear the badge and the
    // alarm, resuming must bring both back.
    if (AI_BALANCE_CONFIG_STORAGE_KEY in changes || MASTER_STORAGE_KEY in changes) {
      void rescheduleAlarm();
      void refreshIfStale();
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const request = message as RuntimeRequest | undefined;
    if (!request || typeof request !== 'object') return false;

    if (request.type === RUNTIME_MESSAGE_TYPE.aiBalanceRefresh) {
      void refreshBalance().then((result) => sendResponse(result));
      return true; // async response
    }

    if (request.type === RUNTIME_MESSAGE_TYPE.aiBalanceTest) {
      // Test never touches storage: trying a new key must not overwrite a
      // working configuration or its cached value.
      const config = parseStoredAiBalanceConfig(request.config);
      if (!config) {
        sendResponse({
          ok: false,
          value: null,
          total: null,
          percent: null,
          unit: '',
          error: '配置不完整，请检查地址和取值路径',
          fetchedAt: Date.now(),
        } satisfies AiBalanceProbeResult);
        return true;
      }
      void probeBalance(config).then((result) => sendResponse(result));
      return true;
    }

    return false;
  });

  // Service workers are restarted on demand; treat every wake-up as a chance to
  // re-arm the alarm, since a cleared alarm would silently stop the feature.
  void rescheduleAlarm();
  void refreshIfStale();
});
