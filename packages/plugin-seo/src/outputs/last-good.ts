/**
 * The last good copy of each of the sitemap's files, kept beside the address
 * record so it can be served while the record catches up, rather than asking
 * crawlers to come back: a sitemap a few minutes old serves a crawler better
 * than a 503. Only the sitemap is kept, a list of addresses; never a file
 * carrying pages' titles, descriptions or words (the llms files), since a
 * copy is served without the public-access checks a fresh answer makes, and
 * access may have been taken away since it was kept.
 *
 * A copy is kept only from an answer given while the record was up to date,
 * for the site's own origin (never one a request's host chose), and written
 * only when it differs from the copy kept, told by the digest in its head
 * note: one small read beside the many an answer listing pages makes. Its
 * words are kept in parts, each small enough for a column of MySQL's `TEXT`,
 * and the head and every part are written on one transaction, so a copy is
 * never read back mixed from two answers. The copies live in the address
 * record's notes, so an uninstall that drops the record drops them with it.
 *
 * @module outputs/last-good
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { sha256 } from "../address-record/rows";
import { noteKey, putNotesTogether, readNotes } from "../address-record/store";

/** A root file as it was answered. */
export interface FileCopy {
  body: string;
  contentType: string;
}

/** A kept copy, and when it was kept (an ISO date). */
interface KeptCopy extends FileCopy {
  keptAt: string;
}

/** What a copy's head note keeps: all but its words, and how many parts. */
interface CopyHead {
  digest: string;
  contentType: string;
  keptAt: string;
  parts: number;
}

/**
 * How many characters one part keeps: at most three bytes each in UTF-8, so
 * a part fits MySQL's `TEXT` (65,535 bytes), which the notes' value is there.
 */
const PART_CHARS = 16_000;

/**
 * The largest copy kept, in characters: a file past it is not kept, and the
 * copy kept before, from a smaller answer, stays. A sitemap file this long
 * lists some tens of thousands of addresses.
 */
const MOST_CHARS = 4_000_000;

/** The note keeping the head of the copy of `file`. */
const headKey = (file: string) => noteKey(`last-good:${file}`);

/** The note keeping part `at` of the copy of `file`. */
const partKey = (file: string, at: number) =>
  noteKey(`last-good:${file}:part:${at}`);

/**
 * `body` in parts of at most {@link PART_CHARS} characters, never splitting
 * a character written as two (a surrogate pair), which no part could store.
 */
function partsOf(body: string): string[] {
  const parts: string[] = [];
  for (let at = 0; at < body.length; ) {
    let end = Math.min(at + PART_CHARS, body.length);
    const last = body.charCodeAt(end - 1);
    if (end < body.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(body.slice(at, end));
    at = end;
  }
  return parts;
}

/**
 * Keep `copy` as the last good copy of `file`, a name standing for the file
 * and every part of the request it depends on. Never fails the answer it
 * was made for: a copy that cannot be kept is logged, and the copy kept
 * before stays.
 */
export async function keepCopy(
  ctx: PluginContext,
  file: string,
  copy: FileCopy
): Promise<void> {
  if (copy.body.length > MOST_CHARS) return;
  const digest = sha256(`${copy.contentType}\n${copy.body}`);
  try {
    const before = await headOf(ctx, file);
    if (before?.digest === digest) return;
    const parts = partsOf(copy.body);
    const head: CopyHead = {
      digest,
      contentType: copy.contentType,
      keptAt: new Date().toISOString(),
      parts: parts.length,
    };
    // The parts and the head on one transaction: the head names only
    // parts written with it. Parts a longer copy kept before are left as
    // they are, named by no head, and written over by the next copy that
    // long: forgetting them apart from that transaction could take parts a
    // copy kept at the same moment names.
    await putNotesTogether(ctx, [
      ...parts.map((value, at) => ({ key: partKey(file, at), value })),
      { key: headKey(file), value: JSON.stringify(head) },
    ]);
  } catch (error) {
    ctx.logger.warn("The SEO plugin could not keep a copy of a root file", {
      error,
    });
  }
}

/** The copy of `file` last kept, or none. */
export async function keptCopy(
  ctx: PluginContext,
  file: string
): Promise<KeptCopy | undefined> {
  try {
    const head = await headOf(ctx, file);
    if (head === undefined) return undefined;
    const keys = Array.from({ length: head.parts }, (_, at) =>
      partKey(file, at)
    );
    const { notes } = await readNotes(ctx, keys);
    const parts = keys.map(key => notes.get(key) ?? null);
    if (parts.some(part => part === null)) return undefined;
    const body = parts.join("");
    // Served only as kept: a copy whose words do not match its head's
    // digest is no copy.
    if (sha256(`${head.contentType}\n${body}`) !== head.digest) {
      return undefined;
    }
    return { body, contentType: head.contentType, keptAt: head.keptAt };
  } catch (error) {
    ctx.logger.warn("The SEO plugin could not read a kept root file", {
      error,
    });
    return undefined;
  }
}

/** The head of the copy of `file`, or none where none usable is kept. */
async function headOf(
  ctx: PluginContext,
  file: string
): Promise<CopyHead | undefined> {
  const { notes } = await readNotes(ctx, [headKey(file)]);
  const value = notes.get(headKey(file)) ?? null;
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { digest, contentType, keptAt, parts } = parsed as Record<
      string,
      unknown
    >;
    if (
      typeof digest !== "string" ||
      typeof contentType !== "string" ||
      typeof keptAt !== "string" ||
      Number.isNaN(Date.parse(keptAt)) ||
      typeof parts !== "number" ||
      !Number.isInteger(parts) ||
      parts < 0
    ) {
      return undefined;
    }
    return { digest, contentType, keptAt, parts };
  } catch {
    return undefined;
  }
}

/** The answer serving a kept copy: marked with when it was kept, briefly cached. */
export function keptCopyResponse(copy: KeptCopy): Response {
  return new Response(copy.body, {
    headers: {
      "content-type": copy.contentType,
      "last-modified": new Date(copy.keptAt).toUTCString(),
      "cache-control": "public, max-age=60",
    },
  });
}
