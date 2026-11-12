/**
 * The admin places core names: the pages a plugin may add to, each named once
 * in a catalogue the server checks against and the admin renders from.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CORE_ADMIN_PLACES,
  isCoreAdminPlace,
  isWellFormedAdminPlaceName,
  reservedAdminPlaceSegmentOf,
  type AdminPlaceId,
  type AdminPlaces,
  type CoreAdminPlaceId,
} from "../admin-places";

const CORE_IDS = [
  "account",
  "collection.edit",
  "collection.list",
  "dashboard",
  "entry.form",
  "login",
  "settings",
  "single.edit",
  "user.detail",
];

describe("the core admin places", () => {
  it("names the dashboard, collection list and edit, Single edit, entry form, settings, user detail, account and login", () => {
    expect(Object.keys(CORE_ADMIN_PLACES).sort()).toEqual(CORE_IDS);
  });

  it("says which page each place is on", () => {
    for (const [id, place] of Object.entries(CORE_ADMIN_PLACES)) {
      expect(place.page.trim(), id).not.toBe("");
    }
  });

  it("spells every id as a place name may be spelled", () => {
    for (const id of CORE_IDS) {
      expect(isWellFormedAdminPlaceName(id), id).toBe(true);
    }
  });

  it("reserves each core id's first segment, and nothing else", () => {
    for (const id of CORE_IDS) {
      expect(reservedAdminPlaceSegmentOf(`${id}.extra`), id).toBe(
        id.split(".")[0]
      );
    }
    // A plugin's own namespace is not core's.
    expect(reservedAdminPlaceSegmentOf("acme-billing.invoice")).toBeUndefined();
    // Nor is a segment that only begins like a core one.
    expect(reservedAdminPlaceSegmentOf("collections.list")).toBeUndefined();
    expect(reservedAdminPlaceSegmentOf("user-tools.panel")).toBeUndefined();
  });

  it("cannot be changed at run time", () => {
    expect(Object.isFrozen(CORE_ADMIN_PLACES)).toBe(true);
    for (const place of Object.values(CORE_ADMIN_PLACES)) {
      expect(Object.isFrozen(place)).toBe(true);
    }
  });

  it("tells core's places from a plugin's, and narrows to core's ids", () => {
    for (const id of CORE_IDS) expect(isCoreAdminPlace(id)).toBe(true);
    // A plugin's place, as a plugin that types it adds to `AdminPlaceId`.
    expect(isCoreAdminPlace("nextlyhq-plugin-page-builder.settings")).toBe(
      false
    );
    // Not a key of the object itself, though every object has it.
    expect(isCoreAdminPlace("toString")).toBe(false);
    const place: string = "dashboard";
    if (isCoreAdminPlace(place)) {
      expectTypeOf(place).toEqualTypeOf<CoreAdminPlaceId>();
    }
  });

  it("types exactly the catalogue's ids, so the type and the catalogue cannot drift", () => {
    // Nothing augments `AdminPlaces` inside core, so its keys are core's own.
    expectTypeOf<keyof AdminPlaces>().toEqualTypeOf<CoreAdminPlaceId>();
    expectTypeOf<AdminPlaceId>().toEqualTypeOf<CoreAdminPlaceId>();
    expectTypeOf<CoreAdminPlaceId>().toEqualTypeOf<
      | "account"
      | "collection.edit"
      | "collection.list"
      | "dashboard"
      | "entry.form"
      | "login"
      | "settings"
      | "single.edit"
      | "user.detail"
    >();
  });
});

describe("a place name's spelling", () => {
  it.each(["acme-billing.invoice", "acme-billing.invoice.summary", "a1.b-2"])(
    "accepts %s",
    name => {
      expect(isWellFormedAdminPlaceName(name)).toBe(true);
    }
  );

  it.each([
    "",
    "acme-billing.",
    ".invoice",
    "acme-billing..invoice",
    "acme-billing.Invoice",
    "acme-billing.in voice",
    "acme-billing.-invoice",
    "acme-billing.invoice-",
    "acme_billing.invoice",
    " acme-billing.invoice",
  ])("refuses %j", name => {
    expect(isWellFormedAdminPlaceName(name)).toBe(false);
  });
});
