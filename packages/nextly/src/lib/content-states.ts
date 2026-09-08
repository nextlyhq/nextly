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

import { NextlyError } from "../errors";

/**
 * One state a document can be in.
 *
 * `isPublic` is the whole contract. It answers the only question the read path
 * asks — may an untrusted caller see a document in this state — and it is a
 * property of the STATE rather than of the caller, which is what lets a reader
 * decide without knowing the vocabulary.
 */
export interface ContentState {
  /**
   * Stored in the `status` column, so it is bounded by that column's width.
   *
   * A machine name rather than a caption: it is written into every row, read
   * back by every query, and compared in SQL. {@link ContentState.label} is
   * where the words a person reads live, which is why this one can stay short
   * without the UI reading like code.
   */
  readonly name: string;
  /** What a person is shown. Free text; never stored on a document. */
  readonly label?: string;
  /** Whether an untrusted read may see a document in this state. */
  readonly isPublic: boolean;
}

/**
 * The widest state name the `status` column can hold.
 *
 * Measured rather than chosen: the generated column is `varchar(20)` on
 * PostgreSQL and MySQL and `text` on SQLite. SQLite is therefore the permissive
 * dialect, which is the dangerous direction — a longer name is accepted by
 * every SQLite-backed test and rejected by the two dialects whose integration
 * legs run last. Enforcing it where a state is DECLARED turns that into an
 * error at boot, on every dialect, instead of a write failure on two of them.
 */
export const MAX_STATE_NAME_LENGTH = 20;

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

/**
 * The states an untrusted read may NOT see.
 *
 * The complement of {@link publicStateNames}, derived rather than filtered
 * again, so the two cannot disagree about a state. A caller asking for drafts
 * means "the work in progress", and under a custom workflow that is every state
 * the workflow does not publish — `in_review` and `legal_hold` as much as
 * `draft`.
 */
export function nonPublicStateNames(
  workflow: ContentWorkflow = DEFAULT_WORKFLOW
): readonly string[] {
  const isPublic = new Set(publicStateNames(workflow));
  return workflow.states.map(state => state.name).filter(n => !isPublic.has(n));
}

/** Whether this workflow declares a state by that name. */
export function declaresState(
  name: string,
  workflow: ContentWorkflow = DEFAULT_WORKFLOW
): boolean {
  return workflow.states.some(state => state.name === name);
}

/** What a person should be shown for a state; its name when it declares no label. */
export function stateLabel(
  name: string,
  workflow: ContentWorkflow = DEFAULT_WORKFLOW
): string {
  const state = workflow.states.find(candidate => candidate.name === name);
  return state?.label ?? name;
}

/**
 * Validate a workflow at the moment it is DECLARED, and return it unchanged.
 *
 * Every rule here is one whose violation is otherwise discovered at write time,
 * on one dialect, in production. Declaring is the only moment at which the
 * whole set is visible, so it is the only moment at which "two states share a
 * name" or "nothing here is public" can be seen at all.
 *
 * It returns its input so a config can wrap a literal without restating it,
 * which also means the check cannot be skipped by accident — an unwrapped
 * literal is a workflow nobody validated, and that is visible in the source.
 */
export function defineWorkflow(workflow: ContentWorkflow): ContentWorkflow {
  const names = workflow.states.map(state => state.name);

  if (names.length === 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: "states",
          code: "workflow_has_no_states",
          message: `Workflow "${workflow.name}" declares no states.`,
        },
      ],
    });
  }

  const duplicates = names.filter((name, at) => names.indexOf(name) !== at);
  if (duplicates.length > 0) {
    // Two states of one name make every question about that name ambiguous —
    // including whether it is public, which is the one the read path asks.
    throw NextlyError.validation({
      errors: [...new Set(duplicates)].map(name => ({
        path: "states",
        code: "duplicate_state_name",
        message: `Workflow "${workflow.name}" declares the state "${name}" more than once.`,
      })),
    });
  }

  const tooLong = names.filter(name => name.length > MAX_STATE_NAME_LENGTH);
  if (tooLong.length > 0) {
    throw NextlyError.validation({
      errors: tooLong.map(name => ({
        path: "states",
        code: "state_name_too_long",
        message: `State "${name}" is ${name.length} characters; the status column holds ${MAX_STATE_NAME_LENGTH}. Use a shorter name and a label.`,
      })),
    });
  }

  const empty = names.filter(name => name.trim().length === 0);
  if (empty.length > 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: "states",
          code: "empty_state_name",
          message: `Workflow "${workflow.name}" declares a state with an empty name.`,
        },
      ],
    });
  }

  if (publicStateNames(workflow).length === 0) {
    // A workflow with nothing public can never show a document to anybody, and
    // the failure is silent: every public read simply returns nothing.
    throw NextlyError.validation({
      errors: [
        {
          path: "states",
          code: "workflow_has_no_public_state",
          message: `Workflow "${workflow.name}" declares no public state, so nothing in it could ever be read by the public.`,
        },
      ],
    });
  }

  return workflow;
}
