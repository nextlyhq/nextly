/**
 * The names a declared collection index may use.
 *
 * Collection validation and the schema build both answer this, and a name the
 * first accepts must be one the second builds: otherwise `defineCollection`
 * succeeds and every dev push, `db:sync`, `migrate:create` and
 * `migrate:check` after it fails. The system timestamps and `id` are not
 * fields, so they are resolved to the system columns; a field nested in a
 * group has no column of its own, so it is refused where the collection is
 * defined.
 */
import { describe, expect, it } from "vitest";

import { buildDesiredTableFromFields } from "../../../domains/schema/pipeline/diff/build-from-fields";
import type { CollectionConfig } from "../define-collection";
import { validateCollectionConfig } from "../validate-config";

/** The reason a schema build refused, read from the validation error. */
function refusal(build: () => unknown): string {
  try {
    build();
  } catch (error) {
    const data = (error as { publicData?: { errors?: { message: string }[] } })
      .publicData;
    return data?.errors?.map(e => e.message).join("\n") ?? String(error);
  }
  return "";
}

const fields = [
  { name: "authorId", type: "text" },
  { name: "status", type: "text" },
  {
    name: "seo",
    type: "group",
    fields: [{ name: "title", type: "text" }],
  },
];

function indexErrors(indexFields: string[]) {
  return validateCollectionConfig({
    slug: "posts",
    fields,
    indexes: [{ fields: indexFields }],
  } as unknown as CollectionConfig).errors.filter(error =>
    error.path.startsWith("indexes[0].fields")
  );
}

function builtIndexColumns(indexFields: string[]) {
  const table = buildDesiredTableFromFields("dc_posts", fields, "mysql", {
    builtBy: "codeFirst",
    indexes: [{ fields: indexFields }],
  });
  return table.indexes
    ?.filter(index => index.columns.length > 1)
    .map(index => index.columns);
}

describe("a declared index naming a system column", () => {
  it("builds the documented example on author_id, created_at", () => {
    expect(indexErrors(["authorId", "createdAt"])).toEqual([]);
    expect(builtIndexColumns(["authorId", "createdAt"])).toEqual([
      ["author_id", "created_at"],
    ]);
  });

  it("builds id and updatedAt the same way", () => {
    expect(indexErrors(["status", "updatedAt", "id"])).toEqual([]);
    expect(builtIndexColumns(["status", "updatedAt", "id"])).toEqual([
      ["status", "updated_at", "id"],
    ]);
  });

  it("weighs a system column toward the MySQL key width", () => {
    // Three 255-character text fields are 3,060 bytes of key, inside the
    // 3,072-byte limit; `id` adds its own width and takes the key past it. A
    // system column left unweighed would let this through.
    const wide = [
      { name: "a", type: "text" },
      { name: "b", type: "text" },
      { name: "c", type: "text" },
    ];
    const build = (indexFields: string[]) =>
      buildDesiredTableFromFields("dc_wide", wide, "mysql", {
        builtBy: "codeFirst",
        indexes: [{ fields: indexFields }],
      });
    expect(refusal(() => build(["a", "b", "c"]))).toBe("");
    expect(refusal(() => build(["a", "b", "c", "id"]))).toMatch(/3,?072/);
  });
});

describe("a declared index naming a nested field", () => {
  it("is refused when the collection is defined, for either spelling", () => {
    for (const name of ["seo.title", "title"]) {
      const [error] = indexErrors(["authorId", name]);
      expect(error, name).toMatchObject({
        path: "indexes[0].fields[1]",
        code: "INDEX_FIELD_UNKNOWN",
      });
    }
    expect(indexErrors(["seo.title"])[0].message).toContain(
      "has no column of its own"
    );
  });

  it("is refused by the build with the same rule", () => {
    expect(refusal(() => builtIndexColumns(["seo.title"]))).toContain(
      "has no column of its own"
    );
  });
});
