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
});
