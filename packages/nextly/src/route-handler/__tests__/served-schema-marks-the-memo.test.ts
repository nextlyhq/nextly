/**
 * Checking the stored schema version marks the request's memo, so a Direct API call made later in
 * the same request keeps the definitions it was checked against, and a memo whose request never
 * checked carries no mark.
 */
import { describe, expect, it } from "vitest";

import {
  memoSchemaChecked,
  runWithAccessMemo,
} from "../../auth/access/request-memo";
import { servedSchemaVersion } from "../schema-version";

describe("the stored schema version and the request's memo", () => {
  it("marks the memo open when the version is checked, and only that memo", async () => {
    await runWithAccessMemo(async () => {
      expect(memoSchemaChecked()).toBe(false);
      await servedSchemaVersion();
      expect(memoSchemaChecked()).toBe(true);
    });
    await runWithAccessMemo(async () => {
      expect(memoSchemaChecked()).toBe(false);
    });
  });
});
