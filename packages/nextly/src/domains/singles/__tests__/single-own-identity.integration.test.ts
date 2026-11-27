/**
 * A Single whose author declared their own top-level `title` field.
 *
 * `defineSingle` adds a `title` and a `slug` to every Single that declares
 * neither, fixed by the Single's config: the admin draws them read-only and
 * saves them as the Single's label and slug, and the first read stores the
 * label. A Single that declares its own `title` has none of Nextly's in its
 * place, so its title is content, and nothing may replace it with the label.
 *
 * What separates a correct implementation from the broken one is whether the
 * schema the admin reads names the field as the author's (the admin pins every
 * identity field it is not told is theirs), whether the first read stores the
 * label in it, and whether a value written through the API is the value read.
 * A Single without its own title is the control: its title stays Nextly's,
 * the label, on every road.
 *
 * @module domains/singles/__tests__/single-own-identity.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
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

/** A Single declaring its own `title`, as a site's page heading. */
const OWN = "own_title_page";
/** A Single declaring neither, whose title and slug are Nextly's. */
const SYSTEM = "system_title_page";

/** The heading the author stores, markup and all. */
const HEADING = "Thoughts & <span>Insights</span>";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: OWN,
        label: { singular: "Blog Page" },
        fields: [
          text({ name: "title", required: true }),
          text({ name: "intro" }),
        ],
      }),
      defineSingle({
        slug: SYSTEM,
        label: { singular: "Contact Page" },
        fields: [text({ name: "intro" })],
      }),
    ],
  });
  return current;
}

/** The schema the admin's editor reads for `slug`. */
async function schemaOf(slug: string): Promise<Record<string, unknown>> {
  const response = (await dispatchSingles(
    "getSingleSchema",
    { slug } as never,
    undefined
  )) as Response;
  return (await response.json()) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a Single's own title field (%s)",
  dialect => {
    it("is named as the author's in the schema the admin reads", async () => {
      await boot(dialect);

      expect((await schemaOf(OWN)).ownIdentityFields).toEqual(["title"]);
      // CONTROL: a Single declaring neither has Nextly's title and slug, so
      // the admin keeps both fixed to its config.
      expect((await schemaOf(SYSTEM)).ownIdentityFields).toEqual([]);
    }, 120_000);

    it("is not filled with the Single's label by the first read", async () => {
      const t = await boot(dialect);

      const own = await t.nextly.findSingle({ slug: OWN });
      const system = await t.nextly.findSingle({ slug: SYSTEM });

      expect((own as Record<string, unknown>).title).not.toBe("Blog Page");
      // CONTROL: Nextly's own title is the label.
      expect((system as Record<string, unknown>).title).toBe("Contact Page");
    }, 120_000);

    it("keeps what an API save stored, across later saves and reads", async () => {
      const t = await boot(dialect);

      await t.nextly.updateSingle({
        slug: OWN,
        data: { title: HEADING, _overwrite: true },
      } as never);
      // A later save of another field leaves the title as stored.
      await t.nextly.updateSingle({
        slug: OWN,
        data: { intro: "Notes", _overwrite: true },
      } as never);

      const read = (await t.nextly.findSingle({ slug: OWN })) as Record<
        string,
        unknown
      >;
      expect(read.title).toBe(HEADING);
      expect(read.intro).toBe("Notes");

      // CONTROL: saving the Single without its own title keeps the label.
      await t.nextly.updateSingle({
        slug: SYSTEM,
        data: { intro: "Write to me", _overwrite: true },
      } as never);
      const system = (await t.nextly.findSingle({ slug: SYSTEM })) as Record<
        string,
        unknown
      >;
      expect(system.title).toBe("Contact Page");
      expect(system.slug).toBe(SYSTEM);
    }, 120_000);
  }
);
