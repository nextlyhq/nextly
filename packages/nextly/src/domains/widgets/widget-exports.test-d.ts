/**
 * What the published widget vocabulary IS, asserted so the checker evaluates it.
 *
 * `__tests__/export-contract.test.ts` proves these names are exported and that
 * example values are assignable to them. Neither claim survives a WIDENING:
 * `type WidgetHeight = string` exports the same name and accepts `"tall"`
 * happily, so both assertions stay green while every plugin author loses the
 * only thing the type was for -- a typo becoming a compile error instead of a
 * card that silently draws at the wrong height.
 *
 * In a `.test-d.ts` rather than a `.test.ts` for the reason
 * `shared/addressable-fields.test-d.ts` states: a passive annotation in a
 * runtime test is transpiled away and checks nothing about the type. It is
 * compiled by `pnpm check-types` through `tsconfig.tests.json`.
 *
 * Read through the ROOT entry point, never through the domain modules. There is
 * no `nextly/widgets` subpath, so the root is the only place a plugin author can
 * reach these -- and a name that stops being re-exported is exactly the
 * regression this file exists to catch, which importing from `./definition`
 * would hide.
 *
 * The `Exact` / `assertType` pair is the one
 * `shared/addressable-fields.test-d.ts` and
 * `direct-api/types/field-groups-public-surface.test-d.ts` already use, restated
 * locally the way those do rather than shared: a `.test-d.ts` exporting a helper
 * would be imported by files that are not type tests.
 */
import type {
  WidgetArchetype,
  WidgetHeight,
  WidgetOp,
  WidgetSize,
  WidgetSourceField,
  WidgetSourceFieldType,
  WidgetSourceKind,
} from "../../index";

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

/** Whether `A` is assignable to `B`, as a value the checker EVALUATES. */
type AssignableTo<A, B> = [A] extends [B] ? true : false;

// The unions, member for member. `toMatchTypeOf`-style containment would be
// satisfied by a widened alias; equality in BOTH directions is what refuses one.
assertType<Exact<WidgetHeight, "short" | "tall">>(true);
assertType<Exact<WidgetSize, "sm" | "md" | "lg" | "xl" | "full">>(true);
assertType<Exact<WidgetOp, "count" | "list" | "groupBy" | "timeseries">>(true);
assertType<
  Exact<WidgetSourceKind, "collection" | "single" | "system" | "plugin">
>(true);
assertType<
  Exact<WidgetSourceFieldType, "string" | "number" | "boolean" | "date">
>(true);
assertType<
  Exact<
    WidgetArchetype,
    "metric" | "table" | "list" | "text" | "actions" | "custom"
  >
>(true);

// The three claims a closed string union makes, stated together per type: the
// valid member is assignable, and `string` and a plausible near-miss are not.
// None of them is sufficient alone -- the refusals are satisfied by a union
// narrowed to `never`, which would leave an author unable to write a valid value
// at all, and the acceptance is satisfied by a widening to `string`, which is
// the regression this file exists for. The near-miss is the value an author
// actually mistypes, so a union that quietly GAINED a member fails here where
// `string` alone would not.
//
// Written out per type rather than through a generic `ClosedUnion<T, ...>`
// helper, and that is deliberate: inside a generic alias these conditionals are
// deferred, and the wrapper evaluated to `false` for a HEALTHY union -- a helper
// that fails on correct code and would have been "fixed" by deleting the
// assertions it broke. Instantiated directly, they resolve.
assertType<
  Exact<
    [
      AssignableTo<"tall", WidgetHeight>,
      AssignableTo<string, WidgetHeight>,
      AssignableTo<"long", WidgetHeight>,
    ],
    [true, false, false]
  >
>(true);
assertType<
  Exact<
    [
      AssignableTo<"lg", WidgetSize>,
      AssignableTo<string, WidgetSize>,
      AssignableTo<"medium", WidgetSize>,
    ],
    [true, false, false]
  >
>(true);
assertType<
  Exact<
    [
      AssignableTo<"count", WidgetOp>,
      AssignableTo<string, WidgetOp>,
      AssignableTo<"sum", WidgetOp>,
    ],
    [true, false, false]
  >
>(true);
assertType<
  Exact<
    [
      AssignableTo<"metric", WidgetArchetype>,
      AssignableTo<string, WidgetArchetype>,
      AssignableTo<"chart", WidgetArchetype>,
    ],
    [true, false, false]
  >
>(true);
assertType<
  Exact<
    [
      AssignableTo<"collection", WidgetSourceKind>,
      AssignableTo<string, WidgetSourceKind>,
      AssignableTo<"table", WidgetSourceKind>,
    ],
    [true, false, false]
  >
>(true);
assertType<
  Exact<
    [
      AssignableTo<"date", WidgetSourceFieldType>,
      AssignableTo<string, WidgetSourceFieldType>,
      AssignableTo<"text", WidgetSourceFieldType>,
    ],
    [true, false, false]
  >
>(true);

// `WidgetSource` is built out of this, so its shape is part of the published
// contract too -- and `type` carrying the closed vocabulary rather than `string`
// is the whole reason a source declaration can be checked at all.
assertType<Exact<WidgetSourceField["name"], string>>(true);
assertType<Exact<WidgetSourceField["type"], WidgetSourceFieldType>>(true);
assertType<
  Exact<AssignableTo<{ name: string; type: "text" }, WidgetSourceField>, false>
>(true);
assertType<
  Exact<AssignableTo<{ name: string; type: "string" }, WidgetSourceField>, true>
>(true);
