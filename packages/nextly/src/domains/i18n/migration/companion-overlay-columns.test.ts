/**
 * A field group made or changed in the Schema Builder keeps a group's text per language in the
 * group's overlay column on its translations table, as one defined in code does: every Builder
 * path that makes or changes that table (`buildCompanionTransitionStatements`) gives each such
 * container its column. The plausible broken one plans only the translated fields' columns, so the
 * group's text in a second language has nowhere to go.
 */
import { describe, expect, it } from "vitest";

import { buildCompanionTransitionStatements } from "./reconcile-companion";

const heading = { name: "heading", type: "text" };
const box = {
  name: "box",
  type: "group",
  fields: [{ name: "label", type: "text" }],
};

const change = {
  builtBy: "fieldGroup" as const,
  slug: "badge",
  kind: "fieldGroup" as const,
  tableName: "comp_badge",
  dialect: "postgresql" as const,
  defaultLocale: "en",
  status: false,
  wasStatus: false,
};

const statementsOf = (
  args: Partial<Parameters<typeof buildCompanionTransitionStatements>[0]>
) =>
  buildCompanionTransitionStatements({
    ...change,
    wasLocalized: true,
    isLocalized: true,
    oldFields: [],
    newFields: [],
    companionExists: true,
    ...args,
  }).statements;

const addsBox = (s: string) =>
  s.startsWith(`ALTER TABLE "comp_badge_locales" ADD COLUMN "box"`);
const createsWithBox = (s: string) =>
  s.startsWith(`CREATE TABLE`) &&
  s.includes(`"comp_badge_locales"`) &&
  s.includes(`"box"`);

describe("a Builder field group's overlay columns", () => {
  it("adds a group's overlay column when the field group is made translated", () => {
    const statements = statementsOf({
      wasLocalized: false,
      oldFields: [heading, box],
      newFields: [heading, box],
      companionExists: false,
    });
    expect(statements.some(s => addsBox(s) || createsWithBox(s))).toBe(true);
  });

  it("creates the translations table with the overlay column when a group is all there is", () => {
    const statements = statementsOf({
      wasLocalized: false,
      oldFields: [box],
      newFields: [box],
      companionExists: false,
    });
    expect(statements.some(createsWithBox)).toBe(true);
  });

  it("adds the overlay column of a group added to a translated field group", () => {
    const statements = statementsOf({
      oldFields: [heading],
      newFields: [heading, box],
      liveCompanionColumns: ["heading"],
    });
    expect(statements.filter(addsBox)).toHaveLength(1);
  });

  it("adds the overlay column a translated field group's group still lacks", () => {
    const statements = statementsOf({
      oldFields: [heading, box],
      newFields: [heading, box],
      liveCompanionColumns: ["heading"],
    });
    expect(statements.filter(addsBox)).toHaveLength(1);
  });

  it("adds nothing for a group whose overlay column is there, and drops a removed group's", () => {
    expect(
      statementsOf({
        oldFields: [heading, box],
        newFields: [heading, box],
        liveCompanionColumns: ["heading", "box"],
      }).some(s => s.includes(`"box"`))
    ).toBe(false);
    expect(
      statementsOf({
        oldFields: [heading, box],
        newFields: [heading],
        liveCompanionColumns: ["heading", "box"],
      }).some(s => s.includes(`DROP COLUMN "box"`))
    ).toBe(true);
  });

  // Turning translation off drops the companion, and nothing brings a group's overlay home onto
  // its structure: refused, naming the group by its overlay column. A group with no overlay on the
  // companion loses nothing, so it is not named. Broken, the plan drops the companion.
  it("refuses turning translation off while a group's overlay is on the companion", () => {
    const off = (liveCompanionColumns: string[]) => () =>
      statementsOf({
        isLocalized: false,
        oldFields: [heading, box],
        newFields: [heading, box],
        liveCompanionColumns,
      });

    expect(off(["heading", "box"])).toThrow(
      expect.objectContaining({
        logContext: expect.objectContaining({
          reason: "disable-with-container-overlays",
          containers: ["box"],
        }),
      })
    );
    expect(off(["heading"])).not.toThrow();
  });

  // A save's own migration file makes a new group's overlay column before the companion is
  // reconciled, so the reconcile must not add it again. Broken, the save fails on a duplicate column.
  it("adds no overlay column the companion already has, as a save's own file made it", () => {
    const statements = statementsOf({
      oldFields: [heading],
      newFields: [heading, box],
      liveCompanionColumns: ["heading", "box"],
    });
    expect(statements.filter(addsBox)).toHaveLength(0);
  });

  // A group already there whose overlay is missing keeps its text on the main table, so the
  // default language's overlay is seeded from it; a group new in the save has nothing to copy.
  // Broken, the default language reads no text once another language saves the group.
  it("seeds a missing overlay of a group already there from the main table, and not a new group's", () => {
    const seeds = (s: string) =>
      s.includes(`"comp_badge_locales"`) && /^(UPDATE|INSERT)/.test(s);
    const lacking = statementsOf({
      oldFields: [heading, box],
      newFields: [heading, box],
      liveCompanionColumns: ["heading"],
    });
    expect(lacking.findIndex(addsBox)).toBeGreaterThanOrEqual(0);
    expect(lacking.findIndex(seeds)).toBeGreaterThan(
      lacking.findIndex(addsBox)
    );
    expect(
      statementsOf({
        oldFields: [heading],
        newFields: [heading, box],
        liveCompanionColumns: ["heading"],
      }).some(seeds)
    ).toBe(false);
  });

  // A Builder create's own migration makes the whole translations table, overlay columns among it,
  // before the companion is reconciled as translation starting, so the reconcile adds none of them
  // again. Broken, the create fails on a duplicate column and records the field group as failed.
  it("adds no overlay column the companion has when translation starts over a table the save made", () => {
    const statements = statementsOf({
      wasLocalized: false,
      oldFields: [],
      newFields: [heading, box],
      companionExists: true,
      liveCompanionColumns: ["heading", "box"],
    });
    expect(statements.filter(addsBox)).toHaveLength(0);
  });
});
