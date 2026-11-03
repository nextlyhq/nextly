/**
 * What a binding on a published page may read besides a list, decided the
 * same on every database: a Single as the anonymous visitor reads it, the
 * site settings through their allowlist, and the field shapes a binding is
 * checked against.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  date,
  defineCollection,
  defineSingle,
  group,
  select,
  text,
} from "../../../config";
import { container } from "../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../../revalidation/types";
import { nextlySiteSettingsTags } from "../../cache/nextly-tags";
import { readPublicSiteSettings } from "../../site-settings-read";
import { bindingFieldShapes } from "../binding-field-shapes";
import { createPublicReader, type PublicReader } from "../public-reader";

const POSTS = "pss_posts";
const CLOSED = "pss_closed";
const BANNER = "pss_banner";
const UNPUBLISHED = "pss_unpublished";
const NEVER_WRITTEN = "pss_never_written";

/** Records every intent flushed to it. */
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  flush(intents: RevalidationIntent[]): void {
    this.flushed.push(...intents);
  }
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

const singles = () => [
  defineSingle({
    slug: BANNER,
    status: true,
    access: { read: () => true },
    fields: [
      text({ name: "headline" }),
      text({ name: "internal", access: { read: () => false } }),
    ],
  }),
  defineSingle({
    slug: UNPUBLISHED,
    status: true,
    access: { read: () => true },
    fields: [text({ name: "headline" })],
  }),
  defineSingle({
    slug: NEVER_WRITTEN,
    access: { read: () => true },
    fields: [text({ name: "headline" })],
  }),
];

const collections = () => [
  defineCollection({
    slug: POSTS,
    status: true,
    access: { read: () => true },
    fields: [
      text({ name: "title" }),
      text({ name: "secret", access: { read: () => false } }),
      // Only a signed-in caller may read it: hidden from every visitor.
      text({
        name: "staffNote",
        access: { read: ({ req }) => Boolean(req.user) },
      }),
      select({
        name: "kind",
        options: [
          { label: "News", value: "news" },
          { label: "Guide", value: "guide" },
        ],
      }),
      date({ name: "day" }),
      date({
        name: "month",
        admin: { date: { pickerAppearance: "monthOnly" } },
      }),
      date({
        name: "at",
        admin: { date: { pickerAppearance: "dayAndTime" } },
      }),
      group({
        name: "seo",
        fields: [
          text({ name: "summary" }),
          text({ name: "draftNote", access: { read: () => false } }),
        ],
      }),
    ],
  }),
  defineCollection({
    slug: CLOSED,
    access: { read: () => false },
    fields: [text({ name: "title" })],
  }),
];

