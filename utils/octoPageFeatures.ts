/**
 * Registry of page-side features, i.e. everything the master switch turns on
 * and off inside the Octo tab.
 *
 * The problem this solves: turning the master switch off promises to leave the
 * page exactly as if the extension were not installed. That promise used to be
 * kept by a hand-written list of teardown calls inside `applyMaster`, growing by
 * one line per feature. Forgetting a line there leaves injected styles or
 * attributes behind, and nothing catches it — the failure is invisible until a
 * user notices the page never went back to normal.
 *
 * Here a feature cannot exist without declaring how to stop it: `stop` is
 * mandatory, and teardown is a full traversal of the registry rather than a list
 * someone has to remember to extend.
 *
 * Two orders, deliberately independent:
 *
 * - Registry order is TEARDOWN order, because teardown must be exhaustive and
 *   is a straight walk over every entry.
 * - Startup is a separate, explicit sequence, because it is not the reverse of
 *   teardown (the beautify engine has to be up before recall restores rows) and
 *   some features are started by an incoming setting rather than by the master
 *   switch. Omitting a feature from the startup order is a visible bug — the
 *   feature simply does not run — whereas omitting a teardown is silent, which
 *   is why only the latter is enforced structurally.
 *
 * `octoPageFeatures.test.ts` pins both orders, so a reordering has to be
 * deliberate rather than accidental.
 */

export interface PageFeature {
  /** Stable identifier, used by the startup order and by tests. */
  readonly id: string;
  /**
   * Bring the feature up. Optional: features driven entirely by a setting
   * message (the composer enhancement, the desktop pet) have nothing to do when
   * the master switch flips on — the content script replays their setting right
   * after, which is what starts them.
   */
  readonly start?: () => void;
  /**
   * Revert every page-visible effect of this feature. Mandatory, and expected
   * to be safe to call when the feature was never started.
   */
  readonly stop: () => void;
}

/**
 * Run every feature's teardown, in registry order.
 *
 * One failing teardown must not strand the rest — a half-reverted page is worse
 * than one where a single feature misbehaved — so failures are contained per
 * feature, matching the per-pass error containment used inside the beautify sync.
 */
export function stopAllFeatures(features: readonly PageFeature[]): void {
  for (const feature of features) {
    try {
      feature.stop();
    } catch {
      /* keep tearing the rest down */
    }
  }
}

/**
 * Start the named features, in the given order.
 *
 * Ids with no `start` are skipped, so the startup order can name a feature for
 * documentation purposes even when the master switch has nothing to do for it.
 * An unknown id is ignored rather than thrown on: this runs in the page, where
 * throwing during boot would take down the rest of the startup sequence.
 */
export function startFeatures(
  features: readonly PageFeature[],
  order: readonly string[],
): void {
  for (const id of order) {
    const feature = features.find((candidate) => candidate.id === id);
    if (!feature?.start) continue;
    try {
      feature.start();
    } catch {
      /* one feature failing to start must not abort the others */
    }
  }
}
