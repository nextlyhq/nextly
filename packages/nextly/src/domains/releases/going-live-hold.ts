/**
 * Which of a release's documents going live are held back now, by what governs publishing beyond
 * a release's own checks: a workflow holds a document until the parts it would publish are
 * approved.
 *
 * Asked where a release puts a document live, or shows it live: by the run before it writes each
 * document it publishes, and by the read's projection of a due release before it widens a read to
 * a document the run has not written yet. Both must agree with the hard check that answers for
 * the same documents before the moment, so whatever holds a document registers one answer here
 * and the same answer as its check source; the releases domain never decides it.
 *
 * Registered in the container as `releaseGoingLiveHold`. With nothing registered no document is
 * held. Releases import nothing from the feature that answers.
 *
 * @module domains/releases/going-live-hold
 */
import { container } from "../../di/container";
import type { VersionScopeKind } from "../../schemas/versions/types";

/**
 * A document a release would put live, under a key the caller chooses: a member's id, or for the
 * read's projection the document's own id.
 */
export interface GoingLiveDocument {
  id: string;
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
}

/** What holds a release's documents back from going live. */
export interface GoingLiveHold {
  /** The keys of those of `documents` held back now. */
  held(documents: readonly GoingLiveDocument[]): Promise<ReadonlySet<string>>;
}

/** The hold while nothing is registered: no document is held. */
const NOTHING_HELD: GoingLiveHold = {
  held: () => Promise.resolve(new Set<string>()),
};

/** The hold a release asks: the registered one, else one holding nothing. */
export function goingLiveHold(): GoingLiveHold {
  return container.has("releaseGoingLiveHold")
    ? container.get<GoingLiveHold>("releaseGoingLiveHold")
    : NOTHING_HELD;
}
