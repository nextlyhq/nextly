// `GET …/source-change` and `POST …/keep-current`, of a collection entry and of a Single: what
// changed in a translated field's source, and keeping its translation. A read and an update of the
// document; each route ends at its action, and answers to its own verb alone.

import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

const DOCUMENTS = [
  {
    path: ["collections", "posts", "entries", "p1"],
    service: "collections",
    params: { collectionName: "posts", entryId: "p1" },
    read: "getEntrySourceChange",
    keep: "keepEntryTranslation",
  },
  {
    path: ["singles", "banner"],
    service: "singles",
    params: { slug: "banner" },
    read: "getSingleSourceChange",
    keep: "keepSingleTranslation",
  },
];

describe.each(DOCUMENTS)(
  "a translated field's source, of $service",
  ({ path, service, params, read, keep }) => {
    it("reads what changed in it as a read of the document", () => {
      expect(parseRestRoute([...path, "source-change"], "GET")).toMatchObject({
        service,
        method: read,
        operation: "single",
        routeParams: params,
      });
    });

    it("keeps its translation as an update of the document", () => {
      expect(parseRestRoute([...path, "keep-current"], "POST")).toMatchObject({
        service,
        method: keep,
        operation: "update",
        routeParams: params,
      });
    });

    it.each([
      ["POST", "source-change"],
      ["GET", "keep-current"],
      ["PATCH", "keep-current"],
      ["DELETE", "keep-current"],
    ])("claims nothing for %s …/%s", (verb, action) => {
      const { method } = parseRestRoute([...path, action], verb);
      expect([read, keep]).not.toContain(method);
    });

    it.each([
      ["GET", "source-change"],
      ["POST", "keep-current"],
    ])("claims nothing past %s …/%s", (verb, action) => {
      const { method } = parseRestRoute([...path, action, "extra"], verb);
      expect([read, keep]).not.toContain(method);
    });
  }
);
