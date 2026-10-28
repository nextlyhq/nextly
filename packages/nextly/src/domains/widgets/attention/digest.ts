/**
 * The attention digest: what needs one reader, as one list of items, each a
 * count with where to go about it.
 *
 * ## One reader per item, each on its own
 *
 * Every item is read by a {@link DigestReader}: core's release kinds and each
 * plugin item alike. The readers run at once, each under its own
 * {@link ATTENTION_ITEM_BUDGET_MS} budget and abort signal, so one slow or
 * broken reader costs only its own item. A reader that throws, runs out of
 * time or answers something that is not a count comes back as one `failed`
 * item, logged with its owner and id, and every other item is still answered.
 *
 * ## Absent and zero read the same
 *
 * A reader that answers `null` (the reader may not act on its kind) and one
 * that counts nothing both leave no item, so the digest never tells a reader
 * what it kept from them.
 *
 * ## Who may see an item is asked first, and fails closed
 *
 * A reader's `visible` check runs first, inside the same budget and signal as
 * its count. A check that refuses, throws or runs out of time hides the item
 * rather than failing it: a failed item still shows its label, which a reader
 * not proven to see the item must not be shown.
 *
 * @module domains/widgets/attention/digest
 * @experimental The digest's items may change until the card that draws them
 *   is built on them.
 */

import { getNextlyLogger } from "../../../observability/logger";
import type { AttentionCount } from "../declaration/dashboard";

/**
 * How long one item may take to count. Past it, the item is failed and every
 * other item is still answered.
 */
export const ATTENTION_ITEM_BUDGET_MS = 10_000;

/**
 * The most an item's count shows. A count above it is answered as this number
 * and a floor, which the card draws as "99+": the item's link opens the whole
 * list, so a larger exact number tells the reader nothing more.
 */
const ATTENTION_ITEM_COUNT_CAP = 99;

/** How urgent an item is: critical items rank before every warning. */
export type AttentionSeverity = "critical" | "warning";

/** What an item counts: a core release kind, or a plugin's item. */
export type AttentionDigestKind = "stopped" | "overdue" | "plugin";

/** One item of the digest, as the card, the header and any inbox read it. */
export interface AttentionDigestItem {
  /** Stable across reads: core's `core/<kind>`, or the plugin item's own id. */
  id: string;
  kind: AttentionDigestKind;
  label: string;
  /** Zero only on a failed item, whose count is unknown. */
  count: number;
  /** The count is a floor: counting stopped at a bound. */
  atLeast?: true;
  severity: AttentionSeverity;
  /** Where the reader goes about it: a path relative to the admin, which the admin resolves. */
  link: string;
  /** The count could not be read: it failed, timed out or was not a count. */
  failed?: true;
}

/** One item's reader and what the item is, apart from its count. */
export interface DigestReader {
  id: string;
  kind: AttentionDigestKind;
  label: string;
  severity: AttentionSeverity;
  link: string;
  /** Who declared it, named in the log when it fails: core, or a plugin. */
  owner: string;
  /**
   * Whether the reader may see the item, asked before its count under the
   * same budget and signal. `false`, a throw or running out of time hides the
   * item. Absent, every reader may see it.
   */
  visible?: (signal: AbortSignal) => Promise<boolean>;
  /**
   * The item's count as the reader sees it, or `null` when the reader may not
   * act on it. `signal` aborts when the item's budget runs out or the request
   * is abandoned.
   */
  read: (signal: AbortSignal) => Promise<unknown>;
}

/** A count read back, or `undefined` for anything that is not one. */
export function parseAttentionCount(
  value: unknown
): { count: number; atLeast: boolean } | undefined {
  const whole = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 0;
  if (whole(value)) return { count: value, atLeast: false };
  if (typeof value !== "object" || value === null) return undefined;
  const floor = value as Partial<Extract<AttentionCount, object>>;
  if (!whole(floor.count) || floor.atLeast !== true) return undefined;
  return { count: floor.count, atLeast: true };
}

/** Why an item failed, for the log. */
type Failure = "threw" | "timed-out" | "not-a-count";

/** What one reader answered: its count, `null` when hidden, or why it failed. */
type ReaderAnswer =
  | { count: number; atLeast: boolean }
  | null
  | { failure: Failure; error?: unknown };

/**
 * One reader's answer under its own budget: its count, `null` for an item the
 * reader may not see or act on, or why it failed.
 */
