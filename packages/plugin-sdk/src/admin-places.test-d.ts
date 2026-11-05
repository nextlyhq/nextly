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
expectTypeOf<CoreAdminPlaceId>().toMatchTypeOf<AdminPlaceId>();

// A misspelled plugin place is not.
// @ts-expect-error not a declared place
at("acme-billing.invoce");

// Nor a misspelled core one.
// @ts-expect-error not a declared place
at("colection.list");

// Nor a plain string: the ids are a closed set, not any string.
declare const anyName: string;
// @ts-expect-error not a declared place
at(anyName);
