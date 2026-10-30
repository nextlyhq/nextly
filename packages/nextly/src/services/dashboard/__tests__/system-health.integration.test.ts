/**
 * System health against a real database: each problem it reports, on the card
 * and as a Needs your attention item, for a super-admin; and nothing at all
 * for an editor, who is neither offered the card nor shown the items.
 *
 * What only a database can settle: that the ledger's own rows are read as the
 * schema domain writes them (a migration's apply or rollback that failed or
 * never finished, a collection's failed schema change), on every dialect, and that
 * the one super-admin decision reads the roles the database holds.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  superAdminUser,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { readAccessCaller } from "../../../auth/entity-read-access";
import { recordRollbackFailed } from "../../../cli/commands/plugin-module-rollback";
import { defineCollection, text } from "../../../config";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { runDigest } from "../../../domains/widgets/attention/digest";
import { createBatchScope } from "../../../domains/widgets/batch-scope";
import { refreshContentSources } from "../../../domains/widgets/content-sources";
import { needsAttentionWidget } from "../../../domains/widgets/core-widgets/needs-attention";
import { systemHealthWidget } from "../../../domains/widgets/core-widgets/system-health";
import { bindReadServices } from "../../../domains/widgets/declaration/read-services";
import { widgetAudience } from "../../../domains/widgets/visibility";
import {
  _resetBootMigrationsGateForTest,
  openBootMigrationsGate,
} from "../../../init/boot-migrations-gate";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { recordStorageWriteSuccess } from "../../../storage/last-write-failure";
import { MediaStorage } from "../../../storage/storage";
import type { IStorageAdapter } from "../../../storage/types";
import type { ReadCaller } from "../readable-resources";
import { systemProblemReaders } from "../system-health-source";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const NOTES = "shi_notes";

let current: TestNextly | undefined;

beforeEach(() => {
  // The storage record is the process's: start every case with it clear.
  recordStorageWriteSuccess();
});

afterEach(async () => {
  _resetBootMigrationsGateForTest();
  recordStorageWriteSuccess();
  await current?.destroy();
  current = undefined;
});

/** Read services bound to `caller`, as a batch binds a card's. */
function servicesFor(caller: ReadCaller) {
  const signal = new AbortController().signal;
  const now = new Date();
  return {
    signal,
    now,
    services: bindReadServices({
      caller,
      prepare: () => Promise.reject(new Error("the card reads no collection")),
      signal,
      now,
    }),
  };
}

/** System health's answer for `caller`, as a batch answers the card. */
function healthFor(caller: ReadCaller) {
  const { signal, now, services } = servicesFor(caller);
  return systemHealthWidget.load({
    settings: {},
    user: caller.user,
    signal,
    now,
    scope: createBatchScope().forOwner("core"),
    size: { w: 4, h: 3, tier: "medium" },
    services,
  });
}

/** The Needs your attention card's system items for `caller`, by id. */
async function systemItemsFor(caller: ReadCaller) {
  const { signal, now, services } = servicesFor(caller);
  const answer = await needsAttentionWidget.load({
    settings: {},
    user: caller.user,
    signal,
    now,
    scope: createBatchScope().forOwner("core"),
    size: { w: 8, h: 3, tier: "medium" },
    services,
  });
  return answer.items.filter(item => item.kind === "system");
}

/** Whether `caller` is offered System health at all. */
async function offered(caller: ReadCaller): Promise<boolean> {
  const audience = await widgetAudience(readAccessCaller(caller));
  return audience.visible.some(widget => widget.id === "core/system-health");
}

/** Storage routing `media` to an adapter of type "s3" whose uploads answer with `upload`. */
function storageAnswering(upload: IStorageAdapter["upload"]): MediaStorage {
  return new MediaStorage({
    plugins: [
      {
        name: "s3-storage",
        type: "s3",
        collections: { media: true },
        adapter: {
          upload,
          delete: () => Promise.resolve(),
          exists: () => Promise.resolve(true),
          getPublicUrl: path => `https://s3.test/${path}`,
          getType: () => "s3",
        },
      },
    ],
  });
}

const write = (storage: MediaStorage) =>
  storage.upload(Buffer.from("x"), {
    filename: "a.jpg",
    mimeType: "image/jpeg",
    collection: "media",
  });

