/**
 * A Single update that committed and then met a busy database is not answered
 * with a retry hint, on every dialect.
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

import { defineSingle, text } from "../../config";
import { SingleQueryService } from "../../domains/singles/services/single-query-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
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
