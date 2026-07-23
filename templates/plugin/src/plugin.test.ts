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
  // Direct API methods take a single args object ({ collection, data, id }),
  // and mutations return a { message, item } envelope.
  const created = await t.nextly.create({
    collection: "examples",
    data: { title: "First example" },
  });
  expect(created.item.id).toBeDefined();

  // String() narrows the loosely typed id — a fresh scaffold has no
  // generated collection types yet, and findByID expects a string id.
  const fetched = await t.nextly.findByID({
    collection: "examples",
    id: String(created.item.id),
  });
  expect(fetched?.title).toBe("First example");
});
