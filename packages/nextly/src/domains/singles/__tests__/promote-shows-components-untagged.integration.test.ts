/**
 * A publish shows a component field's validator the component's public value,
 * without the internal type tag a held draft stores it with.
 *
 * A held Single's working draft stores each component value tagged with its
 * component type, so a later restore knows which schema it belonged to. The
 * publish gate compares that draft with the live document, and both sides
 * carry the tag for the comparison. A validator written against the public
 * shape, one that refuses keys a reader never sees, must not be shown it: it
 * would refuse the publish of an unchanged, valid Single. A collection's
 * publish is the control: it already promotes its draft untagged.
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

/** Refuses a key a reader of the component never sees: an internal one. */
const publicShapeOnly = (value: unknown) =>
  value === null ||
  value === undefined ||
  typeof value !== "object" ||
  Object.keys(value).every(key => !key.startsWith("_")) ||
  "hero holds an internal key";

const hero = () =>
  defineFieldGroup({ slug: "hero", fields: [text({ name: "heading" })] });

const heroField = () =>
  fieldGroup({ name: "hero", component: "hero", validate: publicShapeOnly });

type Result = { success?: boolean; errors?: unknown; message?: string };

async function bootSingle(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [hero()],
    singles: [
      defineSingle({
        slug: "home",
        status: true,
        versions: true,
        fields: [text({ name: "title" }), heroField()],
      }),
    ],
  });
  const singles = current.getService("singleEntryService");
  const first = (await singles.update(
    "home",
    { title: "T", hero: { heading: "Live" }, status: "published" },
    { overrideAccess: true }
  )) as Result;
  expect(first.success, JSON.stringify(first)).not.toBe(false);
  return singles;
}

async function liveTitle(handle: TestNextly) {
  const read = await handle
    .getService("singleEntryService")
    .get("home", { overrideAccess: true });
  return (((read as { data?: unknown }).data ?? read) as { title?: unknown })
    .title;
}

describe.each(getConfiguredTestDialects())(
  "a publish shows component validators the public value (integration, %s)",
  dialect => {
    it("publishes a held change that leaves the component as it was", async () => {
      const singles = await bootSingle(dialect);
      const held = (await singles.update(
        "home",
        { title: "Held" },
        { overrideAccess: true }
      )) as Result;
      expect(held.success, JSON.stringify(held)).not.toBe(false);

      const published = (await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      )) as Result;

      expect(published.success, JSON.stringify(published)).not.toBe(false);
      expect(await liveTitle(current!)).toBe("Held");
    });

    it("publishes a held change to the component itself", async () => {
      const singles = await bootSingle(dialect);
      await singles.update(
        "home",
        { hero: { heading: "Held" } },
        { overrideAccess: true }
      );

      const published = (await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      )) as Result;

      expect(published.success, JSON.stringify(published)).not.toBe(false);
    });

    it("publishes every language's held change the same way", async () => {
      const singles = await bootSingle(dialect);
      await singles.update("home", { title: "Held" }, { overrideAccess: true });

      await singles.publishAllLocales("home", { overrideAccess: true });

      expect(await liveTitle(current!)).toBe("Held");
    });

    it("publishes with nothing held", async () => {
      const singles = await bootSingle(dialect);

      const published = (await singles.update(
        "home",
        { status: "published" },
        { overrideAccess: true }
      )) as Result;

      expect(published.success, JSON.stringify(published)).not.toBe(false);
    });

    // The control: a collection's publish of a held change already passes.
    it("publishes a collection entry's held change the same way", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [hero()],
        collections: [
          defineCollection({
            slug: "pages",
            status: true,
            versions: true,
            fields: [text({ name: "title" }), heroField()],
          }),
        ],
      });
      const t = current;
      const created = (await t.nextly.create({
        collection: "pages" as never,
        data: {
          title: "T",
          hero: { heading: "Live" },
          status: "published",
        } as never,
      })) as unknown as { item: { id: string | number } };
      const id = String(created.item.id);
      await t.nextly.update({
        collection: "pages" as never,
        id,
        data: { title: "Held" } as never,
      });

      await expect(
        t.nextly.update({
          collection: "pages" as never,
          id,
          data: { status: "published" } as never,
        })
      ).resolves.toBeDefined();
    });
  }
);
