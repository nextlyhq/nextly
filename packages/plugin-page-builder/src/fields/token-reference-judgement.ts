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
 * gone (`variables-routes`).
 *
 * @module fields/token-reference-judgement
 */
import { DEFAULT_LIMITS, type DocumentLimits } from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
} from "@nextlyhq/plugin-sdk";

import { tokenUsageOf } from "../token-usage";

import { addedUndefinedIds, type StoredForms } from "./added-undefined-ids";
import { isTopLevel } from "./layers-lock-judgement";

/** The engine's code for a reference to a variable the site does not define. */
const UNKNOWN_TOKEN = "unknown-token";

/** How many undefined variables one refusal names; the rest are counted. */
const NAMED_AT_MOST = 5;

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
 */
export async function newTokenReferenceIssues(
  value: unknown,
  args: PluginFieldValidateArgs,
  label: string,
  site: {
    /** The identities of the variables the site defines, every tier merged. */
    readonly tokenIds: () => Promise<ReadonlySet<string>>;
    readonly limits?: DocumentLimits;
    /** The page's stored forms, shared by every check of one write. */
    readonly storedForms?: () => Promise<StoredForms>;
  }
): Promise<PluginFieldIssue[]> {
  if (args.write === undefined || !isTopLevel(args.path)) return [];
  const limits = site.limits ?? DEFAULT_LIMITS;
  const added = await addedUndefinedIds(
    args,
    tokenUsageOf(value, limits).ids,
    site.tokenIds,
    form => tokenUsageOf(form, limits).ids,
    site.storedForms
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
      code: UNKNOWN_TOKEN,
      message: `${label}: ${named}${more} ${added.length === 1 ? "is not a variable" : "are not variables"} on this site. Remove ${added.length === 1 ? "it" : "them"} from the page, or choose a variable the site has.`,
    },
  ];
}
