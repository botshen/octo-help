import { getMessageWrapFromItem } from './octoMessageFiber';
import { showDesktopPetSpeech } from './octoPetRenderer';

import { OCTO_SELECTORS } from './octoSelectors';

const ITEM_SELECTOR = OCTO_SELECTORS.messageItem;
const MESSAGE_AREA_SELECTOR = OCTO_SELECTORS.messageArea;
const MAX_SUMMARY_LENGTH = 52;
const MAX_SEEN_KEYS = 500;
const FRESH_MESSAGE_WINDOW_MS = 30_000;
const PROCESS_DELAY_MS = 80;

type UnknownRecord = Record<string, unknown>;

export interface PetSpeech {
  key: string;
  sender: string;
  summary: string;
}

export interface PetSpeechHints {
  sentBySelf?: boolean;
  system?: boolean;
  senderFallback?: string;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value != null && typeof value === 'object' ? value as UnknownRecord : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstIdentifier(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function normalizeSummary(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= MAX_SUMMARY_LENGTH) return compact;
  return `${compact.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}

function contentTypeLabel(contentType: number | undefined): string {
  switch (contentType) {
    case 2:
      return '[图片]';
    case 3:
      return '[GIF]';
    case 4:
      return '[语音]';
    case 5:
      return '[视频]';
    case 6:
      return '[位置]';
    case 7:
      return '[名片]';
    case 8:
      return '[文件]';
    default:
      return '[新消息]';
  }
}

function readTimestamp(messageWrap: unknown): number | null {
  const wrap = asRecord(messageWrap);
  const message = asRecord(wrap?.message) ?? wrap;
  const raw = message?.timestamp ?? wrap?.timestamp;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw < 1_000_000_000_000 ? raw * 1000 : raw;
}

function isFreshMessage(messageWrap: unknown, startedAt: number): boolean {
  const timestamp = readTimestamp(messageWrap);
  return timestamp == null || timestamp >= startedAt - FRESH_MESSAGE_WINDOW_MS;
}

/** Convert an Octo MessageWrap into a short, local-only desktop-pet message. */
export function extractPetSpeech(
  messageWrap: unknown,
  hints: PetSpeechHints = {},
): PetSpeech | null {
  const wrap = asRecord(messageWrap);
  const message = asRecord(wrap?.message) ?? wrap;
  if (!wrap || !message || hints.system) return null;
  if (wrap.revoke === true || message.revoke === true) return null;
  if (
    hints.sentBySelf ||
    wrap.send === true ||
    wrap.isSend === true ||
    message.send === true ||
    message.isSend === true
  ) return null;

  const content = asRecord(message.content);
  const rawType = message.contentType ?? content?.contentType;
  const contentType = typeof rawType === 'number' && Number.isFinite(rawType)
    ? rawType
    : undefined;
  const digest = firstString(content?.conversationDigest, message.conversationDigest);
  const text = firstString(content?.text);
  const summary = normalizeSummary(text || digest || contentTypeLabel(contentType));
  if (!summary) return null;

  const from = asRecord(message.from) ?? asRecord(wrap.from);
  const sender = firstString(
    from?.title,
    from?.name,
    from?.nickname,
    message.fromName,
    wrap.fromName,
    hints.senderFallback,
  ) || '新消息';

  const id = firstIdentifier(
    message.clientMsgNo,
    wrap.clientMsgNo,
    message.messageSeq,
    wrap.messageSeq,
    message.messageID,
    wrap.messageID,
  );
  const timestamp = readTimestamp(messageWrap) ?? '';
  const fromUID = firstIdentifier(message.fromUID, wrap.fromUID);
  const key = id || `${fromUID}|${timestamp}|${contentType ?? ''}|${summary}`;
  return { key, sender, summary };
}

export class PetSpeechDeduper {
  private readonly keys = new Set<string>();

  has(key: string): boolean {
    return this.keys.has(key);
  }

  add(key: string): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    if (this.keys.size > MAX_SEEN_KEYS) {
      const oldest = this.keys.values().next().value as string | undefined;
      if (oldest) this.keys.delete(oldest);
    }
  }
}

function collectMessageItems(node: Node): HTMLElement[] {
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const element = node as HTMLElement;
  const items: HTMLElement[] = [];
  if (element.matches(ITEM_SELECTOR)) items.push(element);
  element.querySelectorAll<HTMLElement>(ITEM_SELECTOR).forEach((item) => items.push(item));
  return items;
}

function readSpeechFromItem(item: HTMLElement): PetSpeech | null {
  if (!item.closest(MESSAGE_AREA_SELECTOR)) return null;
  const row = item.querySelector<HTMLElement>('.wk-msg-row');
  const senderFallback = item.querySelector<HTMLElement>('.wk-msg-row-sender')
    ?.textContent?.trim();
  return extractPetSpeech(getMessageWrapFromItem(item), {
    sentBySelf: row?.classList.contains('wk-msg-row--send') === true,
    system:
      item.classList.contains('wk-message-item-system') ||
      item.querySelector('.wk-message-system') != null,
    senderFallback,
  });
}

/**
 * Observe newly inserted rows only. Existing rows seed the deduper, so opening
 * the extension or switching render state never replays the visible history.
 */
export function startOctoPetSpeech(): () => void {
  const startedAt = Date.now();
  const deduper = new PetSpeechDeduper();
  const existingItems = new WeakSet<HTMLElement>();
  document.querySelectorAll<HTMLElement>(ITEM_SELECTOR).forEach((item) => {
    existingItems.add(item);
    const speech = readSpeechFromItem(item);
    if (speech) deduper.add(speech.key);
  });

  let timer: number | undefined;
  const pending = new Map<HTMLElement, number>();
  const scheduleFlush = () => {
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(flush, PROCESS_DELAY_MS);
  };
  const flush = () => {
    timer = undefined;
    const batch = [...pending.entries()];
    pending.clear();
    batch.forEach(([item, attempts]) => {
      if (!item.isConnected || existingItems.has(item)) return;
      const messageWrap = getMessageWrapFromItem(item);
      // React may attach the fiber shortly after inserting the host element.
      if (!messageWrap && attempts < 3) {
        pending.set(item, attempts + 1);
        return;
      }
      existingItems.add(item);
      if (!isFreshMessage(messageWrap, startedAt)) return;
      const speech = readSpeechFromItem(item);
      if (!speech || deduper.has(speech.key)) return;
      deduper.add(speech.key);
      showDesktopPetSpeech(`${speech.sender}：${speech.summary}`);
    });
    if (pending.size > 0) scheduleFlush();
  };

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        collectMessageItems(node).forEach((item) => {
          if (!existingItems.has(item) && !pending.has(item)) pending.set(item, 0);
        });
      });
    });
    if (pending.size > 0) scheduleFlush();
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
    if (timer != null) window.clearTimeout(timer);
    pending.clear();
  };
}
