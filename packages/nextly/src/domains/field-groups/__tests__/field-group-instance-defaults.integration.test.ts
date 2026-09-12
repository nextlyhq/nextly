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

/**
 * The same field group and collection, localized.
 *
 * A localized field group splits each instance into a main payload and a
 * companion payload before it is written, and the split copies values out of
 * the instance rather than writing through it. `heading` is translatable and
 * lands on the companion; `tone` is shared and stays on the main row, so one
 * instance covers both sides of the split.
 */
async function bootLocalized() {
  current = await createTestNextly({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    fieldGroups: [
      defineFieldGroup({
        slug: "lhero",
        localized: true,
        fields: [
          text({ name: "heading", required: true, defaultValue: "Welcome" }),
          text({ name: "tone", localized: false, defaultValue: "calm" }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "lpages",
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "slides", component: "lhero", repeatable: true }),
        ],
      }),
    ],
  });
  return { handler: current.getService("collectionsHandler") };
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
  it("fills a repeatable instance of a LOCALIZED field group", async () => {
    const { handler } = await bootLocalized();

    const created = await handler.createEntry(
      { collectionName: "lpages", overrideAccess: true },
      { title: "Home", slides: [{}, { heading: "Given" }] }
    );
    expect(created.success, JSON.stringify(created)).toBe(true);

    const read = await handler.getEntry({
      collectionName: "lpages",
      entryId: (created.data as { id: string }).id,
      overrideAccess: true,
    });
    const slides = (read.data as { slides?: Hero[] }).slides;
    // The companion side (`heading`) and the main side (`tone`) both carry the
    // default: whichever half of the split a child belongs to, it is filled.
    expect(slides?.map(r => ({ heading: r.heading, tone: r.tone }))).toEqual([
      { heading: "Welcome", tone: "calm" },
      { heading: "Given", tone: "calm" },
    ]);
  });
  it("applies a FUNCTION default declared on a field-group child", async () => {
    current = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({
          slug: "fnhero",
          fields: [
            text({ name: "mode", defaultValue: "dark" }),
            // A function cannot be stored, so the stored definition this write
            // reads carries nothing for it. It resolves from the live config.
            text({
              name: "label",
              defaultValue: d => `mode-${String(d.mode)}`,
            }),
          ],
        }),
      ],
      collections: [
        defineCollection({
          slug: "fnpages",
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "hero", component: "fnhero" }),
            fieldGroup({
              name: "slides",
              component: "fnhero",
              repeatable: true,
            }),
          ],
        }),
      ],
    });
    const handler = current.getService("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "fnpages", overrideAccess: true },
      { title: "Home", hero: {}, slides: [{ mode: "light" }] }
    );
    expect(created.success, JSON.stringify(created)).toBe(true);

    const read = await handler.getEntry({
      collectionName: "fnpages",
      entryId: (created.data as { id: string }).id,
      overrideAccess: true,
    });
    const data = read.data as {
      hero?: { mode?: string; label?: string };
      slides?: Array<{ mode?: string; label?: string }>;
    };
    // Resolved against the instance built so far, as it is for a collection
    // field: the constant before it is visible to the function after it.
    expect(data.hero).toMatchObject({ mode: "dark", label: "mode-dark" });
    // A supplied sibling value is what the function reads, not the default.
    expect(data.slides?.[0]).toMatchObject({
      mode: "light",
      label: "mode-light",
    });
  });
});
