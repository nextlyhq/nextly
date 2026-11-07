/**
 * A blocks field's write, judged against the classes the site defines.
 *
 * The engine reports a reference to an undefined class as a warning, because
 * a document on its own cannot say whether the reference is new: a class
 * removed from the library leaves every page that held it referencing
 * nothing, and refusing those pages would make them unsavable for a change
 * nobody made to them. The write path can tell, by comparing with the stored
 * forms, so a reference this write ADDS is refused and one the page already
 * held is kept.
 *
 * That is also what fences a shared style's removal: the remove route counts
 * the style's uses just before it writes, and a page saved after that count
 * cannot add a reference to the style once it is gone.
 *
 * @module fields/class-reference-judgement
 */
import { DEFAULT_LIMITS, type DocumentLimits } from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
} from "@nextlyhq/plugin-sdk";

import { classUsageOf } from "../class-usage";

import {
  addedUndefinedIds,
  referenceBaseline,
  type StoredForms,
} from "./added-undefined-ids";
import { isTopLevel } from "./layers-lock-judgement";
import { storedReadReaches } from "./lock-baselines";

/** The engine's code for a reference to a class the site does not define. */
const UNKNOWN_CLASS = "unknown-class";

/** How many undefined classes one refusal names; the rest are counted. */
const NAMED_AT_MOST = 5;

/**
 * The issues a write adding a reference to an undefined class is refused
 * with; empty when it adds none, or when it cannot be judged.
 *
 * The site's classes are read only when the value references a class, and
 * the stored forms only when one of those is undefined, so an ordinary save
 * pays nothing. A value with no entry write behind it, and a field whose
 * stored value cannot be read (inside a group, or a language not ready), are
 * not judged: nothing tells a new reference from an old one. A field in a
 * repeater's row is judged against nothing held (`referenceBaseline`).
 */
export async function newClassReferenceIssues(
  value: unknown,
  args: PluginFieldValidateArgs,
  label: string,
  site: {
    readonly classIds: () => Promise<ReadonlySet<string>>;
    readonly limits?: DocumentLimits;
    /** The page's stored forms, shared by every check of one write. */
    readonly storedForms?: () => Promise<StoredForms>;
  }
): Promise<PluginFieldIssue[]> {
  if (args.write === undefined) return [];
  // A field inside a group is not judged, as before; one in a repeater's row
  // is, against nothing held (`referenceBaseline`).
  if (!isTopLevel(args.path) && storedReadReaches(args.path)) return [];
  const limits = site.limits ?? DEFAULT_LIMITS;
  // Every node the compiler reads, gated and hidden ones included: a class
  // there is applied whenever the node shows.
  const added = await addedUndefinedIds(
    args,
    classUsageOf(value, limits).ids,
    site.classIds,
    form => classUsageOf(form, limits).ids,
    referenceBaseline(args, site.storedForms)
  );
  if (added.length === 0) return [];
  const named = added
    .slice(0, NAMED_AT_MOST)
    .map(id => `"${id}"`)
    .join(", ");
  const more =
    added.length > NAMED_AT_MOST
      ? ` and ${added.length - NAMED_AT_MOST} more`
      : "";
  return [
    {
      path: args.path,
      code: UNKNOWN_CLASS,
      message: `${label}: ${named}${more} ${added.length === 1 ? "is not a shared style" : "are not shared styles"} on this site. Remove ${added.length === 1 ? "it" : "them"} from the page, or choose a shared style the site has.`,
    },
  ];
}
