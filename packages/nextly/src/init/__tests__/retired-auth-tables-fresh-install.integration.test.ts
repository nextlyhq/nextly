/**
 * A fresh install creates neither the retired `accounts` nor the retired
 * `sessions` table.
 *
 * Boots a dedicated database through the normal first-run path on every
 * dialect with a database in this run. `users` is asserted present in the
 * same run, so an empty catalogue cannot pass the absence checks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

describe.each(getConfiguredTestDialects())(
  "a fresh install on %s",
  (dialect: TestDialect) => {
    let handle: TestNextly;

    beforeAll(async () => {
      handle = await createTestNextly({ dialect });
    });

    afterAll(async () => {
      await handle?.destroy();
    });

    it("creates neither `accounts` nor `sessions`", async () => {
      expect(await handle.adapter.tableExists("users")).toBe(true);
      expect(await handle.adapter.tableExists("accounts")).toBe(false);
      expect(await handle.adapter.tableExists("sessions")).toBe(false);
    });
  }
);
