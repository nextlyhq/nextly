import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import {
  buildDataMigrationSteps,
  settleRegistryDefinitionsStep,
  FIELD_GROUP_STORAGE_VOCABULARY,
  LEGACY_STORAGE_VOCABULARY,
} from "../data-steps";
import { MIGRATION_TARGET } from "../manifest";
import type { MigrationStep } from "../runner";

import { createTableWorld, type TableFixture } from "./helpers/table-world";

const RUN = "run-1";

/** A dynamic zone and an embedded group, as a registry stores them. */
function storedFields(): unknown[] {
  return [
    { name: "blocks", type: "component", components: ["hero", "cta"] },
    { name: "seo", type: "component", component: "seo" },
    { name: "title", type: "text" },
  ];
}

function registry(rows: Record<string, unknown>[]): TableFixture {
  return { columns: ["id", "fields", "configPath"], rows };
}

function world(over: Record<string, TableFixture> = {}) {
  return createTableWorld({
    dynamic_collections: registry([
      { id: "c1", fields: storedFields(), configPath: "collections/post.ts" },
    ]),
    dynamic_singles: registry([
      { id: "s1", fields: storedFields(), configPath: "singles/home.ts" },
    ]),
    [STORAGE_FORMAT.registryTable]: registry([
      { id: "f1", fields: storedFields(), configPath: "components/hero.ts" },
    ]),
    nextly_schema_events: {
      columns: ["id", "scopeKind"],
      rows: [
        { id: "e1", scopeKind: "component" },
        { id: "e2", scopeKind: "collection" },
        { id: "e3", scopeKind: "core" },
      ],
    },
    nextly_versions: {
      columns: ["id", "snapshot"],
      rows: [{ id: "v1", snapshot: { _componentType: "hero" } }],
    },
    nextly_events: {
      columns: ["id", "payload"],
      rows: [{ id: "n1", payload: { data: { _componentType: "cta" } } }],
    },
    ...over,
  });
}

function steps(target: ReturnType<typeof world>): MigrationStep[] {
  return buildDataMigrationSteps({
    meta: target.meta,
    migrationId: RUN,
    from: LEGACY_STORAGE_VOCABULARY,
    to: FIELD_GROUP_STORAGE_VOCABULARY,
  });
}

function stepNamed(
  target: ReturnType<typeof world>,
  id: string
): MigrationStep {
  const step = steps(target).find(candidate => candidate.id === id);
  if (step === undefined) throw new Error(`no step named ${id}`);
  return step;
}

describe("the vocabularies a data rewrite travels between", () => {
  it("pairs every stored spelling with its replacement", () => {
    expect(LEGACY_STORAGE_VOCABULARY).toEqual({
      configPathDir: "components",
      fields: {
        fieldType: "component",
        refKeys: {
          single: "component",
          many: "components",
          legacy: "componentSlug",
        },
      },
      wireTypeKey: "_componentType",
      schemaEventScope: "component",
    });
    expect(FIELD_GROUP_STORAGE_VOCABULARY).toEqual({
      configPathDir: "field-groups",
      fields: {
        fieldType: "fieldGroup",
        refKeys: { single: "fieldGroup", many: "fieldGroups" },
      },
      wireTypeKey: "_fieldGroupType",
      schemaEventScope: "fieldGroup",
    });
  });

  // The compatibility key is retired rather than renamed, so the target side has
  // no counterpart for a rollback to put back.
  it("gives the target vocabulary no legacy reference key", () => {
    expect(
      FIELD_GROUP_STORAGE_VOCABULARY.fields.refKeys.legacy
    ).toBeUndefined();
  });
});

