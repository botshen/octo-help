/**
 * Single source of truth for every Octo DOM selector the extension queries.
 *
 * Why this file exists: the enhancement hooks into Octo's markup by class name,
 * and those class names were previously duplicated across modules —
 * `.wk-message-item` was declared independently in three files, the composer and
 * conversation selectors in two each. A rename on Octo's side would have to be
 * found in every copy, and missing one produces a half-working extension rather
 * than an obvious failure.
 *
 * The second job of this module is telling us *when* that has happened. Octo is
 * a moving target we do not control: if a redesign renames a class, the affected
 * feature silently stops working and the user only sees "the extension is
 * broken". `checkOctoCompat()` turns that into a specific, reportable fact.
 *
 * Only selectors used from JavaScript belong here. The beautify stylesheet
 * matches many more classes, but CSS degrades quietly by design — a rule that
 * matches nothing costs nothing.
 */

export const OCTO_SELECTORS = {
  /** Scroll host of the message list. Also the app-shell presence probe. */
  conversation: '.wk-conversation-content',
  /** Broader message-area match, used when watching for new messages. */
  messageArea: '.wk-conversation-messages, .wk-conversation-content',
  /** One logical message (may render as a normal row or a system notice). */
  messageItem: '.wk-message-item',
  /** Octo's normal message row, the unit the beautify passes work on. */
  messageRow: '.wk-msg-row',
  /** Row variant: sent by the current user. */
  messageRowSend: '.wk-msg-row--send',
  /** Row variant: continuation of the previous sender's block. */
  messageRowContinue: '.wk-msg-row--continue',
  /** System notice inside an item — this is what a recalled message renders as. */
  messageSystem: '.wk-message-system',
  /** Rendered message body (markdown). */
  messageBody: '.wk-markdown',
  /** Message body inside a folded session card. */
  foldMessageBody: '.wk-fold-msg-text',
  /** Message body in either context. */
  anyMessageBody: '.wk-markdown, .wk-fold-msg-text',
  /** Row sub-parts, used when cloning a system row back into a normal one. */
  messageRowSender: '.wk-msg-row-sender',
  messageRowBody: '.wk-msg-row-body',
  messageRowHeader: '.wk-msg-row-header',
  messageRowContent: '.wk-msg-row-content',
  messageRowTimestamp: '.wk-msg-row-timestamp',
  messageAvatarImg: '.wk-msg-avatar-img',
  /** Where a link shortcut is appended, in normal and folded contexts. */
  linkShortcutHost: '.wk-msg-row-content, .wk-fold-msg-body',
  /** Links inside a message body — the input to the link-card passes. */
  messageBodyLinks: '.wk-markdown a[href], .wk-fold-msg-text a[href]',
  /** Expand/collapse control on a folded session card. */
  foldToggle: '.wk-fold-session-card-toggle',
  /** The message composer container. */
  composer: '.wk-messageinput-card',
  /** Bot profile card body (the gacha card). */
  botCardContent: '.wk-bot-detail-content',
  /** Bot profile card modal wrapper. */
  botCardModal: '.wk-bot-detail-modal',
  /** A section inside the bot profile card. */
  botCardSection: '.wk-bot-detail-section',
  /** The tiltable shell of an open bot profile card. */
  botCardShell: '.wk-bot-detail-modal .wk-modal-shell',
  /** AI marker badge on a row. */
  aiBadge: '.ai-badge',
} as const;

/**
 * Message bodies eligible for the long-message clamp.
 *
 * The four row branches partition messages by AI / own / continuation so each
 * gets the right bubble treatment; the target is always the message body. Kept
 * here rather than inline so a class rename stays a one-file change.
 *
 * Note this selector is expensive — `:has()` plus chained `:not()` benchmarked
 * ~19x slower than a plain class selector — so callers should scope it to a
 * changed subtree rather than running it over the document. See octoSyncScope.
 */
