/**
 * A many-to-many stored the earlier way names its collection in `options.target`, with no
 * `relationTo`. Loaded into the Builder and saved again, unchanged or with an unrelated edit, the
 * field the save sends must still name that collection and still be a many-to-many.
 */
import { describe, expect, it } from "vitest";

import {
  convertToBuilderField,
  convertToFieldDefinition,
} from "./field-transformers";

type Stored = Parameters<typeof convertToBuilderField>[0];

/** The field as the server stores a many-to-many made the earlier way. */
const LEGACY = {
  name: "tags",
  label: "Tags",
  type: "relationship",
  options: { target: "lm_tags", relationType: "manyToMany" },
} as unknown as Stored;

/** What the Builder's save sends for `stored`, loaded and saved again. */
function resaved(stored: Stored, edit: Record<string, unknown> = {}) {
  const loaded = convertToBuilderField(stored, 0);
  return convertToFieldDefinition({ ...loaded, ...edit }) as unknown as {
    relationTo?: unknown;
    options?: { target?: unknown; relationType?: unknown };
    hasMany?: unknown;
  };
}

/** A many-to-many stored the current way: `relationTo` and the same `options`. */
const CURRENT = {
  name: "tags",
  label: "Tags",
  type: "relationship",
  relationTo: "lm_tags",
  options: { target: "lm_tags", relationType: "manyToMany" },
} as unknown as Stored;

describe("a many-to-many stored with options.target, saved again", () => {
  it("is sent back with its stored options, unchanged", () => {
    expect(resaved(LEGACY)).toMatchObject({
      options: { target: "lm_tags", relationType: "manyToMany" },
    });
    expect(resaved(LEGACY).relationTo).toBeUndefined();
  });

  it("keeps them through an unrelated edit", () => {
    expect(resaved(LEGACY, { label: "Topics" })).toMatchObject({
      options: { target: "lm_tags", relationType: "manyToMany" },
    });
  });

  it("stays a many-to-many when its collection is picked again", () => {
    expect(resaved(LEGACY, { relationTo: "lm_tags" })).toMatchObject({
      relationTo: "lm_tags",
      options: { target: "lm_tags", relationType: "manyToMany" },
    });
  });

  // A different collection picked: the field still says it is a many-to-many, and its target
  // follows the pick, so the save is judged as a many-to-many moving to another collection.
  it("names the collection picked instead, still a many-to-many", () => {
    expect(resaved(LEGACY, { relationTo: "lm_other" })).toMatchObject({
      relationTo: "lm_other",
      options: { target: "lm_other", relationType: "manyToMany" },
    });
  });
});

describe("a many-to-many stored with relationTo, saved again", () => {
  it("is sent back with its stored options", () => {
    expect(resaved(CURRENT, { label: "Topics" })).toMatchObject({
      relationTo: "lm_tags",
      options: { target: "lm_tags", relationType: "manyToMany" },
    });
  });
});
