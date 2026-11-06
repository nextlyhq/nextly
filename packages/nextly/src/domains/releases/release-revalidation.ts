/**
 * The cache tags a release's schedule changes.
 *
 * ## The gap this closes
 *
 * A cached page's lifetime is bounded by the next scheduled release, but that
 * bound is computed when the page is CACHED. A page cached while nothing was
 * scheduled was stored tag-only — `revalidate: false` — and scheduling a
 * release afterwards cannot reach back into an entry that already exists. It
 * would sit there past the transition indefinitely, until some unrelated write
 * happened to bust its collection tag.
 *
 * So scheduling has to do what an ordinary edit does: flush the tags of the
 * documents it affects. From that moment the page is re-resolved, and the
 * re-resolution is what picks up the new bound.
 *
 * ## Why the tags are the document's own, not a release tag
 *
 * A page is cached under the collection and Single tags of the content it
 * rendered. It has never heard of releases, and inventing a `nextly:release:*`
 * tag would require every cached read to declare a dependency on a table it
 * does not consult. The documents ARE the dependency; naming them is enough.
 *
 * @module domains/releases/release-revalidation
 */

import {
  buildEntryRevalidationIntent,
  buildSingleRevalidationIntent,
} from "../../revalidation/intent-builders";
import type {
  RevalidateConfig,
  RevalidationIntent,
} from "../../revalidation/types";

import type { ReleaseMemberRow } from "./releases-repository";

/**
 * A collection's or Single's `revalidate` config, by the kind of scope a
 * release member names. A page is a collection entry, so it is asked as one.
 */
export type ScopeRevalidateConfig = (
  scopeKind: "collection" | "single",
  slug: string
) => RevalidateConfig | undefined;

/**
 * The intent to flush for a release whose schedule just changed.
 *
 * One intent with every affected tag rather than one per member: the flush is a
 * single call, and a reader cannot observe a partial one.
 *
 * Both the collection-wide tag and the per-entry tag are named. A listing is
 * cached under the collection tag and a detail page under the entry tag, and a
 * release changes what BOTH return — a scheduled publish adds a row to the
 * listing as surely as it changes the document.
 *
 * Each member's tags come from the builders every other write uses, with its
 * collection's or Single's `revalidate` config: one that opts out is
 * skipped, and one that names extra tags has them flushed too. A release is
 * then one more way to write a document, not a second answer to which reads
 * that write changes.
 */
export function releaseRevalidationIntent(
  members: readonly ReleaseMemberRow[],
  configFor: ScopeRevalidateConfig = () => undefined
): RevalidationIntent | null {
  const tags = new Set<string>();
  for (const member of members) {
    const intent =
      member.scopeKind === "single"
        ? buildSingleRevalidationIntent(
            member.scopeSlug,
            configFor("single", member.scopeSlug)
          )
        : buildEntryRevalidationIntent(
            member.scopeSlug,
            configFor("collection", member.scopeSlug),
            { id: member.entryId }
          );
    for (const tag of intent?.tags ?? []) tags.add(tag);
  }

  // Nothing to flush for a release with no members. Returning `null` rather
  // than an empty intent keeps a caller from issuing a revalidation that names
  // nothing, which some backends log as an error.
  return tags.size === 0 ? null : { tags: [...tags] };
}
