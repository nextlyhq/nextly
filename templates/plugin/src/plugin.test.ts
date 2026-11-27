import {
  createTestNextly,
  getConfiguredTestDialects,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { myPlugin } from "./index";

// SQLite always, and PostgreSQL or MySQL too when their server URLs are set
// (TEST_POSTGRES_URL, TEST_MYSQL_URL), so the suite proves the plugin on each
// database it can reach. `declaration.test.ts` holds the declaration's
// `databases` to the same list.
describe.each(getConfiguredTestDialects())("on %s", dialect => {
  let t: Awaited<ReturnType<typeof createTestNextly>>;

  beforeEach(async () => {
    // `plugins` alone. Runtime auto-sync creates the tables for contributed
    // collections during registration, so passing them again as `collections`
    // registers the same slugs as code-owned entities and boot fails with
    // NEXTLY_SCHEMA_SLUG_COLLISION.
    t = await createTestNextly({ plugins: [myPlugin()], dialect });
  });

  afterEach(async () => {
    await t.destroy();
  });

  it("boots and exposes the plugin's example collection (real table)", async () => {
    // Creating an entry proves the contributed collection got a real table and
    // the plugin's lifecycle ran. Replace with assertions for your own behavior.
    // The Direct API takes one argument object per call.
    const created = await t.nextly.create({
      collection: "examples",
      data: { title: "First example" },
    });
    expect(created.item.id).toBeDefined();

    const fetched = await t.nextly.findByID({
      collection: "examples",
      id: String(created.item.id),
    });
    expect(fetched?.title).toBe("First example");
  });
});
