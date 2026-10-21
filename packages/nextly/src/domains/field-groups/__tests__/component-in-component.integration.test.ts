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
import { afterEach, describe, expect, it } from "vitest";

import {
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
    ],
  });

/** The outer component, holding the inner one in each of the three places it can go. */
const card = () =>
  defineFieldGroup({
    slug: "card",
    fields: [
      text({ name: "title" }),
      fieldGroup({ name: "badge", component: "badge" }),
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
              badge: { label: "", tone: "plain", code: null },
            },
          } as never,
        })
      );
      expect(seeded).toEqual({ ok: true, issues: [] });
    });
  }
);
