/**
 * The boot drift check counts a collection's declared compound indexes.
 *
 * The check reduces the config's collections to its own input and hands each
 * to the schema preview. Both steps used to drop the declared `indexes`, so a
 * database whose migration had created the index was reported as drifted on
 * every boot (the preview planned its drop), and one missing it was not.
 *
 * Driven from a config collection through `driftCheckCollections` and the
 * real preview; only the database read is faked. The live table is built by
 * the table builder `migrate:create` writes from, not through the code under
 * test, which would leave the index out of both sides and report clean.
 */
import { describe, expect, it, vi } from "vitest";

import { defineCollection } from "../../collections/config/define-collection";
import { text } from "../../collections/fields/helpers";
import { buildDesiredTableFromFields } from "../../domains/schema/pipeline/diff/build-from-fields";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import { previewDesiredSchema } from "../../domains/schema/pipeline/preview";
import { driftCheckCollections, runDriftCheck } from "../drift-check";

const places = defineCollection({
  slug: "places",
  fields: [text({ name: "country" }), text({ name: "city" })],
  indexes: [{ fields: ["country", "city"], unique: true }],
});

/** `dc_places` as a migration created it, with or without the declared index. */
function liveTable(withDeclaredIndex: boolean): NextlySchemaSnapshot {
  return {
    tables: [
      buildDesiredTableFromFields(
        "dc_places",
        places.fields as never,
        "sqlite",
        {
          builtBy: "codeFirst",
          ...(withDeclaredIndex ? { indexes: places.indexes } : {}),
        }
      ),
    ],
  };
}

async function driftAgainst(live: NextlySchemaSnapshot) {
  return runDriftCheck({
    adapter: { dialect: "sqlite", getDrizzle: () => ({}) },
    collections: driftCheckCollections([places]),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    deps: {
      previewDesiredSchema: args =>
        previewDesiredSchema(args, {
          renameDetector: { detect: vi.fn().mockReturnValue([]) },
          classifier: {
            classify: vi.fn().mockResolvedValue({ level: "safe", events: [] }),
          },
          introspect: vi.fn().mockResolvedValue(live),
        }),
    },
  });
}

describe("the boot drift check and a collection's declared indexes", () => {
  it("carries the declared indexes into its input", () => {
    expect(driftCheckCollections([places])).toEqual([
      expect.objectContaining({
        slug: "places",
        tableName: "dc_places",
        indexes: [{ fields: ["country", "city"], unique: true }],
      }),
    ]);
  });

  it("reports clean when the database already holds the declared index", async () => {
    await expect(driftAgainst(liveTable(true))).resolves.toEqual({
      kind: "clean",
    });
  });

  it("reports drift when the database lacks the declared index", async () => {
    await expect(driftAgainst(liveTable(false))).resolves.toEqual({
      kind: "drift",
      pending: 1,
    });
  });
});
