/**
 * Whether a registry record, projected, is something the published question
 * will actually take.
 *
 * The projection exists because `Collection` under-states what
 * `getCollection()` returns. That makes it a restatement, and a restatement can
 * drift from the type it is meant to feed while everything still compiles — the
 * projection would simply be assigned to nothing. This asserts the connection
 * the runtime depends on.
 *
 * @module class-usage-collection-view.test-d
 */
import type { ResolvedDraftSplitCollection } from "@nextlyhq/plugin-sdk";

import type { ResolvedCollectionView } from "./class-usage-collection-view";

/** The projection is accepted by the question it is projected for. */
const viewIsAcceptedByTheQuestion: ResolvedCollectionView extends Omit<
  ResolvedDraftSplitCollection,
  "fields"
> &
  Record<"fields", unknown>
  ? true
  : false = true;

/**
 * The control. A comparison against a type whose members were all optional
 * would accept anything, so a shape that must NOT match has to come out false.
 */
const anUnrelatedShapeIsRejected: { slug: number } extends Omit<
  ResolvedDraftSplitCollection,
  "fields"
> &
  Record<"fields", unknown>
  ? true
  : false = false;

export { viewIsAcceptedByTheQuestion, anUnrelatedShapeIsRejected };
