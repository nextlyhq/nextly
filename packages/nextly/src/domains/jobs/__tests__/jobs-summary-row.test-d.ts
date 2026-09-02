/**
 * The summary row must promise exactly what the query selects.
 *
 * A runtime test cannot see this: `listRecent` returns whatever the adapter
 * hands back, so a type that over-promises produces `undefined` at a property
 * the compiler calls a `string`, and every assertion written against the
 * projection still passes. It was `Omit<JobRow, "input">` beside a projection
 * that also omitted `runAsUserId`, `dedupeKey` and `lockedBy` — three fields a
 * caller could read, and be typed for, and never receive.
 */

import { expectTypeOf } from "vitest";

import type { JobRow, JobSummaryRow } from "../jobs-repository";

// What the projection selects is present, and keeps JobRow's own type.
expectTypeOf<JobSummaryRow>().toHaveProperty("id").toEqualTypeOf<string>();
expectTypeOf<JobSummaryRow>()
  .toHaveProperty("lastError")
  .toEqualTypeOf<string | null>();
expectTypeOf<JobSummaryRow>()
  .toHaveProperty("lockedUntil")
  .toEqualTypeOf<Date | null>();

// What it does not select is ABSENT rather than optional: reading it is a
// compile error, which is the only signal that arrives before production.
expectTypeOf<JobSummaryRow>().not.toHaveProperty("input");
expectTypeOf<JobSummaryRow>().not.toHaveProperty("runAsUserId");
expectTypeOf<JobSummaryRow>().not.toHaveProperty("dedupeKey");
expectTypeOf<JobSummaryRow>().not.toHaveProperty("lockedBy");

// The premise: those names are real columns on the row this is projected from,
// so their absence above is a projection decision and not four typos.
expectTypeOf<JobRow>().toHaveProperty("runAsUserId");
expectTypeOf<JobRow>().toHaveProperty("dedupeKey");
expectTypeOf<JobRow>().toHaveProperty("lockedBy");
expectTypeOf<JobRow>().toHaveProperty("input");
