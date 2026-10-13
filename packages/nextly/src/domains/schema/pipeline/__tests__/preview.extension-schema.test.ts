/**
 * The schema preview shows what the apply would do with the extension schema.
 *
 * The apply merges the active extension schema into the snapshot it diffs:
 * the tables plugins and the app declare, and what hooks contribute to entity
 * tables. The preview built its snapshot from the entities alone, so a
 * contributed column showed as one to drop, and a declared table the database
 * lacked showed as nothing to do. The admin's confirm dialog and the boot
 * drift check read the preview.
 *
 * The extension schema is compiled from a real plugin, as a hot reload
 * compiles it. The live tables are built from that compiled declaration, as
 * the apply pushes it, not through the preview: a fixture built by the code
 * under test would leave the contribution out of both sides.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin } from "../../../../plugins/plugin-context";
import { clearActiveExtensionSchema } from "../../extension/active-schema";
import type { ExtensionSchema } from "../../extension/build-extension-schema";
import { col, defineTable } from "../../extension/dsl";
import { withEntityContributions } from "../../extension/entity-contributions";
import { compileAndPublishExtensionSchema } from "../../extension/publish";
import { buildDesiredTableFromFields } from "../diff/build-from-fields";
import type { NextlySchemaSnapshot } from "../diff/types";
import { previewDesiredSchema } from "../preview";
import type { DesiredSchema } from "../types";

const TABLE = "dc_places";
const FIELDS = [{ name: "title", type: "text" }];

const plugin = definePlugin({
  name: "preview-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    schema: {
      prefix: "pv",
      tables: [defineTable("notes", { id: col.id(), body: col.shortText() })],
      extend: [
        ({ schema }) => {
          schema.extendTable(TABLE, {
            columns: { indexedAt: col.shortText({ nullable: true }) },
            indexes: [{ columns: ["indexed_at"], name: "idx_dc_places_ia" }],
          });
        },
      ],
    },
  },
});

const desired: DesiredSchema = {
  collections: {
    places: { slug: "places", tableName: TABLE, fields: FIELDS as never },
  },
  singles: {},
  components: {},
};

async function publish(): Promise<ExtensionSchema> {
  const schema = await compileAndPublishExtensionSchema({
    dialect: "sqlite",
    plugins: [plugin],
    config: { collections: [{ slug: "places", fields: FIELDS }] },
    logger: { warn: () => {} },
  });
  if (schema === undefined) throw new Error("the fixture compiled nothing");
  return schema;
}

/** The database as the apply leaves it, optionally without the plugin's table. */
function pushed(
  schema: ExtensionSchema,
  { withPluginTable }: { withPluginTable: boolean }
): NextlySchemaSnapshot {
  const entity = withEntityContributions(
    buildDesiredTableFromFields(TABLE, FIELDS, "sqlite", {
      builtBy: "codeFirst",
    }),
    schema,
    undefined,
    "sqlite"
  );
  return {
    tables: [entity, ...(withPluginTable ? schema.specs : [])],
  };
}

async function preview(live: NextlySchemaSnapshot) {
  return previewDesiredSchema(
    { desired, db: {}, dialect: "sqlite" },
    {
      renameDetector: { detect: vi.fn().mockReturnValue([]) },
      classifier: {
        classify: vi.fn().mockResolvedValue({ level: "safe", events: [] }),
      },
      introspect: vi.fn().mockResolvedValue(live),
    }
  );
}

afterEach(() => {
  clearActiveExtensionSchema();
});

describe("previewDesiredSchema: the active extension schema", () => {
  it("previews nothing for an entity table carrying what a hook contributed", async () => {
    const schema = await publish();
    const live = pushed(schema, { withPluginTable: true });
    // The premise: the live table really carries the contribution, so a
    // preview that left it out would plan dropping it.
    const entity = live.tables.find(table => table.name === TABLE);
    expect(entity?.columns.map(c => c.name)).toContain("indexed_at");
    expect(entity?.indexes?.map(i => i.name)).toContain("idx_dc_places_ia");

    const result = await preview(live);
    expect(result.operations).toEqual([]);
  });

  it("previews creating a declared table the database lacks", async () => {
    const schema = await publish();
    const result = await preview(pushed(schema, { withPluginTable: false }));
    expect(
      result.operations.map(op =>
        op.type === "add_table" ? `add_table ${op.table.name}` : op.type
      )
    ).toEqual(["add_table pv__notes"]);
  });

  it("introspects the declared tables along with the entities'", async () => {
    await publish();
    const introspect = vi.fn().mockResolvedValue({ tables: [] });
    await previewDesiredSchema(
      { desired, db: {}, dialect: "sqlite" },
      {
        renameDetector: { detect: vi.fn().mockReturnValue([]) },
        classifier: {
          classify: vi.fn().mockResolvedValue({ level: "safe", events: [] }),
        },
        introspect,
      }
    );
    // Without the declared table in the list, the live snapshot omits it and
    // the preview plans creating a table that already exists, every time.
    expect(introspect).toHaveBeenCalledWith({}, "sqlite", [TABLE, "pv__notes"]);
  });
});
