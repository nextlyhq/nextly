import { createTestNextly } from "@nextlyhq/plugin-sdk/testing";
import { afterEach, beforeEach, expect, it } from "vitest";

import { myPlugin } from "./index";

let t: Awaited<ReturnType<typeof createTestNextly>>;

beforeEach(async () => {
  // The harness runs the full plugin lifecycle, including schema
  // contributions — contributed collections must NOT be passed again via
  // `collections` (that registers them twice and fails as a slug collision).
  t = await createTestNextly({ plugins: [myPlugin()] });
});

afterEach(async () => {
  await t.destroy();
});

it("boots and exposes the plugin's example collection (real table)", async () => {
  // Creating an entry proves the contributed collection got a real table and
  // the plugin's lifecycle ran. Replace with assertions for your own behavior.
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
