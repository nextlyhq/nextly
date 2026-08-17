import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import {
  buildDataMigrationSteps,
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
  // Membership is the claim that the runtime can still read a value after it
  // moves, so the pair is asserted whole rather than key by key: a spelling
  // added here without its accessor is the failure this guards, and a test that
  // only checked the keys it knew about would not see the new one.
  it("carries only the spelling the runtime can read after it moves", () => {
    expect(LEGACY_STORAGE_VOCABULARY).toEqual({
      wireTypeKey: "_componentType",
    });
    expect(FIELD_GROUP_STORAGE_VOCABULARY).toEqual({
      wireTypeKey: "_fieldGroupType",
    });
  });
});

describe("the vocabulary this migration must NOT move", () => {
  // Stored field definitions are read through `STORAGE_FORMAT` by code that
  // accepts no other spelling, so rewriting them leaves definitions the runtime
  // cannot read: boot validation rejects every field-group field and the
  // application exits. The whole plan runs here, rather than one step, because
  // the property is about what the migration leaves behind and any step could
  // break it.
  it("leaves every stored field definition exactly as it found it", async () => {
    const target = world();
    const before = JSON.stringify(
      [
        "dynamic_collections",
        "dynamic_singles",
        STORAGE_FORMAT.registryTable,
      ].map(table => target.rows(table))
    );

    for (const step of steps(target)) await step.run(target.session);

    expect(
      JSON.stringify(
        [
          "dynamic_collections",
          "dynamic_singles",
          STORAGE_FORMAT.registryTable,
        ].map(table => target.rows(table))
      )
    ).toBe(before);
  });

  // Named separately from the whole-row comparison above so a failure says which
  // spelling moved. `type` is the one that stops the application booting.
  it("leaves a field-group field's type and reference keys legacy", async () => {
    const target = world();
    for (const step of steps(target)) await step.run(target.session);

    expect(target.rows(STORAGE_FORMAT.registryTable)[0]?.fields).toEqual(
      storedFields()
    );
  });

  // `read-journal.ts` matches this column against the legacy spelling to decide
  // an event's scope, so a migrated value loses the attribution silently.
  it("leaves a schema event's scope legacy", async () => {
    const target = world();
    for (const step of steps(target)) await step.run(target.session);

    expect(
      target.rows("nextly_schema_events").map(row => row.scopeKind)
    ).toEqual(["component", "collection", "core"]);
  });

  // Nothing compares this value on read and the code sync rewrites it on the
  // next boot, so moving it would be churn a settlement check then chases.
  it("leaves the field-group registry's config path legacy", async () => {
    const target = world();
    for (const step of steps(target)) await step.run(target.session);

    expect(target.rows(STORAGE_FORMAT.registryTable)[0]?.configPath).toBe(
      "components/hero.ts"
    );
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

    expect(target.rows("nextly_versions")[0]?.snapshot).toEqual({
      _componentType: "hero",
    });
    expect(target.rows("nextly_events")[0]?.payload).toEqual({
      data: { _componentType: "cta" },
    });
  });
});
