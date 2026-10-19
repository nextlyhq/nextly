// `nextly_meta`'s conditional writes against a real database, with the
// object values callers claim with. A compare-and-set that never matches an
// object on one dialect turns every claim built on it into a refusal there.

import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../../database/sqlite-core-tables";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { MetaService } from "../meta-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function meta(dialect: TestDialect): Promise<MetaService> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  if (dialect === "sqlite") {
    for (const statement of generateSqliteCoreTableStatements()) {
      await current.adapter.executeQuery(statement);
    }
  }
  return current.getService("metaService") as unknown as MetaService;
}

describe.each(getConfiguredTestDialects())(
  "nextly_meta conditional writes (%s)",
  (dialect: TestDialect) => {
    it("moves an object value only from the value it holds", async () => {
      const m = await meta(dialect);
      const first = { digest: "abc", createdAt: 1, printed: false };
      await m.insertIfAbsent("probe.cas", first);

      expect(
        await m.compareAndSet(
          "probe.cas",
          { ...first, printed: true },
          { stale: true }
        )
      ).toBe(false);
      expect(
        await m.compareAndSet("probe.cas", first, { ...first, printed: true })
      ).toBe(true);
      expect(await m.get("probe.cas")).toEqual({ ...first, printed: true });
    });
  }
);
