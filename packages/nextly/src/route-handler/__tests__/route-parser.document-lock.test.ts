import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("document lock routes", () => {
  it("maps each verb to its operation on the one resource", () => {
    const cases = [
      ["GET", "readDocumentLock"],
      ["POST", "acquireDocumentLock"],
      ["PATCH", "renewDocumentLock"],
      ["DELETE", "releaseDocumentLock"],
    ] as const;

    for (const [verb, method] of cases) {
      expect(parseRestRoute(["document-lock"], verb)).toMatchObject({
        service: "documentLock",
        method,
      });
    }
  });

  it("does not claim a path with segments after the resource", () => {
    // The document is named by scopeKind, slug and entryId together, not by a
    // path segment, so a deeper path is not a lock route. Claiming it would
    // match a shorter route and silently ignore the tail.
    for (const path of [
      ["document-lock", "posts"],
      ["document-lock", "posts", "42"],
    ]) {
      expect(parseRestRoute(path, "GET")?.service).not.toBe("documentLock");
    }
  });

  it("does not claim a verb it has no operation for", () => {
    // PUT is absent deliberately: renewing is a PATCH because it extends a
    // claim rather than replacing one, and a route that answered PUT would
    // dispatch on a method name nothing handles.
    expect(parseRestRoute(["document-lock"], "PUT")?.service).not.toBe(
      "documentLock"
    );
  });
});
