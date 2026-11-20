/**
 * A plugin entity and an app entity of ANOTHER kind under one slug, booted.
 *
 * `apply-contributions.test.ts` asserts the fold refuses the pair. This asserts
 * what the fold's refusal is protecting, on a real instance: before it, the
 * install booted with no error, the registry refused the second entity at sync
 * because a slug is one namespace across kinds, and the app's single was simply
 * gone -- its reads answering not-found under the plugin collection's rule.
 */

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices } from "../../../di/register";
import { seedBuilderSingle } from "../../__tests__/seed-builder-entity";
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

describe("booting an entity whose slug another kind already holds", () => {
  it("fails the boot instead of losing the single", async () => {
    // 🔴 The registry guard refuses the second registration -- one slug, one
    // kind -- and the singles sync used to keep that to itself: the app ran
    // with the single simply missing, answering not-found for one the config
    // declares. The start now judges the configuration's rules across entities
    // before anything connects (`crossEntityProblems`), whatever built the
    // config -- the harness builds it directly, as a Schema-Builder entity's
    // shape is made -- so the pair is refused there, naming the Single's slug,
    // rather than reaching the registries at all.
    // Asserted on the error's identity and the problem's place rather than on
    // its message: the place is what tells which entity to rename.
    await expect(
      createTestNextly({
        collections: [
          defineCollection({ slug: "homepage", fields: [text({ name: "c" })] }),
        ],
        singles: [homepage],
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
      publicData: {
        errors: [
          expect.objectContaining({
            path: "singles[0].slug",
            code: "SLUG_DUPLICATE",
          }),
        ],
      },
    });
  });
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

describe("booting a config entity beside a Builder entity of another kind", () => {
  // The Builder's entities live in the `dynamic_*` tables, so the fold cannot
  // see them; this is the check that runs once the registry is readable. Both
  // boots share one adapter, the way the other two-phase suites do -- the
  // first creates the registry tables, the second meets what was seeded.
  let shared: Awaited<ReturnType<typeof createAdapter>> | undefined;
  let booted: TestNextly | undefined;

  afterAll(async () => {
    await booted?.destroy();
    booted = undefined;
    shared = undefined;
  });

  async function withBuilderSingle(): Promise<
    Awaited<ReturnType<typeof createAdapter>>
  > {
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    shared = adapter;
    const first = await createTestNextly({ adapter });
    await seedBuilderSingle(adapter, {
      slug: "homepage",
      fields: [{ name: "headline", type: "text" }],
    });
    // Not `destroy()`: it disconnects the adapter, and the second boot needs
    // the database the first one created. Clearing the container is what the
    // other two-phase suites do.
    void first;
    clearServices();
    return adapter;
  }

  it("refuses a collection whose slug a Builder single already holds", async () => {
    const adapter = await withBuilderSingle();

    await expect(
      createTestNextly({
        adapter,
        collections: [
          defineCollection({ slug: "homepage", fields: [text({ name: "c" })] }),
        ],
      })
    ).rejects.toMatchObject({ code: "NEXTLY_SCHEMA_SLUG_COLLISION" });
  });

  it("boots beside a Builder single whose slug nothing else holds", async () => {
    // The control: a check that refused every boot with a Builder entity in
    // the registry would pass the case above.
    const adapter = await withBuilderSingle();

    booted = await createTestNextly({
      adapter,
      collections: [
        defineCollection({
          slug: "announcements",
          fields: [text({ name: "c" })],
        }),
      ],
    });

    const singles = await (
      booted.getService("singleRegistryService") as {
        getAllSingles(): Promise<{ slug: string }[]>;
      }
    ).getAllSingles();
    expect(singles.map(row => row.slug)).toContain("homepage");
  });
});
