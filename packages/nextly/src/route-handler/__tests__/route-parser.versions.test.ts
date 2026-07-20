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

  it("rejects a path with segments beyond the version number", () => {
    // A deeper path is not a route this owns; truncating it to a version read
    // would answer a request that was never made.
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions", "3", "extra"],
      "GET"
    );

    expect(parsed.method).not.toBe("getEntryVersion");
  });

  it("rejects a single version path with trailing segments", () => {
    const parsed = parseRestRoute(
      ["singles", "settings", "versions", "2", "extra"],
      "GET"
    );

    expect(parsed.method).not.toBe("getSingleVersion");
  });

  it("does not claim version routes for non-GET methods", () => {
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", "e1", "versions"],
      "POST"
    );

    expect(parsed.method).not.toBe("listEntryVersions");
  });
});
