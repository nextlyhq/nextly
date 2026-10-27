/**
 * The site config's `admin.dashboard` as an author types it, and what a plugin
 * may and may not ask for. Compiled by `pnpm check-types` through
 * `tsconfig.tests.json`.
 */
import { expectTypeOf } from "vitest";

import type { AdminConfig } from "../../../../shared/types/config";
import type { WidgetSizeDeclaration } from "../../grid-size";
import type {
  AdminDashboardConfig,
  CoreWidgetId,
  DashboardContribution,
  DefaultLayoutCard,
  WidgetOverride,
  WidgetRef,
} from "../dashboard";

// The site config carries it under `admin`.
expectTypeOf<AdminConfig["dashboard"]>().toEqualTypeOf<
  AdminDashboardConfig | undefined
>();

// Its keys, as published: nothing beyond these is accepted.
expectTypeOf<keyof AdminDashboardConfig>().toEqualTypeOf<
  "widgets" | "hide" | "overrides" | "defaultLayout" | "suggestions" | "replace"
>();

// A built-in alone can be replaced, so `replace` is keyed by core's ids.
expectTypeOf<
  keyof NonNullable<AdminDashboardConfig["replace"]>
>().toEqualTypeOf<CoreWidgetId>();

// Elsewhere any widget can be named, core's ids completing as they are typed.
expectTypeOf<CoreWidgetId>().toMatchTypeOf<WidgetRef>();
expectTypeOf<"acme/orders">().toMatchTypeOf<WidgetRef>();
expectTypeOf<
  NonNullable<AdminDashboardConfig["overrides"]>["core/team"]
>().toEqualTypeOf<WidgetOverride | undefined>();
expectTypeOf<
  NonNullable<AdminDashboardConfig["defaultLayout"]>[number]
>().toEqualTypeOf<WidgetRef | DefaultLayoutCard>();

// A plugin may only ask: its widgets, a suggestion, an alternative and an
// attention line. It has no field that hides, moves or replaces another widget,
// or that changes a saved dashboard.
expectTypeOf<keyof DashboardContribution>().toEqualTypeOf<
  "widgets" | "suggest" | "alternatives" | "attention"
>();

// A default card's size is `w` and `h` in grid units, each optional; it takes
// no named width.
expectTypeOf<keyof DefaultLayoutCard>().toEqualTypeOf<
  "widget" | "w" | "h" | "settings"
>();
expectTypeOf<DefaultLayoutCard["w"]>().toEqualTypeOf<number | undefined>();
expectTypeOf<DefaultLayoutCard["h"]>().toEqualTypeOf<number | undefined>();

// An override narrows the widget's size with any of the declaration's own
// ends, and has no width or widths of its own.
expectTypeOf<keyof WidgetOverride>().toEqualTypeOf<
  "title" | "description" | "size" | "settings"
>();
expectTypeOf<WidgetOverride["size"]>().toEqualTypeOf<
  Partial<WidgetSizeDeclaration> | undefined
>();
