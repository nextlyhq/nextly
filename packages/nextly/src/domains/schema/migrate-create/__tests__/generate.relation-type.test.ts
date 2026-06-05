// Regression: hasMany / polymorphic relationships must survive the migrate:create
// field-flattening adapters (uiToMinimal / toMinimalEntities) so they reach the
// column-type classifier and emit JSON columns, not single id (text) columns.
// Previously the adapters reduced fields to {name,type,required}, starving
// classifyFieldKind of hasMany/relationTo.

import { describe, expect, it } from "vitest";

import { uiSchemaManifest } from "../../../../schemas/_zod/ui-schema";
import { mergeUiEntities } from "../../ui-schema/merge";
import { buildDesiredSnapshotFromConfig } from "../generate";

function colType(
  table: { columns: { name: string; type: string }[] },
  col: string
) {
  return table.columns.find(c => c.name === col)?.type;
}

describe("migrate:create relationship column types (through uiToMinimal)", () => {
  it("emits json for hasMany/polymorphic relationships, text for a single one", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [
        {
          slug: "posts",
          fields: [
            { name: "author", type: "relationship", relationTo: "authors" },
            {
              name: "tags",
              type: "relationship",
              relationTo: "authors",
              hasMany: true,
            },
            {
              name: "ref",
              type: "relationship",
              relationTo: ["authors", "media"],
            },
          ],
        },
      ],
    });
    const merged = mergeUiEntities({
      codeCollections: [],
      codeSingles: [],
      codeComponents: [],
      manifest,
    });
    const snap = buildDesiredSnapshotFromConfig(
      merged.collections,
      merged.singles,
      merged.components,
      "postgresql"
    );
    const t = snap.tables.find(x => x.name === "dc_posts")!;
    expect(colType(t, "author")).toBe("text"); // fkSingle id column
    expect(colType(t, "tags")).toBe("jsonb"); // hasMany -> json
    expect(colType(t, "ref")).toBe("jsonb"); // polymorphic -> json
  });
});