describe.each(getConfiguredTestDialects())(
  "the public sources a binding reads (%s)",
  dialect => {
    let t: TestNextly;
    let reader: PublicReader;
    const spy = new RecordingRevalidator();

    beforeAll(async () => {
      // Registered before boot, so the boot keeps it rather than the default.
      container.registerSingleton<CacheRevalidator>(
        "cacheRevalidator",
        () => spy
      );
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
        collections: collections(),
        singles: singles(),
      });
      await t.nextly.updateSingle({
        slug: BANNER,
        data: {
          headline: "Hello",
          internal: "staff only",
          status: "published",
        },
      });
      await t.nextly.updateSingle({
        slug: UNPUBLISHED,
        data: { headline: "Not yet", status: "draft" },
      });
      reader = createPublicReader(t.nextly);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    describe("findSingle", () => {
      it("reads a published Single without the fields its rules hide", async () => {
        const trusted = await t.nextly.findSingle({ slug: BANNER });
        // The control: the hidden field is stored, so its absence below is
        // the field rule's doing.
        expect(trusted.internal).toBe("staff only");

        const single = await reader.findSingle({ slug: BANNER });
        expect(single?.headline).toBe("Hello");
        expect(single).not.toHaveProperty("internal");
      });

      it("narrows the document to its id and the fields named", async () => {
        const single = await reader.findSingle({
          slug: BANNER,
          select: ["headline", "internal"],
        });
        expect(Object.keys(single ?? {}).sort()).toEqual(["headline", "id"]);
      });

      it("does not read a Single that has never been published", async () => {
        const trusted = await t.nextly.findSingle({
          slug: UNPUBLISHED,
          status: "all",
        });
        expect(trusted.headline).toBe("Not yet");

        await expect(reader.findSingle({ slug: UNPUBLISHED })).resolves.toBe(
          null
        );
      });

      it("answers null for a Single with no document, and creates none", async () => {
        await expect(
          reader.findSingle({ slug: NEVER_WRITTEN })
        ).resolves.toBeNull();
        await expect(
          t.nextly.findSingle({ slug: NEVER_WRITTEN, createIfMissing: false })
        ).resolves.toBeNull();
      });
    });

    describe("readPublicSiteSettings", () => {
      it("shows the allowlisted settings and never the administrator's email", async () => {
        const service = t.getService("generalSettingsService");
        await service.updateSettings({
          applicationName: "Acme",
          siteUrl: "https://acme.test",
          adminEmail: "owner@acme.test",
          timezone: "Asia/Karachi",
          logoUrl: "https://acme.test/logo.png",
          dateFormat: "DD/MM/YYYY",
        });
        // The control: the email is stored.
        expect((await service.getSettings()).adminEmail).toBe(
          "owner@acme.test"
        );

        const settings = await readPublicSiteSettings();
        expect(settings).toEqual({
          applicationName: "Acme",
          siteUrl: "https://acme.test",
          logoUrl: "https://acme.test/logo.png",
          timezone: "Asia/Karachi",
        });
        expect(JSON.stringify(settings)).not.toContain("owner@acme.test");
      });

      it("expires the settings tag when the settings are written", async () => {
        const [tag] = nextlySiteSettingsTags();
        const before = spy.tags.filter(seen => seen === tag).length;
        await t
          .getService("generalSettingsService")
          .updateSettings({ timezone: "Europe/Paris" });
        expect(spy.tags.filter(seen => seen === tag).length).toBe(before + 1);
        await expect(readPublicSiteSettings()).resolves.toMatchObject({
          timezone: "Europe/Paris",
        });
      });
    });

    describe("bindingFieldShapes", () => {
      it("leaves out every field a visitor's field rules hide", async () => {
        const declared = (
          await t
            .getService("collectionRegistryService")
            .getCollectionBySlug(POSTS)
        )?.fields.map(field => ("name" in field ? field.name : ""));
        // The control: both hidden fields are declared.
        expect(declared).toEqual(
          expect.arrayContaining(["secret", "staffNote"])
        );

        const shapes = await bindingFieldShapes({ collection: POSTS });
        const names = shapes?.map(shape => shape.name);
        expect(names).toEqual(
          expect.arrayContaining(["title", "kind", "day", "seo"])
        );
        expect(names).not.toContain("secret");
        expect(names).not.toContain("staffNote");
        const seo = shapes?.find(shape => shape.name === "seo");
        expect(seo?.fields?.map(shape => shape.name)).toEqual(["summary"]);
      });

      it("leaves out a Single's hidden field", async () => {
        const shapes = await bindingFieldShapes({ single: BANNER });
        const names = shapes?.map(shape => shape.name);
        // A Single also carries the fields every Single is given.
        expect(names).toContain("headline");
        expect(names).not.toContain("internal");
      });

      it("says what each field holds", async () => {
        const shapes = await bindingFieldShapes({ collection: POSTS });
        const byName = new Map(shapes?.map(shape => [shape.name, shape]));
        expect(byName.get("kind")).toMatchObject({
          type: "select",
          options: ["news", "guide"],
        });
        expect(byName.get("day")).toMatchObject({
          type: "date",
          dateOnly: true,
        });
        expect(byName.get("month")).toMatchObject({ monthOnly: true });
        expect(byName.get("at")).not.toHaveProperty("dateOnly");
      });

      it("has none for a source the visitor may not read, or one that does not exist", async () => {
        await expect(
          bindingFieldShapes({ collection: CLOSED })
        ).resolves.toBeUndefined();
        await expect(
          bindingFieldShapes({ collection: "pss_nowhere" })
        ).resolves.toBeUndefined();
      });
    });
  }
);