describe("rewriting the vocabulary stored in registry rows", () => {
  it("rewrites field definitions in every registry", async () => {
    const target = world();
    await stepNamed(target, "data:registry-definitions").run(target.session);

    for (const table of [
      "dynamic_collections",
      "dynamic_singles",
      STORAGE_FORMAT.registryTable,
    ]) {
      expect(target.rows(table)[0]?.fields).toEqual([
        { name: "blocks", type: "fieldGroup", fieldGroups: ["hero", "cta"] },
        { name: "seo", type: "fieldGroup", fieldGroup: "seo" },
        { name: "title", type: "text" },
      ]);
    }
  });

  it("rewrites the field-group registry's config path", async () => {
    const target = world();
    await stepNamed(target, "data:registry-definitions").run(target.session);
    expect(target.rows(STORAGE_FORMAT.registryTable)[0]?.configPath).toBe(
      "field-groups/hero.ts"
    );
  });

  // 🔴 The gate is the TABLE, not the string. A collection's `config_path`
  // names the collections directory, and a rewrite that matched on the leading
  // segment alone would rename a directory this migration has nothing to do
  // with. Given a collection whose path starts with the same segment, only the
  // table check keeps it intact.
  it("leaves another registry's config path alone even when it looks the same", async () => {
    const target = world({
      dynamic_collections: registry([
        { id: "c1", fields: [], configPath: "components/post.ts" },
      ]),
    });
    await stepNamed(target, "data:registry-definitions").run(target.session);
    expect(target.rows("dynamic_collections")[0]?.configPath).toBe(
      "components/post.ts"
    );
  });

  it("writes nothing for rows that are already right", async () => {
    const target = world();
    const step = stepNamed(target, "data:registry-definitions");
    await step.run(target.session);
    const after = target.counts.updates;
    await step.run(target.session);
    expect(target.counts.updates).toBe(after);
  });

  // A half-rewritten definition set is a database whose entities disagree about
  // what a field group is, so all three registries move together or not at all.
  it("moves all three registries in one transaction", async () => {
    const target = world();
    const before = target.counts.transactions;
    await stepNamed(target, "data:registry-definitions").run(target.session);
    expect(target.counts.transactions).toBe(before + 1);
  });

  it("fails its postcondition before it runs and passes after", async () => {
    const target = world();
    const step = stepNamed(target, "data:registry-definitions");
    await expect(step.verify(target.session)).resolves.toBe(false);
    await step.run(target.session);
    await expect(step.verify(target.session)).resolves.toBe(true);
  });

  // 🔴 A refusal has to leave the transaction as a value, because an exception
  // is reclassified at the boundary and loses its context - but a value RETURNED
  // from the callback commits. So every patch is staged before any is issued:
  // otherwise a bad row late in the set would commit the rows rewritten before
  // it, leaving exactly the mixed-vocabulary registries this step prevents.
  it("writes nothing at all when a later row cannot be read", async () => {
    const target = world({
      // Read third, and missing `fields` - so the first two registries have
      // already produced patches by the time this one refuses.
      [STORAGE_FORMAT.registryTable]: {
        columns: ["id", "configPath"],
        rows: [{ id: "f1", configPath: "components/hero.ts" }],
      },
    });

    await expect(
      stepNamed(target, "data:registry-definitions").run(target.session)
    ).rejects.toMatchObject({
      logContext: {
        reason: "row rewrite target names a property the table does not have",
      },
    });

    // The registries read before the refusal are untouched.
    expect(target.rows("dynamic_collections")[0]?.fields).toEqual(
      storedFields()
    );
    expect(target.rows("dynamic_singles")[0]?.fields).toEqual(storedFields());
    expect(target.counts.updates).toBe(0);
  });

  // Same hazard as the ledger walk: a plain SELECT takes no lock, and the update
  // writes the whole `fields` document back, so a schema save committing in
  // between would be overwritten rather than merged.
  it("locks the registry rows it is about to rewrite", async () => {
    const target = world();
    await stepNamed(target, "data:registry-definitions").run(target.session);
    const registryReads = target.reads.filter(read =>
      [
        "dynamic_collections",
        "dynamic_singles",
        STORAGE_FORMAT.registryTable,
      ].includes(read.table)
    );
    expect(registryReads).not.toHaveLength(0);
    expect(registryReads.every(read => read.forUpdate)).toBe(true);
  });

  // 🔴 The ordering invariant, expressed as behaviour. These steps run before
  // any rename, so the registry is addressed under the name the ORM declares.
  // A world holding only the migrated name is the state they must NOT work in,
  // and the adapter refuses a table it cannot resolve rather than inventing one.
  it("addresses the registry under the name it has before any rename", async () => {
    const renamed = createTableWorld({
      dynamic_collections: registry([
        { id: "c1", fields: storedFields(), configPath: "collections/post.ts" },
      ]),
      dynamic_singles: registry([
        { id: "s1", fields: storedFields(), configPath: "singles/home.ts" },
      ]),
      [MIGRATION_TARGET.registryTable]: registry([
        { id: "f1", fields: storedFields(), configPath: "components/hero.ts" },
      ]),
    });

    await expect(
      stepNamed(renamed, "data:registry-definitions").run(renamed.session)
    ).rejects.toThrow(/not found in schema registry/);
  });
});

