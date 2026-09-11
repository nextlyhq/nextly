/**
 * A new field-group instance takes the defaults its own fields declare.
 *
 * The parent entry's defaults pass skips a field group, since its value lives
 * in the component's own table, and the component save validated and hashed a
 * new instance without ever filling its defaults. So an omitted child stayed
 * empty, and a required child with a default refused an instance the caller
 * could not have completed. The component save now fills a NEW instance's
 * defaults before validating it, on every save path; an existing instance is
 * left as the caller's patch.
 *
 * Asserted through a booted instance and read back, on the ordinary create and
 * on a bulk create, which reach the component save by different paths.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot() {
  current = await createTestNextly({
    fieldGroups: [
      defineFieldGroup({
        slug: "hero",
        fields: [
          text({ name: "heading", required: true, defaultValue: "Welcome" }),
          text({ name: "tone", defaultValue: "calm" }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "pages",
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "hero", component: "hero" }),
          fieldGroup({ name: "slides", component: "hero", repeatable: true }),
        ],
      }),
    ],
  });
  return {
    handler: current.getService("collectionsHandler"),
    service: current.getService("collectionService"),
  };
}

type Hero = { heading?: string; tone?: string };

describe("a new field-group instance takes its declared defaults (integration)", () => {
  it("fills an omitted child and satisfies a required one on a create", async () => {
    const { handler } = await boot();

    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Home", hero: {}, slides: [{ heading: "Given" }, {}] }
    );
    expect(created.success, JSON.stringify(created)).toBe(true);

    const read = await handler.getEntry({
      collectionName: "pages",
      entryId: (created.data as { id: string }).id,
      overrideAccess: true,
    });
    const data = read.data as { hero?: Hero; slides?: Hero[] };
    expect(data.hero).toMatchObject({ heading: "Welcome", tone: "calm" });
    // Each new row is filled on its own, and a supplied value stands.
    expect(
      data.slides?.map(r => ({ heading: r.heading, tone: r.tone }))
    ).toEqual([
      { heading: "Given", tone: "calm" },
      { heading: "Welcome", tone: "calm" },
    ]);
  });

  it("fills them on a bulk create too", async () => {
    const { handler, service } = await boot();

    const result = await service.createMany(
      "pages",
      [{ title: "Bulk", hero: {} }],
      {
        overrideAccess: true,
      }
    );
    expect(result.errors).toEqual([]);

    const read = await handler.getEntry({
      collectionName: "pages",
      entryId: result.ids[0],
      overrideAccess: true,
    });
    expect((read.data as { hero?: Hero }).hero).toMatchObject({
      heading: "Welcome",
      tone: "calm",
    });
  });
});
