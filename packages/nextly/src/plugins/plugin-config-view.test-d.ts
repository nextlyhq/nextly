/**
 * `ctx.config` is frozen all the way down at runtime (`pluginConfigView`), so
 * its type has to be readonly all the way down too: a write the type allows
 * is a write that throws. Each assertion here is evaluated by the checker
 * (`expectTypeOf`), so a type that went back to readonly at the top level
 * only fails this file rather than passing it silently.
 */
import { expectTypeOf } from "vitest";

import type { CollectionConfig } from "../collections/config/define-collection";
import type { FrozenCopy, FrozenValue } from "../shared/lib/plain-copy";
import type { SecurityConfig } from "../shared/types/config";

import type { PluginConfig, PluginSummary } from "./plugin-config-view";
import type { PluginCapabilities } from "./plugin-context";

/**
 * Whether `A` and `B` are the same type, readonly modifiers included. The
 * generic-function comparison is the checker's own identity relation, which
 * treats `{ readonly a: 1 }` and `{ a: 1 }` as different where assignability
 * does not.
 */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Whether property `K` of `T` can be assigned to. */
type Writable<T, K extends keyof T> = Same<
  { [P in K]: T[P] },
  { -readonly [P in K]: T[P] }
>;

/** Whether `T` (once defined) has a member named `K`. */
type Has<T, K extends PropertyKey> = K extends keyof NonNullable<T>
  ? true
  : false;

// The positive control: the helper does report an ordinary property as
// writable, so the `false` answers below come from the modifier rather than
// from a helper that answers `false` for everything.
expectTypeOf<Writable<{ a: number }, "a">>().toEqualTypeOf<true>();
expectTypeOf<Writable<{ readonly a: number }, "a">>().toEqualTypeOf<false>();

// --- collections ----------------------------------------------------------

type Collections = NonNullable<PluginConfig["collections"]>;
type Collection = Collections[number];

// A readonly array of frozen collections: no `push`, and the elements are the
// frozen form of what the app declared.
expectTypeOf<Collections>().toEqualTypeOf<
  readonly FrozenCopy<CollectionConfig>[]
>();
expectTypeOf<Has<Collections, "push">>().toEqualTypeOf<false>();

// One level further down: a collection's own properties and its field list.
expectTypeOf<Writable<Collection, "slug">>().toEqualTypeOf<false>();
expectTypeOf<Has<Collection["fields"], "push">>().toEqualTypeOf<false>();

// A hook is kept by reference at runtime, and keeps its signature here: the
// handler list is readonly, each handler is exactly the declared function.
type BeforeOperation = NonNullable<
  NonNullable<Collection["hooks"]>["beforeOperation"]
>;
expectTypeOf<Has<BeforeOperation, "push">>().toEqualTypeOf<false>();
expectTypeOf<BeforeOperation[number]>().toEqualTypeOf<
  NonNullable<NonNullable<CollectionConfig["hooks"]>["beforeOperation"]>[number]
>();

// --- security -------------------------------------------------------------

type Security = NonNullable<PluginConfig["security"]>;
type Cors = NonNullable<Security["cors"]>;

expectTypeOf<Writable<Security, "cors">>().toEqualTypeOf<false>();
expectTypeOf<Writable<Cors, "credentials">>().toEqualTypeOf<false>();
expectTypeOf<Has<Cors["origin"], "push">>().toEqualTypeOf<false>();
expectTypeOf<Security>().toEqualTypeOf<FrozenCopy<SecurityConfig>>();

// --- plugins[number].capabilities -----------------------------------------

// Asserted on `PluginSummary` itself: it is exported on its own, and read
// through `PluginConfig` the outer mapping would make it readonly whatever
// `PluginSummary` declared. The two readings are then held to be the same.
type Capabilities = NonNullable<PluginSummary["capabilities"]>;

expectTypeOf<
  NonNullable<NonNullable<PluginConfig["plugins"]>[number]["capabilities"]>
>().toEqualTypeOf<Capabilities>();
expectTypeOf<Capabilities>().toEqualTypeOf<FrozenCopy<PluginCapabilities>>();
expectTypeOf<Writable<Capabilities, "net">>().toEqualTypeOf<false>();
expectTypeOf<
  Writable<NonNullable<Capabilities["net"]>, "outbound">
>().toEqualTypeOf<false>();
expectTypeOf<
  Has<NonNullable<Capabilities["net"]>["outbound"], "push">
>().toEqualTypeOf<false>();
expectTypeOf<
  Writable<NonNullable<Capabilities["db"]>, "rawSql">
>().toEqualTypeOf<false>();

// --- what FrozenValue keeps as it is ----------------------------------------

// Functions and built-in instances are held by reference, unfrozen, so the
// type leaves them alone rather than mapping their members.
type Handler = (input: { id: string }) => Promise<void>;
expectTypeOf<FrozenValue<Handler>>().toEqualTypeOf<Handler>();
expectTypeOf<FrozenValue<Date>>().toEqualTypeOf<Date>();
expectTypeOf<FrozenValue<Map<string, number>>>().toEqualTypeOf<
  Map<string, number>
>();
// Symbol keys are mapped with the rest, as the copy carries them.
declare const brand: unique symbol;
expectTypeOf<FrozenCopy<{ [brand]: { n: number[] } }>>().toEqualTypeOf<{
  readonly [brand]: { readonly n: readonly number[] };
}>();
// `unknown` passes through instead of turning into a mapped object, and an
// optional property stays optional.
expectTypeOf<FrozenValue<unknown>>().toEqualTypeOf<unknown>();
expectTypeOf<FrozenCopy<{ a?: string }>>().toEqualTypeOf<{
  readonly a?: string;
}>();
