/**
 * An explicit collection index name is one the schema diff can drop.
 *
 * The diff matches indexes by their columns but drops only the names it owns
 * (`idx_`, `uq_`), because a live index under any other name may be one a
 * database administrator added. A declared index named outside those prefixes
 * would be created and then never removed once the declaration was, so the
 * name is refused where the collection is defined, with the rename to make.
 */
import { describe, expect, it } from "vitest";

import { buildDesiredTableFromFields } from "../../../domains/schema/pipeline/diff/build-from-fields";
import type { CollectionConfig } from "../define-collection";
import { validateCollectionConfig } from "../validate-config";

const fields = [
  { name: "slug", type: "text" },
  { name: "locale", type: "text" },
];

function nameErrors(name: string, unique: boolean) {
  const result = validateCollectionConfig({
    slug: "pages",
    fields,
    indexes: [{ fields: ["slug", "locale"], unique, name }],
  } as unknown as CollectionConfig);
  return result.errors.filter(error => error.path === "indexes[0].name");
}

describe("an explicit collection index name", () => {
  it("is refused outside the managed prefixes, naming the rename", () => {
    const [error] = nameErrors("slug_locale_unique", true);
    expect(error).toMatchObject({ code: "INDEX_NAME_INVALID" });
    expect(error.message).toContain("'uq_slug_locale_unique'");

    const [plain] = nameErrors("posts_author_status_idx", false);
    expect(plain.message).toContain("'idx_posts_author_status_idx'");
  });

  it("is accepted under either prefix, and the pipeline builds it", () => {
    expect(nameErrors("uq_slug_locale", true)).toEqual([]);
    expect(nameErrors("idx_slug_locale", false)).toEqual([]);

    // The config boundary and the schema pipeline agree: a name the config
    // accepts is one the desired table carries.
    const table = buildDesiredTableFromFields("dc_pages", fields, "sqlite", {
      builtBy: "codeFirst",
      indexes: [
        { fields: ["slug", "locale"], unique: true, name: "uq_slug_locale" },
      ],
    });
    expect(table.indexes?.map(index => index.name)).toContain("uq_slug_locale");
  });
});
