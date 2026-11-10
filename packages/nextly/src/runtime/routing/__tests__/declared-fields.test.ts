/**
 * The fields a source declares, as bindings and the public read see them: a
 * builder-made collection's system `title` and `slug` are fields of every
 * entry, though the registry's stored list leaves them out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const registry = vi.hoisted(() => ({
  getCollectionBySlug: vi.fn(),
  getSingleBySlug: vi.fn(),
}));

vi.mock("../../../di/service-access", () => ({
  isServicesRegistered: () => true,
  getService: (name: string) => {
    if (name === "fieldGroupDataService") {
      return { getComponentFields: () => Promise.resolve([]) };
    }
    return registry;
  },
}));

import { expandedDeclaration, expandedFields } from "../declared-fields";

const namesOf = async (source: Parameters<typeof expandedFields>[0]) =>
  (await expandedFields(source))?.map(field => field.name);

beforeEach(() => {
  registry.getCollectionBySlug.mockReset();
  registry.getSingleBySlug.mockReset();
});

describe("a collection's declared fields", () => {
  it("include the system title and slug of a builder-made collection", async () => {
    registry.getCollectionBySlug.mockResolvedValue({
      fields: [{ name: "summary", type: "text" }],
    });
    expect(await namesOf({ kind: "collection", slug: "events" })).toEqual([
      "title",
      "slug",
      "summary",
    ]);
  });

  it("keep an author's own title and slug, once each", async () => {
    registry.getCollectionBySlug.mockResolvedValue({
      fields: [
        { name: "title", type: "textarea" },
        { name: "slug", type: "text" },
      ],
    });
    const fields = await expandedFields({
      kind: "collection",
      slug: "events",
    });
    expect(fields?.map(field => [field.name, field.type])).toEqual([
      ["title", "textarea"],
      ["slug", "text"],
    ]);
  });

  it("add neither to a plugin's collection, which holds only what it declares", async () => {
    registry.getCollectionBySlug.mockResolvedValue({
      admin: { isPlugin: true },
      fields: [{ name: "body", type: "text" }],
    });
    expect(await namesOf({ kind: "collection", slug: "forms" })).toEqual([
      "body",
    ]);
  });

  it("say which timestamps the entries carry", async () => {
    registry.getCollectionBySlug.mockResolvedValue({
      timestamps: false,
      fields: [],
    });
    const declared = await expandedDeclaration({
      kind: "collection",
      slug: "events",
    });
    expect(declared?.timestamps).toEqual([]);
  });
});

describe("a Single's declared fields", () => {
  it("are only those it declares", async () => {
    registry.getSingleBySlug.mockResolvedValue({
      fields: [{ name: "tagline", type: "text" }],
    });
    expect(await namesOf({ kind: "single", slug: "site" })).toEqual([
      "tagline",
    ]);
  });
});
