/**
 * The only way to ask for a hook-free read is the owning plugin's own context.
 * Each assertion is evaluated by the checker (`expectTypeOf`), so a type that
 * gained a way to name a person, or an ordinary read that gained a way to name
 * the grant, fails this file rather than passing it silently.
 */
import { expectTypeOf } from "vitest";

import type {
  CountArgs,
  FindArgs,
  FindByIDArgs,
  GroupArgs,
} from "../direct-api/types/collections";

import type { PluginContext } from "./plugin-context";
import type { OwnCollectionReadOpts, ServiceOpts } from "./service-opts";

type Own = PluginContext["services"]["ownCollections"];

// The read takes data only: no `as`, no `user`, no principal, no scope.
expectTypeOf<keyof OwnCollectionReadOpts>().toEqualTypeOf<
  "context" | "locale" | "fallbackLocale"
>();
// Each method takes those options last, and nothing else in their place.
expectTypeOf<{ [K in keyof Own]: Parameters<Own[K]>[2] }>().toEqualTypeOf<{
  [K in keyof Own]: OwnCollectionReadOpts | undefined;
}>();

// Reads only: the four methods and nothing that writes.
expectTypeOf<keyof Own>().toEqualTypeOf<
  "listEntries" | "findEntryById" | "count" | "group"
>();

// No ordinary read, and no Direct API read, can name the grant.
// Distributed, so the keys are every member's own, not only those they share.
type KeysOfEach<T> = T extends unknown ? keyof T : never;
type Ordinary = ServiceOpts | FindArgs | FindByIDArgs | CountArgs | GroupArgs;
expectTypeOf<Extract<KeysOfEach<Ordinary>, "hookExemptRead">>().toBeNever();
// The control: the same check finds a key one member has and the others lack.
expectTypeOf<
  Extract<KeysOfEach<Ordinary>, "groupBy">
>().toEqualTypeOf<"groupBy">();

// Each read answers what the ordinary read of the same method answers.
expectTypeOf<ReturnType<Own["count"]>>().toEqualTypeOf<Promise<number>>();
expectTypeOf<ReturnType<Own["group"]>>().toEqualTypeOf<
  Promise<{
    buckets: { value: string | null; count: number }[];
    truncated: boolean;
  }>
>();
expectTypeOf<ReturnType<Own["listEntries"]>>().toEqualTypeOf<
  ReturnType<PluginContext["services"]["collections"]["listEntries"]>
>();
