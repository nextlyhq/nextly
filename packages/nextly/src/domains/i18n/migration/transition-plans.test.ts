/**
 * A migration file and the database it was generated on are not the same thing.
 *
 * The file is replayed against databases that have only ever run migrations, so its content has to
 * follow from history. Unattended provisioning breaks that assumption in one direction only: it
 * retains the columns it copied into a companion, so a development database can sit in a shape no
 * sequence of migrations produces. A disable generated from that shape omits the `ADD COLUMN`s,
 * and replaying it where the enable migration dropped those columns leaves the restore addressing
 * columns that are not there.
 */
import { describe, expect, it } from "vitest";

import { buildCompanionTransitionPlans } from "./reconcile-companion";

const disable = {
  slug: "posts",
  tableName: "dc_posts",
  dialect: "postgresql" as const,
  defaultLocale: "en",
  status: false,
  // This entity has no Draft/Published lifecycle on either side of the save, so it carried no
  // `status` beforehand either. The restore that `wasStatus` gates is inert here, which is what
  // keeps these cases about the retained-column question they exist to ask.
  wasStatus: false,
  wasLocalized: true,
  isLocalized: false,
  oldFields: [{ name: "title", type: "text", localized: true }],
  newFields: [{ name: "title", type: "text" }],
  companionExists: true,
};

const adds = (statements: string[]) =>
  statements.filter(s => s.includes("ADD COLUMN"));

describe("buildCompanionTransitionPlans", () => {
  it("re-adds the column in the artefact even when this database still has it", () => {
    const { artefact } = buildCompanionTransitionPlans({
      ...disable,
      existingMainColumns: ["title"],
    });

    // The database being generated against retained `title`; a database that only ran migrations
    // had it dropped by the enable. The file has to serve the second.
    expect(adds(artefact.statements)).toHaveLength(1);
    expect(artefact.statements[0]).toContain(`ADD COLUMN "title"`);
  });

  it("gives this database its own plan, which skips the re-add", () => {
    const { local } = buildCompanionTransitionPlans({
      ...disable,
      existingMainColumns: ["title"],
    });

    expect(local).toBeDefined();
    expect(adds(local!.statements)).toHaveLength(0);
    // Still restored. Presence says the column exists, never that its value is current: every
    // localized write since the transition went to the companion alone.
    expect(local!.statements.some(s => s.startsWith("UPDATE"))).toBe(true);
  });

  it("returns no local plan when the two agree", () => {
    // The ordinary case — an explicit transition or a migration file left main without the
    // columns. One plan means a caller cannot pick the wrong one.
    const { artefact, local } = buildCompanionTransitionPlans(disable);

    expect(local).toBeUndefined();
    expect(adds(artefact.statements)).toHaveLength(1);
  });

  it("keeps an enable identical on both, since only a disable reads the retained columns", () => {
    const { local } = buildCompanionTransitionPlans({
      ...disable,
      wasLocalized: false,
      isLocalized: true,
      companionExists: false,
      oldFields: [{ name: "title", type: "text" }],
      newFields: [{ name: "title", type: "text", localized: true }],
      existingMainColumns: ["title"],
    });

    expect(local).toBeUndefined();
  });
});
