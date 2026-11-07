/**
 * The entry delete check as a plugin author imports it from the SDK.
 *
 * Made as the person a plugin route resolved, never as the system; it names
 * one entry of one collection; and it answers yes or no, nothing else.
 *
 * Asserted with `expectTypeOf` rather than `@ts-expect-error`, which would
 * keep passing if the line failed for an unrelated reason.
 */

import { expectTypeOf } from "vitest";

import type {
  PluginDeleteCheck,
  PluginRouteIdentity,
  PluginWriteCheck,
} from "@nextlyhq/plugin-sdk";
import { mayDeleteEntry, mayWriteEntry } from "@nextlyhq/plugin-sdk";

// Asked as the person a route resolved.
expectTypeOf(mayDeleteEntry).parameter(0).toEqualTypeOf<PluginRouteIdentity>();

// One entry: a collection and an id.
expectTypeOf(mayDeleteEntry).parameter(1).toEqualTypeOf<PluginDeleteCheck>();
expectTypeOf<PluginDeleteCheck>().toEqualTypeOf<{
  readonly collection: string;
  readonly id: string;
}>();

// A yes or a no.
expectTypeOf(mayDeleteEntry).returns.toEqualTypeOf<Promise<boolean>>();

// The write check: asked as the same person, of an entry or a Single, never
// both, answering yes or no.
expectTypeOf(mayWriteEntry).parameter(0).toEqualTypeOf<PluginRouteIdentity>();
expectTypeOf(mayWriteEntry).parameter(1).toEqualTypeOf<PluginWriteCheck>();
expectTypeOf(mayWriteEntry).returns.toEqualTypeOf<Promise<boolean>>();
expectTypeOf({
  collection: "pages",
  id: "1",
  status: "published",
  fields: ["content"],
}).toMatchTypeOf<PluginWriteCheck>();
expectTypeOf({ single: "home" }).toMatchTypeOf<PluginWriteCheck>();
expectTypeOf({
  single: "home",
  collection: "pages",
  id: "1",
}).not.toMatchTypeOf<PluginWriteCheck>();
