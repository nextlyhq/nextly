/**
 * Links to missing items: references the import neither moves nor finds on
 * the target, kept as they are and listed for the plan and the report.
 */
import { describe, expect, it } from "vitest";

import { missingLinks } from "../missing-links";
import type { ContentReference, ReferenceMap } from "../reference-map";

const A = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0a01";
const B = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0a02";
const GONE = "0b6f4f3e-58a5-4c3e-9a51-0d6c1c1e0a0f";

const map: ReferenceMap = {
  ids: new Map([["people", new Map([[A, "new-a"]])]]),
  addresses: new Map([["/uploads/moved.png", "/files/moved.png"]]),
};

/** The target holds person B and media item B, and serves `/files/here.png`. */
const holds = {
  link: (collection: string, id: string) =>
    (collection === "people" || collection === "media") && id === B,
  isSourceAddress: (url: string) => url.startsWith("/uploads/"),
  address: (url: string) => url === "/uploads/here.png",
};

const link = (
  collection: string | null,
  id: string,
  extra: Partial<ContentReference> = {}
): ContentReference =>
  ({ kind: "link", fieldPath: "f", collection, id, ...extra }) as ContentReference;
const address = (url: string, mediaId?: string): ContentReference => ({
  kind: "address",
  fieldPath: "f",
  url,
  ...(mediaId === undefined ? {} : { mediaId }),
});

describe("missingLinks", () => {
  it("lists a link the import does not bring and the target does not have", () => {
    const dangling = link("people", GONE);
    expect(
      missingLinks(
        [link("people", A), link("people", B), dangling],
        map,
        holds
      )
    ).toEqual([dangling]);
  });

  it("lists a link whose collection is unknown, and never an inferred one", () => {
    const unknown = link(null, A);
    expect(
      missingLinks(
        [unknown, link("media", GONE, { inferred: true })],
        map,
        holds
      )
    ).toEqual([unknown]);
  });

  it("judges a route address by its media item", () => {
    const gone = address(`/api/media/${GONE}/raw`, GONE);
    expect(
      missingLinks([address(`/api/media/${B}/raw`, B), gone], map, holds)
    ).toEqual([gone]);
  });

  it("judges only the source's own addresses, after the map", () => {
    const gone = address("/uploads/gone.png");
    expect(
      missingLinks(
        [
          address("/uploads/moved.png"),
          address("/uploads/here.png"),
          gone,
          address("https://elsewhere.example/x.png"),
        ],
        map,
        holds
      )
    ).toEqual([gone]);
  });

  it("judges no plain address when the source's are not described", () => {
    expect(
      missingLinks([address("/uploads/gone.png")], map, { link: () => true })
    ).toEqual([]);
  });
});