async function readWithinBudget(
  reader: DigestReader,
  request: AbortSignal | undefined
): Promise<ReaderAnswer> {
  // A request already abandoned has nobody waiting for its answer: its readers
  // are never started, so none runs out its whole budget for nothing.
  if (request?.aborted) return null;
  const controller = new AbortController();
  const abandon = () => controller.abort();
  request?.addEventListener("abort", abandon, { once: true });
  // Until the item is known to be the reader's, running out of time hides it
  // rather than failing it, as a check that throws does.
  let shown = reader.visible === undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<ReaderAnswer>(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(shown ? { failure: "timed-out" } : null);
    }, ATTENTION_ITEM_BUDGET_MS);
  });
  const answered = (async (): Promise<ReaderAnswer> => {
    if (reader.visible !== undefined) {
      if (!(await isVisible(reader, reader.visible, controller.signal))) {
        return null;
      }
      shown = true;
    }
    return countOf(reader, controller.signal);
  })();
  try {
    return await Promise.race([answered, timedOut]);
  } finally {
    clearTimeout(timer);
    request?.removeEventListener("abort", abandon);
  }
}

/**
 * Whether the reader may see an item. A check that throws denies, and is
 * logged with the item's owner and id: the item is hidden, never shown on an
 * unknown answer.
 */
async function isVisible(
  reader: DigestReader,
  visible: NonNullable<DigestReader["visible"]>,
  signal: AbortSignal
): Promise<boolean> {
  try {
    return (await visible(signal)) === true;
  } catch (error) {
    getNextlyLogger().warn({
      kind: "attention-item-access-failed",
      owner: reader.owner,
      item: reader.id,
      ...(error instanceof Error ? { error: error.message } : {}),
    });
    return false;
  }
}

/**
 * An item's count, or why it failed. Read inside the `try`, so a count that
 * throws before it returns a promise fails its own item, as one that rejects
 * does, rather than the whole digest.
 */
async function countOf(
  reader: DigestReader,
  signal: AbortSignal
): Promise<ReaderAnswer> {
  try {
    const value = await reader.read(signal);
    if (value === null) return null;
    return parseAttentionCount(value) ?? { failure: "not-a-count" };
  } catch (error) {
    return { failure: "threw", error };
  }
}

/** The order the digest is drawn in: critical first, then most waiting, then by label. */
function byUrgency(a: AttentionDigestItem, b: AttentionDigestItem): number {
  const severity =
    Number(a.severity === "warning") - Number(b.severity === "warning");
  if (severity !== 0) return severity;
  if (a.count !== b.count) return b.count - a.count;
  return a.label.localeCompare(b.label);
}

/**
 * Every reader's item, read at once, each within its own budget, in the order
 * the digest is drawn in.
 */
export async function runDigest(
  readers: readonly DigestReader[],
  request?: AbortSignal
): Promise<AttentionDigestItem[]> {
  const answers = await Promise.all(
    readers.map(async reader => ({
      reader,
      answer: await readWithinBudget(reader, request),
    }))
  );
  return answers
    .flatMap(({ reader, answer }) => digestItem(reader, answer))
    .sort(byUrgency);
}

/**
 * One reader's item as the digest draws it, or none: hidden from this reader,
 * or nothing waiting. A failed item is drawn as failed and logged, so the
 * others are still answered; a count past the cap is drawn as a floor.
 */
function digestItem(
  reader: DigestReader,
  answer: ReaderAnswer
): AttentionDigestItem[] {
  const { id, kind, label, severity, link } = reader;
  if (answer === null) return [];
  if ("failure" in answer) {
    getNextlyLogger().warn({
      kind: "attention-item-failed",
      owner: reader.owner,
      item: id,
      reason: answer.failure,
      ...(answer.error instanceof Error ? { error: answer.error.message } : {}),
    });
    return [{ id, kind, label, count: 0, severity, link, failed: true }];
  }
  if (answer.count === 0 && !answer.atLeast) return [];
  const capped = answer.count > ATTENTION_ITEM_COUNT_CAP;
  return [
    {
      id,
      kind,
      label,
      count: capped ? ATTENTION_ITEM_COUNT_CAP : answer.count,
      ...(capped || answer.atLeast ? { atLeast: true as const } : {}),
      severity,
      link,
    },
  ];
}
