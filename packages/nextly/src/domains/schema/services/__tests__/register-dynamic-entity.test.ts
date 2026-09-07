/**
 * A localized entity is TWO Drizzle tables, and registering one is not
 * registering it.
 *
 * The main table omits the translatable columns — they live in
 * `<table>_locales` — so a caller that registers only the main one leaves every
 * localized read and write addressing a table without the columns it needs. And
 * nothing downstream repairs that: `ensureSingleRuntimeTable` ADOPTS an existing
 * registration when both tables are present rather than rebuilding it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerDynamicEntitySchema } from "../register-dynamic-entity";

vi.mock("../runtime-schema-generator", () => ({
  generateRuntimeSchema: () => ({ table: { __main: true } }),
}));

const ensureCompanionTable = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../i18n/runtime/companion-io", () => ({ ensureCompanionTable }));

vi.mock("../../../i18n/runtime/companion-registration", () => ({
  buildCompanionRuntimeTable: ({ tableName }: { tableName: string }) => ({
    companionTableName: `${tableName}_locales`,
    table: { __companion: true },
  }),
}));

function registryStub() {
  const registered: string[] = [];
  return {
    registered,
    registry: {
      registerDynamicSchema: (name: string) => registered.push(name),
    } as never,
  };
}

const base = {
  adapter: {} as never,
  dialect: "postgresql" as const,
  tableName: "ds_settings",
  fields: [],
  status: false,
  builderOwned: undefined,
};

describe("registerDynamicEntitySchema", () => {
  // Cleared per case: the mock is module-scoped, so one test's calls would
  // otherwise satisfy the next one's "was not called" assertion.
  beforeEach(() => ensureCompanionTable.mockClear());

  it("registers the main table AND the companion for a localized entity", async () => {
    const { registry, registered } = registryStub();

    await registerDynamicEntitySchema({
      ...base,
      registry,
      kind: "single",
      localized: true,
    });

    expect(registered).toEqual(["ds_settings", "ds_settings_locales"]);
  });

  it("registers only the main table when the entity is not localized", async () => {
    // The control. Registering a companion unconditionally would satisfy the
    // case above while creating a `_locales` table for every entity that has
    // no translations to put in one.
    const { registry, registered } = registryStub();

    await registerDynamicEntitySchema({
      ...base,
      registry,
      kind: "single",
      localized: false,
    });

    expect(registered).toEqual(["ds_settings"]);
    expect(ensureCompanionTable).not.toHaveBeenCalled();
  });

  it("asks about the owner its OWN kind implies", async () => {
    // A single and a collection are built by different services when the
    // Builder owns them, and their creators size a text column differently --
    // so the companion's DDL depends on this being the row's real kind.
    const { registry } = registryStub();

    await registerDynamicEntitySchema({
      ...base,
      registry,
      kind: "collection",
      tableName: "dc_posts",
      localized: true,
    });

    const [, opts] = ensureCompanionTable.mock.calls[0] as unknown as [
      unknown,
      { builtBy: string; tableName: string },
    ];
    expect(opts.tableName).toBe("dc_posts");
    expect(opts.builtBy).toBeDefined();
  });
});
