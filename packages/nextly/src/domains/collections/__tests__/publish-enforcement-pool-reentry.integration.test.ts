/**
 * A write that runs inside a caller-owned transaction must perform EVERY read on
 * that transaction's own connection, never the pool. A pooled read tries to check
 * out a second connection the open transaction will not release until its callback
 * returns, so against a single-connection pool it blocks forever and the write
 * deadlocks. The transactional bulk and single-entry write paths do this for the
 * publish/unpublish RBAC check, the collection metadata and owner-constraint
 * reads, the DB-reading hooks (the built-in sanitization hook loads field
 * metadata), and the localized delete's companion-schema and default-locale
 * reads, all bound to the caller's transaction.
 *
 * These pin the fix on a REAL database with a single-connection pool
 * (`pool.max = 1`): the RBAC preflight and each full bulk / direct in-transaction
 * create-and-update COMPLETE instead of deadlocking. Break any binding (drop the
 * executor and a read falls back to the pool) and the affected case hangs on the
 * second checkout, caught by the timeout. SQLite has no connection pool, so the
 * suite self-skips without a Postgres URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import { NextlyError } from "../../../errors/nextly-error";
import { registerHook, unregisterHook } from "../../../hooks";
import type { HookHandler } from "../../../hooks/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionRegistryService } from "../../../services/collections/collection-registry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? "";

// Distinct slugs so each test owns its table and the file's parallel-safe drop
// never races another case.
const RBAC_SLUG = "poolreentryrbac";
const BULK_CREATE_SLUG = "poolreentrybulkc";
const BULK_UPDATE_SLUG = "poolreentrybulku";
const DIRECT_CREATE_SLUG = "poolreentrydirc";
const DIRECT_UPDATE_SLUG = "poolreentrydiru";
const HOOK_SLUG = "poolreentryhook";
const AFTER_HOOK_SLUG = "poolreentryafter";
const DELETE_SLUG = "poolreentrydelete";
const DIRECT_DELETE_SLUG = "poolreentrydirdel";
const BEFOREOP_SLUG = "poolreentrybeforeop";
const LOCALIZED_DELETE_SLUG = "poolreentrylocdel";
const SLUGS = [
  RBAC_SLUG,
  BULK_CREATE_SLUG,
  BULK_UPDATE_SLUG,
  DIRECT_CREATE_SLUG,
  DIRECT_UPDATE_SLUG,
  HOOK_SLUG,
  AFTER_HOOK_SLUG,
  DELETE_SLUG,
  DIRECT_DELETE_SLUG,
  BEFOREOP_SLUG,
  LOCALIZED_DELETE_SLUG,
];

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

// A single-connection pool is the whole point: with `max: 1` the caller's
// transaction holds the ONLY connection, so any read that re-enters the pool
// from inside the transaction can never acquire a second one and blocks forever.
async function connectSingleConnection(): Promise<TestAdapter> {
  // env.ts validates DATABASE_URL against DB_DIALECT on first read in this
  // worker, so both must be on process.env — not just passed to createAdapter.
  process.env.DB_DIALECT = "postgresql";
  process.env.DATABASE_URL = POSTGRES_URL;
  const adapter = await createAdapter({
    type: "postgresql",
    url: POSTGRES_URL,
    pool: { max: 1 },
  } as Parameters<typeof createAdapter>[0]);
  await adapter.executeQuery("SELECT 1");
  return adapter;
}

// Reject if the work does not settle in time: a re-entrant pooled read on a
// `max: 1` pool never resolves, so without a bound timeout the test would hang
// instead of failing. The timer is cleared once the work settles so a passing
// run does not keep the worker alive until `ms` elapses.
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          NextlyError.internal({
            logContext: { reason: "pool-reentry-timeout", timeoutMs: ms },
          })
        ),
      ms
    );
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// A collection whose create/read/update/publish are all allowed for a session
// editor. Judging each of those still reads the RBAC and metadata tables — the
// reads that must run on the transaction's own connection.
function openCollection(slug: string) {
  return defineCollection({
    slug,
    status: true,
    access: {
      create: () => true,
      read: () => true,
      update: () => true,
      delete: () => true,
      publish: () => true,
    },
    fields: [text({ name: "title" })],
  });
}

const describePg = describe.skipIf(!POSTGRES_URL);

describePg(
  "publish enforcement — caller-owned-tx pool reentry (postgres)",
  () => {
    let boot: TestAdapter | undefined;

    beforeAll(async () => {
      if (!POSTGRES_URL) return;
      boot = await connectSingleConnection();
      await drop();
    });

    afterAll(async () => {
      await drop();
      if (boot) await boot.disconnect();
    });

    async function drop(): Promise<void> {
      if (!boot) return;
      for (const slug of SLUGS) {
        for (const stmt of [
          // Drop the localized companion (`<table>_locales`) before the main
          // table so a companion-to-main foreign key never blocks the drop.
          `DROP TABLE IF EXISTS dc_${slug}_locales`,
          `DROP TABLE IF EXISTS dc_${slug}`,
          `DELETE FROM dynamic_collections WHERE slug = '${slug}'`,
        ]) {
          try {
            await boot.executeQuery(stmt);
          } catch {
            // Best-effort on a fresh database.
          }
        }
      }
    }

    it("resolves a publish RBAC check on the transaction's own connection", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [
            defineCollection({
              slug: RBAC_SLUG,
              status: true,
              fields: [text({ name: "title" })],
            }),
          ],
        });
        const rbac = handle.getService<RBACAccessControlService>(
          "rbacAccessControlService"
        );

        // Judge a publish transition from INSIDE a caller-owned transaction,
        // passing the transaction's executor. The RBAC reads run on that
        // connection; a pooled read would block forever on the second checkout.
        const allowed = await withTimeout(
          handle.adapter.transaction(tx =>
            rbac.checkAccess({
              userId: "editor",
              operation: "publish",
              resource: RBAC_SLUG,
              executor: tx.getDrizzle(),
            })
          ),
          15_000
        );

        // The editor holds no roles and the collection defines no publish rule,
        // so publish is denied — the point is the decision was REACHED on the tx.
        expect(allowed).toBe(false);
      } finally {
        await handle?.destroy();
      }
    }, 30_000);

    it("completes a bulk create-as-published inside a caller-owned transaction", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [openCollection(BULK_CREATE_SLUG)],
        });
        const entries = handle
          .getService<CollectionsHandler>("collectionsHandler")
          .getEntryService() as CollectionEntryService;

        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.createEntriesInTransaction(
              tx,
              { collectionName: BULK_CREATE_SLUG, user: { id: "editor" } },
              [{ title: "t", status: "published" }]
            )
          ),
          15_000
        );

        expect(result.successful).toBe(1);
        expect(result.failed).toBe(0);
        const [row] = await handle.adapter.select<{ status: string }>(
          `dc_${BULK_CREATE_SLUG}`,
          {}
        );
        expect(row?.status).toBe("published");
      } finally {
        await handle?.destroy();
      }
    }, 30_000);

    it("completes a bulk update-to-published inside a caller-owned transaction", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [openCollection(BULK_UPDATE_SLUG)],
        });
        const h = handle.getService<CollectionsHandler>("collectionsHandler");
        const entries = h.getEntryService() as CollectionEntryService;
        const created = await h.createEntry(
          { collectionName: BULK_UPDATE_SLUG, overrideAccess: true },
          { title: "t", status: "draft" }
        );
        const id = (created.data as { id: string }).id;

        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.updateEntriesInTransaction(
              tx,
              { collectionName: BULK_UPDATE_SLUG, user: { id: "editor" } },
              [{ id, data: { title: "changed", status: "published" } }]
            )
          ),
          15_000
        );

        expect(result.successful).toBe(1);
        expect(result.failed).toBe(0);
        const [row] = await handle.adapter.select<{ status: string }>(
          `dc_${BULK_UPDATE_SLUG}`,
          {}
        );
        expect(row?.status).toBe("published");
      } finally {
        await handle?.destroy();
      }
    }, 30_000);

    it("completes a direct create-as-published inside a caller-owned transaction", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [openCollection(DIRECT_CREATE_SLUG)],
        });
        const entries = handle
          .getService<CollectionsHandler>("collectionsHandler")
          .getEntryService() as CollectionEntryService;

        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.createEntryInTransaction(
              tx,
              { collectionName: DIRECT_CREATE_SLUG, user: { id: "editor" } },
              { title: "t", status: "published" }
            )
          ),
          15_000
        );

        expect(result.success).toBe(true);
        const [row] = await handle.adapter.select<{ status: string }>(
          `dc_${DIRECT_CREATE_SLUG}`,
          {}
        );
        expect(row?.status).toBe("published");
      } finally {
        await handle?.destroy();
      }
    }, 30_000);

    it("completes a direct update-to-published inside a caller-owned transaction", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [openCollection(DIRECT_UPDATE_SLUG)],
        });
        const h = handle.getService<CollectionsHandler>("collectionsHandler");
        const entries = h.getEntryService() as CollectionEntryService;
        const created = await h.createEntry(
          { collectionName: DIRECT_UPDATE_SLUG, overrideAccess: true },
          { title: "t", status: "draft" }
        );
        const id = (created.data as { id: string }).id;

        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.updateEntryInTransaction(
              tx,
              {
                collectionName: DIRECT_UPDATE_SLUG,
                entryId: id,
                user: { id: "editor" },
              },
              { title: "changed", status: "published" }
            )
          ),
          15_000
        );

        expect(result.success).toBe(true);
        const [row] = await handle.adapter.select<{ status: string }>(
          `dc_${DIRECT_UPDATE_SLUG}`,
          {}
        );
        expect(row?.status).toBe("published");
      } finally {
        await handle?.destroy();
      }
    }, 30_000);

    it("completes a create with a stored uniqueness hook inside a caller-owned transaction", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [openCollection(HOOK_SLUG)],
        });
        // Configure the built-in `unique-validation` stored hook on `title`. It
        // runs on `beforeChange` and calls `context.queryDatabase`, which reads
        // the collection to check for a duplicate — the read that must run on
        // the caller's transaction connection, not the pool.
        await handle.adapter.update(
          "dynamic_collections",
          {
            hooks: [
              {
                hookId: "unique-validation",
                hookType: "beforeChange",
                enabled: true,
                config: { field: "title", errorMessage: "duplicate title" },
              },
            ],
          },
          { and: [{ column: "slug", op: "=", value: HOOK_SLUG }] }
        );

        const h = handle.getService<CollectionsHandler>("collectionsHandler");
        const entries = h.getEntryService() as CollectionEntryService;
        // Seed one row (trusted, on the pool) so the collection is non-empty.
        await h.createEntry(
          { collectionName: HOOK_SLUG, overrideAccess: true },
          { title: "seed", status: "draft" }
        );

        // Create a second row with a fresh title inside a caller-owned
        // transaction: the stored uniqueness hook's `queryDatabase` read runs
        // on the transaction's connection and COMPLETES; a pooled read blocks.
        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.createEntriesInTransaction(
              tx,
              { collectionName: HOOK_SLUG, user: { id: "editor" } },
              [{ title: "fresh", status: "draft" }]
            )
          ),
          15_000
        );

        expect(result.successful).toBe(1);
        expect(result.failed).toBe(0);
      } finally {
        await handle?.destroy();
      }
    }, 30_000);

    it("completes when a code afterCreate hook reads via context.executor in a caller-owned transaction", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      // A code-registered afterCreate hook that reads the collection registry
      // through the hook context's transaction executor. If the after-hook
      // context omits the executor, this read falls back to the pool and, on a
      // single-connection pool, deadlocks while the caller's transaction holds
      // the only connection.
      const afterHook: HookHandler = async context => {
        const registry = container.get<CollectionRegistryService>(
          "collectionRegistryService"
        );
        await registry.getCollectionBySlug(
          context.collection,
          context.executor
        );
      };
      try {
        handle = await createTestNextly({
          adapter,
          collections: [openCollection(AFTER_HOOK_SLUG)],
        });
        // Registered AFTER boot: createTestNextly resets the hook registry on
        // startup, and the running services share that same singleton registry.
        registerHook("afterCreate", AFTER_HOOK_SLUG, afterHook);
        const entries = handle
          .getService<CollectionsHandler>("collectionsHandler")
          .getEntryService() as CollectionEntryService;

        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.createEntriesInTransaction(
              tx,
              { collectionName: AFTER_HOOK_SLUG, user: { id: "editor" } },
              [{ title: "t", status: "draft" }]
            )
          ),
          15_000
        );

        expect(result.successful).toBe(1);
        expect(result.failed).toBe(0);
      } finally {
        unregisterHook("afterCreate", AFTER_HOOK_SLUG, afterHook);
        await handle?.destroy();
      }
    }, 30_000);

    it("completes a bulk delete with a beforeDelete hook in a caller-owned transaction", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      // A code beforeDelete hook reading the registry via context.executor.
      // Exercises both bindings of the delete worker: the metadata/owner reads
      // (getCollection/getOwnerConstraint) and the beforeDelete hook context.
      const beforeDeleteHook: HookHandler = async context => {
        const registry = container.get<CollectionRegistryService>(
          "collectionRegistryService"
        );
        await registry.getCollectionBySlug(
          context.collection,
          context.executor
        );
      };
      try {
        handle = await createTestNextly({
          adapter,
          collections: [openCollection(DELETE_SLUG)],
        });
        registerHook("beforeDelete", DELETE_SLUG, beforeDeleteHook);
        const h = handle.getService<CollectionsHandler>("collectionsHandler");
        const entries = h.getEntryService() as CollectionEntryService;
        const created = await h.createEntry(
          { collectionName: DELETE_SLUG, overrideAccess: true },
          { title: "doomed", status: "draft" }
        );
        const id = (created.data as { id: string }).id;

        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.deleteEntriesInTransaction(
              tx,
              { collectionName: DELETE_SLUG, user: { id: "editor" } },
              [id]
            )
          ),
          15_000
        );

        expect(result.successful).toBe(1);
        expect(result.failed).toBe(0);
      } finally {
        unregisterHook("beforeDelete", DELETE_SLUG, beforeDeleteHook);
        await handle?.destroy();
      }
    }, 30_000);

    it("completes a direct delete inside a caller-owned transaction", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          collections: [openCollection(DIRECT_DELETE_SLUG)],
        });
        const h = handle.getService<CollectionsHandler>("collectionsHandler");
        const entries = h.getEntryService() as CollectionEntryService;
        const created = await h.createEntry(
          { collectionName: DIRECT_DELETE_SLUG, overrideAccess: true },
          { title: "doomed", status: "draft" }
        );
        const id = (created.data as { id: string }).id;

        // The direct delete worker's access check + metadata reads must run on
        // the transaction connection; a pooled read would deadlock here.
        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.deleteEntryInTransaction(tx, {
              collectionName: DIRECT_DELETE_SLUG,
              entryId: id,
              user: { id: "editor" },
            })
          ),
          15_000
        );

        expect((result.data as { deleted?: boolean } | null)?.deleted).toBe(
          true
        );
      } finally {
        await handle?.destroy();
      }
    }, 30_000);

    it("completes when a code beforeOperation hook reads via context.executor", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      // A beforeOperation hook that reads the registry via context.executor.
      const beforeOpHook: HookHandler = async context => {
        const registry = container.get<CollectionRegistryService>(
          "collectionRegistryService"
        );
        await registry.getCollectionBySlug(
          context.collection,
          context.executor
        );
      };
      try {
        handle = await createTestNextly({
          adapter,
          collections: [openCollection(BEFOREOP_SLUG)],
        });
        registerHook("beforeOperation", BEFOREOP_SLUG, beforeOpHook);
        const entries = handle
          .getService<CollectionsHandler>("collectionsHandler")
          .getEntryService() as CollectionEntryService;

        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.createEntriesInTransaction(
              tx,
              { collectionName: BEFOREOP_SLUG, user: { id: "editor" } },
              [{ title: "t", status: "draft" }]
            )
          ),
          15_000
        );

        expect(result.successful).toBe(1);
        expect(result.failed).toBe(0);
      } finally {
        unregisterHook("beforeOperation", BEFOREOP_SLUG, beforeOpHook);
        await handle?.destroy();
      }
    }, 30_000);

    it("completes a localized bulk delete inside a caller-owned transaction", async () => {
      const adapter = await connectSingleConnection();
      let handle: TestNextly | undefined;
      try {
        handle = await createTestNextly({
          adapter,
          // A localized collection keeps translatable values in a companion
          // `<table>_locales`. Deleting a row assembles the removed document,
          // which loads the companion schema and reads its default-locale
          // values — both metadata/companion reads that must run on the
          // caller's transaction, not a second pooled connection.
          collections: [
            defineCollection({
              slug: LOCALIZED_DELETE_SLUG,
              status: true,
              localized: true,
              access: {
                create: () => true,
                read: () => true,
                update: () => true,
                delete: () => true,
                publish: () => true,
              },
              fields: [text({ name: "title", localized: true })],
            }),
          ],
          localization: { locales: ["en", "de"], defaultLocale: "en" },
        });
        const h = handle.getService<CollectionsHandler>("collectionsHandler");
        const entries = h.getEntryService() as CollectionEntryService;
        const created = await h.createEntry(
          { collectionName: LOCALIZED_DELETE_SLUG, overrideAccess: true },
          { title: "doomed", status: "draft" }
        );
        const id = (created.data as { id: string }).id;

        // The delete builds the removed document via loadCompanionSchema +
        // readCompanionLocalizedValues; both run on the transaction connection
        // and COMPLETE. Drop either binding and this deadlocks on the second
        // checkout against the single-connection pool.
        const result = await withTimeout(
          handle.adapter.transaction(tx =>
            entries.deleteEntriesInTransaction(
              tx,
              { collectionName: LOCALIZED_DELETE_SLUG, user: { id: "editor" } },
              [id]
            )
          ),
          15_000
        );

        expect(result.successful).toBe(1);
        expect(result.failed).toBe(0);
      } finally {
        await handle?.destroy();
      }
    }, 30_000);
  }
);
