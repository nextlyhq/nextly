/**
 * The shapes recorded before a sync are read whenever an entity keeps its translatable values per
 * language, so a change to such a field's column is judged against what its per-language table
 * held: under `experimental.perLanguageStorage`, an entity that is not marked translatable too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const shapes = vi.hoisted(() => [
  {
    slug: "notes",
    localized: false,
    fields: [{ name: "headline", type: "text" }],
  },
]);
vi.mock("../../../collections/services/collection-registry-service", () => ({
  CollectionRegistryService: class {
    getAllTranslationShapes() {
      return Promise.resolve(shapes);
    }
  },
}));
vi.mock("../../../singles/services/single-registry-service", () => ({
  SingleRegistryService: class {
    getAllTranslationShapes() {
      return Promise.resolve([]);
    }
  },
}));
vi.mock("../../../field-groups/services/field-group-registry-service", () => ({
  FieldGroupRegistryService: class {
    getAllTranslationShapes() {
      return Promise.resolve([]);
    }
  },
}));

import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../per-language-storage";
import { readRecordedEntities } from "../recorded-before";

const config = {
  collections: [
    { slug: "notes", fields: [{ name: "headline", type: "text" }] },
  ],
};

afterEach(() => _resetPerLanguageStorage());

describe("readRecordedEntities", () => {
  it("reads nothing when no entity keeps its values per language", async () => {
    await expect(readRecordedEntities({} as never, config)).resolves.toBe(
      undefined
    );
  });

  it("reads the recorded shapes, as stored per language, when the site keeps every translatable value so", async () => {
    setPerLanguageStorage(true);
    const recorded = await readRecordedEntities({} as never, config);
    expect(recorded?.get("collection:notes")?.localized).toBe(true);
  });
});
