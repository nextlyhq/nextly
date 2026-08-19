/**
 * What releases say about the documents one read is holding.
 *
 * The read rule is per document, but asking it per document would put a query
 * behind every row of every listing. This is the one place the two mitigations
 * are stated together, so neither can be dropped by a caller that only meant to
 * add a read:
 *
 *   1. The cheap check first. While no scheduled release has taken effect, no
 *      document can be affected, and the whole question costs a comparison
 *      between two numbers.
 *   2. One batched lookup for the entire result set, resolved in memory.
 *
 * Deliberately NOT gated on whether the caller may edit. That is the difference
 * from the working-draft overlay, and the single most important thing here not
 * to "tidy" into the draft rule later: a working draft is one author's
 * unpublished work and is shown only to that author, while a release whose time
 * has passed is PUBLISHED and must be visible to an anonymous visitor. Widening
 * the draft predicate to serve both would leak unpublished work.
 *
 * @module domains/releases/release-read
 */
import type { DocumentRef } from "./releases-repository";
import { documentRefKey } from "./releases-repository";
import type {
  DueMember,
  ReleaseEffectDecision,
} from "./resolve-release-effect";
import { resolveReleaseEffect } from "./resolve-release-effect";

/**
 * The decisions for one read.
 *
 * A lookup object rather than the raw map, so the key stays derived in one
 * place. A caller spelling the key itself would get an empty member list for a
 * document that has members, which reads exactly like "nothing is scheduled".
 */
export interface ReleaseEffects {
  for(ref: DocumentRef): ReleaseEffectDecision;
}

const NO_EFFECT: ReleaseEffectDecision = {
  effect: "none",
  memberId: null,
  releaseId: null,
};

/** Every document unaffected, without having asked anything. */
const NOTHING_DUE: ReleaseEffects = { for: () => NO_EFFECT };

/** The narrow cheap-check surface, so a test can answer without a database. */
export interface DueCheck {
  mayHaveDue(now: Date): Promise<boolean>;
}

/** The narrow batched-lookup surface, satisfied by `ReleasesRepository`. */
export interface DueMemberSource {
  findDueMembersFor(
    refs: DocumentRef[],
    now: Date
  ): Promise<Map<string, DueMember[]>>;
}

export interface ResolveReleaseEffectsInput {
  cache: DueCheck;
  repository: DueMemberSource;
  /** Every document this read is holding, in one call. */
  refs: DocumentRef[];
  now: Date;
}

/** What each of these documents should look like at `now`. */
export async function resolveReleaseEffects(
  input: ResolveReleaseEffectsInput
): Promise<ReleaseEffects> {
  // No documents means no question, and asking the cheap check anyway would
  // load the memo for a read that could not have used it.
  if (input.refs.length === 0) return NOTHING_DUE;
  if (!(await input.cache.mayHaveDue(input.now))) return NOTHING_DUE;

  const grouped = await input.repository.findDueMembersFor(
    input.refs,
    input.now
  );
  if (grouped.size === 0) return NOTHING_DUE;

  return {
    for(ref: DocumentRef): ReleaseEffectDecision {
      const members = grouped.get(documentRefKey(ref));
      if (members === undefined || members.length === 0) return NO_EFFECT;
      // The same pure rule the materialisation applies, so a read and the write
      // that later persists it cannot disagree about one release.
      return resolveReleaseEffect({ members, now: input.now });
    },
  };
}
