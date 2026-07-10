import { useEffect, useState } from 'react';
import {
  GLOBAL_THEME_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  MESSI_WATERMARK_STORAGE_KEY,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '@/utils/octoRecall';
import {
  GLOBAL_THEMES,
  THEMES,
  DEFAULT_GLOBAL_THEME,
  DEFAULT_THEME,
  KICK_STYLES,
  DEFAULT_KICK_STYLE,
} from '@/utils/octoBeautify';
import './App.css';

function App() {
  const [enabled, setEnabled] = useState(false);
  const [themeId, setThemeId] = useState(DEFAULT_THEME);
  const [globalThemeId, setGlobalThemeId] = useState(DEFAULT_GLOBAL_THEME);
  const [kickStyle, setKick] = useState(DEFAULT_KICK_STYLE);
  const [messiWatermark, setMessiWatermark] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    browser.storage.local
      .get([
        STORAGE_KEY,
        THEME_STORAGE_KEY,
        GLOBAL_THEME_STORAGE_KEY,
        KICK_STYLE_STORAGE_KEY,
        MESSI_WATERMARK_STORAGE_KEY,
      ])
      .then((res) => {
        if (!mounted) return;
        setEnabled(res[STORAGE_KEY] === true);
        if (typeof res[THEME_STORAGE_KEY] === 'string') setThemeId(res[THEME_STORAGE_KEY] as string);
        if (typeof res[GLOBAL_THEME_STORAGE_KEY] === 'string') {
          setGlobalThemeId(res[GLOBAL_THEME_STORAGE_KEY] as string);
        }
        if (typeof res[KICK_STYLE_STORAGE_KEY] === 'string') setKick(res[KICK_STYLE_STORAGE_KEY] as string);
        setMessiWatermark(res[MESSI_WATERMARK_STORAGE_KEY] === true);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const toggleRecall = async () => {
    const next = !enabled;
    setEnabled(next);
    await browser.storage.local.set({ [STORAGE_KEY]: next });
  };

  const chooseTheme = async (id: string) => {
    setThemeId(id);
    await browser.storage.local.set({ [THEME_STORAGE_KEY]: id });
  };

  const chooseGlobalTheme = async (id: string) => {
    setGlobalThemeId(id);
    await browser.storage.local.set({ [GLOBAL_THEME_STORAGE_KEY]: id });
  };

  const chooseKick = async (id: string) => {
    setKick(id);
    await browser.storage.local.set({ [KICK_STYLE_STORAGE_KEY]: id });
  };

  const toggleMessiWatermark = async () => {
    const next = !messiWatermark;
    setMessiWatermark(next);
    await browser.storage.local.set({ [MESSI_WATERMARK_STORAGE_KEY]: next });
  };

  return (
    <main className="panel">
      <h1 className="title">Octo 增强</h1>

      <section className="group">
        <div className="group-title">消息主题（美化换肤）</div>
        <div className="theme-list" aria-busy={loading}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-item${themeId === t.id ? ' is-active' : ''}`}
              aria-pressed={themeId === t.id}
              onClick={() => chooseTheme(t.id)}
            >
              <span className="theme-ico">{t.icon}</span>
              <span className="theme-label">{t.label}</span>
              <span className="theme-check">{themeId === t.id ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="group">
        <div className="group-title">全站配色（导航 / 会话 / 输入区）</div>
        <div className="theme-list" aria-busy={loading}>
          {GLOBAL_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-item${globalThemeId === t.id ? ' is-active' : ''}`}
              aria-pressed={globalThemeId === t.id}
              onClick={() => chooseGlobalTheme(t.id)}
            >
              <span className="theme-ico">{t.icon}</span>
              <span className="theme-label">{t.label}</span>
              <span className="theme-check">{globalThemeId === t.id ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="group">
        <div className="group-title">
          足球射门动画
          {themeId !== 'worldcup' && <span className="group-note">（仅「美加墨世界杯」主题生效）</span>}
        </div>
        <div className="theme-list">
          {KICK_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`theme-item${kickStyle === s.id ? ' is-active' : ''}`}
              aria-pressed={kickStyle === s.id}
              onClick={() => chooseKick(s.id)}
            >
              <span className="theme-ico">{s.icon}</span>
              <span className="theme-label">{s.label}</span>
              <span className="theme-check">{kickStyle === s.id ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="group">
        <label className="row">
          <div className="row-copy">
            <span className="row-title">显示梅西水印</span>
            <span className="row-desc">在聊天区域显示梅西主题水印。</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={messiWatermark}
            className={`switch${messiWatermark ? ' switch-on' : ''}`}
            disabled={loading}
            onClick={toggleMessiWatermark}
          >
            <span className="switch-knob" />
          </button>
        </label>
      </section>

      <section className="group">
        <label className="row">
          <div className="row-copy">
            <span className="row-title">显示已撤回的消息</span>
            <span className="row-desc">
              开启后，把“撤回了一条消息”还原为原文，并标注「已撤回」。
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            className={`switch${enabled ? ' switch-on' : ''}`}
            disabled={loading}
            onClick={toggleRecall}
          >
            <span className="switch-knob" />
          </button>
        </label>
      </section>

      <p className="footnote">
        仅在 im.deepminer.com.cn 生效。所有处理在本地完成，插件不发送任何数据。
      </p>
    </main>
  );
}

export default App;
