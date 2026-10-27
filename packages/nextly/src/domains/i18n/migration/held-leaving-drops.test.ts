/**
 * A field leaving translation loses its companion column last: a schema dialog copies its values
 * onto the shared column, applies its Required or Unique setting, and only then drops the column,
 * so a refused setting leaves the field translated with every language still in place.
 */
import { describe, expect, it } from "vitest";

import { companionUniqueIndexName } from "./companion-unique-indexes";
import { buildCompanionTransitionStatements } from "./reconcile-companion";

const companion = "dc_posts_locales";
const codeIndex = companionUniqueIndexName(companion, "code");

const change = {
  builtBy: "collection" as const,
  slug: "posts",
  kind: "collection" as const,
  tableName: "dc_posts",
  dialect: "postgresql" as const,
  defaultLocale: "en",
  status: false,
  wasStatus: false,
  wasLocalized: true,
  isLocalized: true,
  oldFields: [
    { name: "title", type: "text", localized: true },
    { name: "code", type: "text", localized: true, unique: true },
  ],
  newFields: [
    { name: "title", type: "text", localized: true },
    { name: "code", type: "text", localized: false, unique: true },
  ],
  companionExists: true,
  liveCompanionColumns: ["title", "code"],
  liveCompanionIndexes: [codeIndex],
};

const dropsColumn = (s: string, column: string) =>
  s.includes(`DROP COLUMN "${column}"`);
const dropsIndex = (s: string, index: string) =>
  s.startsWith("DROP INDEX") && s.includes(index);
const archives = (s: string) => s.includes("nextly_i18n_archive");
const copies = (s: string) => s.startsWith(`UPDATE "dc_posts"`);

describe("a field leaving translation, its drop held for last", () => {
  it("copies the default language's values first, and keeps the column and its index", () => {
    const plan = buildCompanionTransitionStatements({
      ...change,
      holdLeavingDrops: true,
    });
    expect(plan.statements.filter(copies)).toHaveLength(1);
    expect(plan.statements.some(s => dropsColumn(s, "code"))).toBe(false);
    expect(plan.statements.some(s => dropsIndex(s, codeIndex))).toBe(false);
    // The archive is written with the drop, so a language written in between is kept too.
    expect(plan.statements.some(archives)).toBe(false);
  });

  it("drops the index, archives, copies again and drops the column, in that order", () => {
    const { leavingDrops } = buildCompanionTransitionStatements({
      ...change,
      holdLeavingDrops: true,
    });
    const at = (match: (s: string) => boolean) =>
      (leavingDrops ?? []).findIndex(match);
    expect(at(s => dropsIndex(s, codeIndex))).toBe(0);
    expect(at(archives)).toBe(1);
    expect(at(copies)).toBe(2);
    expect(at(s => dropsColumn(s, "code"))).toBe(3);
    expect(leavingDrops).toHaveLength(4);
  });

  it("drops a field removed outright with the other statements, as before", () => {
    const plan = buildCompanionTransitionStatements({
      ...change,
      newFields: [
        { name: "code", type: "text", localized: false, unique: true },
      ],
      holdLeavingDrops: true,
    });
    expect(plan.statements.some(s => dropsColumn(s, "title"))).toBe(true);
    expect(plan.leavingDrops?.some(s => dropsColumn(s, "title"))).toBe(false);
  });

  it("leaves a plan that does not hold them as it was: copy and drop together", () => {
    const plan = buildCompanionTransitionStatements(change);
    expect(plan.leavingDrops).toBeUndefined();
    expect(plan.statements.some(s => dropsIndex(s, codeIndex))).toBe(true);
    expect(plan.statements.some(s => dropsColumn(s, "code"))).toBe(true);
  });

  it("holds nothing for a column an earlier apply already dropped", () => {
    const plan = buildCompanionTransitionStatements({
      ...change,
      liveCompanionColumns: ["title"],
      liveCompanionIndexes: [],
      holdLeavingDrops: true,
    });
    expect(plan.leavingDrops).toEqual([]);
    expect(plan.statements.some(s => s.includes(`"code"`))).toBe(false);
  });

  // A column cannot be renamed under MySQL's functional index, so the index on the old name goes
  // first, and one on the renamed column holds the field unique until its drop.
  it("keeps a renamed field unique in each language until its drop", () => {
    const plan = buildCompanionTransitionStatements({
      ...change,
      dialect: "mysql",
      newFields: [
        { name: "title", type: "text", localized: true },
        { name: "sku", type: "text", localized: false, unique: true },
      ],
      renamed: { from: "code", to: "sku" },
      holdLeavingDrops: true,
    });
    const skuIndex = companionUniqueIndexName(companion, "sku");
    const at = (match: (s: string) => boolean) =>
      plan.statements.findIndex(match);
    const renamedAt = at(s => s.includes("RENAME COLUMN"));
    expect(at(s => dropsIndex(s, codeIndex))).toBeLessThan(renamedAt);
    expect(
      at(s => s.startsWith("CREATE UNIQUE INDEX") && s.includes(skuIndex))
    ).toBeGreaterThan(renamedAt);
    expect(plan.leavingDrops?.[0]).toMatch(/^DROP INDEX/);
    expect(plan.leavingDrops?.[0]).toContain(skuIndex);
    expect(plan.leavingDrops?.at(-1)).toContain("DROP COLUMN `sku`");
  });

  it("finds the renamed field's index where an earlier apply left it, and holds its drop", () => {
    const skuIndex = companionUniqueIndexName(companion, "sku");
    const plan = buildCompanionTransitionStatements({
      ...change,
      newFields: [
        { name: "title", type: "text", localized: true },
        { name: "sku", type: "text", localized: false, unique: true },
      ],
      renamed: { from: "code", to: "sku" },
      liveCompanionColumns: ["title", "sku"],
      liveCompanionIndexes: [skuIndex],
      holdLeavingDrops: true,
    });
    expect(plan.statements.some(s => s.includes(skuIndex))).toBe(false);
    expect(
      plan.leavingDrops?.filter(s => dropsIndex(s, skuIndex))
    ).toHaveLength(1);
  });
});
