/**
 * The stored read and the conditional write as a plugin author imports them
 * from the SDK.
 *
 * Both are made as a person, named by the identity a plugin route resolves,
 * or as the system, `{ overrideAccess: true }`;
 * a request names exactly one document, an entry or a Single, never both; the
 * read answers a discriminated result per field, so an absent value is never
 * confused with a stored one; and the expectation carries the hash the SDK's
 * own `storedValueHash` makes from what the read returned.
 *
 * Asserted with `expectTypeOf` rather than `@ts-expect-error`, which would
 * keep passing if the line failed for an unrelated reason.
 */

import { expectTypeOf } from "vitest";

import type {
  PluginConditionalUpdate,
  PluginRouteIdentity,
  PluginStoredDocument,
  PluginStoredFields,
  PluginStoredFieldsRequest,
  PluginStoredIdentity,
  PluginStoredLifecycle,
  PluginStoredValue,
  PluginSystemIdentity,
  PluginWriteExpectation,
} from "@nextlyhq/plugin-sdk";
import {
  readStoredFields,
  storedValueHash,
  updateIfUnchanged,
} from "@nextlyhq/plugin-sdk";

// Made as the person a route resolved, or as the system, and nobody else.
expectTypeOf(readStoredFields)
  .parameter(0)
  .toEqualTypeOf<PluginStoredIdentity>();
expectTypeOf(updateIfUnchanged)
  .parameter(0)
  .toEqualTypeOf<PluginStoredIdentity>();
expectTypeOf<PluginStoredIdentity>().toEqualTypeOf<
  | (PluginRouteIdentity & { readonly overrideAccess?: never })
  | PluginSystemIdentity
>();
expectTypeOf<PluginRouteIdentity>().toMatchTypeOf<PluginStoredIdentity>();
expectTypeOf({
  overrideAccess: true as const,
}).toMatchTypeOf<PluginStoredIdentity>();
expectTypeOf({
  overrideAccess: false as const,
}).not.toMatchTypeOf<PluginStoredIdentity>();

// A caller with the system's flag spread in is neither: the runtime refuses
// it, and the type does too.
declare const caller: PluginRouteIdentity;
declare const asked: PluginStoredFieldsRequest;
// @ts-expect-error a caller carrying `overrideAccess` is no stored identity
void readStoredFields({ ...caller, overrideAccess: true as const }, asked);
expectTypeOf(readStoredFields)
  .parameter(1)
  .toEqualTypeOf<PluginStoredFieldsRequest>();
expectTypeOf(updateIfUnchanged)
  .parameter(1)
  .toEqualTypeOf<PluginConditionalUpdate>();

// The read answers the stored values; the write answers nothing but success.
expectTypeOf(
  readStoredFields
).returns.resolves.toEqualTypeOf<PluginStoredFields>();
expectTypeOf(updateIfUnchanged).returns.resolves.toEqualTypeOf<void>();

// The system's read is also told the live row's lifecycle, read with the
// values: its public state, if any, and whether a working draft is pending.
expectTypeOf<
  Extract<PluginStoredFields, { kind: "found" }>["live"]
>().toEqualTypeOf<PluginStoredLifecycle | undefined>();
expectTypeOf<PluginStoredLifecycle>().toEqualTypeOf<{
  readonly publicState: string | null;
  readonly workingDraft: boolean;
}>();

// The hash is made from what the read returned, and is what the write expects.
expectTypeOf(storedValueHash).parameter(0).toEqualTypeOf<PluginStoredValue>();
expectTypeOf(storedValueHash).returns.resolves.toEqualTypeOf<string>();
expectTypeOf<PluginWriteExpectation["hash"]>().toEqualTypeOf<string>();
expectTypeOf<PluginWriteExpectation["form"]>().toEqualTypeOf<
  "published" | "draft"
>();
expectTypeOf<PluginWriteExpectation>()
  .toHaveProperty("noPendingDraft")
  .toEqualTypeOf<boolean | undefined>();

// One document: an entry by collection and id, or a Single, never both.
expectTypeOf({
  collection: "pages",
  id: "1",
}).toMatchTypeOf<PluginStoredDocument>();
expectTypeOf({ single: "site" }).toMatchTypeOf<PluginStoredDocument>();
expectTypeOf({
  collection: "pages",
  id: "1",
  single: "site",
}).not.toMatchTypeOf<PluginStoredDocument>();
expectTypeOf({ collection: "pages" }).not.toMatchTypeOf<PluginStoredDocument>();

// A found read carries each field's own discriminated value.
type Found = Extract<PluginStoredFields, { kind: "found" }>;
expectTypeOf<Found["values"][string]>().toEqualTypeOf<PluginStoredValue>();
expectTypeOf<Extract<PluginStoredFields, { kind: "absent" }>>().toEqualTypeOf<{
  readonly kind: "absent";
}>();
