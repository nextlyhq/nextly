/**
 * Which ids a blocks write brings that the site does not define, told apart
 * from the ones the stored page already held.
 *
 * The one comparison behind every reference a page keeps by id to something
 * the site defines: a shared style, a breakpoint. The engine cannot make it,
 * since a document on its own does not say whether an id is new, and a page
 * holding an id the site has since dropped must stay savable. The write path
 * can, by reading both stored forms.
 *
 * @module fields/added-undefined-ids
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { PluginFieldValidateArgs } from "@nextlyhq/plugin-sdk";

import { readStoredForms } from "./lock-baselines";

/** The page's stored forms as one read answered: both, or unreadable. */
export interface StoredForms {
  readonly forms: readonly BlockDocument[];
  readonly readable: boolean;
}

/**
 * Both stored forms of the field being written: an id either one holds is the
 * page's already.
 */
export function storedFormsFor(
  args: PluginFieldValidateArgs
): Promise<StoredForms> {
  return readStoredForms(
    args.write,
    args.path,
    [false, true],
    (args.field as { localized?: unknown }).localized === true
  );
}

/**
 * The ids in `used` the site does not define and neither stored form holds;
 * empty when there are none, or when the stored value cannot be read.
 *
 * The site is asked only when `used` names something, and the stored forms
 * only when one of those is undefined, so a write using only what the site
 * defines reads nothing more.
 */
export async function addedUndefinedIds(
  args: PluginFieldValidateArgs,
  used: readonly string[],
  /** The ids the site defines, read when asked. */
  defined: () => Promise<ReadonlySet<string>>,
  /** The ids one stored form holds, read the way `used` was. */
  heldBy: (form: BlockDocument) => Iterable<string>,
  /**
   * The stored forms, read when asked. Shared by every check judging one
   * write, so each judges against the same snapshot of the page.
   */
  stored: () => Promise<StoredForms> = () => storedFormsFor(args)
): Promise<string[]> {
  if (used.length === 0) return [];
  const known = await defined();
  const undefinedHere = used.filter(id => !known.has(id));
  if (undefinedHere.length === 0) return [];
  const snapshot = await stored();
  if (!snapshot.readable) return [];
  const held = new Set(snapshot.forms.flatMap(form => [...heldBy(form)]));
  return undefinedHere.filter(id => !held.has(id));
}
