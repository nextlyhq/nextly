// Regression: buildDesiredSnapshotFromConfig must forward each entity's
// `status` flag into the system-column logic of buildDesiredTableFromFields.
//
// Bug: code-first projects that opted into the built-in Draft/Published
// lifecycle via `defineCollection({ status: true })` had the flag silently
// dropped here. migrate:create / migrate:check / db:sync all consume this
// snapshot, so missing the forwarding meant the system status column never
// reached generated DDL or drift comparisons.

import { describe, expect, it } from "vitest";

import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "../generate";

const POST_FIELDS = [
  { name: "description", type: "text", required: true },
] as const;

function findStatusColumn(table: { columns: { name: string }[] }) {
  return table.columns.find(c => c.name === "status");
}

describe("buildDesiredSnapshotFromConfig — status flag forwarding", () => {
  it("emits a status system column when the collection has status: true", () => {
    const collections: MinimalConfigEntity[] = [
      {
        slug: "posts",
        tableName: "dc_posts",
        fields: [...POST_FIELDS],
        status: true,
      },
    ];
    const snapshot = buildDesiredSnapshotFromConfig(
      collections,
      [],
      [],
      "sqlite"
    );

    const postsTable = snapshot.tables.find(t => t.name === "dc_posts");
    expect(postsTable).toBeDefined();
    expect(findStatusColumn(postsTable!)).toBeDefined();
  });

  it("omits the status column when status is unset (default off)", () => {
    const collections: MinimalConfigEntity[] = [
      {
        slug: "posts",
        tableName: "dc_posts",
        fields: [...POST_FIELDS],
      },
    ];
    const snapshot = buildDesiredSnapshotFromConfig(
      collections,
      [],
      [],
      "sqlite"
    );

    const postsTable = snapshot.tables.find(t => t.name === "dc_posts");
    expect(findStatusColumn(postsTable!)).toBeUndefined();
  });

  it("omits the status column when status is explicitly false", () => {
    const collections: MinimalConfigEntity[] = [
      {
        slug: "posts",
        tableName: "dc_posts",
        fields: [...POST_FIELDS],
        status: false,
      },
    ];
    const snapshot = buildDesiredSnapshotFromConfig(
      collections,
      [],
      [],
      "sqlite"
    );

    const postsTable = snapshot.tables.find(t => t.name === "dc_posts");
    expect(findStatusColumn(postsTable!)).toBeUndefined();
  });

  it("forwards the flag for singles too (defineSingle({ status: true }))", () => {
    const singles: MinimalConfigEntity[] = [
      {
        slug: "site-settings",
        tableName: "single_site_settings",
        fields: [...POST_FIELDS],
        status: true,
      },
    ];
    const snapshot = buildDesiredSnapshotFromConfig(
      [],
      singles,
      [],
      "sqlite"
    );

    const singleTable = snapshot.tables.find(
      t => t.name === "single_site_settings"
    );
    expect(findStatusColumn(singleTable!)).toBeDefined();
  });

  it("ignores the flag on components (components don't carry status)", () => {
    const components: MinimalConfigEntity[] = [
      {
        slug: "hero",
        tableName: "comp_hero",
        fields: [...POST_FIELDS],
        // Setting status: true on a component is a configuration nonsense
        // case — components don't have a Draft/Published lifecycle. The
        // snapshot must NOT emit a status column even if the flag arrives.
        status: true,
      },
    ];
    const snapshot = buildDesiredSnapshotFromConfig(
      [],
      [],
      components,
      "sqlite"
    );

    const componentTable = snapshot.tables.find(t => t.name === "comp_hero");
    expect(findStatusColumn(componentTable!)).toBeUndefined();
  });
});
