/**
 * The ownership policy.
 *
 * The transfer refusal is the load-bearing one: a silent owner change is how
 * one plugin takes over another's table, and the damage shows up later as an
 * uninstall dropping data it no longer appears to own.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  createOwnerRegistry,
  type OwnerRecord,
  type OwnerRegistryStore,
} from "../owner-registry";

const row = (over: Partial<OwnerRecord> = {}): OwnerRecord => ({
  tableName: "fx__notes",
  ownerKind: "plugin",
  ownerId: "fx",
  migratedBy: "plugin:fx",
  ownerVersion: "1.0.0",
  schemaVersion: 1,
  state: "active",
  ...over,
});

function store(initial: OwnerRecord[] = []) {
  let rows = [...initial];
  const impl: OwnerRegistryStore = {
    read: names =>
      Promise.resolve(
        names ? rows.filter(r => names.includes(r.tableName)) : [...rows]
      ),
    upsert: incoming => {
      for (const next of incoming) {
        const at = rows.findIndex(r => r.tableName === next.tableName);
        if (at === -1) rows.push(next);
        else rows[at] = next;
      }
      return Promise.resolve();
    },
    deleteByOwner: ownerId => {
      rows = rows.filter(r => r.ownerId !== ownerId);
      return Promise.resolve();
    },
  };
  return { impl, all: () => rows };
}

describe("round trip", () => {
  it("records and reads back a row", async () => {
    const s = store();
    const registry = createOwnerRegistry(s.impl);
    await registry.record([row()]);
    expect(await registry.get("fx__notes")).toMatchObject({
      ownerId: "fx",
      migratedBy: "plugin:fx",
    });
  });

  it("returns null for a table nobody has claimed", async () => {
    // The control, and the rule that keeps data: absence means "unclaimed",
    // and no path in this plan drops an unclaimed table.
    const registry = createOwnerRegistry(store().impl);
    expect(await registry.get("someone_elses_table")).toBeNull();
  });

  it("separates who DECLARED a table from which stream MIGRATES it", async () => {
    // A plugin-contributed collection: declared by the plugin, migrated by
    // the app. One "owner" column would have to be wrong about one of them.
    const s = store();
    const registry = createOwnerRegistry(s.impl);
    await registry.record([
      row({
        tableName: "dc_forms",
        ownerKind: "collection",
        ownerId: "form-builder",
        migratedBy: "app",
      }),
    ]);
    const record = await registry.get("dc_forms");
    expect(record?.ownerId).toBe("form-builder");
    expect(record?.migratedBy).toBe("app");
  });
});

describe("owner changes", () => {
  it("refuses to move a table to a different owner", async () => {
    const s = store([row()]);
    const registry = createOwnerRegistry(s.impl);
    await expect(
      registry.record([row({ ownerId: "impostor" })])
    ).rejects.toThrow(NextlyError);
  });

  it("allows the same owner to update its own row", async () => {
    // The discriminator: a check that refused every upsert would pass the
    // test above and make the registry unwritable.
    const s = store([row()]);
    const registry = createOwnerRegistry(s.impl);
    await registry.record([row({ schemaVersion: 2 })]);
    expect((await registry.get("fx__notes"))?.schemaVersion).toBe(2);
  });

  it("allows an explicit transfer", async () => {
    const s = store([row()]);
    const registry = createOwnerRegistry(s.impl);
    await registry.record([row({ ownerId: "successor" })], { transfer: true });
    expect((await registry.get("fx__notes"))?.ownerId).toBe("successor");
  });
});

describe("setState", () => {
  it("affects only the named owner's rows", async () => {
    const s = store([
      row(),
      row({ tableName: "other__things", ownerId: "other" }),
    ]);
    const registry = createOwnerRegistry(s.impl);
    await registry.setState("fx", "uninstalled");

    expect(s.all().find(r => r.tableName === "fx__notes")?.state).toBe(
      "uninstalled"
    );
    // The sibling must be untouched: marking another plugin's tables
    // uninstalled on the strength of a name is how data gets dropped.
    expect(s.all().find(r => r.tableName === "other__things")?.state).toBe(
      "active"
    );
  });
});

describe("appliedSchemaVersion", () => {
  it("reports the highest version across an owner's tables", async () => {
    // Highest, not first: an owner with several tables applied across
    // releases has a row each, and the newest decides whether it is behind.
    const s = store([
      row({ tableName: "fx__a", schemaVersion: 1 }),
      row({ tableName: "fx__b", schemaVersion: 3 }),
      row({ tableName: "fx__c", schemaVersion: null }),
    ]);
    const registry = createOwnerRegistry(s.impl);
    expect(await registry.appliedSchemaVersion("fx")).toBe(3);
  });

  it("is null for an owner with no versions recorded", async () => {
    const registry = createOwnerRegistry(store().impl);
    expect(await registry.appliedSchemaVersion("fx")).toBeNull();
  });
});

describe("remove", () => {
  it("drops only that owner's rows", async () => {
    const s = store([
      row(),
      row({ tableName: "other__things", ownerId: "other" }),
    ]);
    const registry = createOwnerRegistry(s.impl);
    await registry.remove("fx");
    expect(s.all().map(r => r.ownerId)).toEqual(["other"]);
  });
});
