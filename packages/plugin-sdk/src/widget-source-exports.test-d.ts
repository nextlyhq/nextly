/**
 * The data-source contract, typed the way a plugin author writes it.
 *
 * The defect this pins is a DX one and it compiles away silently: the SDK
 * published `WidgetSourceResolver` as the name for "a widget source's
 * resolver", and that alias is core's own TWO-argument shape. An author
 * following the export and typing a standalone resolver with it had the
 * `PluginContext` parameter rejected -- the one parameter through which a
 * contributed resolver can read any data at all. The contract was reachable
 * only by writing the function inline and letting inference do it.
 *
 * Asserted with `expectTypeOf` rather than `@ts-expect-error`, because a
 * directive suppresses ANY error on the line beneath it: it would keep passing
 * if the rejection stopped happening, and keep passing if the line started
 * failing for an unrelated reason. These assertions are evaluated.
 */

import { expectTypeOf } from "vitest";

import type {
  PluginContext,
  PluginSourceResolver,
  PluginWidgetSource,
  ReadCaller,
  WidgetQuery,
  WidgetSourceResolver,
} from "@nextlyhq/plugin-sdk";

// The shape an author writes: the question, who is asking, and the plugin's
// own context to answer from.
declare const named: (
  query: WidgetQuery,
  caller: ReadCaller,
  ctx: PluginContext
) => Promise<{ op: "count"; total: number }>;

// 🔴 The assertion the export exists for. A named resolver taking `ctx` is
// assignable to the published type, so an author can declare one outside
// `definePlugin` and hand it to `contributes.widgetSources`.
expectTypeOf(named).toMatchTypeOf<PluginSourceResolver>();
expectTypeOf<
  PluginWidgetSource["resolve"]
>().toEqualTypeOf<PluginSourceResolver>();

// The context is genuinely the third parameter rather than an optional extra:
// its absence is what made the contract unusable.
expectTypeOf<Parameters<PluginSourceResolver>>().toMatchTypeOf<
  [WidgetQuery, ReadCaller, PluginContext]
>();

// The two names are NOT interchangeable, which is the whole reason both are
// published. Core's own shape takes two arguments; a plugin's takes three, so
// the parameter lists differ and an author reaching for the wrong name finds
// out at the point of use.
expectTypeOf<Parameters<WidgetSourceResolver>["length"]>().toEqualTypeOf<2>();
expectTypeOf<Parameters<PluginSourceResolver>["length"]>().toEqualTypeOf<3>();
