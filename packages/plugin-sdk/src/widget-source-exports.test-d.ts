/**
 * The data-source contract, typed the way a plugin author writes it.
 *
 * The defect this pins is a DX one and it compiles away silently: the SDK
 * published `WidgetSourceResolver` as the name for "a widget source's
 * resolver", and that alias is core's own shape, which has no place for a
 * `PluginContext`. An author
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
  ResolverOptions,
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
expectTypeOf<
  Parameters<PluginSourceResolver>[2]
>().toEqualTypeOf<PluginContext>();

// 🔴 The host's options come AFTER the context for a plugin and in the context's
// place for core, which is the one thing that keeps the two shapes in step. A
// concern the host adds later becomes a FIELD of `ResolverOptions` rather than
// another position that means `ctx` to a plugin and something else to core --
// the collision that decided this shape, since `PluginSourceResolver` derives
// its own parameters from core's.
expectTypeOf<Parameters<WidgetSourceResolver>[2]>().toEqualTypeOf<
  ResolverOptions | undefined
>();
expectTypeOf<Parameters<PluginSourceResolver>[3]>().toEqualTypeOf<
  ResolverOptions | undefined
>();

// Optional, so adding it broke nobody: `named` above takes no `opts` at all and
// is still assignable. That is the assertion that makes this an additive change
// rather than a breaking one, and it is the case every resolver written before
// the signal existed is in.
declare const interruptible: (
  query: WidgetQuery,
  caller: ReadCaller,
  ctx: PluginContext,
  opts?: ResolverOptions
) => Promise<{ op: "count"; total: number }>;
expectTypeOf(interruptible).toMatchTypeOf<PluginSourceResolver>();

// The two names are still NOT interchangeable, which is the whole reason both
// are published: core's shape has no place for a `PluginContext`, so an author
// reaching for the wrong name finds out at the point of use.
expectTypeOf(named).not.toMatchTypeOf<WidgetSourceResolver>();
