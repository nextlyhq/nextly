/**
 * Whether the documented producer reaches the documented consumer.
 *
 * `resolvedCollectionDraftSplit` is published for a Builder collection, and the
 * way a plugin OBTAINS one is `ctx.services.collections.getCollection`. Those
 * two are documented together, so the connection between them is a contract
 * even though no single declaration states it — and a contract nothing asserts
 * is one that compiles happily while being false.
 *
 * Derived from the producer's own type rather than from a hand-written record.
 * A restated shape agrees with the service on the day it is written and drifts
 * afterwards, which is the failure this file exists to catch: the assertions
 * would go on passing about a shape the service no longer returns.
 *
 * Written as conditional types assigned to literals, never `@ts-expect-error`.
 * That directive suppresses ANY error on the line beneath it, so it stays green
 * once the code starts failing for an unrelated reason and stays green after
 * the property it names stops holding. These are evaluated by the checker.
 *
 * @module resolved-collection-view.test-d
 */
import type {
  PluginCollectionService,
  ResolvedDraftSplitCollection,
  // Imported as a type because every use here is `typeof`. The RUNTIME export
  // is asserted by the surface snapshot, which reads the built declarations.
  resolvedCollectionView,
} from "@nextlyhq/plugin-sdk";

/** Exactly what a plugin holds after awaiting the documented producer. */
type ProducerResult = Awaited<
  ReturnType<PluginCollectionService["getCollection"]>
>;

/**
 * The raw result is NOT accepted by the question, and that is the point.
 *
 * `Collection` carries its fields under `schemaDefinition` and declares no
 * root-level `status` or `versions`, so a plugin following the documented path
 * cannot pass what it holds. Asserted as `false` rather than left implicit:
 * were the service type ever widened to describe what it really returns, this
 * flips and says so, instead of a projection quietly becoming dead weight.
 */
const rawResultIsNotAccepted: ProducerResult extends ResolvedDraftSplitCollection
  ? true
  : false = false;

/** The projection closes that gap, which is the whole reason it is published. */
const projectedResultIsAccepted: ReturnType<
  typeof resolvedCollectionView
> extends ResolvedDraftSplitCollection
  ? true
  : false = true;

/**
 * The control. Every member of the target but `fields` is optional, so a
 * comparison that accepted anything would satisfy the assertion above without
 * testing it. A shape that must NOT match has to come out false.
 */
const anUnrelatedShapeIsRejected: {
  slug: number;
} extends ResolvedDraftSplitCollection
  ? true
  : false = false;

/**
 * The projection accepts an unknown, because the producer's type under-states it.
 *
 * Asked as "is `unknown` assignable to the parameter", not the reverse. Every
 * type extends `unknown`, so the reverse form is true for a parameter of
 * `string` as readily as for one of `unknown` — it would go on passing after
 * the signature narrowed, which is the one change it exists to catch.
 */
const projectionAcceptsUnknown: unknown extends Parameters<
  typeof resolvedCollectionView
>[0]
  ? true
  : false = true;

export {
  rawResultIsNotAccepted,
  projectedResultIsAccepted,
  anUnrelatedShapeIsRejected,
  projectionAcceptsUnknown,
};
