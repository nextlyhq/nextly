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
  heldBy: (form: BlockDocument) => Iterable<string>
): Promise<string[]> {
  if (used.length === 0) return [];
  const known = await defined();
  const undefinedHere = used.filter(id => !known.has(id));
  if (undefinedHere.length === 0) return [];
  // Both stored forms: an id either one holds is the page's already.
  const stored = await readStoredForms(
    args.write,
    args.path,
    [false, true],
    (args.field as { localized?: unknown }).localized === true
  );
  if (!stored.readable) return [];
  const held = new Set(stored.forms.flatMap(form => [...heldBy(form)]));
  return undefinedHere.filter(id => !held.has(id));
}
