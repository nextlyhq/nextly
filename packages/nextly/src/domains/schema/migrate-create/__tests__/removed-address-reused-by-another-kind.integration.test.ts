/**
 * A collection removed from the configuration and its exact address reused by another kind, a
 * Single or a field group, taken through `migrate:create`, `nextly migrate` and a start, on
 * PostgreSQL, MySQL and SQLite.
 *
 * `one` creates the collection; `two` is generated with the collection gone and the other kind
 * under the same address. Each is applied and its registry rows written as `nextly migrate`
 * writes them (`reconcileMigrationMetadata`), which removes the row of the entity a migration
 * dropped; the app then starts on the new configuration, its one-kind-per-address rule finding
 * the address held once.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { installRegistryResolver } from "../../../../cli/utils/registry-resolver";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { shutdownServices } from "../../../../di/register";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../../plugins/test-nextly";
import { resolveRegistryTableName } from "../../../field-groups/storage/resolve-storage-names";
import { ensureSchemaEventsTable } from "../../events/schema-events-ddl";
import { resolveDataLossConsent } from "../../migrate/data-loss-consent";
import {
  appMigrationInputs,
  type AppMigrationConfig,
} from "../app-migration-inputs";
import { generateMigration } from "../generate";

/** The kind that takes over the removed collection's address. */
const KINDS = ["single", "fieldGroup"] as const;
type ReusingKind = (typeof KINDS)[number];
const silent = { warn: () => {}, error: () => {} };

describe.each(
  getConfiguredTestDialects().flatMap(dialect =>
    KINDS.map(kind => [dialect, kind] as const)
  )
)(
  "a removed collection's address reused on %s by a %s",
  (dialect: TestDialect, kind: ReusingKind) => {
    const SLUG = `rak_${kind === "single" ? "page" : "group"}`;
    const COLLECTION_TABLE = `dc_${SLUG}`;
    let url: string;
    let drop: () => Promise<void>;
    let adapter: DrizzleAdapter;
    let dir = "";

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    beforeAll(async () => {
      if (dialect === "sqlite") {
        const sqliteDir = mkdtempSync(join(tmpdir(), "nextly-rak-"));
        url = `file:${join(sqliteDir, "rak.db")}`;
        drop = async () => rmSync(sqliteDir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_rak");
        url = scratch.url;
        drop = scratch.drop;
      }
      // The core tables and the registries, as a started app has them.
      const core = await createTestNextly({
        adapter: (await adapterFor()) as never,
      });
      await core.destroy();
      adapter = await adapterFor();
      installRegistryResolver(adapter);
      dir = mkdtempSync(join(tmpdir(), "nextly-rak-migrations-"));
    }, 180_000);

    afterAll(async () => {
      // Each step on its own, so one that fails, or a setup that stopped early, leaves the
      // others to run.
      try {
        await adapter?.disconnect().catch(() => {});
        await shutdownServices();
        if (dir !== "") rmSync(dir, { recursive: true, force: true });
      } finally {
        await drop?.();
      }
    });

    /**
     * What `nextly migrate:create` does with a configuration: its inputs read and checked
     * (`appMigrationInputs`, which is where an address is refused), then the file written.
     */
    async function create(
      name: string,
      at: string,
      entities: Partial<
        Pick<AppMigrationConfig, "collections" | "singles" | "fieldGroups">
      >
    ): Promise<void> {
      const inputs = await appMigrationInputs({
        config: {
          collections: [],
          singles: [],
          fieldGroups: [],
          plugins: [],
          db: { uiSchemaFile: "ui-schema.json", migrationsDir: dir },
          ...entities,
        } as unknown as AppMigrationConfig,
        projectRoot: dir,
        migrationsDir: dir,
        dialect,
        logger: silent,
      });
      await generateMigration({
        name,
        dialect,
        migrationsDir: dir,
        appStream: inputs.appStream,
        collections: inputs.collections,
        singles: inputs.singles,
        components: inputs.components,
        previous: inputs.latest,
        metadataUpserts: inputs.metadataUpserts,
        previousMetadataUpserts: inputs.previousMetadataUpserts,
        nonInteractive: true,
        now: new Date(at),
      });
    }

    /**
     * What `nextly migrate` does with the folder: apply each file, then its own registry phase,
     * which removes the row of an entity a migration dropped.
     */
    async function migrate(): Promise<void> {
      await migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir: dir,
        logger: createLogger({ quiet: true }),
        lockMode: "fail-fast",
        consent: resolveDataLossConsent({ flag: COLLECTION_TABLE, env: {} }),
        interactive: false,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      } as never);
    }

    /** Whether a registry holds a row for the address, read on `on`. */
    async function hasRow(
      table: string,
      on: DrizzleAdapter = adapter
    ): Promise<boolean> {
      const row = await on.selectOne(table, {
        where: { and: [{ column: "slug", op: "=", value: SLUG }] },
      });
      return row !== null;
    }

    it("is generated, applied and started on", async () => {
      const fields = [text({ name: "title" })];
      // The configuration once the other kind holds the address.
      const reusing =
        kind === "single"
          ? { singles: [defineSingle({ slug: SLUG, fields })] }
          : { fieldGroups: [defineFieldGroup({ slug: SLUG, fields })] };
      await create("one", "2026-11-19T10:00:00.000Z", {
        collections: [defineCollection({ slug: SLUG, fields })],
      });
      await migrate();
      expect(await hasRow("dynamic_collections")).toBe(true);

      await create("two", "2026-11-19T11:00:00.000Z", reusing);
      expect(
        readdirSync(dir).filter(file => file.endsWith(".sql"))
      ).toHaveLength(2);
      await migrate();
      // The removed collection's registry row went with the migration that dropped it: the
      // row a start's one-kind-per-address rule would otherwise find.
      expect(await hasRow("dynamic_collections")).toBe(false);

      // The start on the new configuration: the address held once, by the other kind.
      await adapter.disconnect();
      const started = await createTestNextly({
        adapter: (await adapterFor()) as never,
        ...reusing,
      });
      try {
        // Read on the started app's own connection, which has its registries registered.
        const live = started.adapter as unknown as DrizzleAdapter;
        expect({
          collection: await hasRow("dynamic_collections", live),
          reusing: await hasRow(
            kind === "single"
              ? "dynamic_singles"
              : await resolveRegistryTableName(live),
            live
          ),
        }).toEqual({ collection: false, reusing: true });
      } finally {
        await started.destroy();
        adapter = await adapterFor();
        installRegistryResolver(adapter);
      }
    }, 180_000);
  }
);
