/**
 * The last good copy of the root files the plugin lists pages in (each of
 * the sitemap's files and llms.txt), kept beside the address record so it
 * can be served while the record catches up, rather than asking readers to
 * come back: a sitemap a few minutes old serves a crawler better than a 503.
 * Only lists are kept, never a file carrying pages' words (llms-full.txt):
 * a copy is served without the public-access checks a fresh answer makes,
 * and any answer given once the record is ready replaces it.
 *
 * A copy is kept only from an answer given while the record was up to date,
 * for the site's own origin (never one a request's host chose), and written
 * only when it differs from the copy kept, told by a short note keeping its
 * digest: one small read beside the many an answer listing pages makes. The
 * copies live in the address record's notes, so an uninstall that drops the
 * record drops them with it.
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

/** The note keeping the copy of `file`. */
const copyKey = (file: string) => noteKey(`last-good:${file}`);

/** The note keeping the digest of the copy of `file`. */
const digestKey = (file: string) => noteKey(`last-good-digest:${file}`);

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
  const digest = sha256(`${copy.contentType}\n${copy.body}`);
  try {
    const { notes } = await readNotes(ctx, [digestKey(file)]);
    const stored = notes.get(digestKey(file)) ?? undefined;
    if (stored !== digest) {
      const kept: KeptCopy = { ...copy, keptAt: new Date().toISOString() };
      // Written together, so the digest kept is always the copy's own: one
      // matching a copy another answer wrote over would stop every later
      // answer with the same words from keeping them.
      await putNotesTogether(ctx, [
        { key: copyKey(file), value: JSON.stringify(kept) },
        { key: digestKey(file), value: digest },
      ]);
    }
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
    const { notes } = await readNotes(ctx, [copyKey(file)]);
    return keptCopyOf(notes.get(copyKey(file)) ?? null);
  } catch (error) {
    ctx.logger.warn("The SEO plugin could not read a kept root file", {
      error,
    });
    return undefined;
  }
}

/** The kept copy a stored note holds, or none where it holds no usable one. */
function keptCopyOf(value: string | null): KeptCopy | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { body, contentType, keptAt } = parsed as Record<string, unknown>;
    if (
      typeof body !== "string" ||
      typeof contentType !== "string" ||
      typeof keptAt !== "string" ||
      Number.isNaN(Date.parse(keptAt))
    ) {
      return undefined;
    }
    return { body, contentType, keptAt };
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
