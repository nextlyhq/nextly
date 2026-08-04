/**
 * A registry row's provenance decides both ownership answers, not just one of them.
 *
 * Two consumers ask the same question in opposite directions: the exclusion that stops a UI save
 * emitting DDL against a code-owned table reads `locked`, and the text-width rule reads
 * `builderOwned`. Deriving one from the stored flag and the other from provenance left a row that
 * names a code or plugin source without a populated `locked` flag protected from a width change and
 * unprotected from a column rewrite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../di", () => ({
  getCollectionRegistryFromDI: vi.fn(),
  getSingleRegistryFromDI: vi.fn(),
  getComponentRegistryFromDI: vi.fn(),
}));

import {
  getCollectionRegistryFromDI,
  getComponentRegistryFromDI,
  getSingleRegistryFromDI,
} from "../di";
import { buildFullDesiredSchema } from "../desired-schema";

/** A stored row that names its source but predates the `locked` flag being populated. */
const legacyCodeRow = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [],
  source: "code",
};

const builderRow = {
  slug: "notes",
  tableName: "dc_notes",
  fields: [],
  source: "ui",
};

function wire(rows: readonly unknown[]) {
  vi.mocked(getCollectionRegistryFromDI).mockReturnValue({
    getAllCollections: vi.fn().mockResolvedValue(rows),
  } as unknown as ReturnType<typeof getCollectionRegistryFromDI>);
  vi.mocked(getSingleRegistryFromDI).mockReturnValue({
    getAllSingles: vi.fn().mockResolvedValue(rows),
  } as unknown as ReturnType<typeof getSingleRegistryFromDI>);
  vi.mocked(getComponentRegistryFromDI).mockReturnValue({
    getAllComponents: vi.fn().mockResolvedValue(rows),
  } as unknown as ReturnType<typeof getComponentRegistryFromDI>);
}

beforeEach(() => {
  vi.mocked(getCollectionRegistryFromDI).mockReset();
  vi.mocked(getSingleRegistryFromDI).mockReset();
  vi.mocked(getComponentRegistryFromDI).mockReset();
});

describe("buildFullDesiredSchema — ownership from provenance", () => {
  it("locks a row that names a code source but leaves the flag unset", async () => {
    wire([legacyCodeRow]);

    const desired = await buildFullDesiredSchema();

    // Both answers, because the two consumers read different keys for the same fact.
    expect(desired.collections.posts.locked).toBe(true);
    expect(desired.collections.posts.builderOwned).toBe(false);
  });

  it("locks a plugin-owned row the same way", async () => {
    wire([{ ...legacyCodeRow, source: "plugin:acme" }]);

    const desired = await buildFullDesiredSchema();

    expect(desired.collections.posts.locked).toBe(true);
    expect(desired.collections.posts.builderOwned).toBe(false);
  });

  it("leaves a builder-created row unlocked and builder-owned", async () => {
    wire([builderRow]);

    const desired = await buildFullDesiredSchema();

    expect(desired.collections.notes.locked).toBe(false);
    expect(desired.collections.notes.builderOwned).toBe(true);
  });

  // Every entity kind, because the same pair of assignments is repeated per kind and a fix applied
  // to one of them is the shape this codebase has had to correct more than once.
  it("answers the same way for singles and field groups", async () => {
    wire([legacyCodeRow]);

    const desired = await buildFullDesiredSchema();

    for (const entity of [desired.singles.posts, desired.components.posts]) {
      expect(entity.locked).toBe(true);
      expect(entity.builderOwned).toBe(false);
    }
  });
});
