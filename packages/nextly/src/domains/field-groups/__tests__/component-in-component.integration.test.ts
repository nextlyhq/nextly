/**
 * A component inside another component's fields, as the outer component's write treats it.
 *
 * Held in a group or a repeater of the outer component, the inner component's value is stored in
 * that container's JSON, so no component write of its own reaches it: the outer component's write
 * is what judges it, against the inner component's fields and its registered validators.
 *
 * Placed DIRECTLY in the outer component's fields, it has no column and no table write, so its
 * value cannot be stored. A write carrying one is refused rather than accepted and dropped; only an
 * empty one passes. The admin's form never draws such a field, since the schema it reads leaves it
 * out, so it never sends one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as TagComponentTypes from "../../versions/tag-component-types";

import {
  checkbox,
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  repeater,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { writeFieldGroupType } from "../storage/field-group-type-key";

/**
 * Each schema resolution a component write makes for the components nested in it: the calls that
 * pass `ownFieldsAreContainer`, which only the component write does. Counted at the resolver rather
 * than at the registry, which the rest of the write reads too.
 */
const componentWriteResolutions: unknown[] = [];

vi.mock("../../versions/tag-component-types", async importOriginal => {
  const actual = await importOriginal<typeof TagComponentTypes>();
  return {
    ...actual,
    containedComponentResolver: (
      ...args: Parameters<typeof actual.containedComponentResolver>
    ) => {
      if (args[2] === true) componentWriteResolutions.push(args[0]);
      return actual.containedComponentResolver(...args);
    },
  };
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Outcome = {
  ok: boolean;
  issues: Array<{ path: string; code: string; message: string }>;
};

/** What a write reports, read the same way whether it returned or threw. */
async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    await run();
    return { ok: true, issues: [] };
  } catch (error) {
    const thrown = error as {
      publicData?: {
        errors?: Array<{ path: string; code: string; message: string }>;
      };
    };
    return { ok: false, issues: thrown.publicData?.errors ?? [] };
  }
}

/** The inner component: a required field, and a field with its own validator. */
const badge = () =>
  defineFieldGroup({
    slug: "badge",
    fields: [
      text({ name: "label", required: true }),
      text({ name: "tone", defaultValue: "plain" }),
      text({
        name: "code",
        validate: (value: unknown) =>
          value !== "forbidden" || "code cannot be forbidden",
      }),
      // Judged against the component's own values: `data` is this badge, as its own write gives it.
      text({
        name: "motto",
        validate: (value: unknown, { data }) =>
          value === undefined ||
          value !== data.label ||
          "motto cannot repeat the label",
      }),
      checkbox({ name: "flag", defaultValue: true }),
    ],
  });

/** The outer component, holding the inner one in each of the three places it can go. */
const card = () =>
  defineFieldGroup({
    slug: "card",
    fields: [
      text({ name: "title" }),
      fieldGroup({ name: "badge", component: "badge" }),
      fieldGroup({ name: "badges", component: "badge", repeatable: true }),
      fieldGroup({ name: "slot", components: ["badge"] }),
      group({
        name: "meta",
        fields: [fieldGroup({ name: "badge", component: "badge" })],
      }),
      repeater({
        name: "chips",
        fields: [fieldGroup({ name: "badge", component: "badge" })],
      }),
    ],
  });

/** An outer component whose directly placed inner one is REQUIRED. */
const plaque = () =>
  defineFieldGroup({
    slug: "plaque",
    fields: [fieldGroup({ name: "seal", component: "badge", required: true })],
  });

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    fieldGroups: [badge(), card(), plaque()],
    collections: [
      defineCollection({
        slug: "pages",
        fields: [
          text({ name: "name" }),
          fieldGroup({ name: "card", component: "card" }),
          fieldGroup({ name: "plaque", component: "plaque" }),
          fieldGroup({ name: "cards", component: "card", repeatable: true }),
          // The same outer component, held in the entry's own group: judged by the entry's write.
          group({
            name: "box",
            fields: [fieldGroup({ name: "plaque", component: "plaque" })],
          }),
        ],
      }),
    ],
    singles: [
      // Published and edited held: the held save and the publish judge the component too.
      defineSingle({
        slug: "landing",
        status: true,
        versions: true,
        fields: [
          text({ name: "headline" }),
          fieldGroup({ name: "plaque", component: "plaque" }),
        ],
      }),
      defineSingle({
        slug: "home",
        fields: [
          text({ name: "headline" }),
          fieldGroup({ name: "card", component: "card" }),
        ],
      }),
    ],
  });
  return current;
}

const NOT_STORED = {
  code: "NOT_STORED",
  message:
    "A component placed directly in another component is not stored. Put it in a group or repeater.",
};