export const CLAMP_CANDIDATE_SELECTOR = [
  `${OCTO_SELECTORS.messageRow}:has(${OCTO_SELECTORS.aiBadge}) ${OCTO_SELECTORS.messageBody}`,
  `${OCTO_SELECTORS.messageRowContinue}[data-ai-continue="true"] ${OCTO_SELECTORS.messageBody}`,
  `${OCTO_SELECTORS.messageRowSend}:not(:has(${OCTO_SELECTORS.aiBadge})) ${OCTO_SELECTORS.messageBody}`,
  `${OCTO_SELECTORS.messageRow}:not(${OCTO_SELECTORS.messageRowSend}):not(:has(${OCTO_SELECTORS.aiBadge})):not([data-ai-continue="true"]) ${OCTO_SELECTORS.messageBody}`,
  OCTO_SELECTORS.foldMessageBody,
].join(',');

export type OctoSelectorKey = keyof typeof OCTO_SELECTORS;

interface CompatCheck {
  key: OctoSelectorKey;
  /** What stops working when this selector matches nothing. */
  feature: string;
  /**
   * Selector that must be present for the check to mean anything. Without it we
   * cannot distinguish "Octo renamed the class" from "there is simply no
   * conversation open right now", and guessing produces false alarms.
   */
  requires: OctoSelectorKey;
}

/**
 * Load-bearing selectors only. A missing one degrades a user-visible feature, so
 * it is worth telling the user about. Cosmetic variants are excluded: e.g. if
 * `.wk-msg-row--send` disappears, own-message bubbles just lose their accent.
 */
const COMPAT_CHECKS: CompatCheck[] = [
  { key: 'messageItem', feature: '撤回消息还原 / 新消息气泡', requires: 'conversation' },
  { key: 'messageRow', feature: '消息美化与主题', requires: 'conversation' },
  { key: 'messageBody', feature: '长消息折叠、链接卡片', requires: 'messageRow' },
  { key: 'composer', feature: '舒适输入框、输入框宠物', requires: 'conversation' },
];

export interface OctoCompatReport {
  /** False when the app shell was not rendered yet — the result says nothing. */
  conclusive: boolean;
  /** Features whose selector matched nothing while its prerequisite was present. */
  brokenFeatures: string[];
  /** Selector keys behind `brokenFeatures`, for logs and bug reports. */
  brokenKeys: OctoSelectorKey[];
}

export const HEALTHY_COMPAT_REPORT: OctoCompatReport = {
  conclusive: true,
  brokenFeatures: [],
  brokenKeys: [],
};

/** Narrow DOM surface, so this stays testable with a stub. */
export interface CompatProbe {
  matches(selector: string): boolean;
}

/**
 * Report which load-bearing selectors no longer match Octo's DOM.
 *
 * Returns `conclusive: false` when the app shell is absent (still booting, or a
 * page without a conversation), because every selector would look "missing" and
 * warning then would be worse than saying nothing.
 */
export function checkOctoCompat(probe: CompatProbe): OctoCompatReport {
  if (!probe.matches(OCTO_SELECTORS.conversation)) {
    return { conclusive: false, brokenFeatures: [], brokenKeys: [] };
  }

  const brokenFeatures: string[] = [];
  const brokenKeys: OctoSelectorKey[] = [];
  for (const check of COMPAT_CHECKS) {
    // Skip checks whose precondition is itself absent: reporting them would
    // just be noise caused by the earlier failure.
    if (!probe.matches(OCTO_SELECTORS[check.requires])) continue;
    if (probe.matches(OCTO_SELECTORS[check.key])) continue;
    brokenKeys.push(check.key);
    if (!brokenFeatures.includes(check.feature)) brokenFeatures.push(check.feature);
  }

  return { conclusive: true, brokenFeatures, brokenKeys };
}

/** Convenience probe backed by the real document. */
export function documentCompatProbe(): CompatProbe {
  return { matches: (selector) => document.querySelector(selector) != null };
}
