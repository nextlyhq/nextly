/**
 * Deleting orphaned field groups must hold a storage migration out for the WHOLE pass.
 *
 * 🔴 The property is an ORDER, and order is what an "it works" test cannot see. This path drops
 * tables and deletes registry rows from a list of table names read BEFORE any of it runs, so a
 * migration renaming `comp_<slug>` to `fg_<slug>` partway through leaves the remaining drops
 * addressing names that no longer exist — silently, because they are `DROP TABLE IF EXISTS`. The
 * field group then survives as a table nothing scans for again.
 *
 * So the assertions are: the exclusion is entered BEFORE the first destructive statement, and it
 * spans every component rather than being taken and released per iteration. Asserting merely that
 * it was called would pass on a guard taken after the first drop, which is the arrangement that
 * fails.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

/** Every observable step, in the order it happened. */
const events: string[] = [];

vi.mock("../../../domains/schema/services/schema-change-exclusion", () => ({
  withSchemaChangeExcluded: vi.fn(
    async (args: { issuesDdl: boolean }, work: () => Promise<unknown>) => {
      events.push(`exclusion:enter(issuesDdl=${String(args.issuesDdl)})`);
      const result = await work();
      events.push("exclusion:exit");
      return result;
    }
  ),
}));

vi.mock(
  "../../../domains/field-groups/services/teardown-entity-field-group-data",
  () => ({ teardownEntityComponentData: vi.fn(async () => undefined) })
);
vi.mock("../../../domains/i18n/migration/teardown-entity-i18n", () => ({
  teardownEntityI18n: vi.fn(async () => undefined),
}));
vi.mock("../../../domains/field-groups/storage/resolve-storage-names", () => ({
  resolveFieldGroupRegistryName: vi.fn(async () => "dynamic_field_groups"),
  resolveTypeColumns: vi.fn(async () => new Map()),
}));

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { handleRemovedComponents } from "../dev-build";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
  newline: vi.fn(),
} as unknown as Parameters<typeof handleRemovedComponents>[2];

const adapter = {
  getCapabilities: () => ({ dialect: "postgresql" }),
  delete: vi.fn(async () => {
    events.push("delete:registry-row");
  }),
  executeQuery: vi.fn(async () => {
    events.push("drop:table");
  }),
} as unknown as DrizzleAdapter;

beforeEach(() => {
  events.length = 0;
});

describe("deleting orphaned field groups", () => {
  it("enters the exclusion before anything destructive happens", async () => {
    await handleRemovedComponents(
      [{ slug: "hero", tableName: "comp_hero" }],
      adapter,
      logger
    );

    // The population first: an empty list would satisfy every ordering assertion below while
    // proving the pass never ran at all.
    expect(events).toContain("delete:registry-row");
    expect(events).toContain("drop:table");

    expect(events.indexOf("exclusion:enter(issuesDdl=true)")).toBe(0);
    expect(events.indexOf("exclusion:enter(issuesDdl=true)")).toBeLessThan(
      events.indexOf("delete:registry-row")
    );
    expect(events.indexOf("exclusion:enter(issuesDdl=true)")).toBeLessThan(
      events.indexOf("drop:table")
    );
  });

  it("holds it across every component rather than per component", async () => {
    await handleRemovedComponents(
      [
        { slug: "hero", tableName: "comp_hero" },
        { slug: "cta", tableName: "comp_cta" },
      ],
      adapter,
      logger
    );

    // Taken once, released once, with both components inside. A per-iteration guard would show two
    // enters — and would leave a migration free to rename between them, which is the whole risk.
    expect(events.filter(e => e.startsWith("exclusion:enter"))).toHaveLength(1);
    expect(events.filter(e => e === "exclusion:exit")).toHaveLength(1);
    expect(events.filter(e => e === "drop:table")).toHaveLength(2);
    expect(events[events.length - 1]).toBe("exclusion:exit");
  });

  it("declares that it may create the lock, because it drops tables", async () => {
    // `issuesDdl` is not cosmetic. With `false`, a first-ever storage migration could create the
    // lock table, claim it, and begin renaming while this pass was already deleting unguarded.
    await handleRemovedComponents(
      [{ slug: "hero", tableName: "comp_hero" }],
      adapter,
      logger
    );

    expect(events).toContain("exclusion:enter(issuesDdl=true)");
    expect(events).not.toContain("exclusion:enter(issuesDdl=false)");
  });
});
