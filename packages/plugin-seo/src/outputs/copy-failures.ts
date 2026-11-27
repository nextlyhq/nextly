/**
 * The pages whose plain-text copy could not be made from the rendered page,
 * kept so the problem list can name them: the page did not render (an
 * error, a time-out, a page too large, one with no main content), or
 * llms-full.txt ran out of time before rendering it. AI tools are given the
 * page's description in its place meanwhile.
 *
 * Kept as one note of the address record, the most recent first and no more
 * than {@link MOST_KEPT}, and written only where it changes: a page that
 * renders again is taken off it. A note that cannot be read or written is
 * logged and never fails the answer it was made for.
 *
 * @module outputs/copy-failures
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { noteKey, putNote, readNotes } from "../address-record/store";
import { isRecord, textOf } from "../plain-values";

/** One page whose copy could not be made. */
export interface CopyFailure {
  /** The page's own address. */
  url: string;
  /** Why, in words: "status 500", "timed out after 10 s". */
  reason: string;
  /** Where asking again makes the copy again: its copy, or llms-full.txt. */
  retry: string;
  /** When, as an ISO date. */
  at: string;
}

/**
 * How many failures are kept: enough to show a pattern, few enough that
 * the note stays well inside a MySQL `TEXT` column.
 */
const MOST_KEPT = 40;

/** The longest address kept; a longer one is cut, as no page needs more to be found. */
const MOST_URL_CHARS = 500;

/** The note the failures are kept in. */
const FAILURES_KEY = noteKey("plain-copy-failures");

/** The failures a stored note holds, each checked; none from a note that is not one. */
function failuresIn(value: string | null | undefined): CopyFailure[] {
  if (value === null || value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap(entry => {
    if (!isRecord(entry)) return [];
    const url = textOf(entry.url);
    const reason = textOf(entry.reason);
    const retry = textOf(entry.retry);
    const at = textOf(entry.at);
    return url === undefined ||
      reason === undefined ||
      retry === undefined ||
      at === undefined
      ? []
      : [{ url, reason, retry, at }];
  });
}

/** The pages whose copy could not be made, the most recent first. */
export async function copyFailures(ctx: PluginContext): Promise<CopyFailure[]> {
  try {
    const { notes } = await readNotes(ctx, [FAILURES_KEY]);
    return failuresIn(notes.get(FAILURES_KEY));
  } catch (error) {
    ctx.logger.warn(
      "The pages whose plain-text copy failed could not be read",
      {
        error,
      }
    );
    return [];
  }
}

/**
 * Keep what making copies found: each of `failed` noted, in place of any
 * earlier note of its page, and each page of `made` taken off. One read of
 * the note, and a write only where it changes.
 */
export async function noteCopyResults(
  ctx: PluginContext,
  failed: readonly Omit<CopyFailure, "at">[],
  made: readonly string[]
): Promise<void> {
  if (failed.length === 0 && made.length === 0) return;
  try {
    const { notes } = await readNotes(ctx, [FAILURES_KEY]);
    const stored = notes.get(FAILURES_KEY);
    const before = failuresIn(stored);
    const at = new Date().toISOString();
    const fresh = failed.map(failure => ({
      ...failure,
      url: failure.url.slice(0, MOST_URL_CHARS),
      retry: failure.retry.slice(0, MOST_URL_CHARS),
      at,
    }));
    const settled = new Set([...made, ...fresh.map(failure => failure.url)]);
    const after = [
      ...fresh,
      ...before.filter(failure => !settled.has(failure.url)),
    ].slice(0, MOST_KEPT);
    // Unchanged but for the times of failures already noted: nothing to write.
    const same = (list: readonly CopyFailure[]) =>
      JSON.stringify(
        list.map(({ url, reason, retry }) => [url, reason, retry])
      );
    if (same(after) === same(before)) return;
    await putNote(ctx, FAILURES_KEY, JSON.stringify(after), {
      absent: !notes.has(FAILURES_KEY),
    });
  } catch (error) {
    ctx.logger.warn(
      "The pages whose plain-text copy failed could not be kept",
      {
        error,
      }
    );
  }
}
