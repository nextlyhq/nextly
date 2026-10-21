/**
 * How a held Single records its component values, for two cases a draft's
 * eligibility and its snapshot get wrong.
 *
 * A Single that is not localized keeps no working drafts once it reaches a
 * localized component, because one language-less draft would mix languages'
 * values. A component named only by a virtual field stores no rows, so it
 * holds no such values and must not turn drafts off.
 *
 * A held snapshot records each component's type, so a later restore can tell
 * which schema a value belonged to after its field is pointed elsewhere. A
 * component nested in a group is recorded too, and the record is taken off
 * again when the draft is published, so the live document never stores it.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
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

async function workingDrafts(handle: TestNextly) {
  return (await handle.adapter.select<Row>("nextly_versions")).filter(
    r => r.scopeSlug === "home" && r.versionNo === null && !r.isAutosave
  );
}

describe.each(getConfiguredTestDialects())(
  "a held Single's component types (integration, %s)",
  dialect => {
    it("keeps drafts when a localized component is named only by a virtual field", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: "banner",
            localized: true,
            fields: [text({ name: "heading" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              fieldGroup({
                name: "banner",
                component: "banner",
                virtual: true,
              }),
            ],
          }),
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        { title: "Live", status: "published" },
        { overrideAccess: true }
      );

      await singles.update("home", { title: "Held" }, { overrideAccess: true });

      expect(await workingDrafts(current)).toHaveLength(1);
      const live = await singles.get("home", { overrideAccess: true });
      expect((live.data as { title?: unknown }).title).toBe("Live");
    });

    async function bootNested(d: TestDialect) {
      current = await createTestNextly({
        dialect: d,
        fieldGroups: [
          defineFieldGroup({
            slug: "hero",
            fields: [text({ name: "heading" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "home",
            status: true,
            versions: true,
            fields: [
              text({ name: "title" }),
              group({
                name: "layout",
                fields: [fieldGroup({ name: "hero", component: "hero" })],
              }),
            ],
          }),
        ],
      });
      const singles = current.getService("singleEntryService");
      await singles.update(
        "home",
        {
          title: "T",
          layout: { hero: { heading: "Live" } },
          status: "published",
        },
        { overrideAccess: true }
      );
      return singles;
    }

    it("records the type of a component nested in a group", async () => {
      const singles = await bootNested(dialect);

      await singles.update(
        "home",
        { layout: { hero: { heading: "Held" } } },
        { overrideAccess: true }
      );

      const [draft] = await workingDrafts(current!);
      const layout = parsed(draft.snapshot).layout as {
        hero?: Record<string, unknown>;
      };
      expect(layout.hero).toMatchObject({
        heading: "Held",
        _componentType: "hero",
      });
    });

    it("publishes the held value without the record of its type", async () => {
      const singles = await bootNested(dialect);
      await singles.update(
        "home",
        { layout: { hero: { heading: "Held" } } },
        { overrideAccess: true }
      );

      const published = await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      );
      expect(published.success, JSON.stringify(published)).not.toBe(false);

      const live = (await singles.get("home", { overrideAccess: true }))
        .data as { layout?: { hero?: Record<string, unknown> } };
      expect(live.layout?.hero).toMatchObject({ heading: "Held" });
      expect(live.layout?.hero).not.toHaveProperty("_componentType");
      // Nor is it stored: the group is one JSON value on the row.
      const rows =
        await current!.adapter.select<Record<string, unknown>>("single_home");
      expect(JSON.stringify(rows)).not.toContain("_componentType");
    });
  }
);