describe("re-checking the registries once the renames have run", () => {
  /** A world as it stands after an upward run has renamed the registry. */
  function migrated() {
    return createTableWorld({
      dynamic_collections: registry([
        { id: "c1", fields: storedFields(), configPath: "collections/post.ts" },
      ]),
      dynamic_singles: registry([
        { id: "s1", fields: storedFields(), configPath: "singles/home.ts" },
      ]),
      [MIGRATION_TARGET.registryTable]: registry([
        { id: "f1", fields: storedFields(), configPath: "components/hero.ts" },
      ]),
    });
  }

  function settleStep(registryTable: string): MigrationStep {
    return settleRegistryDefinitionsStep({
      from: LEGACY_STORAGE_VOCABULARY,
      to: FIELD_GROUP_STORAGE_VOCABULARY,
      resolveRegistryTable: async () => registryTable,
    });
  }

  // 🔴 The whole point of the step. Going up it runs AFTER the registry rename,
  // so the name the plan was assembled with is gone. The data step refuses in
  // this exact world — the test directly above proves it — and this one must
  // not, which is what makes the resolver load-bearing rather than decorative.
  it("rewrites a registry that exists only under its migrated name", async () => {
    const target = migrated();
    const step = settleStep(MIGRATION_TARGET.registryTable);

    await expect(step.verify(target.session)).resolves.toBe(false);
    await step.run(target.session);
    await expect(step.verify(target.session)).resolves.toBe(true);

    expect(target.rows(MIGRATION_TARGET.registryTable)[0]?.fields).toEqual([
      { name: "blocks", type: "fieldGroup", fieldGroups: ["hero", "cta"] },
      { name: "seo", type: "fieldGroup", fieldGroup: "seo" },
      { name: "title", type: "text" },
    ]);
  });

  // 🔴 `config_path` is rewritten only for the field-group registry, and that
  // gate is a comparison against a table name. Under the migrated spelling a
  // comparison against the legacy name alone is false, so the path would stop
  // being rewritten at precisely the moment this check exists to cover. Nothing
  // else in this suite reads the path under the migrated name.
  it("rewrites the config path under the migrated name too", async () => {
    const target = migrated();
    await settleStep(MIGRATION_TARGET.registryTable).run(target.session);
    expect(target.rows(MIGRATION_TARGET.registryTable)[0]?.configPath).toBe(
      "field-groups/hero.ts"
    );
  });

  // The collection and single registries are never renamed and their services
  // keep writing while a run is in flight, so a definition landing after the
  // data step verified sits in a surface no later step revisits.
  it("sees a legacy definition written into an un-renamed registry", async () => {
    const target = migrated();
    const step = settleStep(MIGRATION_TARGET.registryTable);
    await step.run(target.session);
    await expect(step.verify(target.session)).resolves.toBe(true);

    target.insert("dynamic_collections", {
      id: "c2",
      fields: storedFields(),
      configPath: "collections/late.ts",
    });

    await expect(step.verify(target.session)).resolves.toBe(false);
  });

  // Resolved per call rather than once, so a retry after storage moved again
  // addresses what is there now instead of what was there when it was built.
  it("asks which registry to address on every call", async () => {
    const target = migrated();
    let asked = 0;
    const step = settleRegistryDefinitionsStep({
      from: LEGACY_STORAGE_VOCABULARY,
      to: FIELD_GROUP_STORAGE_VOCABULARY,
      resolveRegistryTable: async () => {
        asked += 1;
        return MIGRATION_TARGET.registryTable;
      },
    });

    await step.run(target.session);
    await step.verify(target.session);
    expect(asked).toBe(2);
  });

  // The control. A run whose registries are already right settles rather than
  // refusing, without which every assertion above passes for a step that simply
  // always reports work outstanding.
  it("settles a run whose registries are already rewritten", async () => {
    const target = migrated();
    const step = settleStep(MIGRATION_TARGET.registryTable);
    await step.run(target.session);
    await step.run(target.session);
    await expect(step.verify(target.session)).resolves.toBe(true);
  });
});

