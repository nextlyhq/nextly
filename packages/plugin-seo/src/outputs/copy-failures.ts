/**
 * The pages whose plain-text copy could not be made from the rendered page,
 * kept so the problem list can name them: the page did not render (an
 * error, a time-out, a page too large, one with no main content), or
 * llms-full.txt ran out of time before rendering it. AI tools are given the
 * page's description in its place meanwhile.
 *
 * Each page is its own note of the address record, of its own kind, keyed by
 * its address: a failure writes that page's note and a copy made with the
 * page's words removes it, so two requests finishing at once, about two
 * pages or one, never rewrite each other's results. The list is read back
 * by kind, the most recent first. A note that cannot be read or written is
 * logged and never fails the answer it was made for.
 *
 * @module outputs/copy-failures
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import {
  forgetNotes,
  noteKey,
  notesOfKind,
  putNote,
  readNotes,
} from "../address-record/store";
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

/** The kind each page's note is kept under, which the list is read back by. */
const FAILURE_KIND = "copy-failure";

/** The note of the page at `url`. */
const failureKey = (url: string): string =>
  noteKey(`plain-copy-failure:${url}`);

/** How many notes one reading of the list takes: far more than it shows. */
const MOST_READ = 500;

/** How many failures the problem list shows, the most recent. */
const MOST_SHOWN = 40;

/** How many pages one read of their notes asks for. */
const READ_CHUNK = 100;

/** The failure a stored note holds, checked; none from a note that is not one. */
function failureIn(value: string | null): CopyFailure | undefined {
  if (value === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const url = textOf(parsed.url);
  const reason = textOf(parsed.reason);
  const retry = textOf(parsed.retry);
  const at = textOf(parsed.at);
  return url === undefined ||
    reason === undefined ||
    retry === undefined ||
    at === undefined
    ? undefined
    : { url, reason, retry, at };
}

/** The pages whose copy could not be made, the most recent first. */
export async function copyFailures(ctx: PluginContext): Promise<CopyFailure[]> {
  try {
    const notes = await notesOfKind(ctx, FAILURE_KIND, MOST_READ);
    return notes
      .flatMap(note => failureIn(note.value) ?? [])
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MOST_SHOWN);
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
 * Keep what making copies found: each page of `failed` noted, in place of
 * any earlier note of it, and each page of `made` taken off. Each page's
 * note is written alone, and one read says which of `made` have a note to
 * take off, so a page with none costs no write.
 */
export async function noteCopyResults(
  ctx: PluginContext,
  failed: readonly Omit<CopyFailure, "at">[],
  made: readonly string[]
): Promise<void> {
  if (failed.length === 0 && made.length === 0) return;
  try {
    const at = new Date().toISOString();
    const failedUrls = new Set(failed.map(failure => failure.url));
    for (const failure of failed) {
      await putNote(
        ctx,
        failureKey(failure.url),
        JSON.stringify({ ...failure, at }),
        { kind: FAILURE_KIND }
      );
    }
    const settled = [...new Set(made)].filter(url => !failedUrls.has(url));
    for (let start = 0; start < settled.length; start += READ_CHUNK) {
      const keys = settled.slice(start, start + READ_CHUNK).map(failureKey);
      const { notes } = await readNotes(ctx, keys);
      await forgetNotes(
        ctx,
        keys.filter(key => notes.has(key))
      );
    }
  } catch (error) {
    ctx.logger.warn(
      "The pages whose plain-text copy failed could not be kept",
      {
        error,
      }
    );
  }
}
