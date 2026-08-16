import { createTestNextly } from "@nextlyhq/plugin-sdk/testing";
import { afterEach, beforeEach, expect, it } from "vitest";

import { myPlugin } from "./index";

let t: Awaited<ReturnType<typeof createTestNextly>>;

beforeEach(async () => {
  // `plugins` alone. Runtime auto-sync creates the tables for contributed
  // collections during registration, so passing them again as `collections`
  // registers the same slugs as code-owned entities and boot fails with
  // NEXTLY_SCHEMA_SLUG_COLLISION.
  t = await createTestNextly({ plugins: [myPlugin()] });
});

afterEach(async () => {
  await t.destroy();
});

it("boots and exposes the plugin's example collection (real table)", async () => {
  // Creating an entry proves the contributed collection got a real table and
  // the plugin's lifecycle ran. Replace with assertions for your own behavior.
  const created = await t.nextly.create("examples", { title: "First example" });
  expect(created.item.id).toBeDefined();

  const fetched = await t.nextly.findById("examples", created.item.id);
  expect(fetched?.title).toBe("First example");
});
