/**
 * Version history nests under the document it belongs to, so the existing
 * per-slug permission that guards reading the document also guards its history.
 */
import { describe, it, expect } from "vitest";

import {
  COLLECTION_ENTRY_METHODS,
  SINGLE_DOCUMENT_METHODS,
} from "../../routeHandler";
import { parseRestRoute } from "../route-parser";

describe("version routes", () => {
  it("parses a collection entry's version list", () => {
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions"],
      "GET"
    );

    expect(parsed).toMatchObject({
      service: "collections",
      method: "listEntryVersions",
      routeParams: { collectionName: "posts", entryId: "e1" },
    });
  });

  it("parses a single collection entry version", () => {
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions", "3"],
      "GET"
    );

    expect(parsed).toMatchObject({
      service: "collections",
      method: "getEntryVersion",
      routeParams: { collectionName: "posts", entryId: "e1", versionNo: "3" },
    });
  });

  it("parses a single document's version list", () => {
    const parsed = parseRestRoute(["singles", "settings", "versions"], "GET");

    expect(parsed).toMatchObject({
      service: "singles",
      method: "listSingleVersions",
      routeParams: { slug: "settings" },
    });
  });

  it("parses one version of a single document", () => {
    const parsed = parseRestRoute(
      ["singles", "settings", "versions", "2"],
      "GET"
    );

    expect(parsed).toMatchObject({
      service: "singles",
      method: "getSingleVersion",
      routeParams: { slug: "settings", versionNo: "2" },
    });
  });

  it("matches no route at all for segments beyond the version number", () => {
    // Asserting the absence of a route, not merely of the version route: the
    // entry branches sit below this one, so a path that is merely "not a
    // version read" could still be answered as a read of the entry itself.
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions", "3", "extra"],
      "GET"
    );

    expect(parsed.method).toBeUndefined();
  });

  it("matches no route for a single version path with trailing segments", () => {
    const parsed = parseRestRoute(
      ["singles", "settings", "versions", "2", "extra"],
      "GET"
    );

    expect(parsed.method).toBeUndefined();
  });

  it.each([
    ["POST", "listEntryVersions"],
    ["PATCH", "updateEntry"],
    ["DELETE", "deleteEntry"],
  ])(
    "does not answer %s on a version path as an entry write",
    (httpMethod, forbiddenMethod) => {
      // A version path with a mutating verb owns no route. It must not fall
      // through to the entry branches, where DELETE would destroy the very
      // document whose history was addressed.
      const parsed = parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions"],
        httpMethod
      );

      expect(parsed.method).not.toBe(forbiddenMethod);
      expect(parsed.method).toBeUndefined();
    }
  );

  it("parses restoring a collection entry version as a write", () => {
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions", "3", "restore"],
      "POST"
    );

    expect(parsed).toMatchObject({
      service: "collections",
      method: "restoreEntryVersion",
      // The operation decides the permission: restoring writes the document,
      // so it must resolve to update-{slug} rather than read-{slug}.
      operation: "update",
      routeParams: { collectionName: "posts", entryId: "e1", versionNo: "3" },
    });
  });

  it("parses restoring a single's version as a write", () => {
    const parsed = parseRestRoute(
      ["singles", "settings", "versions", "2", "restore"],
      "POST"
    );

    expect(parsed).toMatchObject({
      service: "singles",
      method: "restoreSingleVersion",
      operation: "update",
      routeParams: { slug: "settings", versionNo: "2" },
    });
  });

  it("does not restore on a GET", () => {
    // A read must never reach a method that writes the document.
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions", "3", "restore"],
      "GET"
    );

    expect(parsed.method).toBeUndefined();
  });

  it("parses discarding a collection entry's working draft as a write", () => {
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions", "working-draft"],
      "DELETE"
    );

    expect(parsed).toMatchObject({
      service: "collections",
      method: "discardWorkingDraft",
      // Discarding rewrites what the editor sees (it reverts the document to its
      // live published row), so it resolves to update-{slug}, not read-{slug}.
      operation: "update",
      routeParams: { collectionName: "posts", entryId: "e1" },
    });
    // `working-draft` is a named sub-resource, never captured as a version number.
    expect(parsed.routeParams?.versionNo).toBeUndefined();
  });

  it("does not discard a working draft on a POST", () => {
    // Only DELETE discards; a create-verb on the same path owns no route and
    // must not fall through to an entry write.
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions", "working-draft"],
        "POST"
      ).method
    ).toBeUndefined();
  });

  it("parses a collection entry's autosave as a write", () => {
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions", "autosave"],
      "PUT"
    );

    expect(parsed).toMatchObject({
      service: "collections",
      method: "autosaveEntry",
      // A recovery point holds the entry's own content, so storing one owes the
      // rules updating it owes rather than the rules for reading history.
      operation: "update",
      routeParams: { collectionName: "posts", entryId: "e1" },
    });
    // `autosave` is a named sub-resource, never captured as a version number.
    expect(parsed.routeParams?.versionNo).toBeUndefined();
  });

  it("parses a Single's autosave as a write, with no entry id in the URL", () => {
    const parsed = parseRestRoute(
      ["singles", "settings", "versions", "autosave"],
      "PUT"
    );

    expect(parsed).toMatchObject({
      service: "singles",
      method: "autosaveSingle",
      operation: "update",
      routeParams: { slug: "settings" },
    });
    // A Single has exactly one document and the server resolves its id from the
    // live row, so the client never names which document it is writing.
    expect(parsed.routeParams?.entryId).toBeUndefined();
    expect(parsed.routeParams?.versionNo).toBeUndefined();
  });

  it("resolves each verb on the autosave path to its own route", () => {
    // Asserted as an exact method per verb rather than "not the write method".
    // The weaker form passes when a verb resolves to something else wrong, and
    // it passed here while GET fell through to the ordinary version read with
    // `autosave` in the version-NUMBER position -- which is no longer true now
    // that the read has its own route, and would have gone unnoticed.
    const entry = [
      "collections",
      "posts",
      "entries",
      "e1",
      "versions",
      "autosave",
    ];
    const single = ["singles", "settings", "versions", "autosave"];

    expect(parseRestRoute(entry, "PUT").method).toBe("autosaveEntry");
    expect(parseRestRoute(entry, "GET").method).toBe("getEntryAutosave");
    expect(parseRestRoute(single, "PUT").method).toBe("autosaveSingle");
    expect(parseRestRoute(single, "GET").method).toBe("getSingleAutosave");

    // A rename on this path is a version LABEL write, and the handler coerces
    // the segment to a number, so `autosave` is rejected there rather than
    // reaching a route that would treat it as a version.
    expect(parseRestRoute(entry, "PATCH").method).toBe("setEntryVersionLabel");
    expect(parseRestRoute(single, "PATCH").method).toBe(
      "setSingleVersionLabel"
    );

    // Neither verb owns a route on this path, and neither may fall through to
    // one that writes or reads a recovery point.
    for (const httpMethod of ["POST", "DELETE"]) {
      expect(parseRestRoute(entry, httpMethod).method).toBeUndefined();
      expect(parseRestRoute(single, httpMethod).method).toBeUndefined();
    }
  });

  it("still matches the entry itself when no segments trail", () => {
    // The guard must not cost the entry routes their own paths.
    expect(
      parseRestRoute(["collections", "posts", "entries", "e1"], "DELETE").method
    ).toBe("deleteEntry");
    expect(
      parseRestRoute(["collections", "posts", "entries", "e1"], "GET").method
    ).toBe("getEntry");
    expect(
      parseRestRoute(["collections", "posts", "entries", "e1"], "PATCH").method
    ).toBe("updateEntry");
  });

  it("leaves the real entry sub-routes matching", () => {
    // These are claimed by earlier, POST-only parsers; the guard sits below
    // them and must not shadow them.
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "duplicate"],
        "POST"
      ).method
    ).toBe("duplicateEntry");
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "publish-all"],
        "POST"
      ).method
    ).toBe("publishAllLocales");
  });

  it("parses a collection version diff, not a version read", () => {
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions", "diff"],
      "GET"
    );

    expect(parsed).toMatchObject({
      service: "collections",
      method: "getEntryVersionDiff",
      // A read of history, so it resolves to read-{slug}, not a write.
      operation: "single",
      routeParams: { collectionName: "posts", entryId: "e1" },
    });
    // `diff` must never be captured as a version number.
    expect(parsed.routeParams?.versionNo).toBeUndefined();
  });

  it("parses a single's version diff", () => {
    const parsed = parseRestRoute(
      ["singles", "settings", "versions", "diff"],
      "GET"
    );

    expect(parsed).toMatchObject({
      service: "singles",
      method: "getSingleVersionDiff",
      operation: "single",
      routeParams: { slug: "settings" },
    });
    expect(parsed.routeParams?.versionNo).toBeUndefined();
  });

  it("does not answer a diff comparison on a destructive verb", () => {
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions", "diff"],
        "POST"
      ).method
    ).toBeUndefined();
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions", "diff"],
        "DELETE"
      ).method
    ).toBeUndefined();
  });
});

