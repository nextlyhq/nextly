/**
 * A production start compares nothing with the live schema or the migration
 * ledger, on every dialect, begun by the Direct API and by a request.
 *
 * The database is migrated for the configuration (three collections that each
 * hold a component, a translated collection with a field marked unique, a
 * Single and the component), with one plugin installed.
 * Every statement a production start sends is recorded at the driver
 * (`record-statements`), the work it leaves running after it resolves
 * included (`startSettled`), and each is told apart by the code that asked:
 * the test wraps the few readers a production start keeps, and the schema
 * introspection every comparison goes through, in an AsyncLocalStorage label
 * the recorder reads when the driver is handed the statement.
 *
 * What a production start may still read of the schema and the ledger:
 * - whether a table exists, and which tables there are (the start's own
 *   table creation, which a later change removes, asks this per entity);
 * - the per-language storage layout refusal, which refuses a database laid
 *   out for the other choice of `experimental.perLanguageStorage`;
 * - the column a component's table keeps its discriminator in, which the
 *   start needs to serve the table at all;
 * - the two registry tables, for the rules left in their retired
 *   `access_rules` column;
 * - the plugin readiness check's reads of the ledger;
 * - on SQLite, the one-time timestamp repair, upkeep the start runs after it
 *   resolves, which reads each table's columns to find the timestamps.
 * Anything else that reads a table's shape (the drift check of each
 * collection, the core schema check, the check that a translated unique field
 * has its per-language index) or the ledger fails the test. Each kept
 * reader must also be seen, so none of the exceptions is satisfied by absence.
 *
 * The control: a development start, recorded the same way, still compares
 * each collection with the live schema and reads the translated collection's
 * indexes.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  recordStatements,
  type RecordedStatement,
} from "../../__tests__/helpers/record-statements";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { recordPluginLifecycle } from "../../domains/schema/ownership/plugin-lifecycle-state";
import { getNextly, startSettled } from "../../init";
import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";
import { RETIRED_ACCESS_RULES_TABLES } from "../retired-access-rules";

/** Who asked for a statement, as the wrappers below label it. */
interface Asker {
  /** A reader a production start keeps, by name. */
  kept?:
    | "per-language layout"
    | "component discriminator"
    | "plugin readiness"
    | "sqlite timestamp repair";
  /**
   * A schema introspection: the code that called it (its nearest frames,
   * nearest first) and the tables it read.
   */
  introspection?: { caller: string; tables: readonly string[] };
  /**
   * The check that each translated unique field has its per-language index.
   * Not a reader a production start keeps: labelled so the failure names it,
   * and so the development control can see it ran.
   */
  translatedUniqueCheck?: true;
}

const asking = vi.hoisted(() => {
  const { AsyncLocalStorage } = process.getBuiltinModule(
    "node:async_hooks"
  ) as typeof import("node:async_hooks");
  const store = new AsyncLocalStorage<Asker>();
  /** `fn` with every call run under `label` added to the store it is in. */
  const label =
    (extra: (args: unknown[]) => Asker) =>
    <F extends (...args: never[]) => unknown>(fn: F): F =>
      ((...args: never[]) =>
        store.run({ ...store.getStore(), ...extra(args) }, () =>
          fn(...args)
        )) as F;
  /**
   * The first frames outside the wrapped module and this file, nearest first,
   * so a reader that introspects through a helper is still named.
   */
  const callerOf = (stack: string | undefined, module: string): string =>
    (stack ?? "")
      .split("\n")
      .filter(
        line =>
          line.includes("/src/") &&
          !line.includes(module) &&
          !line.includes("production-start-compares-nothing.integration")
      )
      .slice(0, 3)
      .map(line =>
        line
          .trim()
          .replace(/.*\/src\//, "")
          .replace(/:\d+:\d+\)?$/, "")
      )
      .join(" <- ") || "unknown";
  return { store, label, callerOf };
});

