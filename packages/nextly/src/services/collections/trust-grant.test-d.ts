/**
 * A trusted expansion cannot omit its bound — asserted by the CHECKER.
 *
 * The guarantee this file pins is not "a bound exists". It is that **absence is
 * no longer expressible** on the context an expansion actually runs under. Two
 * different states used to produce the same value: an author who weighed which
 * collections their bypass should reach and decided "all of them", and an author
 * who never saw the question. Both wrote nothing, and only the second was a bug.
 *
 * The failure it prevents is a route reaching related rows with an unbounded
 * bypass: the route names one collection, the expansion reads the others, and
 * nothing in the type obliges the caller to say whether that is intended.
 *
 * Every negative below is asked as a conditional type rather than with
 * `@ts-expect-error`, which suppresses ANY error on the line that follows and
 * would keep passing once the code started failing for an unrelated reason.
 * A conditional fails as `Expected: true, Actual: false`, which names the
 * direction that broke.
 */
import { expectTypeOf } from "vitest";

import type { DirectAPIConfig } from "../../direct-api/types/shared";

import type { RelatedRowReadContext } from "./related-row-read-context";
import type { TrustBound, TRUSTS_EVERY_COLLECTION } from "./trust-grant";

// A context missing `trusted` is not a context. Written as `Omit` rather than an
// inline literal so it keeps testing the real shape as fields are added: an
// inline object would start failing for the newest unrelated required field and
// report that as this guarantee still holding.
type WithoutBound = Omit<RelatedRowReadContext, "trusted">;
type BoundIsRequired = WithoutBound extends RelatedRowReadContext
  ? false
  : true;
expectTypeOf<BoundIsRequired>().toEqualTypeOf<true>();

// And it may not be satisfied by `undefined`. This is the half that does the
// work: `trusted` was already a required KEY before this change, and a required
// key that accepts `undefined` is an optional field wearing a hat.
type UndefinedIsNotABound = undefined extends TrustBound ? false : true;
expectTypeOf<UndefinedIsNotABound>().toEqualTypeOf<true>();

// The positive controls. Without these, both assertions above would pass just as
// well if `TrustBound` were narrowed to something no caller could ever satisfy,
// or deleted outright — a guard nothing can get through is indistinguishable
// from a guard nothing can USE.
type ConstantIsABound = typeof TRUSTS_EVERY_COLLECTION extends TrustBound
  ? true
  : false;
expectTypeOf<ConstantIsABound>().toEqualTypeOf<true>();

type PredicateIsABound = ((collection: string) => boolean) extends TrustBound
  ? true
  : false;
expectTypeOf<PredicateIsABound>().toEqualTypeOf<true>();

// The escape hatch has to be reachable from the PUBLIC option too, or a caller
// outside this package can describe a narrowing bound but not an unbounded one,
// and would go back to expressing "everything" by saying nothing.
type PublicOptionAcceptsConstant =
  typeof TRUSTS_EVERY_COLLECTION extends NonNullable<DirectAPIConfig["trusted"]>
    ? true
    : false;
expectTypeOf<PublicOptionAcceptsConstant>().toEqualTypeOf<true>();
