/**
 * Version history nests under the document it belongs to, so the existing
 * per-slug permission that guards reading the document also guards its history.
 */
import { describe, it, expect } from "vitest";

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

  it("leaves other methods on a version alone", () => {
    expect(
      parseRestRoute(
        ["collections", "posts", "entries", "e1", "versions", "3"],
        "DELETE"
      ).method
    ).toBeUndefined();
  });
});
