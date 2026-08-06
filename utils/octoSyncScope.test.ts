import { describe, expect, it } from 'vitest';
import {
  EMPTY_SYNC_SCOPE,
  MAX_SCOPED_ROOTS,
  classifyMutations,
  isEmptyScope,
  mergeScopes,
  type MutationRecordLike,
} from './octoSyncScope';

/**
 * These tests pin the decision that keeps the beautify engine cheap: a mutation
 * batch that does not touch messages must produce an empty scope, because an
 * empty scope is what stops an O(messages) rescan from running on every tooltip.
 */

const ELEMENT = 1;
const TEXT = 3;

/** Minimal element stand-in: `self` is what `matches` sees, `inside` what `querySelector` finds. */
function el(self: string[], inside: string[] = []) {
  return {
    nodeType: ELEMENT,
    matches: (selector: string) =>
      selector.split(',').some((part) => self.includes(part.trim())),
    querySelector: (selector: string) =>
      selector.split(',').some((part) => inside.includes(part.trim())) ? {} : null,
  };
}

function textNode() {
  return { nodeType: TEXT };
}

type Node = { nodeType: number };

function record(
  added: Node[] = [],
  removed: Node[] = [],
): MutationRecordLike<Node> {
  return { addedNodes: added, removedNodes: removed };
}

describe('classifyMutations', () => {
  it('returns an empty scope for an empty batch', () => {
    expect(classifyMutations([])).toEqual(EMPTY_SYNC_SCOPE);
  });

  it('ignores unrelated element churn', () => {
    const scope = classifyMutations([
      record([el(['.some-tooltip'])]),
      record([el(['.octo-companion-track'])], [el(['.wk-avatar-popover'])]),
    ]);
    expect(isEmptyScope(scope)).toBe(true);
  });

  it('ignores text-node mutations, which is most typing churn', () => {
    const scope = classifyMutations([record([textNode()], [textNode()])]);
    expect(isEmptyScope(scope)).toBe(true);
  });

  it('flags a directly added message row and offers it as a scope root', () => {
    const row = el(['.wk-msg-row']);
    const scope = classifyMutations([record([row])]);
    expect(scope.messages).toBe(true);
    expect(scope.botCard).toBe(false);
    expect(scope.roots).toEqual([row]);
  });

  it('flags a wrapper that brings a subtree of rows with it', () => {
    // The virtual list inserts a container, not the rows themselves.
    const scope = classifyMutations([record([el(['.some-wrapper'], ['.wk-msg-row'])])]);
    expect(scope.messages).toBe(true);
  });

  it('flags removals too, since they shift the AI-continue chain', () => {
    const scope = classifyMutations([record([], [el(['.wk-msg-row'])])]);
    expect(scope.messages).toBe(true);
  });

  it('flags a wrapper subtree and offers the wrapper as the root', () => {
    const wrapper = el(['.some-wrapper'], ['.wk-msg-row']);
    const scope = classifyMutations([record([wrapper])]);
    expect(scope.roots).toEqual([wrapper]);
  });

  it.each([
    '.wk-markdown',
    '.wk-fold-msg-text',
    '.wk-fold-session-card-toggle',
  ])('flags %s as message work', (selector) => {
    expect(classifyMutations([record([el([selector])])]).messages).toBe(true);
  });

  it('flags a mounting bot card', () => {
    const scope = classifyMutations([record([el(['.wk-bot-detail-modal'])])]);
    expect(scope.botCard).toBe(true);
  });

  it('does not flag a bot card that is only being removed', () => {
    // Closing a card needs no rarity roll; only mounting does.
    const scope = classifyMutations([record([], [el(['.wk-bot-detail-content'])])]);
    expect(scope.botCard).toBe(false);
  });

  it('reports both kinds when a batch contains both', () => {
    const row = el(['.wk-msg-row']);
    const scope = classifyMutations([
      record([row]),
      record([el(['.wk-bot-detail-content'])]),
    ]);
    expect(scope.messages).toBe(true);
    expect(scope.botCard).toBe(true);
  });

  describe('scope roots', () => {
    it('withholds roots on removal, since the affected rows are the survivors', () => {
      // Deleting a row re-chains every row *after* it, none of which is reachable
      // from the removed node — so the pass has to look at the document.
      const scope = classifyMutations([record([el(['.wk-msg-row'])], [el(['.wk-msg-row'])])]);
      expect(scope.messages).toBe(true);
      expect(scope.roots).toBeUndefined();
    });

    it('withholds roots for bulk insertions, where a single pass is cheaper', () => {
      const rows = Array.from({ length: MAX_SCOPED_ROOTS + 1 }, () => el(['.wk-msg-row']));
      const scope = classifyMutations(rows.map((row) => record([row])));
      expect(scope.messages).toBe(true);
      expect(scope.roots).toBeUndefined();
    });

    it('keeps roots right up to the cap', () => {
      const rows = Array.from({ length: MAX_SCOPED_ROOTS }, () => el(['.wk-msg-row']));
      const scope = classifyMutations(rows.map((row) => record([row])));
      expect(scope.roots).toHaveLength(MAX_SCOPED_ROOTS);
    });

    it('never offers roots when there is no message work', () => {
      const scope = classifyMutations([record([el(['.wk-bot-detail-modal'])])]);
      expect(scope.botCard).toBe(true);
      expect(scope.roots).toBeUndefined();
    });
  });
});

describe('scope helpers', () => {
  it('treats only the all-false scope as empty', () => {
    expect(isEmptyScope(EMPTY_SYNC_SCOPE)).toBe(true);
    expect(isEmptyScope({ messages: true, botCard: false })).toBe(false);
    expect(isEmptyScope({ messages: false, botCard: true })).toBe(false);
  });

  it('unions scopes so batches coalesced by the debounce keep their work', () => {
    const merged = mergeScopes<Node>(
      { messages: true, botCard: false },
      { messages: false, botCard: true },
    );
    expect(merged.messages).toBe(true);
    expect(merged.botCard).toBe(true);
  });

  it('keeps roots only when both merged scopes could be narrowed', () => {
    const a = el(['.wk-msg-row']);
    const b = el(['.wk-msg-row']);

    expect(
      mergeScopes<Node>(
        { messages: true, botCard: false, roots: [a] },
        { messages: true, botCard: false, roots: [b] },
      ).roots,
    ).toEqual([a, b]);

    // One side needed the whole document, so the union does too.
    expect(
      mergeScopes<Node>(
        { messages: true, botCard: false, roots: [a] },
        { messages: true, botCard: false },
      ).roots,
    ).toBeUndefined();
  });

  it('falls back to a document pass when merging exceeds the root cap', () => {
    const half = Array.from({ length: MAX_SCOPED_ROOTS }, () => el(['.wk-msg-row']));
    const merged = mergeScopes<Node>(
      { messages: true, botCard: false, roots: half },
      { messages: true, botCard: false, roots: half },
    );
    expect(merged.roots).toBeUndefined();
  });
});
