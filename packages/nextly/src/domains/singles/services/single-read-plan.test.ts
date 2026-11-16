/**
 * Which columns a Single's read takes for a `select`.
 */
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { SYSTEM_COLUMNS } from "../../../lib/system-columns";

import { singleReadPlan, tableProjection } from "./single-read-plan";

const fields = [
  { name: "headline", type: "text" },
  { name: "metaTitle", type: "text" },
  { name: "hero", type: "upload" },
  // A field group keeps its values in its own table: no column here.
  { name: "cta", type: "component", component: "cta" },
  // An unnamed layout group stores its children at the Single's level.
  {
    type: "group",
    fields: [{ name: "footerText", type: "text" }],
  },
];

const systemColumns = SYSTEM_COLUMNS.filter(column =>
  column.appliesTo.includes("single")
).map(column => column.name);

describe("singleReadPlan", () => {
  it("reads the selected fields' columns and every system column", () => {
    const plan = singleReadPlan({
      fields,
      select: { metaTitle: true, headline: false },
      wholeRow: false,
    });
    expect(new Set(plan.columns)).toEqual(
      new Set([...systemColumns, "meta_title"])
    );
    expect(plan.fields).toEqual([fields[1]]);
  });

  it("always reads the id, the status, the timestamps and the version counter", () => {
    const plan = singleReadPlan({
      fields,
      select: { headline: true },
      wholeRow: false,
    });
    expect(plan.columns).toEqual(
      expect.arrayContaining([
        "id",
        "status",
        "created_at",
        "updated_at",
        "first_published_at",
        "_revision",
      ])
    );
  });

  it("reads a dot path's top-level field, and a field inside an unnamed layout group", () => {
    const plan = singleReadPlan({
      fields,
      select: { "hero.url": true, footerText: true },
      wholeRow: false,
    });
    expect(plan.columns).toEqual(
      expect.arrayContaining(["hero", "footer_text"])
    );
    expect(plan.columns).not.toContain("headline");
    expect(plan.fields.map(field => field.name)).toEqual([
      "hero",
      "footerText",
    ]);
  });

  it("assembles a selected field group though it adds no column", () => {
    const plan = singleReadPlan({
      fields,
      select: { cta: true },
      wholeRow: false,
    });
    expect(plan.columns).toEqual(systemColumns);
    expect(plan.fields).toEqual([fields[3]]);
  });

  it("reads every column when the selection includes nothing", () => {
    const selections: (Record<string, boolean> | undefined)[] = [
      undefined,
      {},
      { headline: false },
    ];
    for (const select of selections) {
      expect(singleReadPlan({ fields, select, wholeRow: false })).toEqual({
        columns: undefined,
        fields,
      });
    }
  });

  it("reads every column when a hook or a rule needs the whole row", () => {
    expect(
      singleReadPlan({ fields, select: { headline: true }, wholeRow: true })
    ).toEqual({ columns: undefined, fields });
  });
});

describe("tableProjection", () => {
  it("projects the named columns under their property names, leaving out names the table lacks", () => {
    const table = sqliteTable("single_t", {
      id: text("id"),
      metaTitle: text("meta_title"),
      notes: text("notes"),
    });
    const projection = tableProjection(table, ["id", "meta_title", "missing"]);
    expect(Object.keys(projection).sort()).toEqual(["id", "metaTitle"]);
    expect(projection.metaTitle).toBe(table.metaTitle);
  });
});
