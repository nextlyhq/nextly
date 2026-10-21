/**
 * A component inside another component's fields, as the outer component's write treats it.
 *
 * Held in a group or a repeater of the outer component, the inner component's value is stored in
 * that container's JSON, so no component write of its own reaches it: the outer component's write
 * is what judges it, against the inner component's fields and its registered validators.
 *
 * Placed DIRECTLY in the outer component's fields, it has no column and no table write, so its
 * value cannot be stored. A write carrying one is refused rather than accepted and dropped. A value
 * that carries nothing beyond the inner component's defaults, which is what the admin's form seeds
 * for a component nobody touched, is not a value anyone would lose, and passes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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
import { FieldGroupRegistryService } from "../services/field-group-registry-service";
import { writeFieldGroupType } from "../storage/field-group-type-key";

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
        ],
      }),
    ],
    singles: [
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

      // A required one is refused the same way: required or not, it is not stored.
      const required = await outcomeOf(() =>
        t.nextly.create({
          collection: "pages" as never,
          data: { name: "R", plaque: { seal: { label: "S" } } } as never,
        })
      );
      expect(required.ok).toBe(false);
      expect(required.issues).toContainEqual({ path: "seal", ...NOT_STORED });
    });

    it("passes one that carries nothing beyond its defaults, as the admin's form seeds it", async () => {
      const t = await boot(dialect);
      const seeded = await outcomeOf(() =>
        t.nextly.create({
          collection: "pages" as never,
          data: {
            name: "S",
            card: {
              title: "T",
              badge: { label: "", tone: "plain", code: null, flag: true },
              badges: [],
            },
          } as never,
        })
      );
      expect(seeded).toEqual({ ok: true, issues: [] });
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

    it("reads a held component's schema once per write, however many rows hold it", async () => {
      const t = await boot(dialect);
      const lookup = vi.spyOn(
        FieldGroupRegistryService.prototype,
        "getComponentBySlug"
      );
      const badgeReads = async (rows: number) => {
        lookup.mockClear();
        await t.nextly.create({
          collection: "pages" as never,
          data: {
            name: "R",
            cards: Array.from({ length: rows }, () => ({
              meta: { badge: { label: "L" } },
            })),
          } as never,
        });
        return lookup.mock.calls.filter(([slug]) => slug === "badge").length;
      };

      const one = await badgeReads(1);
      expect(one).toBeGreaterThan(0);
      expect(await badgeReads(4)).toBe(one);
      lookup.mockRestore();
    });
  }
);
