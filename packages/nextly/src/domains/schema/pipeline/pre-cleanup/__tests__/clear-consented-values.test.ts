/**
 * The consented clearing of a lossy type change and where pre-cleanup runs it.
 *
 * SQLite applies a push without a transaction, so pre-cleanup runs no clearing there: the values
 * are cleared only after the table's rebuild has succeeded (`clearConsentedValues`, called by the
 * apply), and a rebuild that fails leaves every value as it was.
 */
import { describe, expect, it, vi } from "vitest";

import type { TypeChangeEvent } from "../../resolution/types";
import { RealPreCleanupExecutor } from "../executor";

const lossy: TypeChangeEvent = {
  id: "type_change:dc_posts.price",
  kind: "type_change",
  tableName: "dc_posts",
  columnName: "price",
  fromType: "integer",
  toType: "real",
  isWidening: false,
  perDialectWarning: { pg: "", mysql: "", sqlite: "" },
  dialect: "sqlite",
  lossy: {
    judgement: {
      class: "lossy",
      reasons: [
        {
          kind: "kept-unreadable",
          class: "lossy",
          rows: { first: [{ id: "p1" }], count: 1 },
        },
      ],
    },
    keyedBy: "id",
    cleared: [{ id: "p1" }],
    conversion: {
      dialect: "sqlite",
      from: { type: "integer", nullable: true },
      to: { type: "real", nullable: true },
      compareAs: "number",
    },
  },
};

describe("pre-cleanup and a consented clearing", () => {
  it("clears nothing on SQLite, leaving the clearing until the rebuild has succeeded", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const all = vi.fn().mockResolvedValue([]);
    const run = vi.fn().mockResolvedValue(undefined);

    await new RealPreCleanupExecutor().execute({
      tx: { execute, all, run },
      desiredSnapshot: { tables: [] },
      resolutions: [],
      events: [lossy],
      operations: [],
      fields: [],
      dialect: "sqlite",
      clearing: [lossy.id],
    });

    expect(execute).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
