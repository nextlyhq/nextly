/**
 * A migration never runs inside a transaction someone else opened.
 *
 * A transaction opened inside another now joins it. A migration must not: on
 * MySQL its DDL would commit the outer transaction implicitly, and on SQLite
 * the foreign-key switch it needs does nothing inside a transaction. So
 * `executeTransaction` refuses, on every dialect, before its work runs, and
 * leaves the outer transaction as it was.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { executeTransaction } from "../migration-transaction";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a migration inside an open transaction (%s)",
  dialect => {
    it("is refused before its work runs", async () => {
      handle = await createTestNextly({ dialect });
      const adapter = handle.adapter as unknown as DrizzleAdapter;
      let ran = false;

      const refusal = await adapter
        .transaction(() =>
          executeTransaction(adapter, async () => {
            ran = true;
          })
        )
        .catch((error: unknown) => error);

      expect(ran).toBe(false);
      expect(NextlyError.is(refusal)).toBe(true);
    });

    it("runs on its own outside any transaction", async () => {
      handle = await createTestNextly({ dialect });
      const adapter = handle.adapter as unknown as DrizzleAdapter;

      const result = await executeTransaction(adapter, async () => "ran");

      expect(result).toBe("ran");
    });
  }
);