describe.each(getConfiguredTestDialects())(
  "a component inside a component (integration, %s)",
  dialect => {
    it("is judged by its own validators when held in a group or a repeater", async () => {
      const t = await boot(dialect);
      const create = (card: Record<string, unknown>) =>
        outcomeOf(() =>
          t.nextly.create({
            collection: "pages" as never,
            data: { name: "P", card } as never,
          })
        );

      expect(
        await create({ meta: { badge: { label: "L", code: "ok" } } })
      ).toMatchObject({ ok: true });

      const inGroup = await create({
        meta: { badge: { label: "L", code: "forbidden" } },
      });
      expect(inGroup.ok).toBe(false);
      expect(inGroup.issues).toContainEqual(
        expect.objectContaining({
          path: "meta.badge.code",
          message: "code cannot be forbidden.",
        })
      );

      const inRepeater = await create({
        chips: [{ badge: { code: "ok" } }],
      });
      expect(inRepeater.ok).toBe(false);
      expect(inRepeater.issues).toContainEqual(
        expect.objectContaining({
          path: "chips[0].badge.label",
          code: "REQUIRED",
        })
      );
    });

    it("is judged the same on a Single's write", async () => {
      const t = await boot(dialect);
      const refused = await outcomeOf(() =>
        t.nextly.updateSingle({
          slug: "home" as never,
          data: {
            headline: "H",
            card: { meta: { badge: { label: "L", code: "forbidden" } } },
          } as never,
        })
      );
      expect(refused.ok).toBe(false);
      expect(refused.issues).toContainEqual(
        expect.objectContaining({ path: "meta.badge.code" })
      );
    });

    it("refuses a value for one placed directly in it, on a create and an update", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: "pages" as never,
        data: { name: "P", card: { title: "T" } } as never,
      });
      const id = (created.item as { id: string }).id;

      const onCreate = await outcomeOf(() =>
        t.nextly.create({
          collection: "pages" as never,
          data: {
            name: "Q",
            card: { title: "T", badge: { label: "L", code: "ok" } },
          } as never,
        })
      );
      expect(onCreate.ok).toBe(false);
      expect(onCreate.issues).toContainEqual({ path: "badge", ...NOT_STORED });

      const onUpdate = await outcomeOf(() =>
        t.nextly.update({
          collection: "pages" as never,
          id: id as never,
          data: { card: { title: "U", badge: { label: "L" } } } as never,
        })
      );
      expect(onUpdate.ok).toBe(false);
      expect(onUpdate.issues).toContainEqual({ path: "badge", ...NOT_STORED });

      // A required one is not asked for: the admin never draws it and nothing could store it, so
      // an outer component without it is created.
      expect(
        await outcomeOf(() =>
          t.nextly.create({
            collection: "pages" as never,
            data: { name: "Q", plaque: {} } as never,
          })
        )
      ).toEqual({ ok: true, issues: [] });

      // A value for a required one is refused the same way: required or not, it is not stored.
      const required = await outcomeOf(() =>
        t.nextly.create({
          collection: "pages" as never,
          data: { name: "R", plaque: { seal: { label: "S" } } } as never,
        })
      );
      expect(required.ok).toBe(false);
      expect(required.issues).toContainEqual({ path: "seal", ...NOT_STORED });
    });

    // Held in the entry's group, the outer component's whole value is stored in that group's JSON,
    // a component placed directly in it included: so there it is drawn, stored and judged, and a
    // required one is required.
    it("stores and judges one placed directly in it when the outer component is held in a group", async () => {
      const t = await boot(dialect);
      const create = (box: Record<string, unknown>) =>
        t.nextly.create({
          collection: "pages" as never,
          data: { name: "B", box } as never,
        });

      const missing = await outcomeOf(() => create({ plaque: {} }));
      expect(missing.issues).toContainEqual(
        expect.objectContaining({ path: "box.plaque.seal", code: "REQUIRED" })
      );

      const created = await create({ plaque: { seal: { label: "S" } } });
      const read = (await t.nextly.findByID({
        collection: "pages" as never,
        id: (created.item as { id: string }).id as never,
      })) as { box?: { plaque?: { seal?: { label?: string } } } };
      expect(read.box?.plaque?.seal?.label).toBe("S");
    });

    it("does not require one placed directly in it on a Single, published or held", async () => {
      const t = await boot(dialect);
      const update = (data: Record<string, unknown>) =>
        outcomeOf(() =>
          t.nextly.updateSingle({
            slug: "landing" as never,
            data: data as never,
          })
        );

      expect(
        await update({ headline: "H", plaque: {}, status: "published" })
      ).toEqual({ ok: true, issues: [] });
      // A save naming no status on a published Single is held, and judged as the publish is.
      expect(await update({ headline: "Held" })).toEqual({
        ok: true,
        issues: [],
      });
      expect(await update({ status: "published" })).toEqual({
        ok: true,
        issues: [],
      });
      // A value for it is still refused, there as anywhere it is not stored.
      const refused = await update({ plaque: { seal: { label: "S" } } });
      expect(refused.issues).toContainEqual({ path: "seal", ...NOT_STORED });
    });

    it("passes an empty value for one placed directly in it", async () => {
      const t = await boot(dialect);
      for (const card of [
        { title: "T", badge: null },
        { title: "T", badge: {} },
        { title: "T", badges: [] },
      ]) {
        expect(
          await outcomeOf(() =>
            t.nextly.create({
              collection: "pages" as never,
              data: { name: "E", card } as never,
            })
          )
        ).toEqual({ ok: true, issues: [] });
      }
    });

    // The admin never draws such a field (see below), so nothing seeds it: a value that holds only
    // the inner component's defaults was still sent by someone, and is lost like any other.
    it("refuses one holding only its defaults", async () => {
      const t = await boot(dialect);
      const refused = await outcomeOf(() =>
        t.nextly.create({
          collection: "pages" as never,
          data: {
            name: "D",
            card: { badge: { label: "", tone: "plain", flag: true } },
          } as never,
        })
      );
      expect(refused.issues).toContainEqual({ path: "badge", ...NOT_STORED });
    });

    it("leaves one placed directly in it out of the schema the admin draws", async () => {
      const t = await boot(dialect);
      const [card] = (await t
        .getService("fieldGroupRegistryService")
        .enrichFieldsWithComponentSchemas([
          { name: "card", type: "component", component: "card" },
        ])) as Array<{
        componentFields?: Array<{
          name?: string;
          fields?: Array<{ name?: string; componentFields?: unknown[] }>;
        }>;
      }>;
      const names = (card?.componentFields ?? []).map(field => field.name);

      // Nothing could store these, so the form gets nothing to render, seed or send.
      expect(names).not.toContain("badge");
      expect(names).not.toContain("badges");
      expect(names).not.toContain("slot");
      // Held in a group or repeater it is stored, and drawn.
      expect(names).toEqual(expect.arrayContaining(["title", "meta", "chips"]));
      const meta = card?.componentFields?.find(field => field.name === "meta");
      expect(meta?.fields?.[0]).toMatchObject({ name: "badge" });
      expect(meta?.fields?.[0]?.componentFields).toBeDefined();
    });

    it("draws one placed directly in it where the outer component is held in a group", async () => {
      const t = await boot(dialect);
      const [box] = (await t
        .getService("fieldGroupRegistryService")
        .enrichFieldsWithComponentSchemas([
          {
            name: "box",
            type: "group",
            fields: [
              { name: "plaque", type: "component", component: "plaque" },
            ],
          },
        ])) as Array<{
        fields?: Array<{ componentFields?: Array<{ name?: string }> }>;
      }>;

      // Stored in the group's JSON, so the form draws it, and can fill a required one.
      expect(
        (box?.fields?.[0]?.componentFields ?? []).map(field => field.name)
      ).toContain("seal");
    });

    it("judges a held component's validators against that component's own values", async () => {
      const t = await boot(dialect);
      const refused = await outcomeOf(() =>
        t.nextly.create({
          collection: "pages" as never,
          data: {
            name: "P",
            card: { meta: { badge: { label: "same", motto: "same" } } },
          } as never,
        })
      );
      expect(refused.ok).toBe(false);
      expect(refused.issues).toContainEqual(
        expect.objectContaining({
          path: "meta.badge.motto",
          message: "motto cannot repeat the label.",
        })
      );
    });

    it("refuses a row added to a directly placed list, and a default it turned off", async () => {
      const t = await boot(dialect);
      // A row the editor added, still holding only its defaults: it was added, so it is a value.
      const added = await outcomeOf(() =>
        t.nextly.create({
          collection: "pages" as never,
          data: {
            name: "A",
            card: { badges: [{ label: "", tone: "plain", flag: true }] },
          } as never,
        })
      );
      expect(added.issues).toContainEqual({ path: "badges", ...NOT_STORED });

      // `false` is a choice when the checkbox defaults to `true`.
      const unticked = await outcomeOf(() =>
        t.nextly.create({
          collection: "pages" as never,
          data: { name: "U", card: { badge: { flag: false } } } as never,
        })
      );
      expect(unticked.issues).toContainEqual({ path: "badge", ...NOT_STORED });

      // A zone row names the component someone chose for it, which is a choice too.
      const chosen: Record<string, unknown> = { label: "" };
      writeFieldGroupType(chosen, "badge");
      const zone = await outcomeOf(() =>
        t.nextly.create({
          collection: "pages" as never,
          data: { name: "Z", card: { slot: chosen } } as never,
        })
      );
      expect(zone.issues).toContainEqual({ path: "slot", ...NOT_STORED });
    });

    it("resolves a held component's schema once per write, however many rows hold it", async () => {
      const t = await boot(dialect);
      const passes = async (rows: number) => {
        componentWriteResolutions.length = 0;
        await t.nextly.create({
          collection: "pages" as never,
          data: {
            name: "R",
            cards: Array.from({ length: rows }, () => ({
              meta: { badge: { label: "L" } },
            })),
          } as never,
        });
        return componentWriteResolutions.length;
      };

      expect(await passes(1)).toBe(1);
      expect(await passes(4)).toBe(1);
    });
  }
);
