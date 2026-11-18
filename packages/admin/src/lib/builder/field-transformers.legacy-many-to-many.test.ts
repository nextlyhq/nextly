/**
 * A many-to-many stored the earlier way names its collection in `options.target`, with no
 * `relationTo`. Loaded into the Builder and saved again, unchanged or with an unrelated edit, the
 * field the save sends must still name that collection and still be a many-to-many.
 */
import { describe, expect, it } from "vitest";

import { copyWithNewIds } from "./copy-field";
import {
  convertToBuilderField,
  convertToFieldDefinition,
} from "./field-transformers";
import { builderFieldErrors } from "./field-validators";

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
    options?: {
      target?: unknown;
      relationType?: unknown;
      junctionTable?: unknown;
    };
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

describe("a relationship's stored options and the Builder's own controls", () => {
  // The picker names the collection: emptied, the field links nowhere, and the save says so,
  // rather than the stored target linking it to the collection the person removed.
  it("names no collection once the picker is emptied", () => {
    const sent = resaved(CURRENT, { relationTo: undefined });
    expect(sent.relationTo).toBeUndefined();
    expect(sent.options?.target).toBeUndefined();
    expect(sent.options?.relationType).toBe("manyToMany");
  });

  // Max depth is the Builder's control: a depth stored in `options` is shown there and saved
  // where the control writes it, so the edit is the one that counts.
  it("moves a stored options.maxDepth to the control the person edits", () => {
    const stored = {
      ...(LEGACY as object),
      options: { target: "lm_tags", relationType: "manyToMany", maxDepth: 2 },
    } as unknown as Stored;
    expect(convertToBuilderField(stored, 0).maxDepth).toBe(2);
    const sent = resaved(stored, { maxDepth: 4 }) as {
      maxDepth?: unknown;
      options?: { maxDepth?: unknown };
    };
    expect(sent.maxDepth).toBe(4);
    expect(sent.options?.maxDepth).toBeUndefined();
  });

  // A duplicate is a field of its own, with a link table of its own.
  it("gives a duplicated many-to-many no stored link table", () => {
    const stored = {
      ...(CURRENT as object),
      options: {
        target: "lm_tags",
        relationType: "manyToMany",
        junctionTable: "posts_tags_links",
      },
    } as unknown as Stored;
    const copy = copyWithNewIds(convertToBuilderField(stored, 0));
    expect(copy.storedRelationOptions?.junctionTable).toBeUndefined();
    expect(copy.storedRelationOptions?.relationType).toBe("manyToMany");
  });
});

// The Builder's cardinality controls decide how a many-to-many is stored: the stored options carry
// only what the Builder has no control for.
describe("a many-to-many's cardinality, as the Builder's controls set it", () => {
  /** A many-to-many stored the current way, with Allow multiple on and a link table named. */
  const MANY = {
    ...(CURRENT as unknown as Record<string, unknown>),
    hasMany: true,
    options: {
      target: "lm_tags",
      relationType: "manyToMany",
      junctionTable: "lm_tags_links",
    },
  } as unknown as Stored;

  it("links one entry once Allow multiple is turned off", () => {
    const sent = resaved(MANY, { hasMany: false });
    expect(sent.hasMany).toBe(false);
    expect(sent.options?.relationType).toBe("manyToOne");
    // One entry per row needs no link table.
    expect(sent.options?.junctionTable).toBeUndefined();
  });

  // Stored off beside a many-to-many, the control changed nothing: the links stay where they are.
  it("stays a many-to-many when Allow multiple was stored off", () => {
    const storedOff = {
      ...(MANY as unknown as Record<string, unknown>),
      hasMany: false,
    } as unknown as Stored;
    expect(resaved(storedOff, { label: "Topics" }).options).toMatchObject({
      relationType: "manyToMany",
      junctionTable: "lm_tags_links",
    });
  });

  it("stays a many-to-many with Allow multiple left on", () => {
    expect(resaved(MANY, { label: "Topics" }).options).toMatchObject({
      relationType: "manyToMany",
      junctionTable: "lm_tags_links",
    });
  });

  // A many-to-many keeps its links in a table made for one collection.
  it("is refused with several collections picked", () => {
    const loaded = {
      ...convertToBuilderField(MANY, 0),
      relationTo: ["lm_tags", "lm_other"],
    };
    expect(builderFieldErrors([loaded]).get(loaded.id)?.message).toBe(
      'Relationship field "tags" keeps its links for one collection: pick only one'
    );
  });

  it("is not refused with one collection picked", () => {
    const loaded = {
      ...convertToBuilderField(MANY, 0),
      relationTo: "lm_other",
    };
    expect(builderFieldErrors([loaded]).get(loaded.id)).toBeUndefined();
  });
});

// A relationship's stored relation type follows the Builder's controls the person changed: one
// collection however the picker holds it, and Unique for a one-to-one.
describe("a relationship's stored relation type and the Builder's other controls", () => {
  it("names its one collection when the picker holds it as a list", () => {
    const listed = {
      ...(CURRENT as unknown as Record<string, unknown>),
      relationTo: ["lm_tags"],
    } as unknown as Stored;
    expect(resaved(listed, { label: "Topics" }).options).toMatchObject({
      target: "lm_tags",
      relationType: "manyToMany",
    });
  });

  /** A one-to-one stored the current way, with Unique on. */
  const ONE = {
    name: "lead",
    label: "Lead",
    type: "relationship",
    relationTo: "lm_tags",
    unique: true,
    options: { target: "lm_tags", relationType: "oneToOne" },
  } as unknown as Stored;

  /** What the save sends for `stored` with its Unique control set to `unique`. */
  function withUnique(stored: Stored, unique: boolean) {
    const loaded = convertToBuilderField(stored, 0);
    return convertToFieldDefinition({
      ...loaded,
      advanced: { ...loaded.advanced, unique },
    }) as unknown as { unique?: unknown; options?: { relationType?: unknown } };
  }

  it("is no longer one-to-one once Unique is turned off", () => {
    const sent = withUnique(ONE, false);
    expect(sent.unique).toBe(false);
    expect(sent.options?.relationType).toBe("manyToOne");
  });

  it("stays one-to-one with Unique left on", () => {
    expect(withUnique(ONE, true).options?.relationType).toBe("oneToOne");
  });

  // Stored off beside a one-to-one, the control changed nothing: the relation type stays.
  it("stays one-to-one when Unique was stored off", () => {
    const storedOff = {
      ...(ONE as unknown as Record<string, unknown>),
      unique: undefined,
    } as unknown as Stored;
    expect(resaved(storedOff, { label: "Topics" }).options).toMatchObject({
      relationType: "oneToOne",
    });
  });
});