describe("version label routes", () => {
  it("parses a PATCH on a collection entry's version", () => {
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions", "3"],
      "PATCH"
    );

    expect(parsed).toMatchObject({
      service: "collections",
      method: "setEntryVersionLabel",
      routeParams: { collectionName: "posts", entryId: "e1", versionNo: "3" },
    });
  });

  it("parses a PATCH on a single's version", () => {
    const parsed = parseRestRoute(
      ["singles", "settings", "versions", "3"],
      "PATCH"
    );

    expect(parsed).toMatchObject({
      service: "singles",
      method: "setSingleVersionLabel",
      routeParams: { slug: "settings", versionNo: "3" },
    });
  });

  it("authorizes a label as an update, not a read of history", () => {
    // The operation drives the permission. Read would let anyone who can see a
    // document rename its history.
    for (const parsed of [
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions", "3"],
        "PATCH"
      ),
      parseRestRoute(["singles", "settings", "versions", "3"], "PATCH"),
    ]) {
      expect(parsed?.operation).toBe("update");
    }
  });

  // These assert the method is UNDEFINED rather than merely "not the label
  // method". An unmatched route resolves to `{}`, but a path that silently
  // matched some OTHER handler would satisfy a weaker assertion while
  // dispatching somewhere unintended.
  it("does not claim a PATCH on the version list itself", () => {
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions"],
        "PATCH"
      ).method
    ).toBeUndefined();
    expect(
      parseRestRoute(["singles", "settings", "versions"], "PATCH").method
    ).toBeUndefined();
  });

  it("does not claim a PATCH deeper than a version number", () => {
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions", "3", "label"],
        "PATCH"
      ).method
    ).toBeUndefined();
  });

  /**
   * A path deeper than the autosave sub-resource belongs to no route, and the
   * parser must say so rather than truncate it to the nearest one it does own.
   *
   * The failure this guards is quiet in a way a 404 is not: the segments after
   * `autosave` would simply be dropped, and the request would answer 200 from
   * the caller's recovery point while naming a resource that does not exist.
   * Nothing downstream can detect that, because by then the route looks like an
   * ordinary autosave read.
   *
   * Asserted for both scopes. The two parsers reach this through different
   * guards, so one can lose it while the other keeps it.
   */
  it("claims no route deeper than the autosave sub-resource", () => {
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions", "autosave", "x"],
        "GET"
      ).method
    ).toBeUndefined();
    expect(
      parseRestRoute(
        ["singles", "settings", "versions", "autosave", "x"],
        "GET"
      ).method
    ).toBeUndefined();
  });

  it("leaves other methods on a version alone", () => {
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions", "3"],
        "DELETE"
      ).method
    ).toBeUndefined();
  });
});

