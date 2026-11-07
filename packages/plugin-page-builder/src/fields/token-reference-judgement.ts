/**
 * A blocks field's write, judged against the variables (design tokens) the
 * site defines.
 *
 * The engine reports a reference to an undefined variable as a warning,
 * because a document on its own cannot say whether the reference is new: a
 * variable removed from the site leaves every page that held it referencing
 * nothing, and refusing those pages would make them unsavable for a change
 * nobody made to them. The write path can tell, by comparing with the stored
 * forms, so a reference this write ADDS is refused and one the page already
 * held is kept, exactly as for shared styles (`class-reference-judgement`).
 *
 * That is what fences a variable's removal: the remove route checks the
 * variable's uses just before it writes the site style without it, and a page
 * saved after that write cannot add a first use of the variable once it is
 * gone (`variables-routes`). This judgement runs before the page's
 * transaction, so it is made again inside it, under the composition graph
 * lock the removal's write takes too (`composition-rejudge`).
 *
 * @module fields/token-reference-judgement
 */
import { DEFAULT_LIMITS, type DocumentLimits } from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginFieldIssue } from "@nextlyhq/plugin-sdk";

import {
  tokenUsageOf,
  UNKNOWN_TOKEN_CODE,
  undefinedVariablesMessage,
} from "../token-usage";

import {
  addedUndefinedIds,
  storedFormsFor,
  storedReadReaches,
  type JudgedField,
  type StoredForms,
} from "./added-undefined-ids";
import { isTopLevel } from "./layers-lock-judgement";

/** The stored forms of a field the stored read refuses to name: none held. */
const NOTHING_HELD: StoredForms = { forms: [], readable: true };

/**
 * The stored forms, read as `stored` reads them, except that a nested field
 * the stored read refuses to name (one inside a group kept per language)
 * answers that nothing is held, which refuses every undefined reference
 * instead of passing the write unjudged. Any other failure propagates.
 */
export function closedWhenUnreachable(
  stored: () => Promise<StoredForms>,
  path: string
): () => Promise<StoredForms> {
  return async () => {
    try {
      return await stored();
    } catch (error) {
      if (!isTopLevel(path) && NextlyError.isCode(error, "INVALID_INPUT")) {
        return NOTHING_HELD;
      }
      throw error;
    }
  };
}

/**
 * The issues a write adding a reference to an undefined variable is refused
 * with; empty when it adds none, or when it cannot be judged.
 *
 * Read by the walk the variable usage index records from, every node the
 * compiler reads and the page's own settings, so a reference the fence lets
 * through is never one the index would count. The site's variables are read
 * only when the value references one, and the stored forms only when one of
 * those is undefined, so an ordinary save pays nothing. A value with no entry
 * write behind it, and a field whose stored value cannot be read, are not
 * judged: nothing tells a new reference from an old one.
 *
 * A blocks field inside named groups (`hero.body`) is judged like a top-level
 * one, its stored value read at its path: the editor opens it, so a fence
 * that skipped it would let a page save a first use of a variable just
 * removed. Where that stored value cannot be read (a group kept per
 * language), it is judged as holding nothing, so every undefined variable the
 * write names is refused rather than let through. A field in a repeater's
 * rows has no stored path, and the editor does not open it.
 */
export async function newTokenReferenceIssues(
  value: unknown,
  // The field's write as a reference check reads it: the validation's whole
  // arguments, or the in-transaction judgement's narrower view.
  args: JudgedField,
  label: string,
  site: {
    /** The identities of the variables the site defines, every tier merged. */
    readonly tokenIds: () => Promise<ReadonlySet<string>>;
    readonly limits?: DocumentLimits;
    /** The page's stored forms, shared by every check of one write. */
    readonly storedForms?: () => Promise<StoredForms>;
  }
): Promise<PluginFieldIssue[]> {
  if (args.write === undefined || !storedReadReaches(args.path)) return [];
  const limits = site.limits ?? DEFAULT_LIMITS;
  const added = await addedUndefinedIds(
    args,
    tokenUsageOf(value, limits).ids,
    site.tokenIds,
    form => tokenUsageOf(form, limits).ids,
    closedWhenUnreachable(
      site.storedForms ?? (() => storedFormsFor(args)),
      args.path
    )
  );
  if (added.length === 0) return [];
  return [
    {
      path: args.path,
      code: UNKNOWN_TOKEN_CODE,
      message: undefinedVariablesMessage(label, added, "the page"),
    },
  ];
}
