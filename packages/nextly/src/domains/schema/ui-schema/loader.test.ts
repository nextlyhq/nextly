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
