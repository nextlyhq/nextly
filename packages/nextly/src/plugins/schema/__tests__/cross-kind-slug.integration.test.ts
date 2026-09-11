/**
 * A plugin entity and an app entity of ANOTHER kind under one slug, booted.
 *
 * `apply-contributions.test.ts` asserts the fold refuses the pair. This asserts
 * what the fold's refusal is protecting, on a real instance: before it, the
 * install booted with no error, the registry refused the second entity at sync
 * because a slug is one namespace across kinds, and the app's single was simply
 * gone -- its reads answering not-found under the plugin collection's rule.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { definePlugin } from "../../plugin-context";
import { createTestNextly, type TestNextly } from "../../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A plugin contributing one collection under `slug`. */
function contributing(slug: string) {
  return definePlugin({
    name: "@test/cross-kind",
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: {
      collections: [defineCollection({ slug, fields: [text({ name: "c" })] })],
    },
  });
}

const homepage = defineSingle({
  slug: "homepage",
  access: { read: () => true, update: () => true },
  fields: [text({ name: "headline" })],
});

describe("booting a plugin entity beside an app entity of another kind", () => {
  it("refuses to boot when the two share a slug", async () => {
    await expect(
      createTestNextly({
        singles: [homepage],
        plugins: [contributing("homepage")],
      })
    ).rejects.toMatchObject({ code: "NEXTLY_SCHEMA_SLUG_COLLISION" });
  });

  it("boots and registers BOTH when their slugs differ", async () => {
    // The control: a refusal of every plugin beside an app single would pass
    // the case above. Both rows are asserted, since the defect this guards was
    // one of them missing from a boot that reported nothing.
    current = await createTestNextly({
      singles: [homepage],
      plugins: [contributing("announcements")],
    });

    const collections = await (
      current.getService("collectionRegistryService") as {
        getAllCollections(): Promise<{ slug: string }[]>;
      }
    ).getAllCollections();
    const singles = await (
      current.getService("singleRegistryService") as {
        getAllSingles(): Promise<{ slug: string }[]>;
      }
    ).getAllSingles();

    expect(collections.map(row => row.slug)).toContain("announcements");
    expect(singles.map(row => row.slug)).toContain("homepage");
  });
});
