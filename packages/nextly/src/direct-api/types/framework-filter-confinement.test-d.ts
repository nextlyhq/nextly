/**
 * The framework-filter exemption cannot be inherited — asserted by the CHECKER.
 *
 * `frameworkFilter` says "this `where` was built by the framework, not sent by a
 * request", and it exempts the filter from the guard that stops a caller
 * bisecting a field it may not read. That is only sound while it is stated per
 * operation.
 *
 * `mergeConfig` fills anything a nested Direct API call omits from the instance
 * defaults — the hazard `namespaces/helpers.ts` documents for `overrideAccess`
 * and `trusted`. If the flag could travel that way, a caller-supplied `where`
 * reaching a nested read would acquire the framework's trust, and the guard
 * would be bypassed by inheritance rather than by decision.
 *
 * An earlier version of this file read the SOURCE for the string
 * `frameworkFilter` and asserted where it appeared. That was a scan, not a
 * boundary: it stayed green if `DirectAPIConfig` gained the property through an
 * extended or intersected alias, or if a renamed helper forwarded it by object
 * spread, and it went red on a comment that merely used the word. What follows
 * asks the type system the question instead, so a shape that would inherit the
 * flag cannot compile whatever route it takes there.
 */
import { expectTypeOf } from "vitest";

import type { CountArgs, FindArgs } from "./collections";
import type { DirectAPIConfig } from "./shared";

// The config `mergeConfig` fills from instance defaults must have no notion of
// this flag — through its own declaration or through anything it extends.
//
// Asked via `keyof` rather than `not.toHaveProperty`, and the difference is
// what the RED says: measured, the matcher form fails an arity check that names
// nothing, while this one fails with
// `Expected: literal boolean: false, Actual: literal boolean: true` — a
// diagnostic that identifies the property and the direction. An intersected
// alias contributes its keys here even when the declaration site is elsewhere,
// which is the route a source scan cannot see.
type ConfigCarriesFlag = "frameworkFilter" extends keyof DirectAPIConfig
  ? true
  : false;
expectTypeOf<ConfigCarriesFlag>().toEqualTypeOf<false>();

// And it IS reachable where a call site states it. Asserting only absence would
// pass just as well if the flag were deleted from the codebase entirely.
expectTypeOf<FindArgs>().toHaveProperty("frameworkFilter");
expectTypeOf<CountArgs>().toHaveProperty("frameworkFilter");

// Stated, never inferred: `true` only, so `frameworkFilter: someBoolean` cannot
// carry a runtime value into a security decision.
expectTypeOf<FindArgs["frameworkFilter"]>().toEqualTypeOf<true | undefined>();
