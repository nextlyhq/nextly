/**
 * The op/key dependency an author writes against, and the `keyof` the
 * exhaustive source tables depend on.
 *
 * Both are checked here because they pull in opposite directions. Narrowing
 * the authoring position is what makes a malformed declaration a compile
 * error; doing it by turning `WidgetQuery` itself into a union would take
 * `groupBy` out of `keyof WidgetQuery`, and the
 * `Record<keyof WidgetQuery, ...>` tables in the fixed-question sources would
 * stop demanding a position on it — silently, in the passing direction.
 */
import { expectTypeOf } from "vitest";

import type { WidgetQuery, WidgetQuerySpec } from "../query";

// A group key belongs with the op that reads it.
expectTypeOf<{
  source: string;
  op: "groupBy";
  groupBy: "status";
}>().toMatchTypeOf<WidgetQuerySpec>();

expectTypeOf<{
  source: string;
  op: "count";
}>().toMatchTypeOf<WidgetQuerySpec>();

// A key beside an op that would ignore it is refused, rather than accepted
// and dropped on the way to a result that reads like a grouped one.
expectTypeOf<{
  source: string;
  op: "count";
  groupBy: "status";
}>().not.toMatchTypeOf<WidgetQuerySpec>();

// The op with nothing to group into is refused at the same seam.
expectTypeOf<{
  source: string;
  op: "groupBy";
}>().not.toMatchTypeOf<WidgetQuerySpec>();

// A grouped declaration cannot carry row-shaped options. The validator refuses
// them, so a type that admitted them would compile a widget whose every
// request fails.
expectTypeOf<{
  source: string;
  op: "groupBy";
  groupBy: "status";
  select: string[];
}>().not.toMatchTypeOf<WidgetQuerySpec>();

expectTypeOf<{
  source: string;
  op: "groupBy";
  groupBy: "status";
  sort: string;
}>().not.toMatchTypeOf<WidgetQuerySpec>();

// `WidgetQuery` itself stays flat. This is the guard: the fixed-question
// sources key an exhaustive table on these names, so a member disappearing
// from here removes a compiler demand rather than raising an error.
expectTypeOf<keyof WidgetQuery>().toEqualTypeOf<
  "source" | "op" | "where" | "status" | "select" | "sort" | "groupBy" | "limit"
>();
