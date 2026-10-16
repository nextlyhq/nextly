/**
 * A held edit to a published Single's component fields is kept, and published
 * when the Single is.
 *
 * A save that names no status on a published Single is held as its working
 * draft. Component values live in tables of their own, so a held save must
 * carry them in the draft, in the same shape a collection's draft holds them,
 * and the publish must write them from it.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Row = {
  scopeSlug: string;
  versionNo: number | null;
  isAutosave: boolean | number;
  snapshot: unknown;
};

function parsed(snapshot: unknown): Record<string, unknown> {
  return (
    typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot
  ) as Record<string, unknown>;
}

async function workingDraft(handle: TestNextly, slug: string) {
  const rows = (await handle.adapter.select<Row>("nextly_versions")).filter(
    r => r.scopeSlug === slug && r.versionNo === null && !r.isAutosave
  );
  expect(rows).toHaveLength(1);
  return parsed(rows[0].snapshot);
}

async function newestVersion(handle: TestNextly, slug: string) {
  const rows = (await handle.adapter.select<Row>("nextly_versions"))
    .filter(r => r.scopeSlug === slug && typeof r.versionNo === "number")
    .sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0));
  return parsed(rows[0].snapshot);
}

/** A component value without the ids and timestamps its rows are given. */
function contentOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contentOf);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          ![
            "id",
            "created_at",
            "updated_at",
            "createdAt",
            "updatedAt",
          ].includes(key)
      )
      .map(([key, inner]) => [key, contentOf(inner)])
  );
}

const hero = () =>
  defineFieldGroup({
    slug: "hero",
    fields: [text({ name: "heading" }), text({ name: "subheading" })],
  });
const card = () =>
  defineFieldGroup({ slug: "card", fields: [text({ name: "label" })] });

async function bootSingle(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [hero(), card()],
    singles: [
      defineSingle({
        slug: "home",
        status: true,
        versions: true,
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "hero", component: "hero" }),
          fieldGroup({ name: "cards", component: "card", repeatable: true }),
        ],
      }),
    ],
  });
  const singles = current.getService("singleEntryService");
  await singles.update(
    "home",
    {
      title: "T",
      hero: { heading: "Live", subheading: "Live sub" },
      cards: [{ label: "One" }],
      status: "published",
    },
    { overrideAccess: true }
  );
  return singles;
}

async function liveHome(handle: TestNextly) {
  const read = await handle
    .getService("singleEntryService")
    .get("home", { overrideAccess: true });
  return ((read as { data?: unknown }).data ?? read) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a held edit to a published Single's components (integration, %s)",
  dialect => {
    it("keeps a component-only save in the draft, and publishes it", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { hero: { heading: "Pending", subheading: "Live sub" } },
        { overrideAccess: true }
      );

      const draft = await workingDraft(current!, "home");
      expect(contentOf(draft.hero)).toMatchObject({ heading: "Pending" });
      // Held: what readers see has not changed.
      expect(contentOf((await liveHome(current!)).hero)).toMatchObject({
        heading: "Live",
      });

      await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      );
      expect(contentOf((await liveHome(current!)).hero)).toMatchObject({
        heading: "Pending",
      });
    });

    it("keeps a mixed save's scalar and component edits together", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        {
          title: "New title",
          hero: { heading: "Pending", subheading: "Live sub" },
        },
        { overrideAccess: true }
      );

      const draft = await workingDraft(current!, "home");
      expect(draft.title).toBe("New title");
      expect(contentOf(draft.hero)).toMatchObject({ heading: "Pending" });

      await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      );
      const live = await liveHome(current!);
      expect(live.title).toBe("New title");
      expect(contentOf(live.hero)).toMatchObject({ heading: "Pending" });
    });

    it("replaces a repeatable component list whole", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { cards: [{ label: "Two" }, { label: "Three" }] },
        { overrideAccess: true }
      );

      await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      );
      const labels = (
        contentOf((await liveHome(current!)).cards) as {
          label: string;
        }[]
      ).map(c => c.label);
      expect(labels).toEqual(["Two", "Three"]);
    });

    it("records the component edit in the save's version", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { hero: { heading: "Pending", subheading: "Live sub" } },
        { overrideAccess: true }
      );

      const version = await newestVersion(current!, "home");
      expect(contentOf(version.hero)).toMatchObject({ heading: "Pending" });
    });

    it("publishes a held component edit when every language is published at once", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [hero()],
        singles: [
          defineSingle({
            slug: "home",
            localized: true,
            status: true,
            versions: true,
            fields: [
              text({ name: "title", localized: true }),
              fieldGroup({ name: "hero", component: "hero" }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        {
          title: "T",
          hero: { heading: "Live", subheading: "Live sub" },
          status: "published",
        },
        { locale: "en", overrideAccess: true }
      );
      await singles.update(
        "home",
        { hero: { heading: "Pending", subheading: "Live sub" } },
        { locale: "en", overrideAccess: true }
      );
      expect(
        contentOf((await workingDraft(current, "home")).hero)
      ).toMatchObject({ heading: "Pending" });

      const res = await singles.publishAllLocales("home", {
        overrideAccess: true,
      });
      expect(res.success).toBe(true);
      expect(contentOf((await liveHome(current)).hero)).toMatchObject({
        heading: "Pending",
      });
    });

    it("lets a publish's own component value win, sub-field by sub-field", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { hero: { heading: "Pending", subheading: "Live sub" } },
        { overrideAccess: true }
      );

      await singles.update(
        "home",
        { hero: { subheading: "Sent with the publish" }, status: "published" },
        { overrideAccess: true }
      );
      expect(contentOf((await liveHome(current!)).hero)).toMatchObject({
        heading: "Pending",
        subheading: "Sent with the publish",
      });
    });

    it("holds the same component values in a Single's draft as in a collection's", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [hero(), card()],
        collections: [
          defineCollection({
            slug: "pages",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "hero", component: "hero" }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "hero", component: "hero" }),
            ],
          }),
        ],
      });
      const live = { heading: "Live", subheading: "Live sub" };
      const edit = { heading: "Pending", subheading: "Live sub" };
      const pages = current.getService("collectionsHandler");
      const created = await pages.createEntry(
        { collectionName: "pages", overrideAccess: true },
        { title: "T", hero: live, status: "published" }
      );
      const id = (created.data as { id: string }).id;
      await pages.updateEntry(
        { collectionName: "pages", entryId: id, overrideAccess: true },
        { hero: edit }
      );
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        { title: "T", hero: live, status: "published" },
        { overrideAccess: true }
      );
      await singles.update("home", { hero: edit }, { overrideAccess: true });

      const collectionDraft = await workingDraft(current, "pages");
      const singleDraft = await workingDraft(current, "home");
      expect(contentOf(singleDraft.hero)).toEqual(
        contentOf(collectionDraft.hero)
      );
    });
  }
);
