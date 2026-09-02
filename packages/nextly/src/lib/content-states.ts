/**
 * What a content state MEANS, as flags rather than as a name.
 *
 * Today the vocabulary is two words and every consumer knows both. The moment a
 * team can define its own — `inReview`, `legalHold`, `retired` — a consumer that
 * asks "is this the word published" has to be taught every new word, and the
 * one that is not taught fails in the dangerous direction: an unrecognised state
 * read as public serves unpublished content to the world.
 *
 * So a state declares a PROPERTY and consumers read the property. A state named
 * `legalHold` needs no special handling anywhere; it is simply not public. This
 * is the model Drupal's content moderation has used across a decade of large
 * deployments, and the shape DatoCMS arrives at from the other direction.
 *
 * ## Why this file is not yet configurable
 *
 * It declares exactly the two states the system has always had, with the flags
 * that reproduce today's behaviour. Nothing an author sees changes. What changes
 * is WHERE the answer comes from: the read path stops comparing a literal and
 * starts asking a workflow which of its states are public, so admitting a third
 * state later is a change to this file rather than to every consumer.
 *
 * @module lib/content-states
 */

/**
 * One state a document can be in.
 *
 * `isPublic` is the whole contract. It answers the only question the read path
 * asks — may an untrusted caller see a document in this state — and it is a
 * property of the STATE rather than of the caller, which is what lets a reader
 * decide without knowing the vocabulary.
 */
export interface ContentState {
  /** Stored in the `status` column. */
  readonly name: string;
  /** Whether an untrusted read may see a document in this state. */
  readonly isPublic: boolean;
}

/**
 * A named set of states a collection's documents move through.
 *
 * `states` is ordered, and the order is the authoring progression rather than a
 * ranking — a UI listing them shows them in this order. Nothing in the read
 * path depends on it, so a workflow that reorders its states changes no
 * behaviour.
 */
export interface ContentWorkflow {
  readonly name: string;
  readonly states: readonly ContentState[];
}

/**
 * The workflow every collection has until one is configured for it.
 *
 * Exactly the two states that existed before workflows: a draft nobody outside
 * may see, and a published document anybody may. Stated as data so the read
 * path can ask rather than assume, and so the first custom workflow is an
 * addition rather than a rewrite.
 */
export const DEFAULT_WORKFLOW: ContentWorkflow = {
  name: "default",
  states: [
    { name: "draft", isPublic: false },
    { name: "published", isPublic: true },
  ],
};

/**
 * The states an untrusted read may see, in the workflow's own order.
 *
 * Returned as names because that is what the `status` column holds and what a
 * SQL predicate compares against. A caller must not reconstruct this by
 * filtering `states` itself — that is the second implementation this module
 * exists to prevent.
 */
export function publicStateNames(
  workflow: ContentWorkflow = DEFAULT_WORKFLOW
): readonly string[] {
  return workflow.states.filter(state => state.isPublic).map(s => s.name);
}

/**
 * Whether a stored value names a state this workflow treats as public.
 *
 * Unknown values answer FALSE, deliberately and load-bearingly. A row carrying a
 * state the workflow no longer declares — a workflow edited after the row was
 * written — must not be visible to the world on the strength of nobody having
 * decided about it. Absence of a decision is not permission.
 */
export function isPublicState(
  name: string,
  workflow: ContentWorkflow = DEFAULT_WORKFLOW
): boolean {
  // Asked of {@link publicStateNames} rather than walked again here. The two
  // answers must never differ, and the only way to guarantee that is for one of
  // them not to exist: a second walk over `states` would keep agreeing until
  // the day normalization or deduplication is added to one of them, and the
  // disagreement then appears as a document the filter excluded and this
  // predicate called public.
  return publicStateNames(workflow).includes(name);
}