describe("rewriting the scope a schema event records", () => {
  it("moves only the field-group scope", async () => {
    const target = world();
    await stepNamed(target, "data:schema-event-scope").run(target.session);
    expect(
      target.rows("nextly_schema_events").map(row => row.scopeKind)
    ).toEqual(["fieldGroup", "collection", "core"]);
  });

  it("fails its postcondition before it runs and passes after", async () => {
    const target = world();
    const step = stepNamed(target, "data:schema-event-scope");
    await expect(step.verify(target.session)).resolves.toBe(false);
    await step.run(target.session);
    await expect(step.verify(target.session)).resolves.toBe(true);
  });
});

describe("rewriting the wire key inside the ledgers", () => {
  it.each([
    ["data:nextly_versions.snapshot", "nextly_versions", "snapshot"],
    ["data:nextly_events.payload", "nextly_events", "payload"],
  ])("rewrites %s", async (stepId, table, property) => {
    const target = world();
    const step = stepNamed(target, stepId);
    await step.run(target.session);
    await expect(step.verify(target.session)).resolves.toBe(true);
    expect(JSON.stringify(target.rows(table)[0]?.[property])).toContain(
      "_fieldGroupType"
    );
  });

  // A row the walk did not reach is not "not finished yet" — the walk ran to the
  // end of the table — so this refuses and names the row rather than reporting a
  // postcondition that a retry would silently re-attempt.
  it("refuses, naming the row, when one was left behind", async () => {
    const target = world();
    const step = stepNamed(target, "data:nextly_versions.snapshot");
    await step.run(target.session);
    target.insert("nextly_versions", {
      id: "v2",
      snapshot: { _componentType: "late" },
    });

    await expect(step.verify(target.session)).rejects.toMatchObject({
      logContext: {
        reason: "row rewrite did not reach every row",
        table: "nextly_versions",
        row: "v2",
      },
    });
  });
});

describe("the shape of the data plan", () => {
  // Step ids key each ledger's durable cursor, so they are part of the format a
  // resume reads and not merely labels.
  it("names its steps stably, in canonical order", () => {
    const target = world();
    expect(steps(target).map(step => step.id)).toEqual([
      "data:registry-definitions",
      "data:schema-event-scope",
      "data:nextly_versions.snapshot",
      "data:nextly_events.payload",
    ]);
  });

  it("reverses when the vocabularies are exchanged", async () => {
    const target = world();
    for (const step of steps(target)) await step.run(target.session);

    const down = buildDataMigrationSteps({
      meta: target.meta,
      migrationId: "run-2",
      from: FIELD_GROUP_STORAGE_VOCABULARY,
      to: LEGACY_STORAGE_VOCABULARY,
    });
    for (const step of [...down].reverse()) await step.run(target.session);

    expect(target.rows(STORAGE_FORMAT.registryTable)[0]).toEqual({
      id: "f1",
      // `component` rather than `componentSlug`: the compatibility key is
      // retired on the way up and never minted again on the way back.
      fields: storedFields(),
      configPath: "components/hero.ts",
    });
    expect(target.rows("nextly_versions")[0]?.snapshot).toEqual({
      _componentType: "hero",
    });
    expect(target.rows("nextly_schema_events")[0]?.scopeKind).toBe("component");
  });
});
