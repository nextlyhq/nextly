/**
 * A plugin's media delete removes the item's stored files durably, on every
 * dialect: the files are recorded as left to remove in the delete's own
 * transaction, with the finalising job queued there, so a removal storage
 * refuses keeps its record, and the job removes the file once storage takes
 * deletes again. A removal that succeeds leaves no record behind, and a
 * standing Undo mark goes with the item, as an ordinary delete takes it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";
import type { JobRegistry } from "../../domains/jobs/job-registry";
import { runJobNow } from "../../domains/jobs/jobs-runner";
import { MEDIA_FINALIZE_DELETES_JOB } from "../../domains/media/finalize-deletes-job";
import {
  PENDING_DELETE_WINDOW_MS,
  pendingDeleteKey,
  removingKey,
} from "../../domains/media/pending-delete";
import { pdfDocument } from "../../services/upload-validation/__tests__/format-fixtures";
import { getMediaStorage } from "../../storage/storage";
import { definePlugin, type PluginContext } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

type Doc = Record<string, unknown>;

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  ctx = undefined;
});

const probe = definePlugin({
  name: "@test/media-delete-probe",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(context: PluginContext) {
    ctx = context;
  },
} as never);

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    plugins: [probe],
  });
  const t = current;
  const media = ctx!.services.media;

  /** A file the plugin stored, and the name storage keeps it under. */
  const stored = async (marker: string) => {
    const bytes = pdfDocument(marker);
    const item = await media.upload(
      {
        buffer: bytes,
        filename: `${marker}.pdf`,
        mimeType: "application/pdf",
        size: bytes.length,
      },
      { as: "system" }
    );
    return { id: item.id, filename: item.filename };
  };

  /** The `nextly_meta` rows a delete of `id` keeps: a mark, a removal. */
  const records = async (id: string) =>
    (
      await t.adapter.select<Doc>("nextly_meta", {
        columns: ["key"],
        where: {
          and: [
            {
              column: "key",
              op: "IN",
              value: [pendingDeleteKey(id), removingKey(id)],
            },
          ],
        },
      })
    )
      .map(row => String(row.key))
      .sort();

  /** The finalising job queued for `id`. */
  const queuedJob = async (id: string) => {
    const jobs = (
      await t.adapter.select<Doc>("nextly_jobs", {
        where: {
          and: [{ column: "slug", op: "=", value: MEDIA_FINALIZE_DELETES_JOB }],
        },
      })
    ).filter(job =>
      (typeof job.input === "string"
        ? job.input
        : JSON.stringify(job.input)
      ).includes(id)
    );
    expect(jobs).toHaveLength(1);
    return String(jobs[0]!.id);
  };

  const rowOf = async (id: string) =>
    (
      await t.adapter.select<Doc>("media", {
        where: { and: [{ column: "id", op: "=", value: id }] },
      })
    )[0];

  return { t, media, stored, records, queuedJob, rowOf };
}

describe.each(getConfiguredTestDialects())(
  "a plugin's media delete (%s)",
  dialect => {
    it("keeps the record of a file storage could not remove, and the job removes it once it can", async () => {
      const { t, media, stored, records, queuedJob, rowOf } =
        await boot(dialect);
      const file = await stored("refused");
      const storage = getMediaStorage();
      const refusing = vi
        .spyOn(storage, "delete")
        .mockRejectedValue(new Error("the bucket refused the delete"));

      await media.delete(file.id, { as: "system" });

      expect(refusing).toHaveBeenCalled();
      refusing.mockRestore();
      expect(await rowOf(file.id)).toBeUndefined();
      expect(await storage.exists(file.filename, "media")).toBe(true);
      expect(await records(file.id)).toEqual([removingKey(file.id)]);

      // The job, run once storage takes deletes again, removes the file.
      const run = await runJobNow(
        t.adapter,
        container.get<JobRegistry>("jobRegistry"),
        await queuedJob(file.id),
        { now: () => new Date(Date.now() + PENDING_DELETE_WINDOW_MS + 1_000) }
      );

      expect(run.claimed).toBe(1);
      expect(await storage.exists(file.filename, "media")).toBe(false);
      expect(await records(file.id)).toEqual([]);
    });

    it("removes the files and leaves no record when storage takes the delete", async () => {
      const { media, stored, records, rowOf } = await boot(dialect);
      const file = await stored("taken");

      await media.delete(file.id, { as: "system" });

      expect(await rowOf(file.id)).toBeUndefined();
      expect(await getMediaStorage().exists(file.filename, "media")).toBe(
        false
      );
      expect(await records(file.id)).toEqual([]);
    });

    it("takes a standing Undo mark with the item, and answers not-found for one already gone", async () => {
      const { t, media, stored, records } = await boot(dialect);
      const file = await stored("marked");
      await t.adapter.insert("nextly_meta", {
        key: pendingDeleteKey(file.id),
        value: JSON.stringify({}),
        updated_at: new Date(),
      });

      await media.delete(file.id, { as: "system" });

      expect(await records(file.id)).toEqual([]);
      await expect(
        media.delete(file.id, { as: "system" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  }
);
