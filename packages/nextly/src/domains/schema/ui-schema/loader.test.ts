/**
 * @module domains/schema/ui-schema/loader.test
 * @since v0.0.3-alpha (Plan D1)
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { loadUiSchema } from "./loader";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "uischema-"));
});

describe("loadUiSchema", () => {
  it("returns an empty manifest when the file is absent", async () => {
    const m = await loadUiSchema({
      projectRoot: dir,
      uiSchemaFile: "./ui-schema.json",
    });
    expect(m.collections).toEqual([]);
    expect(m.singles).toEqual([]);
    expect(m.components).toEqual([]);
  });

  it("loads and validates a valid manifest", async () => {
    await writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        version: 1,
        collections: [
          { slug: "events", fields: [{ name: "title", type: "text" }] },
        ],
      })
    );
    const m = await loadUiSchema({
      projectRoot: dir,
      uiSchemaFile: "./ui-schema.json",
    });
    expect(m.collections).toHaveLength(1);
    expect(m.collections[0].slug).toBe("events");
  });

  it("loads a field with a camelCase name under that name, at any depth", async () => {
    // A collection made through the API or by a plugin keeps the name it was given, and the
    // file records it so: a start reads it back as it is.
    await writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        version: 1,
        collections: [
          {
            slug: "posts",
            fields: [
              { name: "metaTitle", type: "text" },
              {
                name: "seo",
                type: "group",
                fields: [{ name: "ogImage", type: "text" }],
              },
            ],
          },
        ],
        singles: [
          { slug: "home", fields: [{ name: "heroTitle", type: "text" }] },
        ],
        components: [
          { slug: "teaser", fields: [{ name: "linkLabel", type: "text" }] },
        ],
      })
    );

    const m = await loadUiSchema({
      projectRoot: dir,
      uiSchemaFile: "./ui-schema.json",
    });

    expect(m.collections[0].fields.map(field => field.name)).toEqual([
      "metaTitle",
      "seo",
    ]);
    expect(m.collections[0].fields[1].fields?.[0]?.name).toBe("ogImage");
    expect(m.singles[0].fields[0].name).toBe("heroTitle");
    expect(m.components[0].fields[0].name).toBe("linkLabel");
  });

  it("still refuses a name that is no identifier", async () => {
    await writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        collections: [
          { slug: "posts", fields: [{ name: "meta-title", type: "text" }] },
        ],
      })
    );
    await expect(
      loadUiSchema({ projectRoot: dir, uiSchemaFile: "./ui-schema.json" })
    ).rejects.toMatchObject({ code: "NEXTLY_UI_SCHEMA_INVALID" });
  });

  it("throws NEXTLY_UI_SCHEMA_INVALID on a schema violation", async () => {
    await writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify({ collections: [{ slug: "Bad", fields: [] }] })
    );
    await expect(
      loadUiSchema({ projectRoot: dir, uiSchemaFile: "./ui-schema.json" })
    ).rejects.toMatchObject({ code: "NEXTLY_UI_SCHEMA_INVALID" });
  });

  it("throws NEXTLY_UI_SCHEMA_INVALID on malformed JSON", async () => {
    await writeFile(join(dir, "ui-schema.json"), "{ not json");
    await expect(
      loadUiSchema({ projectRoot: dir, uiSchemaFile: "./ui-schema.json" })
    ).rejects.toMatchObject({ code: "NEXTLY_UI_SCHEMA_INVALID" });
  });
});
