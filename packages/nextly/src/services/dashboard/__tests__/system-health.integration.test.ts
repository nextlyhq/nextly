/**
 * System health against a real database: each problem it reports, on the card
 * and as a Needs your attention item, for a super-admin; and nothing at all
 * for an editor, who is neither offered the card nor shown the items.
 *
 * What only a database can settle: that the ledger's own rows are read as the
 * schema domain writes them (a migration's apply or rollback that failed or
 * never finished, a collection's failed or interrupted schema change, each
 * found by its own rows however many events came after), on every dialect, and that
 * the one super-admin decision reads the roles the database holds.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  superAdminUser,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { readAccessCaller } from "../../../auth/entity-read-access";
import { container } from "../../../di/container";
import { recordRollbackFailed } from "../../../cli/commands/plugin-module-rollback";
import { defineCollection, text } from "../../../config";
import { SCHEMA_CHANGE_STALE_MS } from "../../../domains/schema/events/schema-problems";
import { forgetLatestVersion } from "../../../domains/health/latest-version";
import { JobsRepository } from "../../../domains/jobs/jobs-repository";
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
import {
  ENCRYPTED_CONNECTIONS_DOCS,
  systemProblemReaders,
} from "../system-health-source";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const NOTES = "shi_notes";

let current: TestNextly | undefined;

beforeEach(() => {
  // The storage record is the process's: start every case with it clear.
  recordStorageWriteSuccess();
  // The newest-version read never reaches the registry from a test: it
  // answers the tags below, for this case alone.
  forgetLatestVersion();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ latest: "99.0.0", alpha: "99.0.0-alpha.1" })
        )
      )
    )
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  forgetLatestVersion();
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
      const health = await healthFor(admin);
      expect(health).toEqual({
        version: expect.any(String),
        // The stubbed registry's channels are all ahead of the build.
        latest: { status: "update", version: expect.any(String) },
        environment: { production: false },
        database: {
          dialect,
          serverVersion: expect.stringMatching(/^\d+\.\d+/),
          roundTripMs: expect.any(Number),
          // The test databases are reached without TLS, and SQLite is a file.
          encryption: dialect === "sqlite" ? "not-applicable" : "unencrypted",
          exposed: false,
        },
        migrations: { status: "ok", failed: 0, pending: 0 },
        schemaChanges: { failed: [], more: 0 },
        storage: { status: "ok", type: expect.any(String) },
        email: { provider: null },
        jobs: { queued: 0, running: 0, failed: 0 },
        runtime: expect.objectContaining({ node: process.versions.node }),
        plugins: [],
      });
      expect(await systemItemsFor(admin)).toEqual([]);
      await editorSeesNothing(editor);
    });

    it("says couldn't check for updates when the registry cannot be reached", async () => {
      const { admin } = await boot();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new TypeError("fetch failed")))
      );
      const health = await healthFor(admin);
      expect(health.latest).toEqual({ status: "unknown" });
      // The rest of the card is still answered.
      expect(health.migrations.status).toBe("ok");
      expect(await systemItemsFor(admin)).toEqual([]);
    });

    it("counts queued, running and recently failed jobs, and the default email provider", async () => {
      const { t, admin } = await boot();
      const jobs = new JobsRepository(t.adapter);
      const now = new Date();
      const job = (key: string) =>
        jobs.enqueue({
          slug: "shi-job",
          input: {},
          runAt: null,
          runAsUserId: null,
          dedupeKey: key,
          now,
        });
      await job("shi-a");
      await job("shi-b");
      const running = await job("shi-c");
      const failed = await job("shi-d");
      const failedLongAgo = await job("shi-e");
      const done = await job("shi-f");
      const set = (id: string, data: Record<string, unknown>) =>
        t.adapter.update("nextly_jobs", data, {
          and: [{ column: "id", op: "=", value: id }],
        });
      await set(running.id, { state: "running" });
      await set(failed.id, { state: "failed", updatedAt: new Date() });
      await set(failedLongAgo.id, {
        state: "failed",
        updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });
      await set(done.id, { state: "done" });

      await t.getService("emailProviderService").createProvider({
        name: "Main",
        type: "smtp",
        fromEmail: "noreply@example.com",
        fromName: null,
        configuration: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          auth: { user: "postmaster", pass: "secret-value" },
        },
        isDefault: true,
        isActive: true,
      });

      const health = await healthFor(admin);
      expect(health.jobs).toEqual({ queued: 2, running: 1, failed: 1 });
      expect(health.email).toEqual({ provider: "SMTP" });
    });

    it("lists an unencrypted connection to another machine in production as a danger, with how to fix it", async () => {
      const { t, admin, editor } = await boot();
      vi.stubEnv("NODE_ENV", "production");
      // The read as a database on another machine, reached without TLS, answers it.
      vi.spyOn(t.adapter, "inspectConnection").mockResolvedValue({
        encryption: "unencrypted",
        local: false,
      });
      expect((await healthFor(admin)).database).toMatchObject({
        encryption: "unencrypted",
        exposed: true,
      });
      expect(await systemItemsFor(admin)).toEqual([
        expect.objectContaining({
          id: "core/system-connection-unencrypted",
          label: "Database connection is not encrypted",
          count: 1,
          severity: "critical",
          help: ENCRYPTED_CONNECTIONS_DOCS,
          single: true,
        }),
      ]);
      await editorSeesNothing(editor);
    });

    it("lists a connection whose encryption could not be read in production as a warning, never as encrypted", async () => {
      const { t, admin } = await boot();
      vi.stubEnv("NODE_ENV", "production");
      vi.spyOn(t.adapter, "inspectConnection").mockResolvedValue({
        encryption: "unknown",
        local: false,
      });
      expect((await healthFor(admin)).database.encryption).toBe("unknown");
      expect(await systemItemsFor(admin)).toEqual([
        expect.objectContaining({
          id: "core/system-connection-unchecked",
          severity: "warning",
          help: ENCRYPTED_CONNECTIONS_DOCS,
        }),
      ]);
    });

    it("lists nothing for an unencrypted connection on this machine, or outside production", async () => {
      const { t, admin } = await boot();
      vi.spyOn(t.adapter, "inspectConnection").mockResolvedValue({
        encryption: "unencrypted",
        local: false,
      });
      // Not production: shown on the card, and not a problem.
      expect(await systemItemsFor(admin)).toEqual([]);
      vi.stubEnv("NODE_ENV", "production");
      vi.spyOn(t.adapter, "inspectConnection").mockResolvedValue({
        encryption: "unencrypted",
        local: true,
      });
      expect(await systemItemsFor(admin)).toEqual([]);
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
          reason:
            "A migration did not finish applying or rolling back. Run nextly migrate:status to see which.",
        }),
      ]);
      // No admin page is the place to act on a migration, so it links nowhere.
      expect((await systemItemsFor(admin))[0]).not.toHaveProperty("link");
      await editorSeesNothing(editor);
    });

    it("still reports an older failed migration and schema change behind many newer events", async () => {
      const { admin, ledger } = await boot();
      const failedApply = await ledger.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: "0004_shi_old.sql",
      });
      await ledger.markFailed(failedApply, { errorCode: "TEST" });
      const failedSave = await ledger.recordStart({
        eventType: "ui_save",
        source: "admin-ui",
        scopeKind: "collection",
        scopeSlug: NOTES,
      });
      await ledger.markFailed(failedSave, { errorCode: "TEST" });
      // More newer, unrelated, successful events than any one window of the
      // ledger's newest: each key is judged by its own rows.
      for (let i = 0; i < 600; i += 1) {
        await ledger.insertEvent({
          eventType: "ui_save",
          source: "admin-ui",
          status: "applied",
          scopeKind: "collection",
          scopeSlug: "shi_other",
          startedAt: new Date(Date.now() + 1000 + i),
        });
      }

      const health = await healthFor(admin);
      expect(health.migrations).toEqual({
        status: "failed",
        failed: 1,
        pending: 0,
      });
      expect(health.schemaChanges.failed).toEqual([
        { slug: NOTES, label: expect.any(String) },
      ]);
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

    it("reports a migration another process is applying as pending, and an interrupted one as failed", async () => {
      const { admin, ledger } = await boot();
      // The gate is settled: this process is applying nothing, so the attempt
      // was recorded by another (a CLI, a second instance), a moment ago.
      await ledger.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: "0005_shi_running.sql",
      });
      // 🔴 Counted as failed once this process's gate settled, an ordinary
      // rolling deployment raised a critical failed-migration alert.
      expect((await healthFor(admin)).migrations).toEqual({
        status: "pending",
        failed: 0,
        pending: 1,
      });
      expect(
        (await systemItemsFor(admin)).map(item => [item.id, item.count])
      ).toEqual([["core/system-migrations-pending", 1]]);

      // Open past the stale threshold: its process stopped.
      await ledger.insertEvent({
        eventType: "file_apply",
        source: "cli-migrate",
        status: "in_progress",
        filename: "0006_shi_interrupted.sql",
        startedAt: new Date(Date.now() - SCHEMA_CHANGE_STALE_MS - 60_000),
      });
      expect((await healthFor(admin)).migrations).toEqual({
        status: "failed",
        failed: 1,
        pending: 1,
      });
      expect(
        (await systemItemsFor(admin)).map(item => [item.id, item.count]).sort()
      ).toEqual([
        ["core/system-migrations-failed", 1],
        ["core/system-migrations-pending", 1],
      ]);
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

    it("reports an interrupted schema change, and not one still running", async () => {
      const { admin, ledger } = await boot();
      // Started and never ended: its process stopped between start and end.
      await ledger.insertEvent({
        eventType: "dev_push",
        source: "dev-server",
        status: "in_progress",
        scopeKind: "collection",
        scopeSlug: NOTES,
        startedAt: new Date(Date.now() - SCHEMA_CHANGE_STALE_MS - 60_000),
      });
      expect((await healthFor(admin)).schemaChanges.failed).toEqual([
        { slug: NOTES, label: expect.any(String) },
      ]);

      // A change started a moment ago is running, and is the newest.
      await ledger.recordStart({
        eventType: "ui_save",
        source: "admin-ui",
        scopeKind: "collection",
        scopeSlug: NOTES,
      });
      expect((await healthFor(admin)).schemaChanges.failed).toEqual([]);
    });

    it("names the adapter the media library writes through, not the local fallback", async () => {
      const { admin } = await boot();
      // Storage routing media to S3, as an install with a cloud adapter has it.
      container.registerSingleton("mediaStorage", () =>
        storageAnswering(() =>
          Promise.resolve({ url: "https://s3.test/a.jpg", path: "a.jpg" })
        )
      );
      expect((await healthFor(admin)).storage).toEqual({
        status: "ok",
        type: "s3",
      });
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
        type: expect.any(String),
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
      expect((await healthFor(admin)).storage).toEqual({
        status: "ok",
        type: expect.any(String),
      });
      expect(await systemItemsFor(admin)).toEqual([]);
    });
  }
);
