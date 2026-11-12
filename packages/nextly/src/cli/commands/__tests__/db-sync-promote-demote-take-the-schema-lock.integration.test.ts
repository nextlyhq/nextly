/**
 * `db:sync --promote` and `--demote` ask first, holding nothing, then write their registry row
 * holding the schema lock the way `db:sync` and a Schema Builder save hold it.
 *
 * Each case runs the command's core against a database of its own, with the terminal's prompt
 * replaced by a seam, and asserts one property:
 *
 * - with the lock free, each writes (the controls: the fixture reaches the write);
 * - with another process holding the lock, each waits, is refused with `NEXTLY_MIGRATE_LOCK_BUSY`,
 *   and changes nothing;
 * - with a field-group storage migration in flight, each is refused with the error `db:sync`
 *   gives, and changes nothing;
 * - when the collection's record changes, appears or vanishes while the prompt is open, each is
 *   refused with the shared plan-changed refusal, which the CLI ends as `PLAN_CHANGED_AFTER_CONSENT`
 *   with exit 1, and changes nothing;
 * - while the prompt is open, no lock is held: this process takes it at once.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashManifest } from "../../../domains/field-groups/migration/manifest";
import { beginMigration } from "../../../domains/field-groups/migration/state";
import { MetaService } from "../../../domains/meta/services/meta-service";
import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import { PLAN_CHANGED_AFTER_CONSENT } from "../../../domains/schema/migrate/plan-changed-after-consent";
import {
  LOCK_DIALECTS,
  lockWorld,
  startHolder,
  type Holder,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import { NextlyError } from "../../../errors/nextly-error";
import type { CollectionRegistryService } from "../../../services/collections/collection-registry-service";
import { toCliError } from "../../errors";
import { createLogger } from "../../utils/logger";
import { demoteCollection } from "../db-sync-demote";
import { promoteCollection } from "../db-sync-promote";
import { collectionRegistryOn } from "../db-sync-registry";
import { migrateCore } from "../migrate";

/** A collection built in the Schema Builder, which promote moves to code. */
const BUILT = "pdl_built";
/** A collection defined in code, which demote moves to the Schema Builder. */
const CODED = "pdl_coded";
const CONFIG = "export default {};\n";

const logger = createLogger({ quiet: true });

const TITLE = [{ name: "title", type: "text" }];
const SUBTITLE = [{ name: "subtitle", type: "text" }];

