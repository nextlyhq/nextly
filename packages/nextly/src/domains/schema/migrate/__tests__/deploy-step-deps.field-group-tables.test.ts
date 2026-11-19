/**
 * The translations-column check `nextly migrate` and a production start make before the registry
 * records a run (`beforeMetadata`) finds each field group's translations table beside the table
 * the group is stored in.
 *
 * On a site whose field-group storage was migrated a group's table is `fg_<slug>` and its
 * translations table `fg_<slug>_locales`. Derived from the slug alone, the check looked for
 * `comp_<slug>_locales`, found nothing, and judged nothing: a translated field the column there
 * could not hold went through to the registry.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Where the check would look for each group's translations table, by slug. */
const judged = vi.hoisted(() => ({
  tableOf: undefined as ((slug: string) => string) | undefined,
}));
vi.mock("../../../i18n/runtime/companion-io", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../i18n/runtime/companion-io")
  >()),
  refuseCompanionColumnsThatCannotHold: vi.fn(
    async (
      _adapter: unknown,
      _config: unknown,
      _recordedBefore: unknown,
      fieldGroupTable?: (slug: string) => string
    ) => {
      judged.tableOf = fieldGroupTable;
    }
  ),
}));

// No file is pending, so the check runs.
vi.mock("../../../../cli/commands/migrate", () => ({
  findPendingFiles: vi.fn(async () => []),
}));

// The registry holds `card` under its migrated table.
vi.mock(
  "../../../field-groups/services/field-group-stored-tables",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../field-groups/services/field-group-stored-tables")
    >()),
    readStoredFieldGroupTables: vi.fn(async () => ({
      tables: new Map([["card", "fg_card"]]),
      usable: true,
      naming: "current",
    })),
  })
);

import { deployStepDeps } from "../deploy-step-deps";

beforeEach(() => {
  judged.tableOf = undefined;
});

describe("the translations-column check before the registry records a run", () => {
  it("looks for each field group's translations beside the table it is stored in", async () => {
    const steps = deployStepDeps({
      adapter: {} as DrizzleAdapter,
      db: {},
      dialect: "postgresql",
      migrationsDir: "/project/migrations",
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
      } as never,
      config: { collections: [], fieldGroups: [{ slug: "card" }] } as never,
      recordedBefore: {
        collections: {},
        singles: {},
        fieldGroups: {},
      } as never,
    });

    await steps.beforeMetadata?.();

    expect(judged.tableOf?.("card")).toBe("fg_card");
    // A group the registry does not hold yet takes its slug's name under the site's naming.
    expect(judged.tableOf?.("badge")).toBe("fg_badge");
  });
});
