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
  origin: "codeFirst",
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
    expect(entity?.applied?.source).toBe("snapshot");
    expect(entity?.applied?.fields).toEqual([text("title"), number("body")]);
    expect(entity?.configured?.fields).toEqual([text("title"), text("body")]);
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
    expect(entity?.applied?.source).toBe("registry");
    expect(entity?.applied?.fields).toEqual([text("title"), number("body")]);
  });

  it("leaves the applied definition unknown for a registry row waiting for a migration, with no applied snapshot", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [],
        registry: [
          registry({ source: "ui", locked: false, migrationStatus: "pending" }),
        ],
        snapshots: [],
      })
    );
    expect(entity?.applied).toBeNull();
    // What the migration will apply: the row the Builder saved.
    expect(entity?.configured?.fields).toEqual([text("title"), text("body")]);
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
    expect(entity?.applied?.source).toBe("snapshot");
    // A Builder entity is not in the configuration: its configured definition is the row the
    // Builder saved, which the pending migration has not applied yet.
    expect(entity?.configured?.fields).toEqual([text("title"), text("body")]);
  });

  it("leaves an entity only the configuration declares awaiting its migration", () => {
    // No migration file records it and no boot registered it: nothing has been applied, so the
    // configuration is what a migration still has to create, never what the database holds.
    const entity = only(
      resolveRepairEntities({
        configured: [configured()],
        registry: [],
        snapshots: [],
      })
    );
    expect(entity?.applied).toBeNull();
    expect(entity?.configured?.fields).toEqual([text("title"), text("body")]);
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
      expect(entity?.applied?.origin).toBe(origin);
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
    expect(entity?.applied?.origin).toBe("collection");
  });

  it("describes each side by its own owner when code adopts a Builder collection whose migration is pending", () => {
    // The newest applied snapshot still records the Builder's collection; the configuration now
    // declares it in code, and the registry row has already been taken over by code.
    const entity = only(
      resolveRepairEntities({
        configured: [configured()],
        registry: [registry({ source: "code", locked: true })],
        snapshots: [snapshot({ source: "builder", table: "dc_posts" })],
      })
    );
    expect(entity?.applied?.origin).toBe("collection");
    expect(entity?.configured?.origin).toBe("codeFirst");
  });

  it("takes the applied owner from the registry row where no snapshot records the entity", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [],
        registry: [
          registry({ kind: "fieldGroup", source: "ui", locked: false }),
        ],
        snapshots: [],
      })
    );
    expect(entity?.applied?.origin).toBe("fieldGroup");
  });

  it("gives a Builder entity the manifest declares the Builder's owner on its configured side", () => {
    const entity = only(
      resolveRepairEntities({
        configured: [configured({ origin: "collection" })],
        registry: [registry({ source: "ui", locked: false })],
        snapshots: [],
      })
    );
    expect(entity?.configured?.origin).toBe("collection");
    expect(entity?.applied?.origin).toBe("collection");
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
  it("judges user_ext against the stored user field definitions, and compares them with the configured ones", () => {
    const entities = resolveRepairEntities({
      configured: [],
      registry: [],
      snapshots: [],
      userFields: { stored: [number("score")], configured: [text("score")] },
    });
    expect(entities).toEqual([
      {
        kind: "userFields",
        slug: "users",
        table: "user_ext",
        applied: {
          fields: [number("score")],
          localized: false,
          origin: "userFields",
          source: "registry",
        },
        configured: {
          fields: [text("score")],
          localized: false,
          origin: "userFields",
        },
      },
    ]);
  });

  it("leaves user fields awaiting a migration where the database stores no definitions yet", () => {
    const [users] = resolveRepairEntities({
      configured: [],
      registry: [],
      snapshots: [],
      userFields: { stored: null, configured: [text("nickname")] },
    });
    expect(users?.applied).toBeNull();
    expect(users?.configured?.fields).toEqual([text("nickname")]);
  });

  it("has no user fields entity where none is stored or configured", () => {
    expect(
      resolveRepairEntities({
        configured: [],
        registry: [],
        snapshots: [],
        userFields: { stored: null, configured: [] },
      })
    ).toEqual([]);
  });
});
