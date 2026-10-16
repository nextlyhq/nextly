/**
 * A held Single's working draft holds the document as reads return it.
 *
 * A save that names no status on a published Single is held as its working
 * draft, and every such save is also kept as a version. Both must hold the
 * read shape: groups and repeaters as values rather than the text their column
 * stores, and every translation of the language rather than only the fields
 * the save named. A version holding text restores as text, which validation
 * refuses; one missing a translation restores without it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, group, repeater, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { restoreVersion } from "../../versions/restore-version";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const superAdmin = { id: "tester", roles: ["super-admin"] };

type Row = {
  scopeSlug: string;
  entryId: string;
  versionNo: number | null;
  isAutosave: boolean | number;
  locale: string | null;
  snapshot: unknown;
};

function parsed(snapshot: unknown): Record<string, unknown> {
  // Some dialects hand JSON back as text.
  return (
    typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot
  ) as Record<string, unknown>;
}

async function rowsFor(handle: TestNextly, slug: string) {
  return (await handle.adapter.select<Row>("nextly_versions")).filter(
    r => r.scopeSlug === slug && !r.isAutosave
  );
}

async function workingDraft(handle: TestNextly, slug: string) {
  const rows = (await rowsFor(handle, slug)).filter(r => r.versionNo === null);
  expect(rows).toHaveLength(1);
  return parsed(rows[0].snapshot);
}

async function newestVersion(handle: TestNextly, slug: string) {
  const rows = (await rowsFor(handle, slug))
    .filter(r => typeof r.versionNo === "number")
    .sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0));
  return rows[0];
}

async function liveRead(handle: TestNextly, slug: string, locale?: string) {
  const res = await handle
    .getService("singleEntryService")
    .get(slug, { locale, overrideAccess: true });
  return (res.data ?? {}) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a held Single's draft holds the read shape (integration, %s)",
  dialect => {
    it("holds a group and a repeater as values, and its version restores cleanly", async () => {
      current = await createTestNextly({
        dialect,
        singles: [
          defineSingle({
            slug: "site-meta",
            status: true,
            versions: true,
            fields: [
              text({ name: "siteName" }),
              group({ name: "seo", fields: [text({ name: "metaTitle" })] }),
              repeater({ name: "links", fields: [text({ name: "label" })] }),
            ],
          }),
        ],
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "site-meta",
        {
          siteName: "Live",
          seo: { metaTitle: "Live title" },
          links: [{ label: "Live link" }],
          status: "published",
        },
        { overrideAccess: true }
      );
      await singles.update(
        "site-meta",
        { seo: { metaTitle: "Held title" }, links: [{ label: "Held link" }] },
        { overrideAccess: true }
      );

      const draft = await workingDraft(current, "site-meta");
      expect(draft.seo).toEqual({ metaTitle: "Held title" });
      expect(draft.links).toMatchObject([{ label: "Held link" }]);
      const held = await newestVersion(current, "site-meta");
      expect(parsed(held.snapshot).seo).toEqual({ metaTitle: "Held title" });

      // Move the draft on, then put the held save back from history.
      await singles.update(
        "site-meta",
        { seo: { metaTitle: "Later title" } },
        { overrideAccess: true }
      );
      await restoreVersion({
        scopeKind: "single",
        slug: "site-meta",
        entryId: held.entryId,
        versionNo: held.versionNo!,
        user: superAdmin,
      });
      await singles.update(
        "site-meta",
        { status: "published" },
        { overrideAccess: true }
      );

      const live = await liveRead(current, "site-meta");
      expect(live.seo).toEqual({ metaTitle: "Held title" });
      expect(live.links).toMatchObject([{ label: "Held link" }]);
      expect(live.siteName).toBe("Live");
    });

    it("records no version for a held save that changes nothing", async () => {
      current = await createTestNextly({
        dialect,
        singles: [
          defineSingle({
            slug: "site-meta",
            status: true,
            versions: true,
            fields: [
              text({ name: "siteName" }),
              group({ name: "seo", fields: [text({ name: "metaTitle" })] }),
            ],
          }),
        ],
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "site-meta",
        {
          siteName: "Live",
          seo: { metaTitle: "Live title" },
          status: "published",
        },
        { overrideAccess: true }
      );
      const before = (await rowsFor(current, "site-meta")).filter(
        r => typeof r.versionNo === "number"
      ).length;

      // The same values, held: the first held save compares with what is live.
      await singles.update(
        "site-meta",
        { siteName: "Live", seo: { metaTitle: "Live title" } },
        { overrideAccess: true }
      );
      const after = (await rowsFor(current, "site-meta")).filter(
        r => typeof r.versionNo === "number"
      ).length;
      expect(after).toBe(before);
    });

    it("holds every translation of the language, not only the fields saved", async () => {
      current = await createTestNextly({
        dialect,
        singles: [
          defineSingle({
            slug: "home",
            localized: true,
            status: true,
            versions: true,
            fields: [
              text({ name: "heading", localized: true }),
              text({ name: "tagline", localized: true }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        { heading: "EN live", tagline: "EN tagline", status: "published" },
        { locale: "en", overrideAccess: true }
      );
      await singles.update(
        "home",
        { heading: "DE live", tagline: "DE tagline", status: "published" },
        { locale: "de", overrideAccess: true }
      );
      await singles.update(
        "home",
        { heading: "DE held" },
        { locale: "de", overrideAccess: true }
      );

      const draft = await workingDraft(current, "home");
      expect(draft).toMatchObject({
        heading: "DE held",
        tagline: "DE tagline",
      });
      const held = await newestVersion(current, "home");
      expect(held.locale).toBe("de");
      expect(parsed(held.snapshot)).toMatchObject({
        heading: "DE held",
        tagline: "DE tagline",
      });

      await singles.update(
        "home",
        { status: "published" },
        { locale: "de", overrideAccess: true }
      );
      expect(await liveRead(current, "home", "de")).toMatchObject({
        heading: "DE held",
        tagline: "DE tagline",
      });
      // The other language is untouched.
      expect(await liveRead(current, "home", "en")).toMatchObject({
        heading: "EN live",
        tagline: "EN tagline",
      });
    });
  }
);
