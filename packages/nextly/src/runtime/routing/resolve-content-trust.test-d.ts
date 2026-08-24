/**
 * A route cannot hold the access bypass without saying how far it travels —
 * asserted by the CHECKER.
 *
 * `resolveContent` is the surface a custom route calls, and a route names ONE
 * collection while the page it renders reaches others through relationships.
 * Those targets were never named, so an unbounded bypass spreads into all of
 * them; on a pre-rendered route their restricted or unpublished rows are then
 * written into a static artifact that outlives the row.
 *
 * Two properties are pinned, and the second is the one that matters. The first
 * is that a bypass without a bound is rejected. The second is that this holds
 * for a COMPUTED flag — `overrideAccess: granted || draft` is the spelling that
 * actually shipped unbounded, and a union that only caught a literal `true`
 * would miss every real instance while looking like a guard.
 *
 * Written as conditional types rather than `@ts-expect-error`, which suppresses
 * ANY error on the line beneath it and would keep passing once these calls
 * started failing for an unrelated reason.
 */
import { expectTypeOf } from "vitest";

import type { TRUSTS_EVERY_COLLECTION } from "../../services/collections/trust-grant";

import type { ResolveContentOptions } from "./resolve-content";

type Accepts<T> = T extends ResolveContentOptions ? true : false;

// A read that holds no bypass trusts nothing and is not asked to say so.
expectTypeOf<Accepts<Record<string, never>>>().toEqualTypeOf<true>();
expectTypeOf<Accepts<{ overrideAccess: false }>>().toEqualTypeOf<true>();

// A bypass with no bound does not compile.
expectTypeOf<Accepts<{ overrideAccess: true }>>().toEqualTypeOf<false>();

// And neither does the computed form, which is the one that shipped.
expectTypeOf<Accepts<{ overrideAccess: boolean }>>().toEqualTypeOf<false>();

// The positive controls. Without these, both rejections above would hold just
// as firmly if the trusted arm were unsatisfiable — a door nobody can open is
// indistinguishable from a door that is locked, and only one of them is a
// working route.
expectTypeOf<
  Accepts<{ overrideAccess: true; trustedCollections: readonly string[] }>
>().toEqualTypeOf<true>();

expectTypeOf<
  Accepts<{
    overrideAccess: true;
    trustedCollections: typeof TRUSTS_EVERY_COLLECTION;
  }>
>().toEqualTypeOf<true>();

// The escape hatch must be reachable as the CONSTANT, not merely as some
// string: if the arm accepted `string`, a caller could satisfy it with a typo
// and get an unbounded read that reads as a decision.
expectTypeOf<
  Accepts<{ overrideAccess: true; trustedCollections: "all" }>
>().toEqualTypeOf<false>();
