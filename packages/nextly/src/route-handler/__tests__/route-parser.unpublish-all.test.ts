// `POST /api/collections/{slug}/entries/{id}/unpublish-all` — the takedown twin
// of the entry's publish-all.
//
// The capability was built through the mutation service, entry service and
// handler and was reachable by NOTHING: zero route and dispatcher references
// against three for the publish direction. So the risks here are the ones a
// mirrored branch carries — that it shadows its neighbour or is shadowed by it,
// that the verb gate is real, and that it is recognised as a collection-entry
// method so the permission gate applies to it at all.
//
// @module route-handler/__tests__/route-parser.unpublish-all.test

import { describe, expect, it } from "vitest";

import { COLLECTION_ENTRY_METHODS } from "../../routeHandler";
import { parseRestRoute } from "../route-parser";

const ENTRY = ["collections", "posts", "entries", "e1"];

describe("collection entry unpublish-all route", () => {
  it("parses as a write on the entry", () => {
    expect(parseRestRoute([...ENTRY, "unpublish-all"], "POST")).toMatchObject({
      service: "collections",
      // Authorized as an `update`, exactly as the publish direction is: no
      // route-level gate can express `unpublish`, so the service judges a
      // scoped key's own grant on top of this. Registering it as its own
      // operation would invent a permission name nothing seeds.
      operation: "update",
      method: "unpublishAllLocales",
      routeParams: { collectionName: "posts", entryId: "e1" },
    });
  });

  it("is a collection-entry method, so the permission gate reaches it", () => {
    // The parse alone is not enough. A method the gate does not recognise is
    // dispatched without the per-collection permission check the publish twin
    // gets — the route would work and be unguarded, which is worse than the
    // capability staying unreachable.
    expect(COLLECTION_ENTRY_METHODS.has("unpublishAllLocales")).toBe(true);
    expect(COLLECTION_ENTRY_METHODS.has("publishAllLocales")).toBe(true);
  });

  it("claims only POST", () => {
    // A branch that ignored the verb would answer here too, turning a read of
    // an entry into a takedown of every language of it.
    for (const verb of ["GET", "PATCH", "DELETE", "PUT"]) {
      expect(parseRestRoute([...ENTRY, "unpublish-all"], verb).method).not.toBe(
        "unpublishAllLocales"
      );
    }
  });

  it("matches a trailing segment exactly as publish-all does", () => {
    // Both branches test `additionalParams[0]` with no length check, so a
    // trailing segment is IGNORED rather than refused: `.../unpublish-all/de`
    // takes down every language, not `de`.
    //
    // Asserted as PARITY rather than as strictness, deliberately. The looseness
    // is the publish branch's existing behaviour and predates this route; making
    // only the takedown strict would be the worse outcome, because the two would
    // then disagree about what the same URL shape means. Recorded as a
    // pre-existing observation rather than fixed here — tightening publish-all
    // is a behaviour change to a shipped route and belongs in its own change.
    expect(
      parseRestRoute([...ENTRY, "unpublish-all", "de"], "POST").method
    ).toBe("unpublishAllLocales");
    expect(parseRestRoute([...ENTRY, "publish-all", "de"], "POST").method).toBe(
      "publishAllLocales"
    );
  });

  it("does not shadow publish-all, and is not shadowed by it", () => {
    // Both branches live in one function and match on the same shape, so the
    // discriminating token is the only thing separating a publish from a
    // takedown. Asserted in both directions rather than assumed.
    expect(parseRestRoute([...ENTRY, "publish-all"], "POST").method).toBe(
      "publishAllLocales"
    );
    expect(parseRestRoute([...ENTRY, "unpublish-all"], "POST").method).toBe(
      "unpublishAllLocales"
    );
  });

  it("leaves the neighbouring entry routes matching", () => {
    expect(parseRestRoute(ENTRY, "GET").method).toBe("getEntry");
    expect(parseRestRoute(ENTRY, "PATCH").method).toBe("updateEntry");
    expect(parseRestRoute(ENTRY, "DELETE").method).toBe("deleteEntry");
  });
});
