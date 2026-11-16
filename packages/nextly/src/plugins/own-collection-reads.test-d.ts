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
import type { FindSingleArgs } from "../direct-api/types/singles";
import type { SingleDocument } from "../domains/singles/types";

import type { PluginContext } from "./plugin-context";
import type {
  OwnCollectionReadOpts,
  OwnSingleTransactionReadOpts,
  OwnTransactionReadOpts,
  PluginCollectionTransaction,
  ServiceOpts,
} from "./service-opts";

type Own = PluginContext["services"]["ownCollections"];
/** The reads made on the pool, and those made on a transaction the plugin holds. */
type PoolReads = "listEntries" | "findEntryById" | "count" | "group";
type TransactionReads = Exclude<keyof Own, PoolReads>;

// The read takes data only: no `as`, no `user`, no principal, no scope.
expectTypeOf<keyof OwnCollectionReadOpts>().toEqualTypeOf<
  "context" | "locale" | "fallbackLocale"
>();
// Each method takes those options last, and nothing else in their place.
expectTypeOf<{ [K in PoolReads]: Parameters<Own[K]>[2] }>().toEqualTypeOf<{
  [K in PoolReads]: OwnCollectionReadOpts | undefined;
}>();
// A collection read on a transaction may also name the lock its rows take.
expectTypeOf<keyof OwnTransactionReadOpts>().toEqualTypeOf<
  keyof OwnCollectionReadOpts | "lock"
>();
// The locks a collection read names: shared (the default), for update, or a
// plain read with none.
expectTypeOf<OwnTransactionReadOpts["lock"]>().toEqualTypeOf<
  "share" | "update" | "none" | undefined
>();
// A Single read on a transaction names its lock too, shared or none: one row
// read to answer a document has no `update`.
expectTypeOf<keyof OwnSingleTransactionReadOpts>().toEqualTypeOf<
  keyof OwnCollectionReadOpts | "lock"
>();
expectTypeOf<OwnSingleTransactionReadOpts["lock"]>().toEqualTypeOf<
  "share" | "none" | undefined
>();
expectTypeOf<{
  [K in
    | "listEntriesInTransaction"
    | "listHostEntriesInTransaction"]: Parameters<Own[K]>[3];
}>().toEqualTypeOf<{
  [K in "listEntriesInTransaction" | "listHostEntriesInTransaction"]:
    | OwnTransactionReadOpts
    | undefined;
}>();
expectTypeOf<{
  [K in
    | "findEntryByIdInTransaction"
    | "findHostEntryByIdInTransaction"]: Parameters<Own[K]>[3];
}>().toEqualTypeOf<{
  [K in "findEntryByIdInTransaction" | "findHostEntryByIdInTransaction"]:
    | OwnTransactionReadOpts
    | undefined;
}>();
expectTypeOf<{
  [K in "getSingleInTransaction" | "getHostSingleInTransaction"]: Parameters<
    Own[K]
  >[2];
}>().toEqualTypeOf<{
  [K in "getSingleInTransaction" | "getHostSingleInTransaction"]:
    | OwnSingleTransactionReadOpts
    | undefined;
}>();
// A transaction read takes the plugin's transaction token first, never the
// adapter's transaction.
expectTypeOf<{
  [K in TransactionReads]: Parameters<Own[K]>[0];
}>().toEqualTypeOf<{
  [K in TransactionReads]: PluginCollectionTransaction;
}>();

// Reads only: these methods and nothing that writes.
expectTypeOf<keyof Own>().toEqualTypeOf<
  | "listEntries"
  | "findEntryById"
  | "count"
  | "group"
  | "listEntriesInTransaction"
  | "findEntryByIdInTransaction"
  | "getSingleInTransaction"
  | "listHostEntriesInTransaction"
  | "findHostEntryByIdInTransaction"
  | "getHostSingleInTransaction"
  | "listHostTypesInTransaction"
>();

// No ordinary read, and no Direct API read, can name the grant.
// Distributed, so the keys are every member's own, not only those they share.
type KeysOfEach<T> = T extends unknown ? keyof T : never;
type Ordinary =
  | ServiceOpts
  | FindArgs
  | FindByIDArgs
  | CountArgs
  | GroupArgs
  | FindSingleArgs;
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
// A transaction read answers what the same read on the pool answers.
expectTypeOf<ReturnType<Own["listEntriesInTransaction"]>>().toEqualTypeOf<
  ReturnType<Own["listEntries"]>
>();
expectTypeOf<ReturnType<Own["findEntryByIdInTransaction"]>>().toEqualTypeOf<
  ReturnType<Own["findEntryById"]>
>();
expectTypeOf<ReturnType<Own["getSingleInTransaction"]>>().toEqualTypeOf<
  Promise<SingleDocument>
>();
// A host read answers what the own read of the same method answers.
expectTypeOf<ReturnType<Own["listHostEntriesInTransaction"]>>().toEqualTypeOf<
  ReturnType<Own["listEntries"]>
>();
expectTypeOf<ReturnType<Own["findHostEntryByIdInTransaction"]>>().toEqualTypeOf<
  ReturnType<Own["findEntryById"]>
>();
expectTypeOf<ReturnType<Own["getHostSingleInTransaction"]>>().toEqualTypeOf<
  Promise<SingleDocument>
>();
// The host-types listing names each collection and Single as the plugin's
// own listings of them do, so an entry can be handed on as one of theirs.
expectTypeOf<
  Awaited<ReturnType<Own["listHostTypesInTransaction"]>>["collections"][number]
>().toEqualTypeOf<
  Awaited<
    ReturnType<PluginContext["services"]["collections"]["listCollections"]>
  >["data"][number]
>();
expectTypeOf<
  Awaited<ReturnType<Own["listHostTypesInTransaction"]>>["singles"][number]
>().toEqualTypeOf<
  Awaited<
    ReturnType<PluginContext["services"]["singles"]["list"]>
  >["data"][number]
>();
