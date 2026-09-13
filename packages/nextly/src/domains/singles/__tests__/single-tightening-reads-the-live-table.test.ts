/**
 * A single tightening a field consults the LIVE table, not only the definitions.
 *
 * The refusal these pin lives in `DynamicCollectionSchemaService`, and it is keyed entirely on
 * facts the CALLER supplies: `refuseTighteningOverNulls` returns at its first guard when neither
 * `columnsContainingNull` nor `columnsAbsentFromTable` is passed. So a generator test proves the
 * refusal works when asked, and proves nothing about whether the singles path asks. These drive
 * `planUpdate` itself, through the real reader, so the assertion fails if the facts stop arriving.
 *
 * The driver shapes are the ones `live-table-facts.test.ts` transcribed from real output: the
 * PostgreSQL `QueryResult` wrapper with its `.rows` array.
 */
import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { SingleMetadataService } from "../services/single-metadata-service";

const TABLE = "single_site_settings";

/**
 * One fake connection answering every query this path issues.
 *
 * Dispatched on `udt_name` / `IS NULL` rather than on call order, because the reader runs its
 * four reads in `Promise.all` and an order-keyed fake would pass while the code asked for
 * anything at all. `udt_name` appears only in the catalog read; the null probe is the only query
 * carrying `IS NULL`; `tableHasRows` is what is left holding `LIMIT 1`.
 */
function fakeDb(live: {
  columns: string[];
  someColumnHoldsNull: boolean;
  hasRows: boolean;
}) {
  return {
    execute: vi.fn(async (query: unknown) => {
      const text = JSON.stringify(query);
      if (text.includes("udt_name")) {
        return {
          rows: live.columns.map(column => ({
            table_name: TABLE,
            column_name: column,
            udt_name: "text",
          })),
        };
      }
      if (text.includes("IS NULL")) {
        return { rows: live.someColumnHoldsNull ? [{ "?column?": 1 }] : [] };
      }
      if (text.includes("LIMIT 1")) {
        return { rows: live.hasRows ? [{ "?column?": 1 }] : [] };
      }
      return { rows: [] };
    }),
  };
}

function serviceOver(db: ReturnType<typeof fakeDb>) {
  const adapter = {
    getDrizzle: () => db,
    getCapabilities: () => ({ dialect: "postgresql" as const }),
    tableExists: vi.fn().mockResolvedValue(true),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const service = new SingleMetadataService(
    {} as never,
    logger as never,
    adapter as unknown as DrizzleAdapter
  );
  return service as unknown as {
    planUpdate(input: unknown): Promise<{ migrationSQL: string } | null>;
  };
}

const OPTIONAL: FieldDefinition[] = [
  { name: "tagline", type: "text", required: false } as FieldDefinition,
];
const REQUIRED: FieldDefinition[] = [
  { name: "tagline", type: "text", required: true } as FieldDefinition,
];

function tighteningInput(fields: FieldDefinition[] = REQUIRED) {
  return {
    slug: "site-settings",
    existing: { tableName: TABLE, fields: OPTIONAL } as never,
    updateData: {},
    fields,
    isLocalized: false,
    wasLocalized: false,
    hasStatus: false,
    wasStatus: false,
    statusRequested: false,
  };
}

describe("a single tightening a field over a live table", () => {
  it("refuses when the column is not on the table yet and the single has a row", async () => {
    // The table is there and `tagline` is not: a deployment holding the ADD that creates it,
    // with a save that tightens it queued behind. Applying both emits `SET NOT NULL` for a
    // column the first migration creates holding NULL in the existing row.
    const db = fakeDb({
      columns: ["id", "title", "slug", "updated_at"],
      someColumnHoldsNull: false,
      hasRows: true,
    });

    await expect(
      serviceOver(db).planUpdate(tighteningInput())
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        JSON.stringify(error).includes("REQUIRED_COLUMN_NOT_YET_APPLIED")
    );
  });

  it("refuses when the column exists and an entry still leaves it empty", async () => {
    const db = fakeDb({
      columns: ["id", "title", "slug", "updated_at", "tagline"],
      someColumnHoldsNull: true,
      hasRows: true,
    });

    await expect(
      serviceOver(db).planUpdate(tighteningInput())
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        JSON.stringify(error).includes("REQUIRED_COLUMN_HAS_NULLS")
    );
  });

  it("emits the tightening when the column is there and holds no NULL", async () => {
    // The control the two refusals need. Without it a reader that reported EVERY column as
    // absent, or a guard that refused unconditionally, would satisfy both cases above.
    const db = fakeDb({
      columns: ["id", "title", "slug", "updated_at", "tagline"],
      someColumnHoldsNull: false,
      hasRows: true,
    });

    const plan = await serviceOver(db).planUpdate(tighteningInput());

    expect(plan?.migrationSQL).toContain("tagline");
    expect(plan?.migrationSQL.toUpperCase()).toContain("NOT NULL");
  });

  it("reads the catalog before probing, so the ABSENT column is never queried for NULLs", async () => {
    // The absence is the answer, not an error. A probe against a column the table does not have
    // fails the whole save, which is the defect this reader replaced.
    //
    // Narrowed to the absent column on purpose: the reader still probes the columns that ARE
    // there, so "issued no probe at all" would be a claim about the wrong thing and would fail
    // against correct code. drizzle serializes the identifier as its own chunk, so the column a
    // probe names is readable from the query object.
    const db = fakeDb({
      columns: ["id", "title", "slug", "updated_at"],
      someColumnHoldsNull: false,
      hasRows: true,
    });

    await serviceOver(db)
      .planUpdate(tighteningInput())
      .catch(() => undefined);

    const probes = db.execute.mock.calls
      .map(call => JSON.stringify(call[0]))
      .filter(text => text.includes("IS NULL"));
    expect(probes.some(text => text.includes("tagline"))).toBe(false);
    // The control: a probe WAS issued for a column the catalog reported, so the filter above is
    // reading real probes rather than an empty list.
    expect(probes.some(text => text.includes("updated_at"))).toBe(true);
  });
});