vi.mock("../../domains/i18n/per-language-storage-layout", async original => {
  const actual =
    await original<
      typeof import("../../domains/i18n/per-language-storage-layout")
    >();
  return {
    ...actual,
    refuseMixedStorage: asking.label(() => ({ kept: "per-language layout" }))(
      actual.refuseMixedStorage
    ),
  };
});
vi.mock(
  "../../domains/field-groups/storage/resolve-storage-names",
  async original => {
    const actual =
      await original<
        typeof import("../../domains/field-groups/storage/resolve-storage-names")
      >();
    const kept = asking.label(() => ({ kept: "component discriminator" }));
    return {
      ...actual,
      resolveKnownTypeColumns: kept(actual.resolveKnownTypeColumns),
      resolveTypeColumns: kept(actual.resolveTypeColumns),
    };
  }
);
vi.mock(
  "../../domains/schema/ownership/schema-version-check",
  async original => {
    const actual =
      await original<
        typeof import("../../domains/schema/ownership/schema-version-check")
      >();
    return {
      ...actual,
      assertPluginSchemaVersionsUsable: asking.label(() => ({
        kept: "plugin readiness",
      }))(actual.assertPluginSchemaVersionsUsable),
    };
  }
);
vi.mock(
  "../../domains/schema/ownership/plugin-install-gate",
  async original => {
    const actual =
      await original<
        typeof import("../../domains/schema/ownership/plugin-install-gate")
      >();
    return {
      ...actual,
      assertBootPluginsInstalled: asking.label(() => ({
        kept: "plugin readiness",
      }))(actual.assertBootPluginsInstalled),
    };
  }
);
// The one-time repair of SQLite timestamps, upkeep the start runs after it
// resolves: it reads each table's columns to find the timestamps to repair,
// and compares nothing with the configuration.
vi.mock("../../database/repair-sqlite-timestamps", async original => {
  const actual =
    await original<typeof import("../../database/repair-sqlite-timestamps")>();
  return {
    ...actual,
    repairSqliteTimestamps: asking.label(() => ({
      kept: "sqlite timestamp repair",
    }))(actual.repairSqliteTimestamps),
  };
});
vi.mock(
  "../../domains/i18n/runtime/translated-unique-boot-check",
  async original => {
    const actual =
      await original<
        typeof import("../../domains/i18n/runtime/translated-unique-boot-check")
      >();
    return {
      ...actual,
      warnAboutUnindexedTranslatedUnique: asking.label(() => ({
        translatedUniqueCheck: true,
      }))(actual.warnAboutUnindexedTranslatedUnique),
    };
  }
);
// Every introspection, labelled with the code that called it and the tables
// it was asked for, so a comparison is named wherever it comes from.
vi.mock(
  "../../domains/schema/pipeline/diff/introspect-live",
  async original => {
    const actual =
      await original<
        typeof import("../../domains/schema/pipeline/diff/introspect-live")
      >();
    const wrapped: Record<string, unknown> = { ...actual };
    for (const [name, value] of Object.entries(actual)) {
      if (!name.startsWith("introspect") || typeof value !== "function") {
        continue;
      }
      wrapped[name] = (...args: unknown[]) =>
        asking.store.run(
          {
            ...asking.store.getStore(),
            introspection: {
              caller: asking.callerOf(new Error().stack, "introspect-live"),
              tables: Array.isArray(args[2]) ? (args[2] as string[]) : [],
            },
          },
          () => (value as (...a: unknown[]) => unknown)(...args)
        );
    }
    return wrapped;
  }
);

const PLUGIN = definePlugin({
  name: "@test/pcn",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init() {},
});
const COLLECTIONS = [
  ...["pcna", "pcnb", "pcnc"].map(slug =>
    defineCollection({
      slug,
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "hero", component: "pcnhero" }),
      ],
    })
  ),
  // Translated, with a field held unique within each language: the check
  // that its per-language index is there reads the companion's indexes.
  defineCollection({
    slug: "pcnloc",
    localized: true,
    fields: [text({ name: "handle", unique: true })],
  }),
];
const LOCALIZATION = { locales: ["en", "fr"], defaultLocale: "en" };
const SINGLES = [
  defineSingle({ slug: "pcnsite", fields: [text({ name: "title" })] }),
];
const FIELD_GROUPS = [
  defineFieldGroup({ slug: "pcnhero", fields: [text({ name: "heading" })] }),
];
const CONFIG = defineConfig({
  collections: COLLECTIONS,
  singles: SINGLES,
  fieldGroups: FIELD_GROUPS,
  plugins: [PLUGIN],
  localization: LOCALIZATION,
});

/**
 * A statement that reads the database's catalog, rather than a table's rows.
 * On SQLite only the pragmas that describe a table count: the ones a
 * connection sets on open (`journal_mode`, `foreign_keys`) read nothing.
 */
const CATALOG =
  /information_schema|pg_catalog|pg_class|pg_index|pg_constraint|pg_attribute|pg_get_|\bpragma[\s_]+(table_info|table_xinfo|index_list|index_info|index_xinfo|foreign_key_list)\b|sqlite_master|sqlite_schema|^\s*SHOW\s/i;
/** A catalog read that asks only whether tables exist, or which there are. */
const EXISTENCE =
  /information_schema\.tables\b|^\s*SELECT\s+(COUNT\(\*\)|name\b)[\s\S]*\bFROM\s+sqlite_(master|schema)\b/i;
/** A statement that reads or writes the migration ledger. */
const LEDGER = /nextly_schema_events/i;

/**
 * Whether `introspection` is the start's read of the two registry tables for
 * rules left in their retired `access_rules` column, and nothing more.
 */
function readsRetiredAccessRules(
  introspection: Asker["introspection"]
): boolean {
  return (
    introspection !== undefined &&
    introspection.caller.startsWith("init/first-run.ts") &&
    introspection.tables.length > 0 &&
    introspection.tables.every(table =>
      RETIRED_ACCESS_RULES_TABLES.includes(table)
    )
  );
}

/** Why a statement nothing labelled breaks the rule, or undefined. */
function unlabelledBreach(text: string, sent: string): string | undefined {
  if (CATALOG.test(text) && !EXISTENCE.test(text)) {
    return `an unlabelled catalog read: ${sent}`;
  }
  if (LEDGER.test(text) && !CATALOG.test(text)) {
    return `a ledger read outside the plugin readiness check: ${sent}`;
  }
  return undefined;
}

