/**
 * The schema preview shows a collection's declared compound indexes.
 *
 * The preview builds the desired table of each collection itself, apart from
 * the apply, and it left the declared `indexes` out. So a database that a
 * migration had already given the index previewed a drop of it, and one that
 * lacked it previewed nothing to add. The dev drift check reads the preview,
 * so it counted the first as drift on every boot and missed the second.
 *
 * The live side is built by the table builder itself, which is what
 * `migrate:create` writes from, and NOT by the preview's own path: a fixture
 * built through the code under test would leave the index out of both sides
 * and agree with a preview that ignores it.
 */
import { describe, expect, it, vi } from "vitest";

import { indexNameForColumns } from "../../services/index-name";
import { buildDesiredTableFromFields } from "../diff/build-from-fields";
import type { NextlySchemaSnapshot } from "../diff/types";
import { previewDesiredSchema } from "../preview";
import type { DesiredSchema } from "../types";

const TABLE = "dc_places";
const FIELDS = [
  { name: "country", type: "text" },
  { name: "city", type: "text" },
];
const DECLARED = [{ fields: ["country", "city"], unique: true }];
const DECLARED_NAME = indexNameForColumns(TABLE, ["country", "city"], true);

/** The table as a migration created it, with or without the declared index. */
function liveTable(withDeclaredIndex: boolean): NextlySchemaSnapshot {
  return {
    tables: [
      buildDesiredTableFromFields(TABLE, FIELDS, "sqlite", {
        builtBy: "codeFirst",
        ...(withDeclaredIndex ? { indexes: DECLARED } : {}),
      }),
    ],
  };
}

const desired: DesiredSchema = {
  collections: {
    places: {
      slug: "places",
      tableName: TABLE,
      fields: FIELDS as never,
      indexes: DECLARED,
    },
  },
  singles: {},
  components: {},
};

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

describe("previewDesiredSchema: a collection's declared indexes", () => {
  it("previews nothing when the database already holds the declared index", async () => {
    // The fixture's premise: the live table really carries the index, so a
    // preview that left it out of the desired side would plan its drop.
    expect(
      liveTable(true).tables[0].indexes?.map(index => index.name)
    ).toContain(DECLARED_NAME);

    const result = await preview(liveTable(true));
    expect(result.operations).toEqual([]);
  });

  it("previews adding the declared index when the database lacks it", async () => {
    const result = await preview(liveTable(false));
    expect(result.operations).toEqual([
      {
        type: "add_index",
        tableName: TABLE,
        index: {
          name: DECLARED_NAME,
          columns: ["country", "city"],
          unique: true,
        },
      },
    ]);
  });
});