describe.each(getConfiguredTestDialects())(
  "System health (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
        ],
      });
      await refreshContentSources();
      const t = current;
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "shi-admin") },
      };
      const editor: ReadCaller = {
        user: { id: await userWhoMay(t, "shi-editor", "read", [NOTES]) },
      };
      const ledger = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        dialect
      );
      return { t, admin, editor, ledger };
    }

    /** What an editor is shown: never the card, never an item. */
    async function editorSeesNothing(editor: ReadCaller) {
      expect(await offered(editor)).toBe(false);
      await expect(healthFor(editor)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await systemItemsFor(editor)).toEqual([]);
    }

    it("reports a healthy install to a super-admin, and nothing to an editor", async () => {
      const { admin, editor } = await boot();
      expect(await offered(admin)).toBe(true);
      expect(await healthFor(admin)).toEqual({
        version: expect.any(String),
        migrations: { status: "ok", failed: 0, pending: 0 },
        schemaChanges: { failed: [], more: 0 },
        storage: { status: "ok" },
      });
      expect(await systemItemsFor(admin)).toEqual([]);
      await editorSeesNothing(editor);
    });

    it("reports a failed migration, on the card and in Needs your attention", async () => {
      const { admin, editor, ledger } = await boot();
      const id = await ledger.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: "0001_shi_failed.sql",
      });
      await ledger.markFailed(id, { errorCode: "TEST" });

      expect((await healthFor(admin)).migrations).toEqual({
        status: "failed",
        failed: 1,
        pending: 0,
      });
      expect(await systemItemsFor(admin)).toEqual([
        expect.objectContaining({
          id: "core/system-migrations-failed",
          count: 1,
          severity: "critical",
          reason: "A migration did not finish applying or rolling back.",
          link: "#system-health",
        }),
      ]);
      await editorSeesNothing(editor);
    });

    it("reports an applied migration whose migrate:down failed, as migrate:status warns of it", async () => {
      const { admin, editor, ledger } = await boot();
      const applied = await ledger.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: "0003_shi_rollback.sql",
      });
      await ledger.markApplied(applied, {});
      // The control: applied, and nothing since.
      expect((await healthFor(admin)).migrations.status).toBe("ok");

      // Recorded as migrate:down records a DOWN that failed: a rollback row,
      // never a change to the applied one.
      await recordRollbackFailed({
        repo: ledger,
        filename: "0003_shi_rollback.sql",
        dialect,
        note: "migrate:down failed: TEST",
      });

      expect((await healthFor(admin)).migrations).toEqual({
        status: "failed",
        failed: 1,
        pending: 0,
      });
      expect(await systemItemsFor(admin)).toEqual([
        expect.objectContaining({
          id: "core/system-migrations-failed",
          count: 1,
          severity: "critical",
        }),
      ]);
      await editorSeesNothing(editor);
    });

    it("reports a pending migration while boot migrations are applying", async () => {
      const { admin, editor, ledger } = await boot();
      await ledger.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: "0002_shi_pending.sql",
      });
      openBootMigrationsGate();

      expect((await healthFor(admin)).migrations).toEqual({
        status: "pending",
        failed: 0,
        pending: 1,
      });
      // The kind's own readers, as the digest runs them: the release kinds
      // read through services that wait on the gate this case holds open.
      const items = await runDigest(systemProblemReaders(admin));
      expect(items.map(item => [item.id, item.count])).toEqual([
        ["core/system-migrations-pending", 1],
      ]);
      expect(await runDigest(systemProblemReaders(editor))).toEqual([]);
      expect(await offered(editor)).toBe(false);
    });

    it("reports a collection's failed schema change, linking the collections", async () => {
      const { admin, editor, ledger } = await boot();
      const id = await ledger.recordStart({
        eventType: "ui_save",
        source: "admin-ui",
        scopeKind: "collection",
        scopeSlug: NOTES,
      });
      await ledger.markFailed(id, { errorCode: "TEST" });

      expect((await healthFor(admin)).schemaChanges).toEqual({
        failed: [{ slug: NOTES, label: expect.any(String) }],
        more: 0,
      });
      expect(await systemItemsFor(admin)).toEqual([
        expect.objectContaining({
          id: "core/system-schema-changes",
          count: 1,
          severity: "critical",
          link: "builder/collections",
        }),
      ]);
      await editorSeesNothing(editor);
    });

    it("reports the storage adapter's failed write until a write succeeds", async () => {
      const { admin, editor } = await boot();
      const failing = storageAnswering(() =>
        Promise.reject(
          Object.assign(new Error("down"), { code: "ECONNREFUSED" })
        )
      );
      await expect(write(failing)).rejects.toThrow("down");

      expect((await healthFor(admin)).storage).toEqual({
        status: "failed",
        failedAt: expect.any(String),
        adapter: "s3",
        reason: "The storage service could not be reached.",
      });
      expect(await systemItemsFor(admin)).toEqual([
        expect.objectContaining({
          id: "core/system-storage",
          count: 1,
          link: "media",
        }),
      ]);
      await editorSeesNothing(editor);

      const working = storageAnswering(() =>
        Promise.resolve({ url: "https://s3.test/a.jpg", path: "a.jpg" })
      );
      await write(working);
      expect((await healthFor(admin)).storage).toEqual({ status: "ok" });
      expect(await systemItemsFor(admin)).toEqual([]);
    });
  }
);
