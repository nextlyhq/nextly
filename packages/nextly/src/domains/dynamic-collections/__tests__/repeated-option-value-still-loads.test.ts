/**
 * A Builder definition stored before the save refused repeated option values still loads: the save
 * refuses them (`assertValidFieldsPayload`), and the field schema that validates the definition
 * file at every config load does not, so a project already holding one keeps starting. Re-saving
 * it is refused until one value is changed.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertValidFieldsPayload } from "../../../api/fields-payload";
import { NextlyError } from "../../../errors/nextly-error";
import { loadUiSchema } from "../../schema/ui-schema/loader";

const repeated = [
  {
    name: "kind",
    type: "select",
    options: [
      { label: "A", value: "a" },
      { label: "B", value: "a" },
    ],
  },
];

describe("a definition whose options repeat a value", () => {
  it("still loads, and re-saving it is refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "repeated-option-"));
    await writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        version: 1,
        collections: [{ slug: "events", fields: repeated }],
      })
    );

    const manifest = await loadUiSchema({
      projectRoot: dir,
      uiSchemaFile: "./ui-schema.json",
    });

    expect(manifest.collections[0].fields).toHaveLength(1);
    expect(() =>
      assertValidFieldsPayload(manifest.collections[0].fields)
    ).toThrow(NextlyError);
  });
});
