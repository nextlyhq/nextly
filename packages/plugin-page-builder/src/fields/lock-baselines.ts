/**
 * What a document already holds, which a `"contentOnly"` lock lets it keep.
 *
 * A lock is measured against the blocks its slot starts with, and a block's
 * defaults can change after pages store it: a stored child then differs from
 * today's starting child with nobody having changed it. The engine keeps a
 * part a baseline already holds in the same place, so a save that leaves it,
 * or puts it back as it started, is not refused; only a third value is.
 *
 * Read only once a lock has been found broken, so a save breaking none reads
 * and composes nothing more than it did.
 *
 * @module lock-baselines
 */
import {
  placementsAsComponentsHoldThem,
  type BlockDocument,
  type DocumentLimits,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  type PluginFieldWrite,
  type PluginStoredValue,
  type PluginStoredValueTarget,
} from "@nextlyhq/plugin-sdk";

import {
  composeWithReads,
  type BoundedReader,
  type HeldLibrary,
} from "../composition-reading";

import { isForest } from "./blocks-document";

/**
 * The field's stored forms, the live one and the draft an editor's preview
 * reads, as the write reads them, in the language the write is judged in.
 *
 * Empty for a create, for a language that stores no value yet, and where a
 * form cannot be read: each then measures the document against its starting
 * blocks alone, which refuses more and never less.
 */
export async function storedFormsOf(
  write: PluginFieldWrite | undefined,
  field: string
): Promise<BlockDocument[]> {
  // Forgiving, as it always was for the lock baselines it feeds: a form that
  // cannot be read measures against the starting blocks alone.
  try {
    return (await readStoredForms(write, field)).forms;
  } catch {
    return [];
  }
}

/**
 * Whether the stored read can name the field at `path`: a top-level field, or
 * one inside named groups (`hero.body`), which is where the editor opens a
 * blocks field. A field in a repeater's rows (`rows[2].body`) has no stored
 * path of its own.
 */
export function storedReadReaches(path: string): boolean {
  return path !== "" && !/[[\]]/.test(path) && !path.split(".").includes("");
}

/**
 * The stored forms, and whether they could be read at all.
 *
 * Two different empties. A create has nothing stored, so every placement break
 * in it is the write's own; a field whose stored value cannot be read (a
 * localized one whose language store is not ready) may already hold a break,
 * so a break in it may be one the page already held. The placement rule
 * refuses the first and only warns about the second. A single and a localized
 * field are read like any other, in the language the write is judged in.
 */
export async function readStoredForms(
  write: PluginFieldWrite | undefined,
  field: string,
  /**
   * The lifecycle forms the write changes, by `formsChangedBy`'s answer (true
   * is the draft): a draft-only write is measured against the draft alone, so
   * a break only the published form holds is not passed off as the draft's.
   */
  changed: readonly boolean[] = [false, true],
  /**
   * Whether the field is localized. Its stored value is read in the write's
   * language, and the read answers "unavailable" while that language's store
   * is not ready: that answer makes it unreadable rather than failing the
   * write.
   * Any other failure to read is an error and propagates rather than passing
   * a write.
   */
  localized = false
): Promise<{ forms: BlockDocument[]; readable: boolean }> {
  const document = storedDocumentOf(write);
  if (write === undefined || document === undefined) {
    return { forms: [], readable: true };
  }
  // A field in a repeater's rows is no path core's stored read names, and
  // asking would fail the save. It is unreadable instead, as a language not
  // ready is: what a stored form would excuse is kept and logged, not refused.
  if (!storedReadReaches(field)) return { forms: [], readable: false };
  const forms: BlockDocument[] = [];
  for (const draft of changed) {
    const read = await readOneForm(
      write,
      { ...document, field, form: draft ? "draft" : "published" },
      localized
    );
    if (read === UNREADABLE) return { forms: [], readable: false };
    if (read.kind === "value" && isForest(read.value)) {
      forms.push(read.value as BlockDocument);
    }
  }
  return { forms, readable: true };
}

/** A stored form that cannot be read yet: its language store is not ready. */
const UNREADABLE = Symbol("unreadable");

/**
 * One stored form, read in the write's language; {@link UNREADABLE} only for
 * a translated field whose language store is not ready yet. Any other failure
 * is an error, and passing it off as unreadable would wave a write through.
 */
async function readOneForm(
  write: PluginFieldWrite,
  target: PluginStoredValueTarget,
  localized: boolean
): Promise<PluginStoredValue | typeof UNREADABLE> {
  try {
    return await write.readStored(
      write.locale === undefined ? target : { ...target, locale: write.locale }
    );
  } catch (error) {
    if (localized && NextlyError.isCode(error, "SERVICE_UNAVAILABLE")) {
      return UNREADABLE;
    }
    throw error;
  }
}

/**
 * Which stored document the write is to: a single by its slug, or a
 * collection's entry by its id; `undefined` for a create, which stores nothing
 * yet to read.
 */
function storedDocumentOf(
  write: PluginFieldWrite | undefined
): { single: string } | { collection: string; id: string } | undefined {
  if (write === undefined) return undefined;
  if (write.kind === "single") return { single: write.slug };
  return write.id === undefined
    ? undefined
    : { collection: write.slug, id: write.id };
}

/**
 * The composed documents a page's placements are measured against besides
 * their starting blocks: each stored form composed, and the page with every
 * placement as its component holds it. The second is what lets a page placing
 * a component for the first time keep what the component itself holds, which
 * the component's own save already judged.
 *
 * Composed with the same reader, library and allowance as the page itself.
 * Where the allowance runs out, what was composed is returned: a baseline
 * missing only measures more strictly.
 */
export async function lockBaselines(args: {
  document: BlockDocument;
  stored: readonly BlockDocument[];
  library: HeldLibrary;
  read: BoundedReader;
  limits: DocumentLimits;
  work: WorkAllowance;
}): Promise<unknown[]> {
  const read = await composedFormsRead({
    ...args,
    hosts: [
      ...args.stored,
      placementsAsComponentsHoldThem(args.document, args.limits),
    ],
  });
  return read.forms;
}

/**
 * Each host composed with the same reader, library and allowance as the page,
 * and whether every one composed whole. Where the allowance runs out, what was
 * composed is returned: a lock baseline missing only measures more strictly,
 * but a placement baseline cut short may lack a break the stored page holds,
 * so a caller telling old breaks from new must not read its absence as new.
 *
 * The stored forms alone are what a placement break is measured against: the
 * page as its components hold it is the page being saved, so a break it
 * composes to would read as one the page already held.
 */
export async function composedFormsRead(args: {
  hosts: readonly BlockDocument[];
  library: HeldLibrary;
  read: BoundedReader;
  limits: DocumentLimits;
  work: WorkAllowance;
}): Promise<{ forms: unknown[]; complete: boolean }> {
  const { library, read, limits, work } = args;
  const forms: unknown[] = [];
  let complete = true;
  for (const host of args.hosts) {
    if (read.exhausted() || work.left <= 0) {
      complete = false;
      break;
    }
    const composed = await composeWithReads({
      host,
      library,
      read,
      limits,
      work,
    });
    if (composed.incomplete || composed.stoppedShort) complete = false;
    forms.push(composed.composition.document);
  }
  return { forms, complete };
}
