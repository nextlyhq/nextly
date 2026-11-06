/**
 * Every Schema Builder save is refused at once while another process holds the schema lock, and
 * changes nothing: no table, no column, no registry row, no user field definition.
 *
 * A booted Nextly runs on the lock world's database, so the saves go through the real services,
 * dispatchers and routes, while a second process (`schema-lock-holder.ts`) holds the lock. The
 * saves run in development, where the Builder executes its DDL, so a save that slipped past the
 * lock would show up as a changed table as well as a changed row.
 *
 * A refusal alone cannot tell a save that holds the lock across its work from one that checks the
 * lock and lets it go before writing, so three saves are also paused part-way through their work:
 * a second process trying to take the lock then must be refused, and the save must finish once
 * released.
 *
 * Each dialect boots once, on a database of its own; each case uses its own slugs, and the lock
 * tables are dropped after each case so the next one starts with the lock free.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The routes' permission check is the only thing replaced: what is under test is the save behind
// it, on a real boot.
vi.mock("../../../api/route-auth", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../api/route-auth")>()),
  requireRouteAllPermissions: vi.fn(async () => undefined),
  requireRouteAnyPermission: vi.fn(async () => undefined),
}));
// The routes wait for the app's own boot first; the test boot below is it.
vi.mock("../../../init", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../init")>()),
  getCachedNextly: vi.fn(async () => undefined),
}));

import { POST as createCollectionRoute } from "../../../api/collections-schema";
import {
  DELETE as deleteCollectionRoute,
  PATCH as updateCollectionRoute,
} from "../../../api/collections-schema-detail";
import { DELETE as deleteSingleRoute } from "../../../api/singles-schema-detail";
import { POST as createUserFieldRoute } from "../../../api/user-fields";
import {
  DELETE as deleteUserFieldRoute,
  PATCH as updateUserFieldRoute,
} from "../../../api/user-fields-detail";
import { DynamicCollectionService } from "../../../domains/dynamic-collections/services/dynamic-collection-service";
import {
  LOCK_DIALECTS,
  lockWorld,
  startHolder,
  tablesWithPrefix,
  type Holder,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import type { SingleMetadataService } from "../../../domains/singles/services/single-metadata-service";
import type { UserFieldDefinitionService } from "../../../domains/users/services/user-field-definition-service";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { dispatchCollections } from "../collection-dispatcher";
import { dispatchSingles } from "../single-dispatcher";
import { dispatchUserFields } from "../user-field-dispatcher";

const EDITOR_MESSAGE =
  "A migration is running on this database, so this change was not saved. " +
  "Save it again once the migration ends.";

const HEADING = { name: "heading", type: "text" };
const SUMMARY = { name: "summary", type: "text" };

describe.each(LOCK_DIALECTS)(
  "a Builder save while another process holds the schema lock on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let handle: TestNextly;
    let holder: Holder | undefined;

    beforeAll(async () => {
      // The Builder executes its DDL in development only, so that is where a save that slipped
      // past the lock would be visible as a changed table.
      vi.stubEnv("NODE_ENV", "development");
      world = await lockWorld(dialect, { fresh: true });
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv(
        "DATABASE_URL",
        dialect === "sqlite" ? `file:${world.url}` : world.url
      );
      // The validated environment is cached for the process, and the dialect before this one
      // would otherwise answer for this database's DDL.
      _resetEnvCache();
      adapter = await world.connect();
      handle = await createTestNextly({
        adapter: adapter as never,
        collections: [],
      });
    }, 120_000);

    afterAll(async () => {
      await handle?.destroy();
      await world?.dispose();
      vi.unstubAllEnvs();
      _resetEnvCache();
    }, 60_000);

    afterEach(async () => {
      if (holder !== undefined) {
        holder.kill("SIGKILL");
        await holder.exited;
        holder = undefined;
      }
      // The killed holder's claim would otherwise outlive it for its lease, and its table would
      // stop the next holder from starting.
      await world.reset(adapter, await tablesWithPrefix(adapter, "bsl_holder"));
    }, 60_000);

    const collections = () =>
      handle.getService("collectionsHandler") as unknown as CollectionsHandler;
    const userFields = () =>
      handle.getService(
        "userFieldDefinitionService"
      ) as unknown as UserFieldDefinitionService;

    function q(name: string): string {
      return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    }

    async function rows(statement: string): Promise<unknown[]> {
      return (await adapter.executeQuery(statement)) as unknown[];
    }

    async function columnsOf(table: string): Promise<string[]> {
      const found = (await adapter.executeQuery(
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      )) as Array<{ name: string }>;
      return found.map(row => row.name).sort();
    }

    /**
     * What a refused save must leave alone: every table, the columns of every table a Builder save
     * shapes, and every row describing a collection, a Single or a user field.
     */
    async function databaseState(): Promise<unknown> {
      const tables = (await adapter.listTables())
        .filter(name => name !== "nextly_schema_lock")
        .sort();
      const shaped: Record<string, string[]> = {};
      for (const table of tables) {
        if (
          table.startsWith("dc_") ||
          table.startsWith("single_") ||
          table === "user_ext"
        ) {
          shaped[table] = await columnsOf(table);
        }
      }
      return {
        tables,
        shaped,
        collections: await rows(
          `SELECT ${q("slug")}, ${q("fields")}, ${q("schema_version")}, ${q("updated_at")} FROM ${q("dynamic_collections")} ORDER BY ${q("slug")}`
        ),
        singles: await rows(
          `SELECT ${q("slug")}, ${q("fields")}, ${q("schema_version")}, ${q("updated_at")} FROM ${q("dynamic_singles")} ORDER BY ${q("slug")}`
        ),
        userFields: await rows(
          `SELECT ${q("id")}, ${q("name")}, ${q("label")} FROM ${q("user_field_definitions")} ORDER BY ${q("id")}`
        ),
      };
    }

    async function holdTheLock(): Promise<void> {
      holder = startHolder(world, {
        command: "nextly db:sync",
        leaseSeconds: 30,
        prefix: "bsl_holder",
      });
      await holder.printed("held");
    }

    /** Runs `save` under a held lock: it is refused for a migration, and nothing changes. */
    async function refusedWhileHeld(
      save: () => Promise<unknown>
    ): Promise<NextlyError> {
      await holdTheLock();
      // The holder's own table is part of the state from here on.
      const before = await databaseState();
      const outcome = await save().then(
        () => undefined,
        (e: unknown) => e
      );
      // The state first: a save that went through shows what it changed.
      expect(await databaseState()).toEqual(before);
      expect(NextlyError.is(outcome) ? outcome.code : outcome).toBe(
        "SERVICE_UNAVAILABLE"
      );
      return outcome as NextlyError;
    }

    /** A route's answer, refused for a migration, with nothing changed. */
    async function routeRefusedWhileHeld(
      call: () => Promise<Response>
    ): Promise<void> {
      await holdTheLock();
      const before = await databaseState();
      const response = await call();
      expect(await databaseState()).toEqual(before);
      expect(response.status).toBe(503);
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      expect(body.error?.code).toBe("SERVICE_UNAVAILABLE");
    }

    async function createdCollection(slug: string): Promise<void> {
      const created = await collections().createCollection({
        name: slug,
        label: slug,
        fields: [HEADING],
      } as never);
      expect(created.success, JSON.stringify(created)).toBe(true);
    }

    async function createdSingle(slug: string): Promise<void> {
      await (
        handle.getService(
          "singleMetadataService" as never
        ) as unknown as SingleMetadataService
      ).createSingle({
        slug,
        label: slug,
        tableName: `single_${slug.replace(/-/g, "_")}`,
        fields: [HEADING],
        source: "ui",
        locked: false,
        schemaHash: slug,
        schemaVersion: 1,
      } as never);
    }

    /** A JSON request to a route, as the route receives it. */
    function jsonRequest(method: string, path: string, body?: unknown) {
      return new Request(`http://localhost/admin/api/${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }

    /** A gate a save waits at, part-way through its work, until the test opens it. */
    function gate(): {
      reached: Promise<void>;
      wait: () => Promise<void>;
      open: () => void;
    } {
      let arrive!: () => void;
      let open!: () => void;
      const reached = new Promise<void>(resolve => (arrive = resolve));
      const opened = new Promise<void>(resolve => (open = resolve));
      return {
        reached,
        wait: async () => {
          arrive();
          await opened;
        },
        open,
      };
    }

    /**
     * Pauses `save` at `paused` (a step its work runs once the lock is taken), starts a second
     * process trying to take the lock, and asserts that process is refused; then lets the save
     * finish and returns what it returned.
     */
    async function heldAcrossTheSave<T>(
      paused: ReturnType<typeof gate>,
      save: () => Promise<T>
    ): Promise<T> {
      const saving = save();
      // Settled early only if the save failed before reaching the gate.
      void saving.catch(() => undefined);
      await paused.reached;
      holder = startHolder(world, {
        command: "nextly db:sync",
        leaseSeconds: 30,
        prefix: "bsl_holder",
      });
      const contender = await holder.printed("held").then(
        () => "took the lock",
        () => "was refused"
      );
      paused.open();
      const saved = await saving;
      expect(contender).toBe("was refused");
      return saved;
    }

    it("refuses a collection create, telling the editor to save again", async () => {
      const refusal = await refusedWhileHeld(() =>
        collections().createCollection({
          name: "bsl_created",
          label: "Created",
          fields: [HEADING],
        } as never)
      );
      expect(refusal.publicMessage).toBe(EDITOR_MESSAGE);
    }, 90_000);

    it("refuses a collection update", async () => {
      await createdCollection("bsl_updated");
      await refusedWhileHeld(() =>
        collections().updateCollection({ collectionName: "bsl_updated" }, {
          fields: [HEADING, SUMMARY],
        } as never)
      );
    }, 90_000);

    it("refuses a collection delete", async () => {
      await createdCollection("bsl_deleted");
      await refusedWhileHeld(() =>
        collections().deleteCollection({ collectionName: "bsl_deleted" })
      );
    }, 90_000);

    it("refuses a collection's confirmed schema apply", async () => {
      await createdCollection("bsl_applied");
      await refusedWhileHeld(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "bsl_applied" },
          { fields: [HEADING, SUMMARY], confirmed: true, schemaVersion: 1 }
        )
      );
    }, 90_000);

    it("refuses a Single's confirmed schema apply", async () => {
      await createdSingle("bsl-banner");
      await refusedWhileHeld(() =>
        dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "bsl-banner" },
          { fields: [HEADING, SUMMARY], confirmed: true, schemaVersion: 1 }
        )
      );
    }, 90_000);

    it("refuses a user field create", async () => {
      await refusedWhileHeld(() =>
        dispatchUserFields(
          "createField",
          {},
          { name: "bslCreated", label: "Created", type: "text" }
        )
      );
    }, 90_000);

    it("refuses a user field update", async () => {
      const field = await userFields().createField({
        name: "bslUpdated",
        label: "Before",
        type: "text",
      } as never);
      await refusedWhileHeld(() =>
        dispatchUserFields(
          "updateField",
          { fieldId: field.id },
          { label: "After" }
        )
      );
    }, 90_000);

    it("refuses a user field delete", async () => {
      const field = await userFields().createField({
        name: "bslDeleted",
        label: "Deleted",
        type: "text",
      } as never);
      await refusedWhileHeld(() =>
        dispatchUserFields("deleteField", { fieldId: field.id }, undefined)
      );
    }, 90_000);

    it("refuses a collection create through the schema route", async () => {
      await routeRefusedWhileHeld(() =>
        createCollectionRoute(
          new Request("http://localhost/admin/api/collections/schema", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              slug: "bsl_routed",
              labels: { singular: "Routed" },
              fields: [HEADING],
            }),
          })
        )
      );
    }, 90_000);

    it("refuses a collection delete through the schema detail route", async () => {
      await createdCollection("bsl_route_deleted");
      await routeRefusedWhileHeld(() =>
        deleteCollectionRoute(
          new Request(
            "http://localhost/admin/api/collections/schema/bsl_route_deleted",
            { method: "DELETE" }
          ),
          { params: Promise.resolve({ slug: "bsl_route_deleted" }) }
        )
      );
    }, 90_000);

    it("refuses a collection update through the schema detail route", async () => {
      await createdCollection("bsl_route_updated");
      await routeRefusedWhileHeld(() =>
        updateCollectionRoute(
          jsonRequest("PATCH", "collections/schema/bsl_route_updated", {
            fields: [HEADING, SUMMARY],
          }),
          { params: Promise.resolve({ slug: "bsl_route_updated" }) }
        )
      );
    }, 90_000);

    it("refuses a Single delete through the schema detail route", async () => {
      await createdSingle("bsl-route-single");
      await routeRefusedWhileHeld(() =>
        deleteSingleRoute(
          jsonRequest("DELETE", "singles/schema/bsl-route-single"),
          { params: Promise.resolve({ slug: "bsl-route-single" }) }
        )
      );
    }, 90_000);

    it("refuses a user field create through the user-fields route", async () => {
      await routeRefusedWhileHeld(() =>
        createUserFieldRoute(
          jsonRequest("POST", "user-fields", {
            name: "bslRouted",
            label: "Routed",
            type: "text",
          })
        )
      );
    }, 90_000);

    it("refuses a user field delete through the user-fields detail route", async () => {
      const field = await userFields().createField({
        name: "bslRouteDeleted",
        label: "Deleted",
        type: "text",
      } as never);
      await routeRefusedWhileHeld(() =>
        deleteUserFieldRoute(jsonRequest("DELETE", `user-fields/${field.id}`), {
          params: Promise.resolve({ id: field.id }),
        })
      );
    }, 90_000);

    describe("in production, where a save creates no lock table", () => {
      it("refuses a collection update through the metadata service", async () => {
        await createdCollection("bsl_prod_updated");
        vi.stubEnv("NODE_ENV", "production");
        try {
          await refusedWhileHeld(() =>
            collections().updateCollection(
              { collectionName: "bsl_prod_updated" },
              { fields: [HEADING, SUMMARY] } as never
            )
          );
        } finally {
          vi.stubEnv("NODE_ENV", "development");
        }
      }, 90_000);

      it("refuses a user field update through the user-fields detail route", async () => {
        const field = await userFields().createField({
          name: "bslProdUpdated",
          label: "Before",
          type: "text",
        } as never);
        vi.stubEnv("NODE_ENV", "production");
        try {
          await routeRefusedWhileHeld(() =>
            updateUserFieldRoute(
              jsonRequest("PATCH", `user-fields/${field.id}`, {
                label: "After",
              }),
              { params: Promise.resolve({ id: field.id }) }
            )
          );
        } finally {
          vi.stubEnv("NODE_ENV", "development");
        }
      }, 90_000);
    });

    describe("holds the lock until the save has written", () => {
      it("for a collection create, through the registry write", async () => {
        const paused = gate();
        const original = DynamicCollectionService.prototype.registerCollection;
        const spy = vi
          .spyOn(DynamicCollectionService.prototype, "registerCollection")
          .mockImplementationOnce(async function (
            this: DynamicCollectionService,
            ...args: Parameters<typeof original>
          ) {
            await paused.wait();
            return original.apply(this, args);
          });
        try {
          const saved = await heldAcrossTheSave(paused, () =>
            collections().createCollection({
              name: "bsl_latched",
              label: "Latched",
              fields: [HEADING],
            } as never)
          );
          expect(saved.success, JSON.stringify(saved)).toBe(true);
        } finally {
          spy.mockRestore();
        }
      }, 90_000);

      it("for a collection's confirmed schema apply, through the registry write", async () => {
        await createdCollection("bsl_latched_apply");
        const paused = gate();
        const original = adapter.update.bind(adapter);
        const spy = vi
          .spyOn(adapter, "update")
          .mockImplementation(async (...args: Parameters<typeof original>) => {
            if (args[0] === "dynamic_collections") await paused.wait();
            return original(...args);
          });
        try {
          await heldAcrossTheSave(paused, () =>
            dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: "bsl_latched_apply" },
              { fields: [HEADING, SUMMARY], confirmed: true, schemaVersion: 1 }
            )
          );
        } finally {
          spy.mockRestore();
        }
        expect(await columnsOf("dc_bsl_latched_apply")).toContain("summary");
      }, 90_000);

      it("for a user field create, through the definition write", async () => {
        const service = userFields();
        const paused = gate();
        const original = service.createField.bind(service);
        const spy = vi
          .spyOn(service, "createField")
          .mockImplementationOnce(
            async (...args: Parameters<typeof original>) => {
              await paused.wait();
              return original(...args);
            }
          );
        try {
          await heldAcrossTheSave(paused, () =>
            dispatchUserFields(
              "createField",
              {},
              { name: "bslLatched", label: "Latched", type: "text" }
            )
          );
        } finally {
          spy.mockRestore();
        }
        expect(await columnsOf("user_ext")).toContain("bsl_latched");
      }, 90_000);
    });
  }
);
