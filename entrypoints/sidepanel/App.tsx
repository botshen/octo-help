import { browser } from '#imports';
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
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
  GLOBAL_THEME_STORAGE_KEY,
  KICK_STYLE_STORAGE_KEY,
  MASTER_STORAGE_KEY,
  MESSI_WATERMARK_STORAGE_KEY,
  PLAYER_WATERMARK_STORAGE_KEY,
  QQ_SELF_LEFT_STORAGE_KEY,
  COMPAT_REPORT_STORAGE_KEY,
  STORAGE_KEY,
  THEME_STORAGE_KEY,
  type PlayerWatermarkId,
  type BuiltInCompanionId,
  type DesktopPetPlacement,
  type StoredCompatReport,
  type StoredDesktopPet,
} from '@/utils/octoRecall';
import {
  GLOBAL_THEMES,
  THEMES,
  DEFAULT_GLOBAL_THEME,
  DEFAULT_THEME,
  KICK_STYLES,
  DEFAULT_KICK_STYLE,
  type GlobalThemeDef,
  type ThemeCategory,
  type ThemeDef,
} from '@/utils/octoThemeCatalog';
import { isBuiltInCompanionId, isStoredDesktopPet } from '@/utils/octoPetState';
import { AiBalanceBanner, AiBalanceCard } from './AiBalanceCard';
import { FeatureSection } from './FeatureSection';
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

type ThemeChoice = ThemeDef | GlobalThemeDef;
type ThemeFilter = 'all' | ThemeCategory;

const THEME_FILTERS: Array<{ id: ThemeFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'classic', label: '经典' },
  { id: 'special', label: '特色' },
];

function ThemeSwatch({ theme, compact = false }: { theme: ThemeChoice; compact?: boolean }) {
  const style = {
    '--swatch-a': theme.colors[0],
    '--swatch-b': theme.colors[1],
    '--swatch-c': theme.colors[2],
  } as CSSProperties;

  return (
    <span className={`theme-swatch${compact ? ' is-compact' : ''}`} style={style} aria-hidden="true">
      <span className="theme-swatch-icon">{theme.icon}</span>
    </span>
  );
}

