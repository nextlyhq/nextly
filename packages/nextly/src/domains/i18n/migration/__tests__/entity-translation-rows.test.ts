/**
 * Unit tests for removing a deleted entity's translation rows outside its translations table.
 *
 * Each delete's condition is rendered through Drizzle's PostgreSQL dialect, so the test reads the
 * scope the statement carries, by kind as well as slug, rather than only that a delete was made.
 * The behaviour on real databases is covered by the entity-delete teardown suites, which reach
 * this through `teardownEntityI18n`.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDialectTables } from "../../../../database/dialect-tables";
import { removeEntityTranslationRows } from "../entity-translation-rows";

const calls = vi.hoisted(() => ({ order: [] as string[] }));

// Labelling older archive rows reads the registries; here only its place in the order matters.
vi.mock("../label-legacy-archive-rows", () => ({
  labelLegacyArchiveRows: vi.fn(async () => {
    calls.order.push("label");
  }),
}));
vi.mock("../transition-recorder", () => ({
  resolveTransitionStore: vi.fn(async () => ({ store: "meta" })),
}));
vi.mock("../transition-state", () => ({
  forgetI18nTransition: vi.fn(async () => {
    calls.order.push("forget");
  }),
}));

const { forgetI18nTransition } = await import("../transition-state");

beforeAll(async () => {
  await loadDialectTables("postgresql");
});

beforeEach(() => {
  calls.order = [];
  vi.mocked(forgetI18nTransition).mockClear();
});

/** Each delete made, as the table it named and the condition rendered to SQL and parameters. */
interface MadeDelete {
  table: string;
  sql: string;
  params: unknown[];
}

function makeAdapter(present: (table: string) => boolean, rowCount = 2) {
  const deletes: MadeDelete[] = [];
  const dialect = new PgDialect();
  const adapter = {
    dialect: "postgresql" as const,
    tableExists: vi.fn(async (name: string) => present(name)),
    listTables: vi.fn(async () => []),
    getDrizzle: vi.fn().mockReturnValue({
      delete: (table: unknown) => ({
        where: async (condition: SQL) => {
          const rendered = dialect.sqlToQuery(condition);
          const name = String(
            (table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")]
          );
          deletes.push({
            table: name,
            sql: rendered.sql,
            params: rendered.params,
          });
          calls.order.push(`delete ${name}`);
          return { rowCount };
        },
      }),
    }),
  };
  return { adapter, deletes };
}

describe("removeEntityTranslationRows", () => {
  it("reaches no table that is not there, and removes nothing", async () => {
    const { adapter, deletes } = makeAdapter(() => false);

    const removed = await removeEntityTranslationRows({
      adapter,
      kind: "collection",
      slug: "notes",
    });

    expect(removed).toEqual({ archiveRowsPurged: 0, provenanceRowsPurged: 0 });
    expect(deletes).toEqual([]);
    expect(adapter.getDrizzle).not.toHaveBeenCalled();
    expect(forgetI18nTransition).not.toHaveBeenCalled();
  });

  it("removes a collection's archive rows, transition record and provenance, each by kind and slug", async () => {
    const { adapter, deletes } = makeAdapter(() => true, 3);

    const removed = await removeEntityTranslationRows({
      adapter,
      kind: "collection",
      slug: "notes",
    });

    expect(removed).toEqual({ archiveRowsPurged: 3, provenanceRowsPurged: 3 });
    expect(deletes.map(d => d.table)).toEqual([
      "nextly_i18n_archive",
      "nextly_translation_provenance",
    ]);
    // Scoped by both: a Single or a field group may share the slug.
    expect(deletes[0].params).toEqual(["notes", "collection"]);
    expect(deletes[0].sql).toBe(
      '(("nextly_i18n_archive"."collection" = $1) and ("nextly_i18n_archive"."entity_kind" = $2))'
    );
    expect(deletes[1].params).toEqual(["collection", "notes"]);
    expect(deletes[1].sql).toBe(
      '(("nextly_translation_provenance"."scope_kind" = $1) and ("nextly_translation_provenance"."scope_slug" = $2))'
    );
    expect(forgetI18nTransition).toHaveBeenCalledWith(
      { store: "meta" },
      "collection",
      "notes"
    );
  });

  it("labels older archive rows before it removes any", async () => {
    const { adapter } = makeAdapter(() => true);

    await removeEntityTranslationRows({
      adapter,
      kind: "single",
      slug: "banner",
    });

    expect(calls.order).toEqual([
      "label",
      "delete nextly_i18n_archive",
      "forget",
      "delete nextly_translation_provenance",
    ]);
  });

  it("keeps no provenance for a field group, so removes none, but still its archive rows and transition record", async () => {
    const { adapter, deletes } = makeAdapter(() => true);

    const removed = await removeEntityTranslationRows({
      adapter,
      kind: "fieldGroup",
      slug: "seo",
    });

    expect(removed).toEqual({ archiveRowsPurged: 2, provenanceRowsPurged: 0 });
    expect(deletes.map(d => d.table)).toEqual(["nextly_i18n_archive"]);
    expect(deletes[0].params).toEqual(["seo", "fieldGroup"]);
    expect(forgetI18nTransition).toHaveBeenCalledWith(
      { store: "meta" },
      "fieldGroup",
      "seo"
    );
  });

  it("issues no DDL: it has no statement runner to issue one with", async () => {
    // The adapter surface it takes has no `executeQuery`: its removals are Drizzle deletes and
    // the transition store's row writes, so a caller can run it inside a transaction on MySQL.
    const { adapter } = makeAdapter(() => true);

    await expect(
      removeEntityTranslationRows({ adapter, kind: "collection", slug: "x" })
    ).resolves.toBeDefined();
    expect("executeQuery" in adapter).toBe(false);
  });
});
