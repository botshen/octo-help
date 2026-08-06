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
  applyPresetKey,
  findAiBalancePreset,
  formatBalance,
  formatRelativeTime,
  isBalanceLow,
  originPattern,
  parseCurlCommand,
  parseHeaderLines,
  parseStoredAiBalanceCache,
  parseStoredAiBalanceConfig,
  stringifyHeaders,
  validateAiBalanceConfig,
  type ConfigProblem,
} from '@/utils/octoAiBalance';

const REFRESH_CHOICES = [5, 15, 30, 60, 180, 720] as const;

/** Editable mirror of AiBalanceConfig: numbers stay strings while being typed. */
interface FormState {
  presetId: string;
  apiKey: string;
  url: string;
  method: 'GET' | 'POST';
  headersText: string;
  path: string;
  unit: string;
  multiplier: string;
  decimals: string;
  refreshMinutes: number;
  lowThreshold: string;
  showInPage: boolean;
}

function emptyForm(): FormState {
  const preset = AI_BALANCE_PRESETS[0];
  return {
    presetId: preset.id,
    apiKey: '',
    url: preset.urlTemplate,
    method: preset.method,
    headersText: stringifyHeaders(preset.headers),
    path: preset.path,
    unit: preset.unit,
    multiplier: '1',
    decimals: '2',
    refreshMinutes: DEFAULT_AI_BALANCE_CONFIG.refreshMinutes,
    lowThreshold: '',
    showInPage: false,
  };
}

function formFromConfig(config: AiBalanceConfig): FormState {
  return {
    presetId: config.presetId,
    // The key is not recoverable from a saved config (it is embedded in the URL
    // or a header), and re-deriving it would mean guessing. Editing shows the
    // real fields instead of pretending to know the secret.
    apiKey: '',
    url: config.url,
    method: config.method,
    headersText: stringifyHeaders(config.headers),
    path: config.path,
    unit: config.unit,
    multiplier: String(config.multiplier),
    decimals: String(config.decimals),
    refreshMinutes: config.refreshMinutes,
    lowThreshold: config.lowThreshold == null ? '' : String(config.lowThreshold),
    showInPage: config.showInPage,
  };
}

/** Turn the form into the shape the validator accepts. */
function draftFromForm(form: FormState): AiBalanceConfig {
  const preset = findAiBalancePreset(form.presetId);
  const usingPreset = preset != null && form.apiKey.trim() !== '';
  const filled = usingPreset ? applyPresetKey(preset, form.apiKey) : null;
  return {
    presetId: form.presetId,
    url: filled ? filled.url : form.url,
    method: form.method,
    headers: filled
      ? { ...parseHeaderLines(form.headersText), ...filled.headers }
      : parseHeaderLines(form.headersText),
    path: form.path,
    unit: form.unit,
    multiplier: Number(form.multiplier || '1'),
    decimals: Number(form.decimals || '2'),
    refreshMinutes: form.refreshMinutes,
    lowThreshold: form.lowThreshold.trim() === '' ? null : Number(form.lowThreshold),
    showInPage: form.showInPage,
  };
}

