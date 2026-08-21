import { browser } from '#imports';
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  BALL_CURSOR_STORAGE_KEY,
  BEAUTIFY_STORAGE_KEY,
  BUILT_IN_COMPANION_STORAGE_KEY,
  COMPOSER_ENHANCEMENT_STORAGE_KEY,
  DESKTOP_PET_ENABLED_STORAGE_KEY,
  DESKTOP_PET_PLACEMENT_STORAGE_KEY,
  DESKTOP_PET_POSITION_STORAGE_KEY,
  DESKTOP_PET_STORAGE_KEY,
  EXPORT_REQUEST_KEY,
  EXPORT_RESULT_KEY,
  GLOBAL_THEME_STORAGE_KEY,
  CONV_COMPACT_STORAGE_KEY,
  CONV_FOLD_ENABLED_STORAGE_KEY,
  CONV_FOLDED_STORAGE_KEY,
  CONV_RECENT_ONLY_STORAGE_KEY,
  CONV_SORT_STORAGE_KEY,
  LINK_PREVIEW_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  MASTER_STORAGE_KEY,
  MESSI_WATERMARK_STORAGE_KEY,
  PLAYER_WATERMARK_STORAGE_KEY,
  QQ_SELF_LEFT_STORAGE_KEY,
  COMPAT_REPORT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type BuiltInCompanionId,
  type ConvCompactLevel,
  type ExportFormat,
  type PlayerWatermarkId,
} from '@/utils/octoShared';
import {
  GLOBAL_THEMES,
  THEMES,
  DEFAULT_GLOBAL_THEME,
  DEFAULT_THEME,
  KICK_STYLES,
  DEFAULT_KICK_STYLE,
} from '@/utils/octoThemeCatalog';
import { isBuiltInCompanionId, isStoredDesktopPet } from '@/utils/octoPetState';
import { isConvCompactLevel } from '@/utils/octoSettingsParsers';
import { FeatureSection } from './FeatureSection';
import { BotTestPanel } from './BotTestPanel';
import { ThemePicker, ThemeSwatch } from './ThemePicker';
import { APP_INITIAL_STATE, appReducer, type AppState, type BooleanSettingKey } from './state';
import { countFoldedConversations, normalizeStoredId, readCompatReport } from './helpers';
import './App.css';

const PLAYER_WATERMARKS: Array<{ id: PlayerWatermarkId; label: string; icon: string }> = [
  { id: 'none', label: '不显示', icon: '▫️' },
  { id: 'messi', label: '梅西', icon: '🇦🇷' },
  { id: 'mbappe', label: '姆巴佩', icon: '🇫🇷' },
];

const BUILT_IN_COMPANIONS: Array<{
  id: BuiltInCompanionId;
  label: string;
  icon: string;
  description: string;
}> = [
  { id: 'ant', label: '蚂蚁小队', icon: '🐜', description: '轻快巡游' },
  { id: 'snail', label: '蜗牛巡游', icon: '🐌', description: '慢慢陪伴' },
  { id: 'wizard', label: '飞行巫师', icon: '🧙', description: '悬浮飞行' },
  { id: 'zombie', label: '散步僵尸', icon: '🧟', description: '摇晃前进' },
];

/**
 * 会话行精简的四级。累进而非四个独立开关：L2 的标题前缀要先有 L1 删掉子区图标才
 * 讲得通，L3 收掉 L2 刚排好的第二行，L4 的分组表头又替换掉 L2 的前缀。做成一个有序
 * 选择，让非法组合压根表达不出来。
 *
 * 顺序是刻意的：只有最后一级和「按重要性排序」冲突，而真正解决「别把消息内容推给我」
 * 的是 L3 —— 它必须能和排序共存。
 */
const CONV_COMPACT_OPTIONS: Array<{ id: ConvCompactLevel; label: string; summary: string }> = [
  { id: 'off', label: '关闭', summary: '保持 Octo 原样' },
  { id: 'l1', label: '减装饰', summary: '删掉子区图标、AI 徽章和头像小角标' },
  { id: 'l2', label: '收面包屑', summary: '父群名并进标题行，全表统一两行' },
  { id: 'l3', label: '单行', summary: '不显示消息内容，一行一个会话' },
  { id: 'l4', label: '连续折叠', summary: '连续同父群折成一个分组表头' },
];

// ─── App component ────────────────────────────────────────────────────────

