import { describe, expect, it } from "vitest";

import {
  resolveRepairEntities,
  type ConfiguredEntity,
  type RegistryEntity,
  type SnapshotEntity,
} from "../resolve-entities";

const text = (name: string) => ({ name, type: "text" });
const number = (name: string) => ({ name, type: "number" });

const configured = (
  over: Partial<ConfiguredEntity> = {}
): ConfiguredEntity => ({
  kind: "collection",
  slug: "posts",
  table: "dc_posts",
  fields: [text("title"), text("body")],
  localized: false,
  ...over,
});
const registry = (over: Partial<RegistryEntity> = {}): RegistryEntity => ({
  kind: "collection",
  slug: "posts",
  tableName: "dc_posts",
  fields: [text("title"), text("body")],
  localized: false,
  source: "code",
  locked: true,
  migrationStatus: "applied",
  ...over,
});
const snapshot = (over: Partial<SnapshotEntity> = {}): SnapshotEntity => ({
  kind: "collection",
  slug: "posts",
  source: "code",
  fields: [text("title"), number("body")],
  localized: false,
  ...over,
});

const only = (entities: ReturnType<typeof resolveRepairEntities>) => {
  expect(entities).toHaveLength(1);
  return entities[0];
};

describe("resolveRepairEntities: where the applied definition comes from", () => {
  it("takes the newest applied snapshot over the registry row and the configuration", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [configured()],
        registry: [registry()],
        snapshots: [snapshot()],
      })
    );
    expect(entity?.applied.source).toBe("snapshot");
    expect(entity?.applied.fields).toEqual([text("title"), number("body")]);
    expect(entity?.configured?.fields).toEqual([text("title"), text("body")]);
    expect(entity?.awaitingMigration).toBe(false);
  });

  // Pinned for the change that makes `nextly migrate` write registry rows from the applied
  // snapshots: until then a code-first row is rewritten from the configuration at every start, so
  // it can hold a definition no migration has applied. The snapshot must keep winning; once the
  // registry is written from the snapshots the two agree and this fallback gives the same answer.
  it("falls back to the registry row only where no applied snapshot records the entity", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [configured()],
        registry: [registry({ fields: [text("title"), number("body")] })],
        snapshots: [],
      })
    );
    expect(entity?.applied.source).toBe("registry");
    expect(entity?.applied.fields).toEqual([text("title"), number("body")]);
    expect(entity?.awaitingMigration).toBe(false);
  });

  it("marks a registry row waiting for a migration, with no applied snapshot, as awaiting it", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [],
        registry: [
          registry({ source: "ui", locked: false, migrationStatus: "pending" }),
        ],
        snapshots: [],
      })
    );
    expect(entity?.awaitingMigration).toBe(true);
  });

  it("does not mark a pending registry row as awaiting when an applied snapshot says what was applied", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [],
        registry: [
          registry({
            source: "ui",
            locked: false,
            migrationStatus: "pending",
            fields: [text("title"), text("body")],
          }),
        ],
        snapshots: [snapshot({ source: "builder" })],
      })
    );
    expect(entity?.awaitingMigration).toBe(false);
    expect(entity?.applied.source).toBe("snapshot");
    // A Builder entity is not in the configuration: its configured definition is the row the
    // Builder saved, which the pending migration has not applied yet.
    expect(entity?.configured?.fields).toEqual([text("title"), text("body")]);
  });

  it("uses the configuration where neither a snapshot nor a registry row records the entity", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [configured()],
        registry: [],
        snapshots: [],
      })
    );
    expect(entity?.applied.source).toBe("configuration");
    expect(entity?.table).toBe("dc_posts");
  });

  it("leaves a code-first entity the configuration no longer declares without a configured definition", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [],
        registry: [registry()],
        snapshots: [snapshot()],
      })
    );
    expect(entity?.configured).toBeNull();
  });
});

describe("resolveRepairEntities: which builder made the table, and who owns it", () => {
  it.each([
    [{ source: "ui", locked: false }, "collection", "collection"],
    [{ source: "ui", locked: false }, "fieldGroup", "fieldGroup"],
    [{ source: "code", locked: true }, "collection", "codeFirst"],
    [{ source: "plugin:seo-kit", locked: false }, "single", "codeFirst"],
  ] as const)(
    "a registry row %o of kind %s was built by %s",
    (row, kind, origin) => {
      const entity = only(
        resolveRepairEntities({
          configured: [],
          registry: [registry({ ...row, kind })],
          snapshots: [],
        })
      );
      expect(entity?.origin).toBe(origin);
    }
  );

  it("reads a Builder entity from its snapshot record when it has no registry row", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [],
        registry: [],
        snapshots: [snapshot({ source: "builder", table: "dc_posts" })],
      })
    );
    expect(entity?.origin).toBe("collection");
  });

  it("names the plugin a registry row records as the owner", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [],
        registry: [registry({ source: "plugin:seo-kit", locked: true })],
        snapshots: [],
      })
    );
    expect(entity?.plugin).toBe("seo-kit");
  });

  it("names the plugin the configuration says contributed the entity", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [configured({ plugin: "seo-kit" })],
        registry: [],
        snapshots: [],
      })
    );
    expect(entity?.plugin).toBe("seo-kit");
  });

  it("keeps a collection and a Single of one slug apart", () => {
    const entities = resolveRepairEntities({
      configured: [
        configured(),
        configured({ kind: "single", table: "single_posts" }),
      ],
      registry: [],
      snapshots: [],
    });
    expect(entities.map(e => [e.kind, e.table])).toEqual([
      ["collection", "dc_posts"],
      ["single", "single_posts"],
    ]);
  });
});

describe("resolveRepairEntities: user fields", () => {
  it("judges user_ext against the stored user field definitions, by the user-extension builder", () => {
    const entities = resolveRepairEntities({
      configured: [],
      registry: [],
      snapshots: [],
      userFields: [number("score")],
    });
    expect(entities).toEqual([
      {
        kind: "userFields",
        slug: "users",
        table: "user_ext",
        origin: "userFields",
        applied: {
          fields: [number("score")],
          localized: false,
          source: "registry",
        },
        configured: null,
        awaitingMigration: false,
      },
    ]);
  });
});