async function sendRuntime<T>(message: unknown): Promise<T | null> {
  try {
    return (await browser.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}

/**
 * The 「AI 余额」 card.
 *
 * Self-contained on purpose: it owns its two storage keys and its background
 * round trips, so App.tsx grows by one line instead of a dozen pieces of state.
 */
export function AiBalanceCard({ disabled }: { disabled: boolean }) {
  const [config, setConfig] = useState<AiBalanceConfig | null>(null);
  const [cache, setCache] = useState<AiBalanceCache | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<ConfigProblem[]>([]);
  const [notice, setNotice] = useState('');
  const [testResult, setTestResult] = useState<AiBalanceProbeResult | null>(null);
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const patch = useCallback(
    (changes: Partial<FormState>) => setForm((previous) => ({ ...previous, ...changes })),
    [],
  );

  useEffect(() => {
    let mounted = true;
    void browser.storage.local
      .get([AI_BALANCE_CONFIG_STORAGE_KEY, AI_BALANCE_CACHE_STORAGE_KEY])
      .then((stored) => {
        if (!mounted) return;
        const storedConfig = parseStoredAiBalanceConfig(stored[AI_BALANCE_CONFIG_STORAGE_KEY]);
        setConfig(storedConfig);
        setCache(parseStoredAiBalanceCache(stored[AI_BALANCE_CACHE_STORAGE_KEY]));
        if (storedConfig) setForm(formFromConfig(storedConfig));
        else setEditing(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // The background writes the cache, so the card follows storage rather than
  // only rendering what its own refresh call returned.
  useEffect(() => {
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
    return () => browser.storage.local.onChanged.removeListener(onChanged);
  }, []);

  // Keep "3 分钟前更新" honest while the panel stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const preset = findAiBalancePreset(form.presetId);
  const problemFor = (field: ConfigProblem['field']) =>
    problems.find((problem) => problem.field === field)?.message ?? '';

  const balanceText = useMemo(() => {
    if (!config || cache?.value == null) return '';
    return formatBalance(cache.value, cache.unit || config.unit, config.decimals);
  }, [cache, config]);
  const low = isBalanceLow(cache?.value ?? null, config?.lowThreshold ?? null);

  /**
   * Ask for the one origin this config talks to.
   *
   * `optional_host_permissions` in the manifest grants nothing on its own; this
   * prompt is where the user sees exactly which host the extension will reach,
   * and it has to run inside the click handler to count as a user gesture.
   */
  const ensureOrigin = useCallback(async (url: string) => {
    const pattern = originPattern(url);
    if (!pattern) return false;
    try {
      if (await browser.permissions.contains({ origins: [pattern] })) return true;
      return await browser.permissions.request({ origins: [pattern] });
    } catch {
      return false;
    }
  }, []);

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
      if (!(await ensureOrigin(validated.config.url))) {
        setNotice('需要允许访问该接口域名才能查询余额');
        return;
      }
      const result = await sendRuntime<AiBalanceProbeResult>({
        type: RUNTIME_MESSAGE_TYPE.aiBalanceTest,
        config: validated.config,
      });
      setTestResult(result ?? { ok: false, value: null, unit: '', error: '后台无响应，请重开浏览器标签', fetchedAt: Date.now() });
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
      if (!(await ensureOrigin(validated.config.url))) {
        setNotice('需要允许访问该接口域名才能查询余额');
        return;
      }
      await browser.storage.local.set({ [AI_BALANCE_CONFIG_STORAGE_KEY]: validated.config });
      setConfig(validated.config);
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

  const refresh = async () => {
    setBusy(true);
    setNotice('');
    try {
      const result = await sendRuntime<AiBalanceProbeResult | null>({
        type: RUNTIME_MESSAGE_TYPE.aiBalanceRefresh,
      });
      if (result && !result.ok) setNotice(result.error);
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
      // Hand the host permission back: keeping cross-origin access for an
      // endpoint the user just deleted would be access we no longer need.
      const pattern = config ? originPattern(config.url) : null;
      if (pattern) await browser.permissions.remove({ origins: [pattern] }).catch(() => false);
      setConfig(null);
      setCache(null);
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

  const toggleShowInPage = async () => {
    const next = !form.showInPage;
    patch({ showInPage: next });
    if (!config) return;
    const nextConfig = { ...config, showInPage: next };
    setConfig(nextConfig);
    await browser.storage.local.set({ [AI_BALANCE_CONFIG_STORAGE_KEY]: nextConfig });
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
      url: nextPreset.urlTemplate,
      method: nextPreset.method,
      headersText: stringifyHeaders(nextPreset.headers),
      path: nextPreset.path,
      unit: nextPreset.unit,
    });
  };

  return (
    <section className="settings-card" aria-labelledby="balance-title">
      <header className="section-heading">
        <span className="section-icon is-balance" aria-hidden="true">💰</span>
        <div>
          <h2 id="balance-title">AI 余额</h2>
          <p>查询大模型网关的剩余额度，密钥只存在本机</p>
        </div>
      </header>

      {config && !editing && (
        <div className={`balance-readout${low ? ' is-low' : ''}`}>
          <div className="balance-figure">
            <strong>{balanceText || '—'}</strong>
            <small>
              {cache?.error
                ? `更新失败：${cache.error}`
                : formatRelativeTime(cache?.fetchedAt ?? 0, now)}
            </small>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || busy}
            onClick={refresh}
          >
            {busy ? '查询中…' : '刷新'}
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
            {advanced ? '▾ 高级设置' : '▸ 高级设置'}
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
                <span>低余额提醒阈值（留空关闭）</span>
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
              </p>
            </div>
          )}
        </div>
      )}

      {testResult && (
        <p className={`balance-test${testResult.ok ? ' is-ok' : ' is-error'}`} role="status">
          {testResult.ok && testResult.value != null
            ? `测试成功：${formatBalance(testResult.value, form.unit, Number(form.decimals || '2'))}`
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
    </section>
  );
}

export default AiBalanceCard;
