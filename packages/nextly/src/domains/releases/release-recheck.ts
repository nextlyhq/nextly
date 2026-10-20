/**
 * What an event that can create a hard problem names, for the scheduled
 * releases holding it to be checked again.
 *
 * Each event names what it changed, and the check covers only the members of
 * still-scheduled releases that are about it: a saved or deleted document,
 * the documents of a collection or Single whose schema changed, the members
 * added by people whose roles changed, or every scheduled release when a
 * role's grants changed (a role's reach through inheritance is not recorded).
 *
 * @module domains/releases/release-recheck
 * @experimental
 */
import type { VersionScopeKind } from "../../schemas/versions/types";

/** One document, as a release member names it, whatever its language. */
export interface ReleaseRecheckDocument {
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
}

/**
 * The members an event is about.
 *
 * @experimental
 */
export type ReleaseRecheckTarget =
  | { documents: readonly ReleaseRecheckDocument[] }
  | {
      scopes: readonly Pick<
        ReleaseRecheckDocument,
        "scopeKind" | "scopeSlug"
      >[];
    }
  | { authors: readonly string[] }
  | { everyScheduled: true };