function App() {
  const [state, dispatch] = useReducer(appReducer, APP_INITIAL_STATE);
  const [panelTab, setPanelTab] = useState<'general' | 'conversation' | 'bot'>('general');

  const stateRef = useRef(state);
  stateRef.current = state;

  const lastPlayer = useRef<PlayerWatermarkId>('messi');
  const petFileInput = useRef<HTMLInputElement>(null);

  const {
    masterEnabled,
    beautifyEnabled,
    themeId,
    globalThemeId,
    kickStyle,
    playerWatermark,
    ballCursor,
    qqSelfLeft,
    desktopPet,
    desktopPetEnabled,
    builtInCompanion,
    desktopPetPlacement,
    composerEnhancement,
    convSortEnabled,
    convCompactLevel,
    convRecentOnly,
    convFoldEnabled,
    convFoldCount,
    linkPreviewEnabled,
    loading,
    petBusy,
    petError,
    settingsError,
    compatReport,
    exportBusy,
    exportResult,
    exportError,
    activeThemePicker,
    openFeature,
  } = state;

  // ── Stable setting helpers (ref-based, no deps needed) ──────────────────

  const toggleSetting = useCallback(async (storageKey: string, stateKey: BooleanSettingKey) => {
    const prev = stateRef.current[stateKey] as boolean;
    const next = !prev;
    dispatch({ type: 'TOGGLE', key: stateKey });
    try {
      await browser.storage.local.set({ [storageKey]: next });
    } catch {
      dispatch({ type: 'SET', key: stateKey, value: prev });
      dispatch({ type: 'SET_ERROR', errorKey: 'settingsError', message: '设置保存失败，请重试' });
    }
  }, []);

  const chooseSetting = useCallback(async (storageKey: string, stateKey: string, next: unknown) => {
    const prev = stateRef.current[stateKey as keyof AppState];
    dispatch({ type: 'SET', key: stateKey, value: next });
    try {
      await browser.storage.local.set({ [storageKey]: next });
    } catch {
      dispatch({ type: 'SET', key: stateKey, value: prev });
      dispatch({ type: 'SET_ERROR', errorKey: 'settingsError', message: '设置保存失败，请重试' });
    }
  }, []);

  const closeThemePicker = useCallback(
    () => dispatch({ type: 'SET', key: 'activeThemePicker', value: null }),
    [],
  );

  // ── Derived values ──────────────────────────────────────────────────────

  const selectedMessageTheme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  const selectedGlobalTheme = GLOBAL_THEMES.find((t) => t.id === globalThemeId) ?? GLOBAL_THEMES[0];
  const selectedBuiltInCompanion = BUILT_IN_COMPANIONS.find((c) => c.id === builtInCompanion);

  // ── Init: read storage once on mount ────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    browser.storage.local
      .get([
        MASTER_STORAGE_KEY,
        BEAUTIFY_STORAGE_KEY,
        THEME_STORAGE_KEY,
        GLOBAL_THEME_STORAGE_KEY,
        KICK_STYLE_STORAGE_KEY,
        PLAYER_WATERMARK_STORAGE_KEY,
        MESSI_WATERMARK_STORAGE_KEY,
        BALL_CURSOR_STORAGE_KEY,
        QQ_SELF_LEFT_STORAGE_KEY,
        DESKTOP_PET_STORAGE_KEY,
        DESKTOP_PET_ENABLED_STORAGE_KEY,
        DESKTOP_PET_PLACEMENT_STORAGE_KEY,
        COMPOSER_ENHANCEMENT_STORAGE_KEY,
        CONV_SORT_STORAGE_KEY,
        CONV_COMPACT_STORAGE_KEY,
        CONV_RECENT_ONLY_STORAGE_KEY,
        CONV_FOLD_ENABLED_STORAGE_KEY,
        CONV_FOLDED_STORAGE_KEY,
        LINK_PREVIEW_STORAGE_KEY,
        BUILT_IN_COMPANION_STORAGE_KEY,
        COMPAT_REPORT_STORAGE_KEY,
      ])
      .then((res) => {
        if (!mounted) return;

        const storedPlayer = res[PLAYER_WATERMARK_STORAGE_KEY];
        const playerWatermark: PlayerWatermarkId =
          storedPlayer === 'none' || storedPlayer === 'messi' || storedPlayer === 'mbappe'
            ? storedPlayer
            : res[MESSI_WATERMARK_STORAGE_KEY] === true
              ? 'messi'
              : 'none';
        if (playerWatermark === 'messi' || playerWatermark === 'mbappe') {
          lastPlayer.current = playerWatermark;
        }

        const storedDesktopPet = isStoredDesktopPet(res[DESKTOP_PET_STORAGE_KEY])
          ? res[DESKTOP_PET_STORAGE_KEY]
          : null;
        const storedBuiltInValue = res[BUILT_IN_COMPANION_STORAGE_KEY];
        const nextBuiltInCompanion: BuiltInCompanionId | null = isBuiltInCompanionId(storedBuiltInValue)
          ? storedBuiltInValue
          : storedBuiltInValue === undefined && !storedDesktopPet
            ? 'wizard'
            : null;

        dispatch({
          type: 'INIT',
          state: {
            loading: false,
            masterEnabled: res[MASTER_STORAGE_KEY] !== false,
            beautifyEnabled: res[BEAUTIFY_STORAGE_KEY] !== false,
            themeId: normalizeStoredId(res[THEME_STORAGE_KEY], THEMES, DEFAULT_THEME),
            globalThemeId: normalizeStoredId(
              res[GLOBAL_THEME_STORAGE_KEY],
              GLOBAL_THEMES,
              DEFAULT_GLOBAL_THEME,
            ),
            kickStyle: normalizeStoredId(res[KICK_STYLE_STORAGE_KEY], KICK_STYLES, DEFAULT_KICK_STYLE),
            linkPreviewEnabled: res[LINK_PREVIEW_STORAGE_KEY] !== false,
            convSortEnabled: res[CONV_SORT_STORAGE_KEY] === true,
            convCompactLevel: isConvCompactLevel(res[CONV_COMPACT_STORAGE_KEY])
              ? res[CONV_COMPACT_STORAGE_KEY]
              : 'off',
            convRecentOnly: res[CONV_RECENT_ONLY_STORAGE_KEY] === true,
            convFoldEnabled: res[CONV_FOLD_ENABLED_STORAGE_KEY] === true,
            convFoldCount: countFoldedConversations(res[CONV_FOLDED_STORAGE_KEY]),
            playerWatermark,
            ballCursor: res[BALL_CURSOR_STORAGE_KEY] !== false,
            qqSelfLeft: res[QQ_SELF_LEFT_STORAGE_KEY] === true,
            compatReport: readCompatReport(res[COMPAT_REPORT_STORAGE_KEY]),
            desktopPet: storedDesktopPet,
            builtInCompanion: nextBuiltInCompanion,
            desktopPetEnabled:
              res[DESKTOP_PET_ENABLED_STORAGE_KEY] === true ||
              (res[DESKTOP_PET_ENABLED_STORAGE_KEY] === undefined && nextBuiltInCompanion !== null),
            desktopPetPlacement:
              res[DESKTOP_PET_PLACEMENT_STORAGE_KEY] === 'composer' ? 'composer' : 'desktop',
            composerEnhancement: res[COMPOSER_ENHANCEMENT_STORAGE_KEY] !== false,
          },
        });
      })
      .catch(() => {
        if (mounted) {
          dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '读取本地设置失败，请重新打开扩展' });
          dispatch({ type: 'SET_BUSY', key: 'loading', value: false });
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  // ── Storage change listeners (compat report + export result) ────────────

  useEffect(() => {
    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      const compatValue = changes[COMPAT_REPORT_STORAGE_KEY]?.newValue;
      if (compatValue !== undefined) {
        dispatch({ type: 'SET_COMPAT', value: readCompatReport(compatValue) });
      }

      if (CONV_FOLDED_STORAGE_KEY in changes) {
        dispatch({
          type: 'SET',
          key: 'convFoldCount',
          value: countFoldedConversations(changes[CONV_FOLDED_STORAGE_KEY]?.newValue),
        });
      }

      const exportValue = changes[EXPORT_RESULT_KEY]?.newValue as
        | { content?: string; fileName?: string; summary?: string }
        | undefined;
      if (exportValue !== undefined && typeof exportValue.content === 'string') {
        if (exportValue.content) {
          dispatch({
            type: 'SET_RESULT',
            value: {
              summary: exportValue.summary ?? '',
              fileName: exportValue.fileName ?? 'export',
              content: exportValue.content,
            },
          });
          dispatch({ type: 'SET_ERROR', errorKey: 'exportError', message: '' });
        } else {
          dispatch({ type: 'SET_ERROR', errorKey: 'exportError', message: exportValue.summary || '导出失败' });
          dispatch({ type: 'SET_RESULT', value: null });
        }
        dispatch({ type: 'SET_BUSY', key: 'exportBusy', value: false });
      }
    };
    browser.storage.local.onChanged.addListener(onChanged);
    return () => browser.storage.local.onChanged.removeListener(onChanged);
  }, []);

  const toggleFeature = useCallback(
    (id: string) =>
      dispatch({
        type: 'SET',
        key: 'openFeature',
        value: stateRef.current.openFeature === id ? null : id,
      }),
    [],
  );

  const toggleFootball = useCallback(async () => {
    const cur = stateRef.current.playerWatermark;
    if (cur === 'none') {
      await chooseSetting(PLAYER_WATERMARK_STORAGE_KEY, 'playerWatermark', lastPlayer.current);
    } else {
      lastPlayer.current = cur;
      await chooseSetting(PLAYER_WATERMARK_STORAGE_KEY, 'playerWatermark', 'none');
    }
  }, []);

  const triggerExport = useCallback(async (format: ExportFormat) => {
    dispatch({ type: 'SET_BUSY', key: 'exportBusy', value: true });
    dispatch({ type: 'SET_RESULT', value: null });
    dispatch({ type: 'SET_ERROR', errorKey: 'exportError', message: '' });
    const requestId = `${format}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await browser.storage.local.set({ [EXPORT_REQUEST_KEY]: { format, requestId } });
    } catch {
      dispatch({ type: 'SET_BUSY', key: 'exportBusy', value: false });
      dispatch({ type: 'SET_ERROR', errorKey: 'exportError', message: '请求导出失败，请重试' });
    }
  }, []);

  const downloadExport = useCallback(() => {
    if (!stateRef.current.exportResult) return;
    const { content, fileName } = stateRef.current.exportResult;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const restoreAllFoldedConversations = useCallback(async () => {
    try {
      await browser.storage.local.remove(CONV_FOLDED_STORAGE_KEY);
      dispatch({ type: 'SET', key: 'convFoldCount', value: 0 });
    } catch {
      dispatch({ type: 'SET_ERROR', errorKey: 'settingsError', message: '恢复折叠会话失败，请重试' });
    }
  }, []);

  const chooseBuiltInCompanion = useCallback(async (id: BuiltInCompanionId) => {
    dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '' });
    try {
      await browser.storage.local.set({
        [BUILT_IN_COMPANION_STORAGE_KEY]: id,
        [DESKTOP_PET_ENABLED_STORAGE_KEY]: true,
        [DESKTOP_PET_PLACEMENT_STORAGE_KEY]: 'composer',
      });
      dispatch({
        type: 'SET_MULTI',
        updates: { builtInCompanion: id, desktopPetEnabled: true, desktopPetPlacement: 'composer' },
      });
    } catch {
      dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '保存内置宠物失败' });
    }
  }, []);

  const chooseCustomPet = useCallback(async () => {
    if (!stateRef.current.desktopPet) return;
    dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '' });
    try {
      await browser.storage.local.set({
        [BUILT_IN_COMPANION_STORAGE_KEY]: null,
        [DESKTOP_PET_ENABLED_STORAGE_KEY]: true,
      });
      dispatch({ type: 'SET_MULTI', updates: { builtInCompanion: null, desktopPetEnabled: true } });
    } catch {
      dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '切换自定义宠物失败' });
    }
  }, []);

  const importDesktopPet = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '请选择 .zip 或 .codex-pet.zip 文件' });
      return;
    }
    dispatch({ type: 'SET_BUSY', key: 'petBusy', value: true });
    dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '' });
    try {
      const { parsePetPackage } = await import('@/utils/octoPet');
      const pet = await parsePetPackage(file);
      await browser.storage.local.set({
        [DESKTOP_PET_STORAGE_KEY]: pet,
        [DESKTOP_PET_ENABLED_STORAGE_KEY]: true,
        [BUILT_IN_COMPANION_STORAGE_KEY]: null,
      });
      dispatch({
        type: 'SET_MULTI',
        updates: { desktopPet: pet, desktopPetEnabled: true, builtInCompanion: null },
      });
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        errorKey: 'petError',
        message: error instanceof Error ? error.message : '导入宠物失败',
      });
    } finally {
      dispatch({ type: 'SET_BUSY', key: 'petBusy', value: false });
    }
  }, []);

  const toggleDesktopPet = useCallback(async () => {
    const s = stateRef.current;
    if ((!s.desktopPet && !s.builtInCompanion) || s.petBusy) return;
    const next = !s.desktopPetEnabled;
    dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '' });
    try {
      await browser.storage.local.set({ [DESKTOP_PET_ENABLED_STORAGE_KEY]: next });
      dispatch({ type: 'SET', key: 'desktopPetEnabled', value: next });
    } catch {
      dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '保存宠物开关失败' });
    }
  }, []);

  const deleteDesktopPet = useCallback(async () => {
    const s = stateRef.current;
    if (!s.desktopPet || s.petBusy) return;
    dispatch({ type: 'SET_BUSY', key: 'petBusy', value: true });
    dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '' });
    try {
      const keysToRemove = [DESKTOP_PET_STORAGE_KEY, DESKTOP_PET_POSITION_STORAGE_KEY];
      if (!s.builtInCompanion) {
        keysToRemove.push(DESKTOP_PET_ENABLED_STORAGE_KEY, DESKTOP_PET_PLACEMENT_STORAGE_KEY);
      }
      await browser.storage.local.remove(keysToRemove);
      const updates: Partial<AppState> = { desktopPet: null };
      if (!s.builtInCompanion) updates.desktopPetEnabled = false;
      dispatch({ type: 'SET_MULTI', updates });
    } catch {
      dispatch({ type: 'SET_ERROR', errorKey: 'petError', message: '删除宠物失败' });
    } finally {
      dispatch({ type: 'SET_BUSY', key: 'petBusy', value: false });
    }
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <main className="panel">
      <header className={`brand${masterEnabled ? '' : ' is-paused'}`}>
        <img className="brand-logo" src="/logo.png" alt="" />
        <div className="brand-copy">
          <h1 className="title">Octo 聊天增强</h1>
          <span className="brand-subtitle">
            {masterEnabled ? '让你的 Octo 更好看、更好用' : '已暂停，页面与未安装时一致'}
          </span>
        </div>
        <div className="brand-master">
          <span className="brand-master-label">{masterEnabled ? '已启用' : '已暂停'}</span>
          <button
            type="button"
            role="switch"
            aria-label="启用全部增强"
            aria-checked={masterEnabled}
            className={`switch master-switch${masterEnabled ? ' switch-on' : ''}`}
            disabled={loading}
            onClick={() => toggleSetting(MASTER_STORAGE_KEY, 'masterEnabled')}
          >
            <span className="switch-knob" />
          </button>
        </div>
      </header>

      {!masterEnabled && (
        <section className="master-paused" role="status">
          <span className="master-paused-icon" aria-hidden="true">⏸</span>
          <div>
            <strong>全部增强已暂停</strong>
            <p>页面已还原成没有安装扩展的样子。下面的设置可以照常修改，会在重新启用后生效。</p>
          </div>
        </section>
      )}

      {settingsError && <p className="settings-error" role="alert">{settingsError}</p>}
      {compatReport && compatReport.brokenFeatures.length > 0 && (
        <section className="compat-warning" role="status">
          <span className="compat-warning-icon" aria-hidden="true">⚠️</span>
          <div className="compat-warning-copy">
            <span className="compat-warning-title">部分增强可能已失效</span>
            <span className="compat-warning-desc">
              Octo 页面结构发生变化，以下能力暂时无法生效：
              {compatReport.brokenFeatures.join('、')}。其余功能不受影响。
            </span>
          </div>
        </section>
      )}

      <nav className="panel-tabs" aria-label="插件设置分类">
        <button
          type="button"
          className={panelTab === 'general' ? 'is-active' : ''}
          aria-pressed={panelTab === 'general'}
          onClick={() => setPanelTab('general')}
        >
          常用功能
        </button>
        <button
          type="button"
          className={panelTab === 'conversation' ? 'is-active' : ''}
          aria-pressed={panelTab === 'conversation'}
          onClick={() => setPanelTab('conversation')}
        >
          会话列表
        </button>
        <button
          type="button"
          className={panelTab === 'bot' ? 'is-active' : ''}
          aria-pressed={panelTab === 'bot'}
          onClick={() => setPanelTab('bot')}
        >
          Bot
        </button>
      </nav>

      <div data-tab={panelTab} className={`settings-stack${masterEnabled ? '' : ' is-paused'}`}>
        <FeatureSection
          icon="◐"
          title="消息美化与主题"
          summary={
            beautifyEnabled
              ? `${selectedMessageTheme.label} · ${selectedGlobalTheme.label}`
              : '已关闭，页面保持 Octo 原样'
          }
          enabled={beautifyEnabled}
          onToggleEnabled={() => toggleSetting(BEAUTIFY_STORAGE_KEY, 'beautifyEnabled')}
          open={openFeature === 'appearance'}
          onToggleOpen={() => toggleFeature('appearance')}
          disabled={loading}
        >
          <button
            type="button"
            className="choice-row"
            aria-haspopup="dialog"
            disabled={loading}
            onClick={() => dispatch({ type: 'SET', key: 'activeThemePicker', value: 'message' })}
          >
            <ThemeSwatch theme={selectedMessageTheme} compact />
            <span className="choice-copy">
              <small>消息主题</small>
              <strong>{selectedMessageTheme.label}</strong>
              <em>{selectedMessageTheme.description}</em>
            </span>
            <span className="choice-action">更换 <b aria-hidden="true">›</b></span>
          </button>
          <button
            type="button"
            className="choice-row"
            aria-haspopup="dialog"
            disabled={loading}
            onClick={() => dispatch({ type: 'SET', key: 'activeThemePicker', value: 'global' })}
          >
            <ThemeSwatch theme={selectedGlobalTheme} compact />
            <span className="choice-copy">
              <small>全站配色</small>
              <strong>{selectedGlobalTheme.label}</strong>
              <em>{selectedGlobalTheme.description}</em>
            </span>
            <span className="choice-action">更换 <b aria-hidden="true">›</b></span>
          </button>
          {themeId === 'qq2014' && (
            <div className="config-row">
              <div className="config-copy">
                <span>自己的消息靠左</span>
                <small>QQ 2014 主题专属布局</small>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="自己的消息靠左"
                aria-checked={qqSelfLeft}
                className={`switch${qqSelfLeft ? ' switch-on' : ''}`}
                disabled={loading}
                onClick={() => toggleSetting(QQ_SELF_LEFT_STORAGE_KEY, 'qqSelfLeft')}
              >
                <span className="switch-knob" />
              </button>
            </div>
          )}
        </FeatureSection>

        <FeatureSection
          icon="⚽"
          iconClass="is-football"
          title="足球玩法"
          summary={
            playerWatermark === 'none'
              ? '已关闭'
              : `${PLAYER_WATERMARKS.find((player) => player.id === playerWatermark)?.label ?? ''} · ${
                  KICK_STYLES.find((style) => style.id === kickStyle)?.label ?? ''
                }`
          }
          enabled={playerWatermark !== 'none'}
          onToggleEnabled={toggleFootball}
          open={openFeature === 'football'}
          onToggleOpen={() => toggleFeature('football')}
          disabled={loading}
        >
          {themeId !== 'worldcup' && (
            <p className="context-note"><span aria-hidden="true">i</span>气泡射门动画需要选用"美加墨世界杯"消息主题</p>
          )}
          <div className="config-row">
            <div className="config-copy">
              <span>射门动画</span>
              <small>选择视觉效果；轨迹会随机使用直线、弧线或反弹</small>
            </div>
            <label className="select-wrap">
              <span className="sr-only">射门动画</span>
              <select value={kickStyle} disabled={loading} onChange={(event) => chooseSetting(KICK_STYLE_STORAGE_KEY, 'kickStyle', event.currentTarget.value)}>
                {KICK_STYLES.map((style) => (
                  <option key={style.id} value={style.id}>{style.icon} {style.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="config-row is-stacked">
            <div className="config-copy">
              <span>球星射手</span>
              <small>显示在右下角，点击页面任意位置触发全屏射门</small>
            </div>
            <div className="player-selector" role="radiogroup" aria-label="球星射手" aria-busy={loading}>
              {PLAYER_WATERMARKS.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  role="radio"
                  className={`player-option${playerWatermark === player.id ? ' is-active' : ''}`}
                  aria-checked={playerWatermark === player.id}
                  disabled={loading}
                  onClick={() => chooseSetting(PLAYER_WATERMARK_STORAGE_KEY, 'playerWatermark', player.id)}
                >
                  <span aria-hidden="true">{player.icon}</span>
                  <span>{player.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="config-row">
            <div className="config-copy">
              <span>鼠标变足球</span>
              <small>{playerWatermark === 'none' ? '选择球星后可用' : '关闭后仍可点击射门'}</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="鼠标变足球"
              aria-checked={ballCursor}
              className={`switch${ballCursor ? ' switch-on' : ''}`}
              disabled={loading || playerWatermark === 'none'}
              onClick={() => toggleSetting(BALL_CURSOR_STORAGE_KEY, 'ballCursor')}
            >
              <span className="switch-knob" />
            </button>
          </div>
        </FeatureSection>

        <FeatureSection
          icon="✦"
          iconClass="is-pet"
          title="输入框宠物"
          summary={
            desktopPetEnabled
              ? `${selectedBuiltInCompanion?.label ?? desktopPet?.manifest.displayName ?? '已启用'}${
                  desktopPet && !builtInCompanion && desktopPetPlacement === 'desktop' ? ' · 自由拖拽' : ''
                }`
              : desktopPet || builtInCompanion
                ? '已关闭'
                : '还没有选择宠物'
          }
          enabled={desktopPetEnabled}
          onToggleEnabled={toggleDesktopPet}
          open={openFeature === 'pet'}
          onToggleOpen={() => toggleFeature('pet')}
          disabled={loading || petBusy || (!desktopPet && !builtInCompanion)}
        >
          <div className="built-in-pet-grid" role="radiogroup" aria-label="内置宠物">
            {BUILT_IN_COMPANIONS.map((companion) => (
              <button
                key={companion.id}
                type="button"
                role="radio"
                aria-checked={builtInCompanion === companion.id}
                className={`built-in-pet-option${builtInCompanion === companion.id ? ' is-active' : ''}`}
                disabled={loading || petBusy}
                onClick={() => chooseBuiltInCompanion(companion.id)}
              >
                <span className="built-in-pet-icon" aria-hidden="true">{companion.icon}</span>
                <span>
                  <strong>{companion.label}</strong>
                  <small>{companion.description}</small>
                </span>
              </button>
            ))}
            {desktopPet && (
              <button
                type="button"
                role="radio"
                aria-checked={!builtInCompanion}
                className={`built-in-pet-option is-custom${!builtInCompanion ? ' is-active' : ''}`}
                disabled={loading || petBusy}
                onClick={chooseCustomPet}
              >
                <span className="built-in-pet-icon" aria-hidden="true">✦</span>
                <span>
                  <strong>{desktopPet.manifest.displayName}</strong>
                  <small>我的宠物包</small>
                </span>
              </button>
            )}
          </div>
          {selectedBuiltInCompanion || desktopPet ? (
            <div className="pet-card">
              <div className="pet-avatar" aria-hidden="true">
                {selectedBuiltInCompanion?.icon ?? '✺'}
              </div>
              <div className="pet-copy">
                <span className="pet-name">
                  {selectedBuiltInCompanion?.label ?? desktopPet?.manifest.displayName}
                </span>
                {(selectedBuiltInCompanion?.description || desktopPet?.manifest.description) && (
                  <span className="pet-description">
                    {selectedBuiltInCompanion?.description ?? desktopPet?.manifest.description}
                  </span>
                )}
                <span className="pet-local-note">
                  {desktopPetEnabled
                    ? '已在 Octo 页面显示'
                    : selectedBuiltInCompanion
                      ? '当前未显示'
                      : '已导入，当前未显示'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="启用桌面宠物"
                aria-checked={desktopPetEnabled}
                className={`switch${desktopPetEnabled ? ' switch-on' : ''}`}
                disabled={loading || petBusy}
                onClick={toggleDesktopPet}
              >
                <span className="switch-knob" />
              </button>
            </div>
          ) : (
            <div className="pet-empty-state">
              <span aria-hidden="true">✧</span>
              <div>
                <strong>还没有宠物</strong>
                <p>从上方选择一只，立即显示在输入框上方</p>
              </div>
            </div>
          )}
          {desktopPet && !builtInCompanion && (
            <div className="config-row is-stacked pet-placement-row">
              <div className="config-copy">
                <span>宠物位置</span>
                <small>输入框模式会跟随当前会话和输入框尺寸</small>
              </div>
              <div className="player-selector pet-placement-selector" role="radiogroup" aria-label="宠物位置">
                <button
                  type="button"
                  role="radio"
                  className={`player-option${desktopPetPlacement === 'desktop' ? ' is-active' : ''}`}
                  aria-checked={desktopPetPlacement === 'desktop'}
                  disabled={loading || petBusy}
                  onClick={() => chooseSetting(DESKTOP_PET_PLACEMENT_STORAGE_KEY, 'desktopPetPlacement', 'desktop')}
                >
                  自由拖拽
                </button>
                <button
                  type="button"
                  role="radio"
                  className={`player-option${desktopPetPlacement === 'composer' ? ' is-active' : ''}`}
                  aria-checked={desktopPetPlacement === 'composer'}
                  disabled={loading || petBusy}
                  onClick={() => chooseSetting(DESKTOP_PET_PLACEMENT_STORAGE_KEY, 'desktopPetPlacement', 'composer')}
                >
                  输入框陪伴
                </button>
              </div>
            </div>
          )}
          <div className="pet-import-row">
            <input
              ref={petFileInput}
              className="pet-file-input"
              type="file"
              accept=".zip,.codex-pet.zip,application/zip"
              onChange={importDesktopPet}
            />
            <button
              type="button"
              className="secondary-button"
              disabled={loading || petBusy}
              onClick={() => petFileInput.current?.click()}
            >
              {petBusy ? '处理中…' : desktopPet ? '更换自定义宠物' : '导入自定义宠物'}
            </button>
            {desktopPet && (
              <button type="button" className="text-button is-danger" disabled={petBusy} onClick={deleteDesktopPet}>
                删除
              </button>
            )}
            <span className="pet-limit">ZIP，最大 10 MB</span>
          </div>
          {petError && <p className="pet-error" role="alert">{petError}</p>}
        </FeatureSection>

        <FeatureSection
          icon="⌶"
          iconClass="is-message"
          title="舒适输入框"
          summary={composerEnhancement ? '三行编辑区 · 选区格式条 · 快捷 @' : '已关闭，保持 Octo 原始输入框'}
          enabled={composerEnhancement}
          onToggleEnabled={() => toggleSetting(COMPOSER_ENHANCEMENT_STORAGE_KEY, 'composerEnhancement')}
          open={openFeature === 'composer'}
          onToggleOpen={() => toggleFeature('composer')}
          disabled={loading}
        >
          <p className="feature-note">
            默认提供三行编辑空间，把工具栏移到右下角，同时保留 Octo 原生的附件、快捷键和全屏展开。
            选中文本会显示格式条，点击即可插入 Markdown，无需手打；粗体和斜体也支持 Ctrl/Cmd+B、Ctrl/Cmd+I。包含真 @ 或附件的选区不会转换，避免损坏消息结构。
          </p>
        </FeatureSection>

        <FeatureSection
          icon="📌"
          group="conversation"
          title="会话列表按重要性排序"
          summary={
            convSortEnabled
              ? '@我 和私聊未读置顶，免打扰的沉到底部'
              : '已关闭，「最近」保持纯时间顺序'
          }
          enabled={convSortEnabled}
          onToggleEnabled={() => toggleSetting(CONV_SORT_STORAGE_KEY, 'convSortEnabled')}
          open={openFeature === 'convSort'}
          onToggleOpen={() => toggleFeature('convSort')}
          disabled={loading}
        >
          <p className="feature-note">
            只作用于「最近」这一栏，顺序变成：置顶 → @我 或私聊未读 → 其余按时间 → 免打扰。
            这样不用再为了找一条消息在「关注」和「最近」之间来回切：未关注的会话照样在列表里，
            有人 @ 你就会自己冒到最上面。
          </p>
          <p className="feature-note">
            顺带让免打扰变得能用：设了免打扰的群会沉到底部，但里面有人 @ 你时依旧会置顶，
            所以可以放心把刷屏的机器人群静音。「关注」栏完全不受影响，手动拖拽排序照常。
          </p>
        </FeatureSection>

        <FeatureSection
          icon="🗂"
          group="conversation"
          title="会话行精简"
          summary={
            convCompactLevel === 'off'
              ? '已关闭，保持 Octo 原样'
              : CONV_COMPACT_OPTIONS.find((o) => o.id === convCompactLevel)?.summary ?? ''
          }
          enabled={convCompactLevel !== 'off'}
          onToggleEnabled={() =>
            chooseSetting(
              CONV_COMPACT_STORAGE_KEY,
              'convCompactLevel',
              convCompactLevel === 'off' ? 'l2' : 'off',
            )
          }
          open={openFeature === 'convCompact'}
          onToggleOpen={() => toggleFeature('convCompact')}
          disabled={loading}
        >
          <p className="feature-note">
            一行最多塞了 9 个信号，真正回答「要不要我现在处理」的只有 2 个。
            三级逐层递进，等级越高删得越多。
          </p>
          <div className="config-row is-stacked">
            <div className="config-copy">
              <span>精简等级</span>
              <small>越往后越省地方，也越依赖 Octo 的结构</small>
            </div>
            <div className="player-selector" role="radiogroup" aria-label="精简等级">
              {CONV_COMPACT_OPTIONS.map((option) => {
                // L3 按「上一行是不是同一个父群」分组，只在 DOM 顺序下成立；而重要性
                // 排序是用 CSS order 改视觉顺序的。两个同时开会让折叠隐藏错误的行，
                // 所以这里直接禁用并说明原因，而不是悄悄降级让人以为坏了。
                const blocked = option.id === 'l4' && convSortEnabled;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    className={`player-option${convCompactLevel === option.id ? ' is-active' : ''}`}
                    aria-checked={convCompactLevel === option.id}
                    disabled={loading || blocked}
                    title={blocked ? '与「按重要性排序」冲突，需先关掉排序' : option.summary}
                    onClick={() =>
                      chooseSetting(CONV_COMPACT_STORAGE_KEY, 'convCompactLevel', option.id)
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          {convSortEnabled && (
            <p className="feature-note">
              「连续折叠」当前不可选：它和上面的「按重要性排序」互斥。排序用 CSS 改的是视觉顺序、
              DOM 顺序不变，而折叠要判断「上一行是不是同一个父群」，只能按 DOM 顺序判断——
              两个同时开会折叠错行。想用折叠请先关掉排序。其余各级不受影响，
              包括真正管用的「单行」。
            </p>
          )}
          <p className="feature-note">
            删掉的都是重复表达：子区图标（面包屑已说明所属）、AI 徽章（头像已够辨识）、
            头像上 14px 的小角标。父群名从独占一行改成标题前缀。
            还会合掉「一次子区活动占两行」——子区来消息时父群也会跟着上榜，
            同一个名字出现两次、时间还不同；只在那一行没有未读时才合，绝不隐藏在等人处理的行。
          </p>
          <p className="feature-note">
            「单行」这一级是重点：不再显示消息内容。列表于是只回答「谁在动、有没有在等我」，
            想知道说了什么再点进去。未读数字也收成一个圆点——99+ 和 19 都是「进去看」，
            数字只多添一份催促感。时间移到悬停。
          </p>
        </FeatureSection>

        <FeatureSection
          icon="⊟"
          group="conversation"
          title="会话折叠"
          summary={
            convFoldEnabled
              ? `${convFoldCount > 0 ? `手动折叠 ${convFoldCount} 个` : '可手动折叠'}${convRecentOnly ? ' · 自动收起一周前' : ''}`
              : convRecentOnly
                ? '自动收起一周前的会话'
                : '已关闭，会话全部正常显示'
          }
          enabled={convFoldEnabled || convRecentOnly}
          onToggleEnabled={() => {
            const next = !(convFoldEnabled || convRecentOnly);
            void browser.storage.local.set({
              [CONV_FOLD_ENABLED_STORAGE_KEY]: next,
              [CONV_RECENT_ONLY_STORAGE_KEY]: next,
            }).then(() => {
              dispatch({ type: 'SET_MULTI', updates: { convFoldEnabled: next, convRecentOnly: next } });
            }).catch(() => {
              dispatch({ type: 'SET_ERROR', errorKey: 'settingsError', message: '保存折叠设置失败，请重试' });
            });
          }}
          open={openFeature === 'convFold'}
          onToggleOpen={() => toggleFeature('convFold')}
          disabled={loading}
        >
          <p className="feature-note">
            插件不接管官方置顶能力，只提供手动折叠。鼠标移到会话上可折叠，点开聚合入口
            可查看、进入或逐条恢复；展开项会以轻缩进、行间距和独立底色区别于正常会话。
          </p>
          <div className="config-row">
            <div className="config-copy">
              <span>允许手动折叠</span>
              <small>按账号和 Space 分开保存，不改变 Octo 服务端状态</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="允许手动折叠"
              aria-checked={convFoldEnabled}
              className={`switch${convFoldEnabled ? ' switch-on' : ''}`}
              disabled={loading}
              onClick={() => toggleSetting(CONV_FOLD_ENABLED_STORAGE_KEY, 'convFoldEnabled')}
            >
              <span className="switch-knob" />
            </button>
          </div>
          <div className="config-row">
            <div className="config-copy">
              <span>自动收起一周前</span>
              <small>更早的会话收进底部入口；这条自动规则仍保留置顶和待处理会话</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="自动收起一周前"
              aria-checked={convRecentOnly}
              className={`switch${convRecentOnly ? ' switch-on' : ''}`}
              disabled={loading}
              onClick={() => toggleSetting(CONV_RECENT_ONLY_STORAGE_KEY, 'convRecentOnly')}
            >
              <span className="switch-knob" />
            </button>
          </div>
          {convFoldCount > 0 && (
            <div className="folded-summary-row">
              <span>插件已保存 {convFoldCount} 个折叠会话</span>
              <button type="button" className="text-button is-danger" onClick={restoreAllFoldedConversations}>
                全部恢复
              </button>
            </div>
          )}
        </FeatureSection>

        <FeatureSection
          icon="🔗"
          title="链接预览"
          summary={linkPreviewEnabled ? '非 GitHub 链接显示快捷按钮' : '已关闭，链接保持原样'}
          enabled={linkPreviewEnabled}
          onToggleEnabled={() => toggleSetting(LINK_PREVIEW_STORAGE_KEY, 'linkPreviewEnabled')}
          open={openFeature === 'linkPreview'}
          onToggleOpen={() => toggleFeature('linkPreview')}
          disabled={loading}
        >
          <p className="feature-note">
            非 GitHub 链接一条一个按钮，名称由链接地址生成；GitHub 的现有快捷按钮和 PR/Issue 卡片保持不变。
          </p>
        </FeatureSection>

        <FeatureSection
          icon="📥"
          title="导出对话"
          summary={
            exportResult
              ? exportResult.summary
              : exportError
                ? exportError
                : '导出当前会话为 Markdown'
          }
          open={openFeature === 'export'}
          onToggleOpen={() => toggleFeature('export')}
        >
          <div
            className={`export-panel${exportResult ? ' is-done' : ''}`}
            aria-live="polite"
            aria-busy={exportBusy}
          >
            <div className="export-format">
              <span className="export-format-icon" aria-hidden="true">
                {exportResult ? '✓' : 'MD'}
              </span>
              <span className="export-format-copy">
                <strong>{exportResult ? exportResult.summary : 'Markdown 文件'}</strong>
                <small>
                  {exportResult
                    ? `${exportResult.fileName}.md`
                    : '包含发送者、时间和当前已加载的消息'}
                </small>
              </span>
            </div>
            {exportError && <p className="export-error" role="alert">{exportError}</p>}
            <div className="export-actions">
              <button
                type="button"
                className="primary-button"
                disabled={exportBusy}
                onClick={exportResult ? downloadExport : () => triggerExport('markdown')}
              >
                <span aria-hidden="true">{exportBusy ? '•••' : '↓'}</span>
                {exportBusy ? '正在读取' : exportResult ? '下载文件' : '导出当前对话'}
              </button>
              {exportResult && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => triggerExport('markdown')}
                >
                  重新导出
                </button>
              )}
            </div>
            {!exportResult && (
              <small className="export-local-note">文件在本地生成，不会上传聊天内容</small>
            )}
          </div>
        </FeatureSection>

      </div>

      {panelTab === 'bot' && <BotTestPanel open onToggleOpen={() => {}} />}

      <p className="footnote">仅在 im.deepminer.com.cn 生效 · 所有处理均在本地完成</p>

      <ThemePicker
        open={activeThemePicker === 'message'}
        title="选择消息主题"
        description="改变消息气泡、头像和会话细节"
        themes={THEMES}
        selectedId={themeId}
        appliesImmediately={masterEnabled}
        onSelect={(id) => chooseSetting(THEME_STORAGE_KEY, 'themeId', id)}
        onClose={closeThemePicker}
      />
      <ThemePicker
        open={activeThemePicker === 'global'}
        title="选择全站配色"
        description="改变导航、会话列表、聊天区和输入框"
        themes={GLOBAL_THEMES}
        selectedId={globalThemeId}
        appliesImmediately={masterEnabled}
        onSelect={(id) => chooseSetting(GLOBAL_THEME_STORAGE_KEY, 'globalThemeId', id)}
        onClose={closeThemePicker}
      />
    </main>
  );
}

export default App;
