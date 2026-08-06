/**
 * Mutation triage for the beautify engine's debounced sync.
 *
 * The engine watches `document.body` with `subtree: true`, so in a busy IM it
 * wakes up constantly: tooltips, hover states, read receipts, the virtual list
 * recycling rows, our own overlays. Previously every one of those wake-ups ran a
 * full-document sync — several `querySelectorAll` passes over every message plus
 * a `scrollHeight` read per message.
 *
 * This module answers two questions about a mutation batch:
 *   1. what kind of work does it actually require? (so unrelated churn is free)
 *   2. which subtrees changed? (so the passes can query inside them instead of
 *      re-scanning the whole conversation)
 *
 * Question 2 matters more than it looks: the clamp candidate selector uses
 * `:has()` and chained `:not()`, which measured ~19x slower than a plain class
 * selector and dominates the cost of a sync once the conversation is long. It is
 * cheap only when the subtree it runs against is small.
 *
 * Everything here is pure and structural, which keeps it unit testable without a
 * DOM.
 */

import { OCTO_SELECTORS } from './octoSelectors';

/** Elements whose appearance/removal means the message passes must re-run. */
const MESSAGE_SELECTOR = [
  OCTO_SELECTORS.messageRow,
  OCTO_SELECTORS.messageBody,
  OCTO_SELECTORS.foldMessageBody,
  OCTO_SELECTORS.foldToggle,
].join(', ');

/** Bot profile card nodes; these need a synchronous rarity roll, pre-paint. */
const BOT_CARD_SELECTOR = [
  OCTO_SELECTORS.botCardContent,
  '.wk-bot-detail-section',
  OCTO_SELECTORS.botCardModal,
].join(', ');

/**
 * Above this many changed subtrees, scoped queries stop paying off: the
 * per-root overhead plus deduplication costs more than one document-wide pass.
 * Bulk insertions (switching conversation, loading history) land here.
 */
export const MAX_SCOPED_ROOTS = 24;

export interface SyncScope<N = unknown> {
  /**
   * A message row / markdown body / fold toggle was added or removed, so the
   * order-dependent and per-message passes have to run again.
   */
  messages: boolean;
  /** A bot profile card mounted; roll its rarity before the next paint. */
  botCard: boolean;
  /**
   * Added subtrees the message passes can restrict themselves to.
   *
   * `undefined` means "no usable narrowing — scan the document". That is the
   * case for a full sync, for removals (which shift state in nodes that are no
   * longer reachable from any root), and for oversized batches.
   */
  roots?: N[];
}

/** Every pass enabled over the whole document — boot, setting changes, re-enable. */
export const FULL_SYNC_SCOPE: SyncScope<never> = { messages: true, botCard: true };

/** Nothing relevant changed at all — the caller can skip every pass. */
export const EMPTY_SYNC_SCOPE: SyncScope<never> = { messages: false, botCard: false };

export function isEmptyScope(scope: SyncScope<unknown>): boolean {
  return !scope.messages && !scope.botCard;
}

/**
 * Union two scopes. Used when the debounce coalesces several mutation batches:
 * the work of every batch must survive, and roots only survive if *both* sides
 * could be narrowed (otherwise one of them needed the whole document anyway).
 */
export function mergeScopes<N>(a: SyncScope<N>, b: SyncScope<N>): SyncScope<N> {
  const merged: SyncScope<N> = {
    messages: a.messages || b.messages,
    botCard: a.botCard || b.botCard,
  };
  if (a.roots && b.roots) {
    const roots = a.roots.concat(b.roots);
    if (roots.length <= MAX_SCOPED_ROOTS) merged.roots = roots;
  } else if (!a.roots && !b.roots && isEmptyScope(a) !== isEmptyScope(b)) {
    // One side had nothing to say; keep the other side's (absent) narrowing.
    merged.roots = undefined;
  }
  return merged;
}

/**
 * The minimal slice of `Element` we need. Keeping it structural lets tests use
 * plain objects instead of standing up a DOM.
 */
export interface ElementLike {
  nodeType: number;
  matches(selector: string): boolean;
  querySelector(selector: string): unknown;
}

export interface MutationRecordLike<N> {
  addedNodes: ArrayLike<N>;
  removedNodes: ArrayLike<N>;
}

const ELEMENT_NODE = 1;

function touches(node: unknown, selector: string): boolean {
  const el = node as ElementLike;
  // `matches` covers the node itself; `querySelector` covers a wrapper that
  // brought a whole subtree of rows in with it (the common virtual-list case).
  return el.matches(selector) || el.querySelector(selector) != null;
}

/**
 * Classify a mutation batch.
 *
 * Removed nodes are inspected too: deleting a row shifts the AI-continue chain
 * for every row after it, so the sequential pass must re-run. Removals cannot
 * contribute a root though — the affected rows are the *surviving* ones — so any
 * removal forces a document-wide pass.
 */
export function classifyMutations<N extends { nodeType: number }>(
  records: ArrayLike<MutationRecordLike<N>>,
): SyncScope<N> {
  let messages = false;
  let botCard = false;
  let needsDocumentScan = false;
  const roots: N[] = [];

  for (let i = 0; i < records.length; i += 1) {
    const { addedNodes, removedNodes } = records[i];

    for (let j = 0; j < addedNodes.length; j += 1) {
      const node = addedNodes[j];
      if (node.nodeType !== ELEMENT_NODE) continue;
      if (touches(node, MESSAGE_SELECTOR)) {
        messages = true;
        if (roots.length < MAX_SCOPED_ROOTS) roots.push(node);
        else needsDocumentScan = true;
      }
      if (!botCard && touches(node, BOT_CARD_SELECTOR)) botCard = true;
    }

    for (let j = 0; j < removedNodes.length; j += 1) {
      const node = removedNodes[j];
      if (node.nodeType !== ELEMENT_NODE) continue;
      if (touches(node, MESSAGE_SELECTOR)) {
        messages = true;
        needsDocumentScan = true;
      }
      // Bot cards only ever *mount*; a removal needs no roll.
    }
  }

  const scope: SyncScope<N> = { messages, botCard };
  if (messages && !needsDocumentScan) scope.roots = roots;
  return scope;
}
