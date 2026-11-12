/**
 * Which first run of `nextly migrate` a run is, the refusal of a migration
 * without the registry metadata where nothing would record the registry after
 * it, and what a first run says when it writes the rows from the
 * configuration (`first-run.ts`).
 */
import { describe, expect, it } from "vitest";

import { defineCollection, defineConfig, text } from "../../../../config";
import { NextlyError } from "../../../../errors";
import {
  configurationRegistryRows,
  configurationRowsMessage,
  declaredRowCount,
  firstRunOf,
  pointCarriesMetadata,
  refuseMigrationsWithoutMetadata,
  snapshotMetadataOf,
  type AppMigrationStanding,
} from "../first-run";

/** A migration as the run finds it. */
function m(
  name: string,
  applied: boolean,
  metadata: AppMigrationStanding["metadata"]
): AppMigrationStanding {
  return { name, applied, metadata };
}

/** The refusal's message, or undefined where the run is let through. */
function refusal(
  recorded: boolean,
  migrations: AppMigrationStanding[]
): string | undefined {
  try {
    refuseMigrationsWithoutMetadata(recorded, migrations);
    return undefined;
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    return error.publicMessage;
  }
}

describe("configurationRowsMessage", () => {
  it("says the rows came from the configuration, how many were written, and that they are the baseline", () => {
    expect(configurationRowsMessage(3, 5)).toBe(
      "First run on this release: 3 registry rows written from the configuration (5 declared, the rest already matched), and kept with the database's registry record as its baseline. From now on the registry rows come from the migrations."
    );
    expect(configurationRowsMessage(1, 1)).toContain(
      "1 registry row written from the configuration (1 declared"
    );
  });
});

describe("snapshotMetadataOf", () => {
  it("tells a snapshot that records the entities from one that predates them and from none", () => {
    expect(
      snapshotMetadataOf({
        entities: { collections: {}, singles: {}, fieldGroups: {} },
      })
    ).toBe("carries");
    expect(snapshotMetadataOf({})).toBe("lacks");
    expect(snapshotMetadataOf(null)).toBe("none");
  });
});

describe("firstRunOf", () => {
  it("is an ordinary run once the record exists", () => {
    expect(firstRunOf(true, [m("a", false, "carries")])).toEqual({
      kind: "recorded",
    });
  });

  it("writes from the applied snapshot where an applied migration carries the metadata", () => {
    expect(
      firstRunOf(false, [m("a", true, "lacks"), m("b", true, "carries")])
    ).toEqual({ kind: "from-applied-snapshot" });
  });

  it("takes the record before the first pending migration that carries it, an earlier one without it before", () => {
    expect(
      firstRunOf(false, [
        m("a", true, "lacks"),
        m("b", false, "lacks"),
        m("c", false, "none"),
        m("d", false, "carries"),
        m("e", false, "carries"),
      ])
    ).toEqual({ kind: "before-migration", migration: "d" });
  });

  it("writes from the configuration where none carries it, and where there is no migration at all", () => {
    expect(
      firstRunOf(false, [m("a", true, "lacks"), m("b", false, "none")])
    ).toEqual({ kind: "from-configuration" });
    expect(firstRunOf(false, [])).toEqual({ kind: "from-configuration" });
  });
});

describe("refuseMigrationsWithoutMetadata", () => {
  it("refuses a pending one without it once the record exists, naming it and the fix", () => {
    const message = refusal(true, [
      m("a", true, "carries"),
      m("b", false, "lacks"),
    ]);
    expect(message).toContain("`b.sql`");
    expect(message).toContain("nextly migrate:create");
    expect(message).toContain("registry record");
  });

  it("refuses one ordered after a migration that carries it, applied or pending, on a first run", () => {
    expect(
      refusal(false, [m("a", false, "carries"), m("b", false, "lacks")])
    ).toContain("`b.sql`");
    expect(
      refusal(false, [m("a", true, "carries"), m("b", false, "lacks")])
    ).toContain("`b.sql`");
  });

  it("lets one without it through on a first run when it comes before every one with it", () => {
    expect(
      refusal(false, [m("a", false, "lacks"), m("b", false, "carries")])
    ).toBeUndefined();
  });

  it("passes over a migration with no snapshot, and one already applied", () => {
    expect(
      refusal(true, [m("a", true, "lacks"), m("b", false, "none")])
    ).toBeUndefined();
  });
});

describe("pointCarriesMetadata", () => {
  const folder = [
    m("a", true, "lacks"),
    m("b", true, "carries"),
    m("c", true, "none"),
  ];

  it("reads the point's own snapshot, or the newest one before a migration without one", () => {
    expect(pointCarriesMetadata(folder, "a")).toBe(false);
    expect(pointCarriesMetadata(folder, "b")).toBe(true);
    expect(pointCarriesMetadata(folder, "c")).toBe(true);
  });

  it("finds none at the point before any app migration", () => {
    expect(pointCarriesMetadata(folder, null)).toBe(false);
  });
});

describe("configurationRegistryRows", () => {
  it("records each code-first entity of the configuration, as a snapshot records it", () => {
    const config = defineConfig({
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      ],
      db: { migrationsDir: "./migrations" },
    });
    const rows = configurationRegistryRows(config);
    expect(Object.keys(rows.collections)).toEqual(["posts"]);
    expect(rows.collections.posts.source).toBe("code");
    expect(declaredRowCount(rows)).toBe(1);
  });

  it("is an empty record for a configuration declaring no entity", () => {
    const rows = configurationRegistryRows({ collections: [] });
    expect(rows).toEqual({ collections: {}, singles: {}, fieldGroups: {} });
    expect(declaredRowCount(rows)).toBe(0);
  });
});
