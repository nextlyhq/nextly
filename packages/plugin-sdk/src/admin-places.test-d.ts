/**
 * A plugin types its own admin places by augmenting the SDK, the module it
 * installs; the place ids every surface accepts are then checked against it,
 * so a declared name compiles and a misspelled one does not.
 */
import { expectTypeOf } from "vitest";

import type {
  AdminPlaceId,
  AdminPlaces,
  CoreAdminPlaceId,
} from "@nextlyhq/plugin-sdk";
import type { TargetSlotProps } from "@nextlyhq/plugin-sdk/admin";

declare module "@nextlyhq/plugin-sdk" {
  interface AdminPlaces {
    "acme-billing.invoice": { context: { invoiceId: string } };
  }
}

/** Where a surface takes a place id, as every contribution and renderer will. */
declare function at(place: AdminPlaceId): void;

// The plugin's declared place is accepted, and carries what it declared.
at("acme-billing.invoice");
expectTypeOf<AdminPlaces["acme-billing.invoice"]["context"]>().toEqualTypeOf<{
  invoiceId: string;
}>();

// Core's places are accepted with no augmentation.
at("collection.list");
at("account");
expectTypeOf<CoreAdminPlaceId>().toExtend<AdminPlaceId>();

// A misspelled plugin place is not, nor a misspelled core one, nor a plain
// string: the ids are a closed set. Asserted by the checker, so each fails
// only when the id would be accepted, not on an unrelated error.
expectTypeOf<"acme-billing.invoce">().not.toExtend<AdminPlaceId>();
expectTypeOf<"colection.list">().not.toExtend<AdminPlaceId>();
expectTypeOf<string>().not.toExtend<AdminPlaceId>();

// The renderer a plugin's page draws its place with takes the place's own
// context, or `null` while the page does not know it yet, so a page handing it
// the wrong ids does not compile.
expectTypeOf<
  TargetSlotProps<"acme-billing.invoice">["context"]
>().toEqualTypeOf<{ invoiceId: string } | null>();
expectTypeOf<TargetSlotProps<"user.detail">["context"]>().toEqualTypeOf<{
  userId: string;
  shownUserId: string;
} | null>();
