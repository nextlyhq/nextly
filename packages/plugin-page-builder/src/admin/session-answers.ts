"use client";

/**
 * Answers kept for the signed-in author's session: the collections a list
 * or a condition may name, and the site's custom sources. They change only
 * when the schema or the author does, and the inspector asks for them each
 * time a block is selected, so one read serves the session.
 *
 * - **Per author.** Each answer is the author's own, read with their access.
 *   The moment anyone else asks (another person, or nobody: signed out, or
 *   not known yet), everything kept is dropped before anything is answered,
 *   and nothing is kept while the person is not known, so one author's
 *   answer is never handed to the next person on the same tab.
 * - **Per schema version.** Each answer is labelled with the schema version
 *   it was asked under, and is good only while the version is the same; a
 *   collection created, renamed or removed moves it, and the next ask reads
 *   again. A read the version moved under is not kept, and kept answers are
 *   let go as the move is told. The admin learns of a move made elsewhere
 *   (another tab, a code-first change) with its next request.
 * - **Never a failure.** A read that fails is dropped, so the next ask reads
 *   again; a read still on its way is shared by everyone asking meanwhile.
 *
 * An author whose access changes while signed in keeps their answers until
 * the schema moves or they sign in again: nothing tells the browser of it.
 *
 * @module admin/session-answers
 */
import { onSchemaChange, schemaVersion } from "@nextlyhq/plugin-sdk/admin";

/** One answer: the read, and the schema version it was asked under. */
interface Kept {
  readonly read: Promise<unknown>;
  readonly version: number | undefined;
}

/** Every kept answer, by what it answers. */
const kept = new Map<string, Kept>();
/** The person whose answers `kept` holds. */
let keptFor: string | null = null;
/** Stops the schema listener, while one is set. */
let stopListening: (() => void) | undefined;

/** Let go of every answer, on its way or not, asked under another version. */
function dropOutdated(version: number | undefined): void {
  for (const [key, entry] of kept) {
    if (entry.version !== version) kept.delete(key);
  }
}

/** Drop everything kept, as for another person. */
function dropAll(): void {
  kept.clear();
  stopListening?.();
  stopListening = undefined;
}

/**
 * The answer to `key` for `userId`, the person signed in (`null` when none
 * is known): the one kept for them under the current schema version, or
 * `ask`'s, kept.
 */
export function sessionAnswer<T>(
  userId: string | null,
  key: string,
  ask: () => Promise<T>
): Promise<T> {
  // Another person's answers go before anything is answered.
  if (userId !== keptFor) {
    dropAll();
    keptFor = userId;
  }
  // Nobody known: an answer kept under no one could reach whoever is next.
  if (userId === null) return ask();
  const version = schemaVersion();
  const held = kept.get(key);
  if (held !== undefined && held.version === version) {
    return held.read as Promise<T>;
  }
  stopListening ??= onSchemaChange(dropOutdated);
  const read = ask();
  const entry: Kept = { read, version };
  kept.set(key, entry);
  const drop = () => {
    if (kept.get(key) === entry) kept.delete(key);
  };
  read.then(() => {
    // A read the schema moved under may hold the old schema's answer, so it
    // is not kept: the next ask reads again.
    if (schemaVersion() !== version) drop();
  }, drop);
  return read;
}