describe.each(LOCK_DIALECTS)(
  "db:sync --promote and --demote and the schema lock on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let project: string;
    let registry: CollectionRegistryService;
    /** A second registry, standing in for another process changing the same rows. */
    let elsewhere: CollectionRegistryService;
    let holder: Holder | undefined;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      project = mkdtempSync(join(tmpdir(), "nextly-promote-demote-lock-"));
      writeFileSync(join(project, "nextly.config.ts"), CONFIG);
      // The core reconcile builds every system table these read and write, the lock's included.
      await migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir: mkdtempSync(join(project, "migrations-")),
        logger,
        lockMode: "wait",
        lockWaitMs: 1_000,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      });
      registry = collectionRegistryOn(adapter, logger);
      elsewhere = collectionRegistryOn(adapter, logger);
      await register(elsewhere, BUILT, TITLE);
    }, 60_000);

    afterEach(async () => {
      if (holder !== undefined) {
        holder.kill("SIGKILL");
        await holder.exited;
        holder = undefined;
      }
      await adapter.disconnect();
      rmSync(project, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    function register(
      on: CollectionRegistryService,
      slug: string,
      fields: unknown[]
    ) {
      return on.registerCollection({
        slug,
        labels: { singular: slug, plural: slug },
        tableName: `dc_${slug}`,
        fields: fields as never,
        source: "ui",
        schemaHash: `pdl-${slug}`,
        configPath: "pdl",
      });
    }

    /** What a refused run must leave alone: both records, and the configuration file. */
    async function state(): Promise<{
      built: string | null;
      coded: string | null;
      config: string;
    }> {
      const read = async (slug: string) => {
        const record = await elsewhere.getCollectionBySlug(slug);
        return record === null ? null : JSON.stringify(record);
      };
      return {
        built: await read(BUILT),
        coded: await read(CODED),
        config: readFileSync(join(project, "nextly.config.ts"), "utf8"),
      };
    }

    function promote(
      confirm: (code: string) => Promise<boolean> = async () => true,
      lockWaitMs = 1_000,
      templateAddress?: (slug: string) => Promise<string | null>
    ) {
      return promoteCollection({
        slug: BUILT,
        logger,
        cwd: project,
        registry,
        adapter,
        confirm,
        lockWaitMs,
        ...(templateAddress === undefined ? {} : { templateAddress }),
      });
    }

    function demote(
      confirm: (code: string) => Promise<boolean> = async () => true,
      lockWaitMs = 1_000
    ) {
      return demoteCollection({
        collection: { slug: CODED, fields: TITLE },
        logger,
        registry,
        adapter,
        confirm,
        lockWaitMs,
      });
    }

    async function holdTheLock(): Promise<void> {
      holder = startHolder(world, {
        command: "nextly migrate",
        leaseSeconds: 30,
        prefix: "pdl_holder",
      });
      await holder.printed("held");
    }

    /** Runs `path`, and asserts it was refused with `code` and changed nothing. */
    async function refused(
      path: () => Promise<unknown>,
      code: string,
      before: Awaited<ReturnType<typeof state>>
    ): Promise<unknown> {
      const error = await path().then(
        () => undefined,
        (e: unknown) => e
      );
      expect(NextlyError.is(error) ? error.code : error).toBe(code);
      expect(await state()).toEqual(before);
      return error;
    }

    /** The shared refusal of a run whose record moved after consent, as the CLI reads it. */
    function expectPlanChanged(error: unknown): void {
      expect(NextlyError.is(error) ? error.logContext?.reason : error).toBe(
        PLAN_CHANGED_AFTER_CONSENT
      );
      expect(toCliError(error).code).toBe("PLAN_CHANGED_AFTER_CONSENT");
    }

    it("promotes and demotes with the lock free", async () => {
      await expect(promote()).resolves.toBe("promoted");
      await expect(demote()).resolves.toBe("demoted");
      const after = await state();
      expect(after.built).toBeNull();
      expect(after.coded).not.toBeNull();
      expect(after.config).toContain(`Promoted from UI source`);
    }, 90_000);

    it("waits for a held lock and is refused, changing nothing", async () => {
      await holdTheLock();
      const before = await state();
      await refused(() => promote(), "NEXTLY_MIGRATE_LOCK_BUSY", before);
      await refused(() => demote(), "NEXTLY_MIGRATE_LOCK_BUSY", before);
    }, 90_000);

    it("is refused while a field-group storage migration is in flight, as db:sync is", async () => {
      const entries = [
        { kind: "table" as const, from: "comp_hero", to: "fg_hero" },
        {
          kind: "registry" as const,
          from: "dynamic_components",
          to: "dynamic_field_groups",
        },
      ];
      await beginMigration(new MetaService(adapter, logger), {
        direction: "up",
        migrationId: "pdl-stalled",
        plan: { registryHash: "pdl", manifestHash: hashManifest(entries) },
        appliedManifest: entries,
      });
      const before = await state();
      for (const path of [() => promote(), () => demote()]) {
        const error = await refused(path, "SERVICE_UNAVAILABLE", before);
        expect(toCliError(error).code).toBe("FIELD_GROUP_MIGRATION_IN_FLIGHT");
      }
    }, 90_000);

    it("refuses a promote whose record changed while the prompt was open", async () => {
      let before: Awaited<ReturnType<typeof state>> | undefined;
      const error = await promote(async () => {
        await elsewhere.updateCollection(BUILT, { fields: SUBTITLE as never });
        before = await state();
        return true;
      }).then(
        () => undefined,
        (e: unknown) => e
      );
      expectPlanChanged(error);
      expect((error as NextlyError).publicMessage).toBe(
        `${BUILT} changed after you confirmed; nothing was changed; run the command again`
      );
      expect((error as NextlyError).logContext?.command).toBe(
        "nextly db:sync --promote"
      );
      expect(await state()).toEqual(before);
    }, 90_000);

    it("refuses a promote whose configuration file moved or vanished while the prompt was open", async () => {
      const root = join(project, "nextly.config.ts");
      const moved = join(project, "src", "nextly.config.ts");
      for (const change of ["moved", "deleted"] as const) {
        writeFileSync(root, CONFIG);
        const builtBefore = await elsewhere.getCollectionBySlug(BUILT);
        const error = await promote(async () => {
          if (change === "moved") {
            mkdirSync(join(project, "src"), { recursive: true });
            renameSync(root, moved);
          } else {
            rmSync(root);
          }
          return true;
        }).then(
          () => undefined,
          (e: unknown) => e
        );
        expectPlanChanged(error);
        expect(String((error as NextlyError).publicMessage), change).toContain(
          root
        );
        // Nothing was written at the old path, so no file holding only the snippet appears there,
        // and the registry row the promote would remove is still in place.
        expect(existsSync(root), change).toBe(false);
        expect(await elsewhere.getCollectionBySlug(BUILT), change).toEqual(
          builtBefore
        );
        if (change === "moved") {
          expect(readFileSync(moved, "utf8")).toBe(CONFIG);
          rmSync(moved);
        }
      }
    }, 90_000);

    it("refuses a promote whose template address changed while the prompt was open", async () => {
      // The address the page builder's template stores, moved in the admin
      // while the operator read the preview that declared the old one.
      let stored = "/old";
      let before: Awaited<ReturnType<typeof state>> | undefined;
      const error = await promote(
        async code => {
          expect(code).toContain('"/old"');
          stored = "/new";
          before = await state();
          return true;
        },
        1_000,
        async () => stored
      ).then(
        () => undefined,
        (e: unknown) => e
      );
      expectPlanChanged(error);
      expect((error as NextlyError).publicMessage).toBe(
        `${BUILT}'s template address changed after you confirmed; nothing was changed; run the command again`
      );
      expect(await state()).toEqual(before);
    }, 90_000);

    it("refuses a promote whose record vanished while the prompt was open", async () => {
      let before: Awaited<ReturnType<typeof state>> | undefined;
      const error = await promote(async () => {
        await elsewhere.deleteCollection(BUILT);
        before = await state();
        return true;
      }).then(
        () => undefined,
        (e: unknown) => e
      );
      expectPlanChanged(error);
      expect(await state()).toEqual(before);
    }, 90_000);

    it("refuses a demote whose record appeared or changed while the prompt was open", async () => {
      // Absent at the prompt, registered by another process before the write.
      let before: Awaited<ReturnType<typeof state>> | undefined;
      let error = await demote(async () => {
        await register(elsewhere, CODED, SUBTITLE);
        before = await state();
        return true;
      }).then(
        () => undefined,
        (e: unknown) => e
      );
      expectPlanChanged(error);
      expect(await state()).toEqual(before);

      // Present at the prompt, changed by another process before the write.
      error = await demote(async () => {
        await elsewhere.updateCollection(CODED, { fields: TITLE as never });
        before = await state();
        return true;
      }).then(
        () => undefined,
        (e: unknown) => e
      );
      expectPlanChanged(error);
      expect(await state()).toEqual(before);
    }, 90_000);

    it("holds no lock while the prompt is open", async () => {
      for (const run of [promote, demote]) {
        let promptOpen!: () => void;
        const opened = new Promise<void>(resolve => (promptOpen = resolve));
        let answer!: (yes: boolean) => void;
        const running = run(() => {
          promptOpen();
          return new Promise<boolean>(resolve => (answer = resolve));
        });
        await opened;
        // Asked from this test's own context, not the prompt's, so a lock the command held around
        // its prompt would be another holder here and refuse at once.
        await expect(
          withMigrateLock(adapter, dialect, async () => "taken", {
            command: "a forgotten prompt test",
            mode: "fail-fast",
          })
        ).resolves.toEqual({ ran: true, value: "taken" });
        answer(false);
        await expect(running).resolves.toBe("cancelled");
      }
    }, 90_000);
  }
);
