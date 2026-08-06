import { browser } from '#imports';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AI_BALANCE_CACHE_STORAGE_KEY,
  AI_BALANCE_CONFIG_STORAGE_KEY,
  AI_BALANCE_PAGE_STORAGE_KEY,
  RUNTIME_MESSAGE_TYPE,
  type AiBalanceCache,
  type AiBalanceConfig,
  type AiBalanceProbeResult,
} from '@/utils/octoRecall';
import {
  AI_BALANCE_PRESETS,
  CUSTOM_PRESET_ID,
  DEFAULT_AI_BALANCE_CONFIG,
  MIN_REFRESH_MINUTES,
  applyPreset,
  baseUrlOf,
  findAiBalancePreset,
  formatBalance,
  formatPercent,
  formatRelativeTime,
  isBalanceLow,
  parseCurlCommand,
  parseHeaderLines,
  parseStoredAiBalanceCache,
  parseStoredAiBalanceConfig,
  stringifyHeaders,
  validateAiBalanceConfig,
  type ConfigProblem,
} from '@/utils/octoAiBalance';
import { FeatureSection } from './FeatureSection';

const REFRESH_CHOICES = [5, 15, 30, 60, 180, 720] as const;

async function sendRuntime<T>(message: unknown): Promise<T | null> {
  try {
    return (await browser.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}

/**
 * Shared read side of the balance feature.
 *
 * Both the top banner and the settings card need the same two storage keys and
 * the same refresh round trip, and the background is the only writer — so they
 * subscribe to storage rather than passing state through App.
 */
export function useAiBalance() {
  const [config, setConfig] = useState<AiBalanceConfig | null>(null);
  const [cache, setCache] = useState<AiBalanceCache | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    void browser.storage.local
      .get([AI_BALANCE_CONFIG_STORAGE_KEY, AI_BALANCE_CACHE_STORAGE_KEY])
      .then((stored) => {
        if (!mounted) return;
        setConfig(parseStoredAiBalanceConfig(stored[AI_BALANCE_CONFIG_STORAGE_KEY]));
        setCache(parseStoredAiBalanceCache(stored[AI_BALANCE_CACHE_STORAGE_KEY]));
        setLoaded(true);
      });
    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      if (AI_BALANCE_CACHE_STORAGE_KEY in changes) {
        setCache(parseStoredAiBalanceCache(changes[AI_BALANCE_CACHE_STORAGE_KEY].newValue));
        setNow(Date.now());
      }
      if (AI_BALANCE_CONFIG_STORAGE_KEY in changes) {
        setConfig(parseStoredAiBalanceConfig(changes[AI_BALANCE_CONFIG_STORAGE_KEY].newValue));
      }
    };
    browser.storage.local.onChanged.addListener(onChanged);
    // Keep "3 分钟前更新" honest while the panel stays open.
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      mounted = false;
      browser.storage.local.onChanged.removeListener(onChanged);
      window.clearInterval(timer);
    };
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      return await sendRuntime<AiBalanceProbeResult | null>({
        type: RUNTIME_MESSAGE_TYPE.aiBalanceRefresh,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const text = useMemo(() => {
    if (!config || cache?.value == null) return '';
    return formatBalance(cache.value, cache.unit || config.unit, config.decimals);
  }, [cache, config]);

  return {
    config,
    cache,
    loaded,
    busy,
    now,
    refresh,
    text,
    percent: cache?.percent ?? null,
    low: isBalanceLow(cache?.value ?? null, config?.lowThreshold ?? null),
  };
}

/**
 * Balance strip pinned to the top of the panel.
 *
 * The number is why this feature exists, so it sits above the settings rather
 * than inside one of the cards. Renders nothing until a config exists, so users
 * who never set it up see no dead space.
 */
export function AiBalanceBanner() {
  const { config, cache, text, percent, low, busy, now, refresh } = useAiBalance();
  if (!config?.enabled) return null;

  return (
    <section className={`balance-banner${low ? ' is-low' : ''}`} aria-label="AI 余额">
      <span className="balance-banner-icon" aria-hidden="true">💰</span>
      <div className="balance-banner-copy">
        <strong>{text || '—'}</strong>
        <small>
          {cache?.error
            ? `更新失败：${cache.error}`
            : [formatPercent(percent), formatRelativeTime(cache?.fetchedAt ?? 0, now)]
                .filter(Boolean)
                .join(' · ')}
        </small>
        {percent != null && (
          <span className="balance-meter" aria-hidden="true">
            <span style={{ width: `${Math.max(2, Math.round(percent))}%` }} />
          </span>
        )}
      </div>
      <button
        type="button"
        className="balance-refresh"
        aria-label="刷新余额"
        disabled={busy}
        onClick={() => void refresh()}
      >
        {busy ? '…' : '↻'}
      </button>
    </section>
  );
}

/** Editable mirror of AiBalanceConfig: numbers stay strings while being typed. */
interface FormState {
  enabled: boolean;
  presetId: string;
  /** Where the user's own gateway lives. Presets ship a path, never a host. */
  baseUrl: string;
  apiKey: string;
  url: string;
  method: 'GET' | 'POST';
  headersText: string;
  path: string;
  totalPath: string;
  unit: string;
  multiplier: string;
  decimals: string;
  refreshMinutes: number;
  badgePercent: boolean;
  lowThreshold: string;
  showInPage: boolean;
}

function emptyForm(): FormState {
  const preset = AI_BALANCE_PRESETS[0];
  return {
    enabled: true,
    presetId: preset.id,
    baseUrl: '',
    apiKey: '',
    url: '',
    method: preset.method,
    headersText: stringifyHeaders(preset.headers),
    path: preset.path,
    totalPath: preset.totalPath,
    unit: preset.unit,
    multiplier: '1',
    decimals: '2',
    refreshMinutes: DEFAULT_AI_BALANCE_CONFIG.refreshMinutes,
    badgePercent: true,
    lowThreshold: '',
    showInPage: false,
  };
}

function formFromConfig(config: AiBalanceConfig): FormState {
  return {
    enabled: config.enabled,
    presetId: config.presetId,
    baseUrl: baseUrlOf(config.url),
    // The key is not recoverable from a saved config (it is embedded in the URL
    // or a header), and re-deriving it would mean guessing. Editing shows the
    // real fields instead of pretending to know the secret.
    apiKey: '',
    url: config.url,
    method: config.method,
    headersText: stringifyHeaders(config.headers),
    path: config.path,
    totalPath: config.totalPath,
    unit: config.unit,
    multiplier: String(config.multiplier),
    decimals: String(config.decimals),
    refreshMinutes: config.refreshMinutes,
    badgePercent: config.badgePercent,
    lowThreshold: config.lowThreshold == null ? '' : String(config.lowThreshold),
    showInPage: config.showInPage,
  };
}

/** Turn the form into the shape the validator accepts. */
function draftFromForm(form: FormState): AiBalanceConfig {
  const preset = findAiBalancePreset(form.presetId);
  const usingPreset = preset != null && form.apiKey.trim() !== '' && form.baseUrl.trim() !== '';
  const filled = usingPreset ? applyPreset(preset, form.baseUrl, form.apiKey) : null;
  return {
    enabled: form.enabled,
    presetId: form.presetId,
    url: filled ? filled.url : form.url,
    method: form.method,
    headers: filled
      ? { ...parseHeaderLines(form.headersText), ...filled.headers }
      : parseHeaderLines(form.headersText),
    path: form.path,
    totalPath: form.totalPath,
    unit: form.unit,
    multiplier: Number(form.multiplier || '1'),
    decimals: Number(form.decimals || '2'),
    refreshMinutes: form.refreshMinutes,
    badgePercent: form.badgePercent,
    lowThreshold: form.lowThreshold.trim() === '' ? null : Number(form.lowThreshold),
    showInPage: form.showInPage,
  };
}

function failedProbe(error: string): AiBalanceProbeResult {
  return { ok: false, value: null, total: null, percent: null, unit: '', error, fetchedAt: Date.now() };
}

/**
 * The 「AI 余额」 settings card.
 *
 * Self-contained on purpose: it owns its storage keys and its background round
 * trips, so App.tsx grows by one line instead of a dozen pieces of state.
 */
export function AiBalanceCard({
  disabled,
  open,
  onToggleOpen,
}: {
  disabled: boolean;
  open: boolean;
  onToggleOpen: () => void;
}) {
  const { config, cache, loaded, percent, text, low } = useAiBalance();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<ConfigProblem[]>([]);
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState<AiBalanceProbeResult | null>(null);
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const patch = useCallback(
    (changes: Partial<FormState>) => setForm((previous) => ({ ...previous, ...changes })),
    [],
  );

  // Fill the form once storage has been read; an unconfigured panel opens
  // straight into the form so the feature is not hidden behind a button.
  useEffect(() => {
    if (!loaded || hydrated) return;
    setHydrated(true);
    if (config) setForm(formFromConfig(config));
    else setEditing(true);
  }, [config, hydrated, loaded]);

  const preset = findAiBalancePreset(form.presetId);
  const problemFor = (field: ConfigProblem['field']) =>
    problems.find((problem) => problem.field === field)?.message ?? '';

  const runTest = async () => {
    setNotice('');
    setTestResult(null);
    const validated = validateAiBalanceConfig(draftFromForm(form));
    if (!validated.ok) {
      setProblems(validated.problems);
      return;
    }
    setProblems([]);
    setBusy(true);
    try {
      const result = await sendRuntime<AiBalanceProbeResult>({
        type: RUNTIME_MESSAGE_TYPE.aiBalanceTest,
        config: validated.config,
      });
      setTestResult(result ?? failedProbe('后台无响应，请重新打开浏览器标签'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setNotice('');
    const validated = validateAiBalanceConfig(draftFromForm(form));
    if (!validated.ok) {
      setProblems(validated.problems);
      return;
    }
    setProblems([]);
    setBusy(true);
    try {
      await browser.storage.local.set({ [AI_BALANCE_CONFIG_STORAGE_KEY]: validated.config });
      setEditing(false);
      setTestResult(null);
      // Saving is the moment the user expects a number, so refresh immediately
      // instead of waiting for the first alarm.
      await sendRuntime({ type: RUNTIME_MESSAGE_TYPE.aiBalanceRefresh });
    } catch {
      setNotice('保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await browser.storage.local.remove([
        AI_BALANCE_CONFIG_STORAGE_KEY,
        AI_BALANCE_CACHE_STORAGE_KEY,
        AI_BALANCE_PAGE_STORAGE_KEY,
      ]);
      setForm(emptyForm());
      setEditing(true);
      setTestResult(null);
    } finally {
      setBusy(false);
    }
  };

  const importCurl = () => {
    const parsed = parseCurlCommand(curlText);
    if (!parsed) {
      setNotice('没能从这段 curl 里找到 https 地址');
      return;
    }
    patch({
      presetId: CUSTOM_PRESET_ID,
      url: parsed.url,
      method: parsed.method,
      headersText: stringifyHeaders(parsed.headers),
    });
    setAdvanced(true);
    setCurlOpen(false);
    setCurlText('');
    setNotice('已从 curl 填入，请确认取值路径');
  };

  /** Feature switch: keeps the config (and the key), stops polling/badge/pill. */
  const toggleEnabled = async () => {
    const next = !(config?.enabled ?? form.enabled);
    patch({ enabled: next });
    if (!config) return;
    await browser.storage.local.set({
      [AI_BALANCE_CONFIG_STORAGE_KEY]: { ...config, enabled: next },
    });
    if (next) await sendRuntime({ type: RUNTIME_MESSAGE_TYPE.aiBalanceRefresh });
  };

  const toggleBadgePercent = async () => {
    const next = !form.badgePercent;
    patch({ badgePercent: next });
    if (!config) return;
    await browser.storage.local.set({
      [AI_BALANCE_CONFIG_STORAGE_KEY]: { ...config, badgePercent: next },
    });
  };

  const toggleShowInPage = async () => {
    const next = !form.showInPage;
    patch({ showInPage: next });
    if (!config) return;
    await browser.storage.local.set({
      [AI_BALANCE_CONFIG_STORAGE_KEY]: { ...config, showInPage: next },
    });
  };

  const choosePreset = (id: string) => {
    const nextPreset = findAiBalancePreset(id);
    if (!nextPreset) {
      patch({ presetId: CUSTOM_PRESET_ID });
      setAdvanced(true);
      return;
    }
    patch({
      presetId: id,
      method: nextPreset.method,
      headersText: stringifyHeaders(nextPreset.headers),
      path: nextPreset.path,
      totalPath: nextPreset.totalPath,
      unit: nextPreset.unit,
    });
  };

  const summary = !config
    ? '还没有配置，展开填网关地址和 API Key'
    : !config.enabled
      ? '已关闭'
      : cache?.error
        ? `更新失败：${cache.error}`
        : [text || '还没有查到余额', formatPercent(percent)].filter(Boolean).join(' · ');

  return (
    <FeatureSection
      icon="💰"
      iconClass="is-balance"
      title="AI 余额"
      summary={summary}
      enabled={config ? config.enabled : undefined}
      onToggleEnabled={config ? toggleEnabled : undefined}
      open={open}
      onToggleOpen={onToggleOpen}
      disabled={disabled || busy}
    >
      {config && !editing && (
        <div className="config-row">
          <div className="config-copy">
            <span>当前额度</span>
            <small>
              {cache?.error
                ? `更新失败：${cache.error}`
                : [text || '还没有查到余额', formatPercent(percent)].filter(Boolean).join(' · ')}
            </small>
          </div>
          <span className={`balance-chip${low ? ' is-low' : ''}`}>
            {percent == null ? text || '—' : `${Math.round(percent)}%`}
          </span>
        </div>
      )}

      {config && !editing && (
        <div className="config-row">
          <div className="config-copy">
            <span>图标显示剩余百分比</span>
            <small>
              {percent == null
                ? '关闭则显示缩写金额；当前接口没有总额，暂时算不出百分比'
                : '角标只放得下 4 个字，关闭则显示缩写金额'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="图标显示剩余百分比"
            aria-checked={form.badgePercent}
            className={`switch${form.badgePercent ? ' switch-on' : ''}`}
            disabled={disabled || busy}
            onClick={toggleBadgePercent}
          >
            <span className="switch-knob" />
          </button>
        </div>
      )}

      {config && !editing && (
        <div className="config-row">
          <div className="config-copy">
            <span>在 Octo 页面显示</span>
            <small>输入框右上角显示余额，只发送格式化后的文字</small>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="在 Octo 页面显示余额"
            aria-checked={form.showInPage}
            className={`switch${form.showInPage ? ' switch-on' : ''}`}
            disabled={disabled || busy}
            onClick={toggleShowInPage}
          >
            <span className="switch-knob" />
          </button>
        </div>
      )}

      {editing && (
        <div className="balance-form">
          <label className="balance-field">
            <span>服务商</span>
            <div className="select-wrap">
              <select
                value={preset ? form.presetId : CUSTOM_PRESET_ID}
                disabled={disabled || busy}
                onChange={(event) => choosePreset(event.currentTarget.value)}
              >
                {AI_BALANCE_PRESETS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
                <option value={CUSTOM_PRESET_ID}>自定义接口</option>
              </select>
            </div>
          </label>

          {preset && (
            <label className="balance-field">
              <span>网关地址</span>
              <input
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={preset.baseHint}
                value={form.baseUrl}
                disabled={disabled || busy}
                onChange={(event) => patch({ baseUrl: event.currentTarget.value })}
              />
              {problemFor('url') && <small className="balance-problem">{problemFor('url')}</small>}
            </label>
          )}

          {preset && (
            <label className="balance-field">
              <span>API Key</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={preset.keyHint}
                value={form.apiKey}
                disabled={disabled || busy}
                onChange={(event) => patch({ apiKey: event.currentTarget.value })}
              />
            </label>
          )}

          <div className="balance-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={disabled || busy}
              onClick={runTest}
            >
              {busy ? '请求中…' : '测试'}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={disabled || busy}
              onClick={save}
            >
              保存
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setCurlOpen((open) => !open)}
            >
              从 curl 粘贴
            </button>
            {config && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setProblems([]);
                  setTestResult(null);
                }}
              >
                取消
              </button>
            )}
          </div>

          {curlOpen && (
            <label className="balance-field">
              <span>粘贴 curl 命令</span>
              <textarea
                rows={3}
                spellCheck={false}
                placeholder="curl 'https://…' -H 'Authorization: Bearer …'"
                value={curlText}
                onChange={(event) => setCurlText(event.currentTarget.value)}
              />
              <button type="button" className="secondary-button" onClick={importCurl}>
                解析并填入
              </button>
            </label>
          )}

          <button
            type="button"
            className="text-button balance-disclosure"
            aria-expanded={advanced}
            onClick={() => setAdvanced((open) => !open)}
          >
            {advanced ? '收起高级设置' : '展开高级设置'}
          </button>

          {advanced && (
            <div className="balance-advanced">
              <label className="balance-field">
                <span>请求地址</span>
                <input
                  type="url"
                  spellCheck={false}
                  placeholder="https://…"
                  value={form.url}
                  disabled={disabled || busy}
                  onChange={(event) => patch({ url: event.currentTarget.value, presetId: CUSTOM_PRESET_ID })}
                />
                {problemFor('url') && <small className="balance-problem">{problemFor('url')}</small>}
              </label>
              <div className="balance-field-row">
                <label className="balance-field">
                  <span>方法</span>
                  <div className="select-wrap">
                    <select
                      value={form.method}
                      disabled={disabled || busy}
                      onChange={(event) =>
                        patch({ method: event.currentTarget.value === 'POST' ? 'POST' : 'GET' })
                      }
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>
                </label>
                <label className="balance-field">
                  <span>刷新间隔</span>
                  <div className="select-wrap">
                    <select
                      value={form.refreshMinutes}
                      disabled={disabled || busy}
                      onChange={(event) => patch({ refreshMinutes: Number(event.currentTarget.value) })}
                    >
                      {REFRESH_CHOICES.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>
              </div>
              <label className="balance-field">
                <span>请求头（每行 名称: 值）</span>
                <textarea
                  rows={2}
                  spellCheck={false}
                  placeholder="Authorization: Bearer …"
                  value={form.headersText}
                  disabled={disabled || busy}
                  onChange={(event) => patch({ headersText: event.currentTarget.value })}
                />
                {problemFor('headers') && (
                  <small className="balance-problem">{problemFor('headers')}</small>
                )}
              </label>
              <label className="balance-field">
                <span>取值路径</span>
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="data.remain_quota_usd"
                  value={form.path}
                  disabled={disabled || busy}
                  onChange={(event) => patch({ path: event.currentTarget.value })}
                />
                {problemFor('path') && <small className="balance-problem">{problemFor('path')}</small>}
              </label>
              <label className="balance-field">
                <span>总额路径（留空自动识别，用于算百分比）</span>
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="data.total_quota_usd"
                  value={form.totalPath}
                  disabled={disabled || busy}
                  onChange={(event) => patch({ totalPath: event.currentTarget.value })}
                />
                {problemFor('totalPath') && (
                  <small className="balance-problem">{problemFor('totalPath')}</small>
                )}
              </label>
              <div className="balance-field-row">
                <label className="balance-field">
                  <span>单位</span>
                  <input
                    type="text"
                    value={form.unit}
                    disabled={disabled || busy}
                    onChange={(event) => patch({ unit: event.currentTarget.value })}
                  />
                </label>
                <label className="balance-field">
                  <span>倍率</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.multiplier}
                    disabled={disabled || busy}
                    onChange={(event) => patch({ multiplier: event.currentTarget.value })}
                  />
                  {problemFor('multiplier') && (
                    <small className="balance-problem">{problemFor('multiplier')}</small>
                  )}
                </label>
                <label className="balance-field">
                  <span>小数位</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.decimals}
                    disabled={disabled || busy}
                    onChange={(event) => patch({ decimals: event.currentTarget.value })}
                  />
                </label>
              </div>
              <label className="balance-field">
                <span>低余额提醒阈值（按金额，留空关闭）</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="例如 5"
                  value={form.lowThreshold}
                  disabled={disabled || busy}
                  onChange={(event) => patch({ lowThreshold: event.currentTarget.value })}
                />
              </label>
              <p className="balance-hint">
                不支持粘贴 JS 取值函数：扩展页面不允许执行动态代码，取值改用上面的路径。
                扩展图标上显示的是剩余百分比（余额位数太多，角标放不下）。
              </p>
            </div>
          )}
        </div>
      )}

      {testResult && (
        <p className={`balance-test${testResult.ok ? ' is-ok' : ' is-error'}`} role="status">
          {testResult.ok && testResult.value != null
            ? `测试成功：${formatBalance(testResult.value, form.unit, Number(form.decimals || '2'))}${
                testResult.percent == null ? '' : ` · ${formatPercent(testResult.percent)}`
              }`
            : `测试失败：${testResult.error}`}
        </p>
      )}
      {notice && <p className="balance-problem is-block" role="alert">{notice}</p>}

      <div className="balance-footer">
        {config && !editing && (
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || busy}
            onClick={() => {
              setEditing(true);
              setForm(formFromConfig(config));
            }}
          >
            修改配置
          </button>
        )}
        {config && (
          <button type="button" className="text-button is-danger" disabled={busy} onClick={remove}>
            删除
          </button>
        )}
        <span className="balance-note">
          最快 {MIN_REFRESH_MINUTES} 分钟刷新一次 · 密钥不同步、不上传
        </span>
      </div>
    </FeatureSection>
  );
}

export default AiBalanceCard;
