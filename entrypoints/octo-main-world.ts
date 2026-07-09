import {
  MESSAGE_SOURCE,
  MESSAGE_TYPE,
  type OctoMessage,
} from '@/utils/octoRecall';
import { DEFAULT_THEME, initBeautify, setKickStyle, setTheme } from '@/utils/octoBeautify';

/**
 * MAIN-world script.
 *
 * Two independent features run here in the page's JS context:
 *
 * 1. Show recalled messages — octo hides a revoked message's content behind a
 *    "XX撤回了一条消息" tip, but the original payload stays in React memory on
 *    `message.content`. We walk the fiber from the revoked row to the cell's
 *    `memoizedProps.message`, clone a normal row, and render the original.
 *
 * 2. Beautify + theme (skin) — ported from an9xyz/octo-script; see
 *    utils/octoBeautify.ts. Driven by the popup via postMessage.
 *
 * We only READ React props here — no prototype patching, no state mutation.
 * Every node we add carries an `octo-recall-*` class so toggling off fully
 * reverts the DOM.
 */
export default defineUnlistedScript(() => {
  // Beautify + theme engine boots immediately (theme id arrives via message,
  // default until then). Independent of the recall toggle below.
  initBeautify(DEFAULT_THEME);

  // Revoked rows render as a system message. We do NOT gate on the tip text —
  // octo has several revoke phrasings (你撤回…/XX撤回…/撤回了成员…的一条消息/EN),
  // so the reliable signal is `message.revoke === true` read from the fiber.
  const ITEM_SELECTOR = '.wk-message-item';
  const SYSTEM_SELECTOR = '.wk-message-system';
  const ROW_SELECTOR = '.wk-msg-row'; // octo's normal message row
  const CLONE_CLASS = 'octo-recall-clone'; // our restored bubble (cloned row)
  const ITEM_CLASS = 'octo-recall-item'; // marks a message item we restored
  const BADGE_CLASS = 'octo-recall-badge';
  const BOX_CLASS = 'octo-recall-box'; // gray box around restored content
  const HIDDEN_CLASS = 'octo-recall-hidden-tip'; // marks a hidden native tip
  const DONE_ATTR = 'octoRecallDone'; // dataset key -> data-octo-recall-done
  const SYSCLASS_ATTR = 'octoRecallSysclass'; // marks that we removed the system class
  const STYLE_ID = 'octo-recall-style';
  const MAX_FIBER_DEPTH = 12;
  const MAX_FIBER_NODES = 800;
  const SCAN_DEBOUNCE_MS = 150;

  let enabled = false;
  let observer: MutationObserver | null = null;
  let scanTimer: number | undefined;

  // ---- fiber reflection ---------------------------------------------------

  function findFiberKey(el: Element): string | undefined {
    return Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  }

  /**
   * From a `.wk-message-item` DOM node, descend the fiber tree to the first
   * child fiber whose `memoizedProps.message` is an object (the MessageCell /
   * RevokeCell). Returns that MessageWrap, or null.
   */
  function getMessageWrapFromItem(item: Element): any | null {
    const key = findFiberKey(item);
    if (!key) return null;
    const rootFiber = (item as any)[key];
    if (!rootFiber) return null;

    const stack: Array<{ fiber: any; depth: number }> = [
      { fiber: rootFiber.child, depth: 1 },
    ];
    let guard = 0;
    while (stack.length && guard < MAX_FIBER_NODES) {
      guard++;
      const node = stack.pop();
      if (!node || !node.fiber || node.depth > MAX_FIBER_DEPTH) continue;
      const { fiber, depth } = node;
      const props = fiber.memoizedProps;
      if (
        props &&
        typeof props === 'object' &&
        'message' in props &&
        props.message &&
        typeof props.message === 'object'
      ) {
        return props.message;
      }
      if (fiber.child) stack.push({ fiber: fiber.child, depth: depth + 1 });
      if (fiber.sibling) stack.push({ fiber: fiber.sibling, depth });
    }
    return null;
  }

  /**
   * Pull the original text out of a revoked MessageWrap. Text messages
   * (contentType 1) expose `content.text`; for richer types we fall back to
   * the SDK-provided `conversationDigest` (e.g. "[图片]"), avoiding per-type
   * parsing. Returns null when nothing usable is present.
   */
  function extractOriginal(mw: any): string | null {
    if (!mw || mw.revoke !== true) return null;
    const inner = mw.message;
    const content = inner && inner.content;
    if (!content) return null;
    const text = content.text;
    if (typeof text === 'string' && text.length > 0) return text;
    const digest = content.conversationDigest;
    if (typeof digest === 'string' && digest.length > 0) return digest;
    return null;
  }

  // ---- DOM restore / clear ------------------------------------------------

  function formatTimestamp(sec: number): string {
    const d = new Date(sec * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
      d.getMinutes(),
    )}`;
  }

  /**
   * Find a real message row to clone, matching the send/recv side so alignment
   * and colors come out native. Falls back to any row. Never clones one of our
   * own restored rows.
   */
  function pickDonorRow(send: boolean): HTMLElement | null {
    const rows = document.querySelectorAll<HTMLElement>(ROW_SELECTOR);
    let fallback: HTMLElement | null = null;
    for (const row of rows) {
      if (row.classList.contains(CLONE_CLASS)) continue;
      if (!row.querySelector('.wk-msg-row-body')) continue;
      fallback ??= row;
      const isSend = row.classList.contains('wk-msg-row--send');
      // Prefer a non-"continue" donor of the same side (has avatar + header).
      if (isSend === send && !row.classList.contains('wk-msg-row--continue')) {
        return row;
      }
    }
    return fallback;
  }

  /**
   * Rebuild a revoked message as a normal-looking bubble by cloning a real row
   * and swapping in the original content, then hide the native "撤回" tip.
   * The clone is static (React handlers don't fire) but visually native.
   */
  function restoreRow(item: HTMLElement): void {
    if (!enabled) return;
    // Idempotency keyed on the actual clone, not just a flag that can desync.
    if (item.querySelector(`.${CLONE_CLASS}`)) return;

    // Only system rows carry the revoke tip; cheap pre-filter before fiber walk.
    const systemEl = item.querySelector<HTMLElement>(SYSTEM_SELECTOR);
    if (!systemEl) return;

    const mw = getMessageWrapFromItem(item);
    const original = extractOriginal(mw); // returns null unless revoke === true
    if (original == null) return;

    const inner = mw.message;
    // octo normalizes all rows to the left layout (see below), so prefer a
    // plain (recv-style) donor row for the cleanest structural match.
    const donor = pickDonorRow(false);
    if (!donor) return;

    const clone = donor.cloneNode(true) as HTMLElement;
    clone.classList.add(CLONE_CLASS);
    // octo lays every message out left-aligned (avatar always on the left);
    // the --send modifier only adds an indent that would misalign our row, so
    // we normalize to the plain left layout to line up with normal messages.
    clone.classList.remove('wk-msg-row--send', 'wk-msg-row--continue');

    // Avatar
    const img = clone.querySelector<HTMLImageElement>('.wk-msg-avatar-img');
    if (img && inner.fromUID) {
      img.src = `/api/v1/users/${encodeURIComponent(inner.fromUID)}/avatar`;
      img.alt = (inner.from && inner.from.title) || '';
    }
    // Sender name
    const sender = clone.querySelector('.wk-msg-row-sender');
    if (sender && inner.from && inner.from.title) {
      sender.textContent = inner.from.title;
    }
    // Timestamp
    const ts = clone.querySelector('.wk-msg-row-timestamp');
    if (ts && inner.timestamp) ts.textContent = formatTimestamp(inner.timestamp);

    // Body -> plain original text (textContent, XSS-safe) inside a subtly
    // grayed, bordered box so the recalled content reads as "recovered".
    // We intentionally do not re-render markdown; a clean paragraph avoids
    // any injection surface.
    const body = clone.querySelector('.wk-msg-row-body');
    if (body) {
      body.textContent = '';
      const textContent = document.createElement('div');
      textContent.className = 'wk-msg-text-content';
      const box = document.createElement('div');
      box.className = `wk-markdown wk-markdown-recv ${BOX_CLASS}`;
      const p = document.createElement('p');
      p.textContent = original;
      box.appendChild(p);
      textContent.appendChild(box);
      body.appendChild(textContent);
    }
    // "已撤回" badge in the header (falls back to prepending to content).
    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    badge.textContent = '已撤回';
    const header = clone.querySelector('.wk-msg-row-header');
    if (header) header.appendChild(badge);
    else clone.querySelector('.wk-msg-row-content')?.prepend(badge);

    // Hide native tip (reversibly) and neutralize the system-row layout the
    // item still gets from octo's `:has(.wk-message-system)` rule (centered +
    // extra padding). We add a marker class the CSS resets, and record whether
    // we removed `wk-message-item-system` so clearAll restores prior state.
    systemEl.classList.add(HIDDEN_CLASS);
    item.classList.add(ITEM_CLASS);
    if (item.classList.contains('wk-message-item-system')) {
      item.classList.remove('wk-message-item-system');
      item.dataset[SYSCLASS_ATTR] = '1';
    }
    item.appendChild(clone);
    item.dataset[DONE_ATTR] = '1';
  }

  function scan(): void {
    if (!enabled) return;
    const items = document.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    items.forEach((item) => {
      try {
        restoreRow(item);
      } catch {
        // Never let one bad row break the sweep; leave it as the native tip.
      }
    });
  }

  function clearAll(): void {
    document.querySelectorAll(`.${CLONE_CLASS}`).forEach((el) => el.remove());
    document
      .querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}`)
      .forEach((el) => el.classList.remove(HIDDEN_CLASS));
    document
      .querySelectorAll<HTMLElement>(`${ITEM_SELECTOR}[data-octo-recall-done]`)
      .forEach((item) => {
        item.classList.remove(ITEM_CLASS);
        // Only restore the system class if we were the ones who removed it.
        if (item.dataset[SYSCLASS_ATTR]) {
          item.classList.add('wk-message-item-system');
          delete item.dataset[SYSCLASS_ATTR];
        }
        delete item.dataset[DONE_ATTR];
      });
  }

  function scheduleScan(): void {
    if (scanTimer) window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  // ---- style --------------------------------------------------------------

  function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${HIDDEN_CLASS} { display: none !important; }
      .${ITEM_CLASS} {
        /* undo octo's :has(.wk-message-system) system-row layout so the
           restored row aligns exactly like a normal message */
        padding: 0 !important;
        justify-content: normal !important;
      }
      .${BADGE_CLASS} {
        display: inline-flex;
        align-items: center;
        margin-left: 6px;
        padding: 0 6px;
        height: 16px;
        border-radius: 8px;
        background: rgba(250, 173, 20, 0.16);
        color: #d48806;
        font-size: 11px;
        font-weight: 600;
        line-height: 16px;
        vertical-align: middle;
      }
      .${BOX_CLASS} {
        display: inline-block;
        margin-top: 2px;
        padding: 6px 10px;
        border: 1px solid rgba(0, 0, 0, 0.09);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.03);
        color: #646a73;
      }
      body[theme-mode='dark'] .${BADGE_CLASS} {
        background: rgba(250, 173, 20, 0.22);
        color: #f0b429;
      }
      body[theme-mode='dark'] .${BOX_CLASS} {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.05);
        color: #a6a6a6;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- enable / disable ---------------------------------------------------

  function enable(): void {
    if (enabled) return;
    enabled = true;
    ensureStyle();
    scan();
    if (!observer) {
      observer = new MutationObserver(scheduleScan);
    }
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function disable(): void {
    enabled = false;
    if (observer) observer.disconnect();
    if (scanTimer) {
      window.clearTimeout(scanTimer);
      scanTimer = undefined;
    }
    clearAll();
  }

  function applyToggle(next: boolean): void {
    if (next) enable();
    else disable();
  }

  // ---- messaging from the content script ----------------------------------

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as OctoMessage | undefined;
    if (!data || data.source !== MESSAGE_SOURCE) return;
    if (data.type === MESSAGE_TYPE.toggle) {
      applyToggle(!!data.enabled);
    } else if (data.type === MESSAGE_TYPE.theme) {
      setTheme(data.themeId);
    } else if (data.type === MESSAGE_TYPE.kickStyle) {
      setKickStyle(data.styleId);
    }
  });
});