/**
 * The parser decides a route's `operation`, but `resolveAuthorization` only
 * reads it for methods named in these sets. A method missing from its set skips
 * the per-slug branch entirely and lands on the definition fallthrough, which
 * demands `manage-settings` -- denying the editors who hold `update-{slug}` and
 * admitting a caller who holds settings but no access to the document. Nothing
 * in the type system joins the two, so the join is asserted here.
 *
 * The methods are read back OUT of the parser rather than restated, so a route
 * whose method name is renamed on one side is compared against the other.
 */
describe("version routes resolve to a per-document permission", () => {
  const COLLECTION_ROUTES: ReadonlyArray<[string[], string]> = [
    [["collections", "posts", "entries", "e1", "versions"], "GET"],
    [["collections", "posts", "entries", "e1", "versions", "3"], "GET"],
    [["collections", "posts", "entries", "e1", "versions", "diff"], "GET"],
    [["collections", "posts", "entries", "e1", "versions", "3"], "PATCH"],
    [
      ["collections", "posts", "entries", "e1", "versions", "3", "restore"],
      "POST",
    ],
    [
      ["collections", "posts", "entries", "e1", "versions", "working-draft"],
      "DELETE",
    ],
    [["collections", "posts", "entries", "e1", "versions", "autosave"], "PUT"],
  ];

  const SINGLE_ROUTES: ReadonlyArray<[string[], string]> = [
    [["singles", "settings", "versions"], "GET"],
    [["singles", "settings", "versions", "3"], "GET"],
    [["singles", "settings", "versions", "diff"], "GET"],
    [["singles", "settings", "versions", "3"], "PATCH"],
    [["singles", "settings", "versions", "3", "restore"], "POST"],
    [["singles", "settings", "versions", "autosave"], "PUT"],
  ];

  it.each(COLLECTION_ROUTES)(
    "authorizes %s %s against the collection",
    (segments, httpMethod) => {
      const { method } = parseRestRoute(segments, httpMethod);
      // Guards against the route silently ceasing to parse, which would leave
      // an undefined method vacuously "absent from the set" for a second reason.
      expect(method).toBeDefined();
      expect(COLLECTION_ENTRY_METHODS).toContain(method);
    }
  );

  it.each(SINGLE_ROUTES)(
    "authorizes %s %s against the Single",
    (segments, httpMethod) => {
      const { method } = parseRestRoute(segments, httpMethod);
      expect(method).toBeDefined();
      expect(SINGLE_DOCUMENT_METHODS).toContain(method);
    }
  );

  it("does not admit definition mutations to either set", () => {
    // Without this, a set containing everything would satisfy both assertions
    // above while authorizing nothing. Schema mutations must keep falling
    // through to the `manage-settings` branch.
    for (const method of [
      "createCollection",
      "updateCollection",
      "deleteCollection",
    ]) {
      expect(COLLECTION_ENTRY_METHODS).not.toContain(method);
      expect(SINGLE_DOCUMENT_METHODS).not.toContain(method);
    }
  });
});