/** Why `call` breaks the rule, or undefined when a production start may send it. */
function breach(call: RecordedStatement): string | undefined {
  const asker = call.context as Asker | undefined;
  const sent = call.text.replace(/\s+/g, " ").slice(0, 90);
  if (asker?.kept) return undefined;
  if (
    asker?.translatedUniqueCheck &&
    CATALOG.test(call.text) &&
    !EXISTENCE.test(call.text)
  ) {
    return `the translated unique index check read the catalog: ${sent}`;
  }
  const introspection = asker?.introspection;
  if (introspection === undefined) return unlabelledBreach(call.text, sent);
  if (readsRetiredAccessRules(introspection)) return undefined;
  return `${introspection.caller} read the shape of ${introspection.tables.join(", ")}: ${sent}`;
}

describe.each(getConfiguredTestDialects())(
  "a production start (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    beforeEach(async () => {
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-production-start-"));
        url = `file:${join(dir, "start.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_production_start"
        );
        url = scratch.url;
        drop = scratch.drop;
      }
      // The request path opens the database the environment names.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      // Migrated for the configuration, with the plugin installed, as a
      // deployment that ran `nextly migrate` and `nextly plugins install`.
      const setup = await adapterFor();
      await createTestNextly({
        adapter: setup as never,
        collections: COLLECTIONS,
        singles: SINGLES,
        fieldGroups: FIELD_GROUPS,
        plugins: [PLUGIN],
        localization: LOCALIZATION,
      });
      await recordPluginLifecycle(
        new SchemaEventsRepository(setup.getDrizzle(), dialect),
        PLUGIN.name,
        { state: "installed" }
      );
      await shutdownServices();
    }, 180_000);

    afterEach(async () => {
      await shutdownServices();
      resetDispatcherForTests();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
    });

    /** Every statement one start sends, begun as `entry` begins it, in `mode`. */
    async function recordStart(
      entry: "the Direct API" | "a request",
      mode: "production" | "development"
    ): Promise<RecordedStatement[]> {
      vi.stubEnv("NODE_ENV", mode);
      const adapter = await adapterFor();
      const recorder = await recordStatements(adapter, dialect, {
        context: () => asking.store.getStore(),
      });
      try {
        if (entry === "the Direct API") {
          const nextly = await getNextly({
            config: sanitizeConfig(CONFIG) as never,
            adapter,
          });
          await startSettled();
          recorder.uninstall();
          await nextly.shutdown();
        } else {
          const handlers = createDynamicHandlers({
            config: sanitizeConfig(CONFIG) as never,
          });
          const path = ["collections", "pcna", "entries"];
          await handlers.GET(
            new Request(`http://localhost/api/${path.join("/")}`),
            { params: Promise.resolve({ params: path }) }
          );
          recorder.uninstall();
          await adapter.disconnect();
        }
      } finally {
        recorder.uninstall();
      }
      return recorder.calls;
    }

    it.each(["the Direct API", "a request"] as const)(
      "begun by %s, reads no table's shape and no ledger row but what it keeps",
      async entry => {
        const calls = await recordStart(entry, "production");

        expect(calls.map(breach).filter(Boolean)).toEqual([]);
        // Each kept reader is seen, so no exception holds by absence.
        const kept = new Set(
          calls.map(call => (call.context as Asker | undefined)?.kept)
        );
        for (const reader of [
          "component discriminator",
          "per-language layout",
          "plugin readiness",
        ]) {
          expect(kept, `${reader} is seen`).toContain(reader);
        }
        expect(
          calls.some(
            call =>
              LEDGER.test(call.text) &&
              (call.context as Asker | undefined)?.kept === "plugin readiness"
          )
        ).toBe(true);
        // The retired access rules notice still reads the registry tables.
        expect(
          calls.some(call =>
            readsRetiredAccessRules(
              (call.context as Asker | undefined)?.introspection
            )
          ),
          "the registry tables are read for retired access rules"
        ).toBe(true);
      },
      180_000
    );

    it("a development start, recorded the same way, still compares each collection with the live schema and reads the translated collection's indexes", async () => {
      const calls = await recordStart("the Direct API", "development");

      const compared = new Set(
        calls.flatMap(call => {
          const introspection = (call.context as Asker | undefined)
            ?.introspection;
          return introspection?.caller.includes("init/drift-check.ts")
            ? introspection.tables
            : [];
        })
      );
      for (const slug of ["pcna", "pcnb", "pcnc"]) {
        expect(compared, `the drift check reads dc_${slug}`).toContain(
          `dc_${slug}`
        );
      }
      // The fixture reaches the translated unique index check: it reads the
      // companion's indexes, which a production start must not.
      expect(
        calls.filter(
          call =>
            (call.context as Asker | undefined)?.translatedUniqueCheck &&
            CATALOG.test(call.text) &&
            !EXISTENCE.test(call.text)
        ),
        "the translated unique index check reads the companion's indexes"
      ).not.toEqual([]);
    }, 180_000);
  }
);