interface ThemePickerProps {
  open: boolean;
  title: string;
  description: string;
  themes: ThemeChoice[];
  selectedId: string;
  appliesImmediately: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function ThemePicker({
  open,
  title,
  description,
  themes,
  selectedId,
  appliesImmediately,
  onSelect,
  onClose,
}: ThemePickerProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ThemeFilter>('all');
  const searchInput = useRef<HTMLInputElement>(null);
  const pickerPanel = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const showDiscoveryTools = themes.length > 8;

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setFilter('all');
    const focusTimer = window.setTimeout(() => {
      if (searchInput.current) searchInput.current.focus();
      else pickerPanel.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = pickerPanel.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [open, onClose]);

  const availableFilters = useMemo(
    () => THEME_FILTERS.filter((item) => item.id === 'all' || themes.some((theme) => theme.category === item.id)),
    [themes],
  );

  const filteredThemes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return themes.filter((theme) => {
      if (filter !== 'all' && theme.category !== filter) return false;
      if (!normalizedQuery) return true;
      const searchable = [theme.label, theme.description, ...(theme.keywords ?? [])]
        .join(' ')
        .toLocaleLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [filter, query, themes]);

  useEffect(() => {
    if (!open || query || filter !== 'all') return;
    const timer = window.setTimeout(() => {
      pickerPanel.current
        ?.querySelector<HTMLElement>('.theme-option.is-selected')
        ?.scrollIntoView({ block: 'nearest' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [filter, open, query, selectedId]);

  if (!open) return null;

  return (
    <div
      className="theme-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={pickerPanel}
        className={`theme-picker${showDiscoveryTools ? '' : ' is-compact'}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-picker-title"
        aria-describedby="theme-picker-description"
      >
        <header className="theme-picker-header">
          <div>
            <h2 id="theme-picker-title">{title}</h2>
            <p id="theme-picker-description">{description}</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭主题选择" onClick={onClose}>
            ×
          </button>
        </header>

        {showDiscoveryTools && <div className="theme-picker-tools">
          <label className="theme-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInput}
              type="search"
              value={query}
              placeholder="搜索主题名称、颜色或风格"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            {query && (
              <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
                ×
              </button>
            )}
          </label>
          <div className="theme-filters" role="group" aria-label="主题分类">
            {availableFilters.map((item) => {
              const count = item.id === 'all'
                ? themes.length
                : themes.filter((theme) => theme.category === item.id).length;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  className={filter === item.id ? 'is-active' : ''}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}<span>{count}</span>
                </button>
              );
            })}
          </div>
        </div>}

        {showDiscoveryTools && <div className="theme-picker-summary" aria-live="polite">
          {filteredThemes.length > 0
            ? `找到 ${filteredThemes.length} 个主题`
            : '没有匹配的主题'}
        </div>}

        <div className="theme-options">
          {filteredThemes.map((theme) => {
            const selected = theme.id === selectedId;
            return (
              <button
                key={theme.id}
                type="button"
                className={`theme-option${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onSelect(theme.id)}
              >
                <ThemeSwatch theme={theme} />
                <span className="theme-option-copy">
                  <strong>{theme.label}</strong>
                  <small>{theme.description}</small>
                </span>
                <span className="theme-option-state">{selected ? '已选' : ''}</span>
              </button>
            );
          })}
          {filteredThemes.length === 0 && (
            <div className="theme-empty">
              <span aria-hidden="true">◌</span>
              <strong>换个关键词试试</strong>
              <small>可以搜索“深色”、“QQ”或“足球”</small>
            </div>
          )}
        </div>

        <footer className="theme-picker-footer">
          <span><i />{appliesImmediately ? '点击主题后会立即应用' : '重新开启全部增强后应用'}</span>
          <button type="button" onClick={onClose}>完成</button>
        </footer>
      </div>
    </div>
  );
}

function normalizeStoredId(
  value: unknown,
  options: ReadonlyArray<{ id: string }>,
  fallback: string,
): string {
  return typeof value === 'string' && options.some((option) => option.id === value)
    ? value
    : fallback;
}

/**
 * Validate a persisted compatibility report before trusting it in the UI.
 *
 * The value originates in the MAIN world (page context), so it is treated as
 * untrusted input even though the content script already filtered it.
 */
function readCompatReport(value: unknown): StoredCompatReport | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredCompatReport>;
  if (!Array.isArray(candidate.brokenFeatures) || typeof candidate.checkedAt !== 'number') {
    return null;
  }
  const brokenFeatures = candidate.brokenFeatures
    .filter((entry): entry is string => typeof entry === 'string')
    .slice(0, 12);
  return {
    brokenFeatures,
    brokenKeys: Array.isArray(candidate.brokenKeys)
      ? candidate.brokenKeys.filter((k): k is string => typeof k === 'string').slice(0, 12)
      : [],
    checkedAt: candidate.checkedAt,
  };
}

function App() {
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [themeId, setThemeId] = useState(DEFAULT_THEME);
  const [globalThemeId, setGlobalThemeId] = useState(DEFAULT_GLOBAL_THEME);
  const [kickStyle, setKick] = useState(DEFAULT_KICK_STYLE);
  const [playerWatermark, setPlayerWatermark] = useState<PlayerWatermarkId>('none');
  const [ballCursor, setBallCursor] = useState(true);
  const [qqSelfLeft, setQqSelfLeft] = useState(false);
  const [desktopPet, setDesktopPet] = useState<StoredDesktopPet | null>(null);
  const [desktopPetEnabled, setDesktopPetEnabled] = useState(false);
  const [builtInCompanion, setBuiltInCompanion] =
    useState<BuiltInCompanionId | null>(null);
  const [desktopPetPlacement, setDesktopPetPlacement] =
    useState<DesktopPetPlacement>('desktop');
  const [composerEnhancement, setComposerEnhancement] = useState(true);
  const [petBusy, setPetBusy] = useState(false);
  const [petError, setPetError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [compatReport, setCompatReport] = useState<StoredCompatReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeThemePicker, setActiveThemePicker] = useState<'message' | 'global' | null>(null);
  const [beautifyEnabled, setBeautifyEnabled] = useState(true);
  /**
   * Which feature is expanded. One at a time on purpose: the panel's problem was
   * that every knob of every feature was on screen at once.
   */
  const [openFeature, setOpenFeature] = useState<string | null>(null);
  /** Restores the previous shooter when the football switch is flipped back on. */
  const lastPlayer = useRef<PlayerWatermarkId>('messi');
  const petFileInput = useRef<HTMLInputElement>(null);
  const closeThemePicker = useCallback(() => setActiveThemePicker(null), []);

  const selectedMessageTheme = THEMES.find((theme) => theme.id === themeId) ?? THEMES[0];
  const selectedGlobalTheme = GLOBAL_THEMES.find((theme) => theme.id === globalThemeId) ?? GLOBAL_THEMES[0];
  const selectedBuiltInCompanion = BUILT_IN_COMPANIONS.find(
    (companion) => companion.id === builtInCompanion,
  );

  useEffect(() => {
    let mounted = true;
    browser.storage.local
      .get([
        MASTER_STORAGE_KEY,
        STORAGE_KEY,
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
        BUILT_IN_COMPANION_STORAGE_KEY,
        COMPAT_REPORT_STORAGE_KEY,
      ])
      .then((res) => {
        if (!mounted) return;
        // Missing key means enabled so existing users keep the current behavior.
        setMasterEnabled(res[MASTER_STORAGE_KEY] !== false);
        setEnabled(res[STORAGE_KEY] === true);
        setBeautifyEnabled(res[BEAUTIFY_STORAGE_KEY] !== false);
        setThemeId(normalizeStoredId(res[THEME_STORAGE_KEY], THEMES, DEFAULT_THEME));
        setGlobalThemeId(
          normalizeStoredId(res[GLOBAL_THEME_STORAGE_KEY], GLOBAL_THEMES, DEFAULT_GLOBAL_THEME),
        );
        setKick(normalizeStoredId(res[KICK_STYLE_STORAGE_KEY], KICK_STYLES, DEFAULT_KICK_STYLE));
        const storedPlayer = res[PLAYER_WATERMARK_STORAGE_KEY];
        if (storedPlayer === 'none' || storedPlayer === 'messi' || storedPlayer === 'mbappe') {
          setPlayerWatermark(storedPlayer);
        } else if (res[MESSI_WATERMARK_STORAGE_KEY] === true) {
          setPlayerWatermark('messi');
        }
        if (storedPlayer === 'messi' || storedPlayer === 'mbappe') lastPlayer.current = storedPlayer;
        // Default ON (missing key => enabled).
        setBallCursor(res[BALL_CURSOR_STORAGE_KEY] !== false);
        setQqSelfLeft(res[QQ_SELF_LEFT_STORAGE_KEY] === true);
        setCompatReport(readCompatReport(res[COMPAT_REPORT_STORAGE_KEY]));
        const storedDesktopPet = isStoredDesktopPet(res[DESKTOP_PET_STORAGE_KEY])
          ? res[DESKTOP_PET_STORAGE_KEY]
          : null;
        const storedBuiltInCompanion = res[BUILT_IN_COMPANION_STORAGE_KEY];
        const nextBuiltInCompanion: BuiltInCompanionId | null = isBuiltInCompanionId(
          storedBuiltInCompanion,
        )
          ? storedBuiltInCompanion
          : storedBuiltInCompanion === undefined && !storedDesktopPet
            ? 'wizard'
            : null;
        setDesktopPet(storedDesktopPet);
        setDesktopPetEnabled(
          res[DESKTOP_PET_ENABLED_STORAGE_KEY] === true ||
          (res[DESKTOP_PET_ENABLED_STORAGE_KEY] === undefined && nextBuiltInCompanion !== null),
        );
        setDesktopPetPlacement(
          res[DESKTOP_PET_PLACEMENT_STORAGE_KEY] === 'composer' ? 'composer' : 'desktop',
        );
        setComposerEnhancement(res[COMPOSER_ENHANCEMENT_STORAGE_KEY] !== false);
        setBuiltInCompanion(nextBuiltInCompanion);
      })
      .catch(() => {
        if (mounted) setPetError('读取本地设置失败，请重新打开扩展');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // The compatibility verdict is produced by the Octo page 1.5-15s after it
  // boots, which is usually *after* the panel has already loaded. Watch for it
  // instead of only reading once on mount, or the warning would never appear in
  // the session where it matters.
  useEffect(() => {
    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      if (!(COMPAT_REPORT_STORAGE_KEY in changes)) return;
      setCompatReport(readCompatReport(changes[COMPAT_REPORT_STORAGE_KEY].newValue));
    };
    browser.storage.local.onChanged.addListener(onChanged);
    return () => browser.storage.local.onChanged.removeListener(onChanged);
  }, []);

  const persistSetting = useCallback(async <T,>(
    key: string,
    previous: T,
    next: T,
    apply: (value: T) => void,
  ) => {
    apply(next);
    setSettingsError('');
    try {
      await browser.storage.local.set({ [key]: next });
    } catch {
      apply(previous);
      setSettingsError('设置保存失败，请重试');
    }
  }, []);

  const toggleMaster = async () => {
    const next = !masterEnabled;
    await persistSetting(MASTER_STORAGE_KEY, masterEnabled, next, setMasterEnabled);
  };

  const toggleBeautify = async () => {
    const next = !beautifyEnabled;
    await persistSetting(BEAUTIFY_STORAGE_KEY, beautifyEnabled, next, setBeautifyEnabled);
  };

  /**
   * The football feature has no boolean of its own — "no shooter" *is* off — so
   * the switch maps onto the watermark choice and remembers the last shooter.
   */
  const toggleFootball = async () => {
    if (playerWatermark === 'none') {
      await choosePlayerWatermark(lastPlayer.current);
      return;
    }
    lastPlayer.current = playerWatermark;
    await choosePlayerWatermark('none');
  };

  const toggleFeature = (id: string) =>
    setOpenFeature((current) => (current === id ? null : id));

  const toggleRecall = async () => {
    const next = !enabled;
    await persistSetting(STORAGE_KEY, enabled, next, setEnabled);
  };

  const chooseTheme = async (id: string) => {
    await persistSetting(THEME_STORAGE_KEY, themeId, id, setThemeId);
  };

  const chooseGlobalTheme = async (id: string) => {
    await persistSetting(GLOBAL_THEME_STORAGE_KEY, globalThemeId, id, setGlobalThemeId);
  };

  const chooseKick = async (id: string) => {
    await persistSetting(KICK_STYLE_STORAGE_KEY, kickStyle, id, setKick);
  };

  const choosePlayerWatermark = async (id: PlayerWatermarkId) => {
    if (id !== 'none') lastPlayer.current = id;
    await persistSetting(
      PLAYER_WATERMARK_STORAGE_KEY,
      playerWatermark,
      id,
      setPlayerWatermark,
    );
  };

  const toggleBallCursor = async () => {
    const next = !ballCursor;
    await persistSetting(BALL_CURSOR_STORAGE_KEY, ballCursor, next, setBallCursor);
  };

  const toggleQqSelfLeft = async () => {
    const next = !qqSelfLeft;
    await persistSetting(QQ_SELF_LEFT_STORAGE_KEY, qqSelfLeft, next, setQqSelfLeft);
  };

  const toggleComposerEnhancement = async () => {
    const next = !composerEnhancement;
    await persistSetting(
      COMPOSER_ENHANCEMENT_STORAGE_KEY,
      composerEnhancement,
      next,
      setComposerEnhancement,
    );
  };

  const chooseDesktopPetPlacement = async (placement: DesktopPetPlacement) => {
    await persistSetting(
      DESKTOP_PET_PLACEMENT_STORAGE_KEY,
      desktopPetPlacement,
      placement,
      setDesktopPetPlacement,
    );
  };

  const chooseBuiltInCompanion = async (id: BuiltInCompanionId) => {
    setPetError('');
    try {
      await browser.storage.local.set({
        [BUILT_IN_COMPANION_STORAGE_KEY]: id,
        [DESKTOP_PET_ENABLED_STORAGE_KEY]: true,
        [DESKTOP_PET_PLACEMENT_STORAGE_KEY]: 'composer',
      });
      setBuiltInCompanion(id);
      setDesktopPetEnabled(true);
      setDesktopPetPlacement('composer');
    } catch {
      setPetError('保存内置宠物失败');
    }
  };

  const chooseCustomPet = async () => {
    if (!desktopPet) return;
    setPetError('');
    try {
      await browser.storage.local.set({
        [BUILT_IN_COMPANION_STORAGE_KEY]: null,
        [DESKTOP_PET_ENABLED_STORAGE_KEY]: true,
      });
      setBuiltInCompanion(null);
      setDesktopPetEnabled(true);
    } catch {
      setPetError('切换自定义宠物失败');
    }
  };

  const importDesktopPet = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setPetError('请选择 .zip 或 .codex-pet.zip 文件');
      return;
    }

    setPetBusy(true);
    setPetError('');
    try {
      const { parsePetPackage } = await import('@/utils/octoPet');
      const pet = await parsePetPackage(file);
      await browser.storage.local.set({
        [DESKTOP_PET_STORAGE_KEY]: pet,
        [DESKTOP_PET_ENABLED_STORAGE_KEY]: true,
        [BUILT_IN_COMPANION_STORAGE_KEY]: null,
      });
      setDesktopPet(pet);
      setDesktopPetEnabled(true);
      setBuiltInCompanion(null);
    } catch (error) {
      setPetError(error instanceof Error ? error.message : '导入宠物失败');
    } finally {
      setPetBusy(false);
    }
  };

  const toggleDesktopPet = async () => {
    if ((!desktopPet && !builtInCompanion) || petBusy) return;
    const next = !desktopPetEnabled;
    setPetError('');
    try {
      await browser.storage.local.set({ [DESKTOP_PET_ENABLED_STORAGE_KEY]: next });
      setDesktopPetEnabled(next);
    } catch {
      setPetError('保存宠物开关失败');
    }
  };

  const deleteDesktopPet = async () => {
    if (!desktopPet || petBusy) return;
    setPetBusy(true);
    setPetError('');
    try {
      const keysToRemove = [
        DESKTOP_PET_STORAGE_KEY,
        DESKTOP_PET_POSITION_STORAGE_KEY,
      ];
      if (!builtInCompanion) {
        keysToRemove.push(
          DESKTOP_PET_ENABLED_STORAGE_KEY,
          DESKTOP_PET_PLACEMENT_STORAGE_KEY,
        );
      }
      await browser.storage.local.remove(keysToRemove);
      setDesktopPet(null);
      if (!builtInCompanion) setDesktopPetEnabled(false);
    } catch {
      setPetError('删除宠物失败');
    } finally {
      setPetBusy(false);
    }
  };

  return (
    <main className="panel">
      {/* The master switch belongs to the app bar, not to the feature list: it is
          not "one more toggle" — off is supposed to look like the extension is
          not installed. Keeping it in the same stack as the per-feature rows made
          it read as a peer of them. */}
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
            onClick={toggleMaster}
          >
            <span className="switch-knob" />
          </button>
        </div>
      </header>

      {/* Hidden while paused: the background stops polling then, so the number
          would be a stale figure with nothing saying so. */}
      {masterEnabled && <AiBalanceBanner />}

      {!masterEnabled && (
        <section className="master-paused" role="status">
          <span className="master-paused-icon" aria-hidden="true">⏸</span>
          <div>
            <strong>全部增强已暂停</strong>
            <p>
              页面已还原成没有安装扩展的样子，余额查询和图标角标也一并停止。
              下面的设置可以照常修改，会在重新启用后生效。
            </p>
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

      <div className={`settings-stack${masterEnabled ? '' : ' is-paused'}`}>
        <AiBalanceCard
          disabled={loading}
          open={openFeature === 'balance'}
          onToggleOpen={() => toggleFeature('balance')}
        />

        <FeatureSection
          icon="◐"
          title="消息美化与主题"
          summary={
            beautifyEnabled
              ? `${selectedMessageTheme.label} · ${selectedGlobalTheme.label}`
              : '已关闭，页面保持 Octo 原样'
          }
          enabled={beautifyEnabled}
          onToggleEnabled={toggleBeautify}
          open={openFeature === 'appearance'}
          onToggleOpen={() => toggleFeature('appearance')}
          disabled={loading}
        >
          <button
            type="button"
            className="choice-row"
            aria-haspopup="dialog"
            disabled={loading}
            onClick={() => setActiveThemePicker('message')}
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
            onClick={() => setActiveThemePicker('global')}
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
                onClick={toggleQqSelfLeft}
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
            <p className="context-note"><span aria-hidden="true">i</span>气泡射门动画需要选用“美加墨世界杯”消息主题</p>
          )}
          <div className="config-row">
            <div className="config-copy">
              <span>射门动画</span>
              <small>选择视觉效果；轨迹会随机使用直线、弧线或反弹</small>
            </div>
            <label className="select-wrap">
              <span className="sr-only">射门动画</span>
              <select value={kickStyle} disabled={loading} onChange={(event) => chooseKick(event.currentTarget.value)}>
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
                  onClick={() => choosePlayerWatermark(player.id)}
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
              onClick={toggleBallCursor}
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
                  onClick={() => chooseDesktopPetPlacement('desktop')}
                >
                  自由拖拽
                </button>
                <button
                  type="button"
                  role="radio"
                  className={`player-option${desktopPetPlacement === 'composer' ? ' is-active' : ''}`}
                  aria-checked={desktopPetPlacement === 'composer'}
                  disabled={loading || petBusy}
                  onClick={() => chooseDesktopPetPlacement('composer')}
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
          summary={composerEnhancement ? '三行编辑区 · 工具栏在右下角' : '已关闭，保持 Octo 原始输入框'}
          enabled={composerEnhancement}
          onToggleEnabled={toggleComposerEnhancement}
          open={openFeature === 'composer'}
          onToggleOpen={() => toggleFeature('composer')}
          disabled={loading}
        >
          <p className="feature-note">
            默认提供三行编辑空间，把工具栏移到右下角，同时保留 Octo 原生的附件、快捷键和全屏展开。
            只调整布局样式，不接管编辑器事件。
          </p>
        </FeatureSection>

        <FeatureSection
          icon="↺"
          iconClass="is-message"
          title="显示已撤回的消息"
          summary={enabled ? '还原原文并标注「已撤回」' : '已关闭'}
          enabled={enabled}
          onToggleEnabled={toggleRecall}
          open={openFeature === 'recall'}
          onToggleOpen={() => toggleFeature('recall')}
          disabled={loading}
        >
          <p className="feature-note">
            Octo 撤回消息时并不删除原文，它仍在页面内存里。开启后会把「撤回了一条消息」还原成正常气泡并加上标注，
            全程只读页面数据，关闭即完全还原。
          </p>
        </FeatureSection>
      </div>

      <p className="footnote">仅在 im.deepminer.com.cn 生效 · 所有处理均在本地完成</p>

      <ThemePicker
        open={activeThemePicker === 'message'}
        title="选择消息主题"
        description="改变消息气泡、头像和会话细节"
        themes={THEMES}
        selectedId={themeId}
        appliesImmediately={masterEnabled}
        onSelect={chooseTheme}
        onClose={closeThemePicker}
      />
      <ThemePicker
        open={activeThemePicker === 'global'}
        title="选择全站配色"
        description="改变导航、会话列表、聊天区和输入框"
        themes={GLOBAL_THEMES}
        selectedId={globalThemeId}
        appliesImmediately={masterEnabled}
        onSelect={chooseGlobalTheme}
        onClose={closeThemePicker}
      />
    </main>
  );
}

export default App;
