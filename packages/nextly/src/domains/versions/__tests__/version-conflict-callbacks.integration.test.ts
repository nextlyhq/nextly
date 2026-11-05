/**
 * A version_no allocation race, retried by the adapter rather than around it.
 *
 * Each attempt registers what should run once its transaction ends. The first
 * attempt loses the race, rolls back and is tried again; the second commits.
 * Retried inside the adapter, the adapter knows the first attempt was not the
 * last: its commit callback is dropped with it, its rollback callback never
 * runs, and the second attempt's commit callback runs once. Retried around the
 * adapter, each attempt is a transaction that ends for good, so the first
 * attempt's rollback callback runs although the write went on to commit.
 *
 * When every attempt loses, the conflict itself reaches the caller, a 409,
 * and only the last attempt's rollback callback runs.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import { VersionCaptureService } from "../version-capture-service";
import { VersionConflictError } from "../version-conflict";

let handle: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "posts";

describe.each(getConfiguredTestDialects())(
  "a version conflict retried by the adapter (%s)",
  dialect => {
    async function boot() {
      handle = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: COLLECTION,
            versions: true,
            fields: [text({ name: "title" })],
          }),
        ],
      });
      return {
        entries: (
          handle.getService("collectionsHandler") as CollectionsHandler
        ).getEntryService() as CollectionEntryService,
        adapter: handle.adapter as unknown as DrizzleAdapter,
      };
    }

    it("runs the committed attempt's callback once, and no lost attempt's", async () => {
      const { entries, adapter } = await boot();
      const created = await entries.createEntry(
        { collectionName: COLLECTION, overrideAccess: true },
        { title: "first" }
      );
      const id = (created.data as { id: string }).id;
      const ran: string[] = [];
      let attempt = 0;
      const capture = VersionCaptureService.prototype.capture;
      vi.spyOn(VersionCaptureService.prototype, "capture").mockImplementation(
        async function (this: VersionCaptureService, ...args) {
          attempt += 1;
          const at = attempt;
          await adapter.afterCommit(() => ran.push(`commit ${String(at)}`));
          await adapter.afterRollback(() => ran.push(`rollback ${String(at)}`));
          // The first attempt loses the allocation race.
          if (at === 1) throw new VersionConflictError();
          return Reflect.apply(capture, this, args);
        }
      );

      await entries.updateEntry(
        { collectionName: COLLECTION, entryId: id, overrideAccess: true },
        { title: "second" }
      );

      expect(attempt).toBe(2);
      expect(ran).toEqual(["commit 2"]);
    });

    it("answers 409 once every attempt has lost, running the rollback callback of the last only", async () => {
      const { entries, adapter } = await boot();
      const created = await entries.createEntry(
        { collectionName: COLLECTION, overrideAccess: true },
        { title: "first" }
      );
      const id = (created.data as { id: string }).id;
      const ran: string[] = [];
      let attempt = 0;
      vi.spyOn(VersionCaptureService.prototype, "capture").mockImplementation(
        async () => {
          attempt += 1;
          const at = attempt;
          await adapter.afterCommit(() => ran.push(`commit ${String(at)}`));
          await adapter.afterRollback(() => ran.push(`rollback ${String(at)}`));
          // Every attempt loses the allocation race.
          throw new VersionConflictError();
        }
      );

      const result = await entries.updateEntry(
        { collectionName: COLLECTION, entryId: id, overrideAccess: true },
        { title: "second" }
      );

      // Three attempts, and the conflict itself reaches the caller, not a
      // classification of it.
      expect(attempt).toBe(3);
      expect(result).toMatchObject({
        success: false,
        statusCode: 409,
        code: "CONFLICT",
      });
      expect(ran).toEqual(["rollback 3"]);
    });
  }
);
