/**
 * A write that committed and then met a busy database is not answered with a
 * retry hint, on every dialect: a Single update, and publishing every language
 * of a collection entry (below).
 *
 * The update commits its row and outbox event, then builds its response, which
 * reads the database again to expand relationship fields. A busy pool there
 * used to reach the caller as DATABASE_BUSY with `retryAfterSeconds`, and
 * following that hint makes the change a second time. The expansion below
 * rejects with the adapters' own pool-wait timeout, the error that read
 * raises when it waits out its bound.
 *
 * The control is the same error from the update's transaction, before
 * anything commits: there a retry is safe, and the answer keeps its hint.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../config";
import { container } from "../../di/container";
import { CollectionMutationService } from "../../domains/collections/services/collection-mutation-service";
import { SingleQueryService } from "../../domains/singles/services/single-query-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../revalidation/types";
import {
  errorFromServiceEnvelope,
  type ServiceErrorEnvelope,
} from "../from-service-envelope";
import { NextlyError } from "../nextly-error";
import { retryAfterSeconds } from "../retry-after";

const banner = defineSingle({
  slug: "banner",
  fields: [text({ name: "headline" })],
});

let handle: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await handle?.destroy();
  handle = undefined;
});

/** The error a Direct API call rejected with. */
async function rejection(call: Promise<unknown>): Promise<NextlyError> {
  const error = await call.then(
    () => undefined,
    (e: unknown) => e
  );
  if (!NextlyError.is(error)) {
    throw new Error(`expected a NextlyError, got ${String(error)}`);
  }
  return error;
}

describe.each(getConfiguredTestDialects())(
  "a busy database around a Single update (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        singles: [banner],
      });
      return handle;
    }

    function update(nextly: TestNextly["nextly"], headline: string) {
      return nextly.updateSingle({
        slug: "banner",
        data: { headline },
        overrideAccess: true,
      });
    }

    async function storedHeadline(nextly: TestNextly["nextly"]) {
      const doc = (await nextly.findSingle({
        slug: "banner",
        overrideAccess: true,
      })) as { headline?: string };
      return doc.headline;
    }

    it("after the commit, answers that the change was saved, with no retry hint", async () => {
      const { nextly } = await boot();
      await update(nextly, "Before");
      vi.spyOn(
        SingleQueryService.prototype,
        "expandRelationshipFields"
      ).mockRejectedValueOnce(poolWaitTimeoutError(15000));

      const error = await rejection(update(nextly, "Saved once"));

      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.statusCode).toBe(500);
      expect(retryAfterSeconds(error)).toBeUndefined();
      expect(error.publicMessage).toMatch(/change was saved/);
      expect(await storedHeadline(nextly)).toBe("Saved once");
    });

    it("before the commit, keeps DATABASE_BUSY and its retry hint", async () => {
      const { nextly, adapter } = await boot();
      await update(nextly, "Before");
      vi.spyOn(adapter, "transaction").mockRejectedValueOnce(
        poolWaitTimeoutError(15000)
      );

      const error = await rejection(update(nextly, "Never saved"));

      expect(error.code).toBe("DATABASE_BUSY");
      expect(error.statusCode).toBe(503);
      expect(retryAfterSeconds(error)).toBe(5);
      expect(await storedHeadline(nextly)).toBe("Before");
    });
  }
);

/**
 * Publishing every language of a collection entry commits, then reads the
 * published slugs back to build its cache tags. A busy pool there used to
 * answer DATABASE_BUSY with a retry hint after the publish was durable.
 */
const pages = defineCollection({
  slug: "pages",
  localized: true,
  status: true,
  fields: [
    text({ name: "title", localized: false }),
    text({ name: "heading" }),
  ],
});

type PublishResult = ServiceErrorEnvelope & { success: boolean };

/** Records every flushed intent, so a test can see which tags a write busts. */
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  flush(intents: RevalidationIntent[]): void {
    this.flushed.push(...intents);
  }
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

describe.each(getConfiguredTestDialects())(
  "a busy database around publishing every language of an entry (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      // Registered before boot, so the services keep it over the no-op one.
      const revalidator = new RecordingRevalidator();
      container.registerSingleton<CacheRevalidator>(
        "cacheRevalidator",
        () => revalidator
      );
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [pages],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const created = (await handle.nextly.create({
        collection: "pages",
        data: { title: "A", heading: "h" },
      })) as unknown as { item: { id: string } };
      // Only what the publish flushes counts.
      revalidator.flushed.length = 0;
      const handler = handle.getService("collectionsHandler") as unknown as {
        publishAllLocales: (
          p: Record<string, unknown>
        ) => Promise<PublishResult>;
      };
      const publish = () =>
        handler.publishAllLocales({
          collectionName: "pages",
          entryId: created.item.id,
          overrideAccess: true,
        });
      const status = async () =>
        (
          (await handle!.nextly.findByID({
            collection: "pages",
            id: created.item.id,
            overrideAccess: true,
          })) as { status?: string }
        ).status;
      return {
        publish,
        status,
        adapter: handle.adapter,
        revalidator,
        id: created.item.id,
      };
    }

    it("after the commit, still busts the entry's cached pages", async () => {
      const { publish, revalidator, id } = await boot();
      vi.spyOn(
        CollectionMutationService.prototype as unknown as {
          readCompanionSlugsAllLocales: () => Promise<unknown>;
        },
        "readCompanionSlugsAllLocales"
      ).mockRejectedValueOnce(poolWaitTimeoutError(15000));

      await publish();

      // The caller is told not to retry, so this flush is the only one: the
      // published entry's own tag must be in it.
      expect(revalidator.tags.some(tag => tag.includes(id))).toBe(true);
    });

    it("after the commit, answers that the change was saved, with no retry hint", async () => {
      const { publish, status } = await boot();
      vi.spyOn(
        CollectionMutationService.prototype as unknown as {
          readCompanionSlugsAllLocales: () => Promise<unknown>;
        },
        "readCompanionSlugsAllLocales"
      ).mockRejectedValueOnce(poolWaitTimeoutError(15000));

      const result = await publish();
      // What the REST dispatcher and the Direct API rebuild from the result.
      const error = errorFromServiceEnvelope(result);

      expect(result.success).toBe(false);
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(retryAfterSeconds(error)).toBeUndefined();
      expect(error.publicMessage).toMatch(/change was saved/);
      expect(await status()).toBe("published");
    });

    it("before the commit, keeps DATABASE_BUSY and its retry hint, and busts nothing", async () => {
      const { publish, status, adapter, revalidator } = await boot();
      vi.spyOn(adapter, "transaction").mockRejectedValueOnce(
        poolWaitTimeoutError(15000)
      );

      const error = errorFromServiceEnvelope(await publish());

      expect(error.code).toBe("DATABASE_BUSY");
      expect(retryAfterSeconds(error)).toBe(5);
      expect(await status()).toBe("draft");
      expect(revalidator.tags).toEqual([]);
    });
  }
);
