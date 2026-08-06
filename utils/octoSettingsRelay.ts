import { MESSAGE_SOURCE, type OctoMessage } from './octoRecall';

/**
 * `Omit` over a discriminated union collapses it into one flattened object type,
 * which would let a caller mix fields from different message kinds. Distributing
 * over the union keeps each variant intact, so the payload still has to match
 * exactly one message shape.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A message payload minus the `source` tag, which postToPage adds. */
export type PageMessagePayload = DistributiveOmit<OctoMessage, 'source'>;

/**
 * Send a message to the MAIN world.
 *
 * Replaces ten near-identical `postXxx` wrappers whose only difference was the
 * payload; the `source` tag and target origin were copy-pasted each time.
 *
 * `'*'` preserves the previous behaviour, and narrowing it would not buy
 * anything: the receiver is a script in this same page, which can observe any
 * message we post regardless. Nothing confidential travels over this channel —
 * see the security notes in README.
 */
export function postToPage(message: PageMessagePayload): void {
  window.postMessage({ source: MESSAGE_SOURCE, ...message } as OctoMessage, '*');
}

/**
 * Flatten a `storage.onChanged` change set to `{ key: newValue }`, so the same
 * parser can read it and the initial `storage.local.get()` snapshot.
 *
 * Keys whose value was removed appear with `undefined`, which some parsers
 * treat as meaningful — see readDesktopPetEnabledFromChange.
 */
export function toNewValues(
  changes: Record<string, { newValue?: unknown }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(changes)) out[key] = changes[key].newValue;
  return out;
}

/** Whether a change set touched any of the given keys. */
export function touchesAny(
  changes: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => key in changes);
}
