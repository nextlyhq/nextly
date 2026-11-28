/**
 * The llms-full.txt files that stopped short at their size, kept so the
 * problem list can say so: the site's own, or a folder's. AI tools reading
 * one miss every page after where it stopped.
 *
 * Each file is its own note of the address record, of its own kind, keyed
 * by its address, written only when what it says changes, and taken off once
 * the file fits again. A note that cannot be read or written is logged and
 * never fails the file it was made for.
 *
 * @module outputs/full-file-cut
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

/** One llms-full.txt that stopped short. */
export interface FullFileCut {
  /** The file's own address. */
  file: string;
  /** The size it stopped at, in bytes. */
  limit: number;
  /** How many listed pages it left out. */
  leftOut: number;
}

/** The kind each file's note is kept under, which the list is read back by. */
const CUT_KIND = "llms-full-cut";

/** The note of the file at `file`. */
const cutKey = (file: string): string => noteKey(`llms-full-cut:${file}`);

/** The cut a stored note holds, checked; none from a note that is not one. */
function cutIn(value: string | null | undefined): FullFileCut | undefined {
  if (value === null || value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const file = textOf(parsed.file);
  const { limit, leftOut } = parsed;
  return file === undefined ||
    typeof limit !== "number" ||
    typeof leftOut !== "number"
    ? undefined
    : { file, limit, leftOut };
}

/**
 * Keep what writing the llms-full.txt at `file` found: `cut`, where it
 * stopped short, else nothing, taking off a note kept before. One read, and
 * a write only where the note changes, so a file asked for again and again
 * writes nothing new.
 */
export async function noteFullFileCut(
  ctx: PluginContext,
  file: string,
  cut: Omit<FullFileCut, "file"> | null
): Promise<void> {
  try {
    const key = cutKey(file);
    const kept = cutIn((await readNotes(ctx, [key])).notes.get(key));
    if (cut === null) {
      if (kept !== undefined) await forgetNotes(ctx, [key]);
      return;
    }
    if (kept?.limit === cut.limit && kept.leftOut === cut.leftOut) return;
    await putNote(ctx, key, JSON.stringify({ file, ...cut }), {
      kind: CUT_KIND,
    });
  } catch (error) {
    ctx.logger.warn("Whether llms-full.txt stopped short could not be kept", {
      error,
    });
  }
}

/** Every llms-full.txt noted as stopping short, by its address. */
export async function fullFileCuts(ctx: PluginContext): Promise<FullFileCut[]> {
  try {
    const notes = await notesOfKind(ctx, CUT_KIND);
    return notes
      .flatMap(note => cutIn(note.value) ?? [])
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch (error) {
    ctx.logger.warn(
      "Which llms-full.txt files stopped short could not be read",
      {
        error,
      }
    );
    return [];
  }
}

/** Forget the notes of the files at `files`, such as files no longer served. */
export async function forgetFullFileCuts(
  ctx: PluginContext,
  files: readonly string[]
): Promise<void> {
  try {
    await forgetNotes(ctx, files.map(cutKey));
  } catch (error) {
    ctx.logger.warn("Whether llms-full.txt stopped short could not be kept", {
      error,
    });
  }
}
