/**
 * A held edit to a published Single's component is validated when it is
 * saved, the way the same value is when it is published.
 *
 * A save that names no status on a published Single is held as its working
 * draft and recorded as a version, and its component values skip the
 * component write, which is where a component's own fields are validated. A
 * held value that breaks one of them was stored, and only the later publish
 * refused it. Each case here publishes the invalid value once to learn the
 * refusal, then holds the same value and expects that refusal, with nothing
 * written: no working draft, no version, and the live component unchanged.
 * A collection entry's held edit takes the same path, and is held to the same.
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
};

/** A scope's version rows: the working draft has no number. */
async function versionRows(handle: TestNextly, scope = "home") {
  return (await handle.adapter.select<Row>("nextly_versions")).filter(
    r => r.scopeSlug === scope
  );
}

type Refusal = {
  ok: boolean;
  code?: string | number;
  issues: Array<{ path: string; message: string }>;
};

/**
 * What an update reports, read the same way whether it returned a result or
 * threw: success, and each field path with its message.
 */
async function outcomeOf(run: () => Promise<unknown>): Promise<Refusal> {
  try {
    const result = (await run()) as {
      success?: boolean;
      statusCode?: number;
      errors?: Array<{ field?: string; path?: string; message: string }>;
    };
    return {
      ok: result.success !== false,
      code: result.statusCode,
      issues: (result.errors ?? []).map(e => ({
        path: e.field ?? e.path ?? "",
        message: e.message,
      })),
    };
  } catch (error) {
    const thrown = error as {
      statusCode?: number;
      publicData?: { errors?: Array<{ path: string; message: string }> };
    };
    return {
      ok: false,
      code: thrown.statusCode,
      issues: (thrown.publicData?.errors ?? []).map(e => ({
        path: e.path,
        message: e.message,
      })),
    };
  }
}

/** A component with a required field and a field with its own validator. */
const heroGroup = () =>
  defineFieldGroup({
    slug: "hero",
    fields: [
      text({ name: "heading", required: true }),
      text({
        name: "code",
        validate: (value: unknown) =>
          value !== "forbidden" || "code cannot be forbidden",
      }),
    ],
  });

async function bootSingle(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [heroGroup()],
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
  const singles = current.getService("singleEntryService");
  const published = await outcomeOf(() =>
    singles.update(
      "home",
      {
        title: "T",
        hero: { heading: "Live", code: "ok" },
        status: "published",
      },
      { overrideAccess: true }
    )
  );
  expect(published.ok).toBe(true);
  return singles;
}

async function liveHero(handle: TestNextly) {
  const read = await handle
    .getService("singleEntryService")
    .get("home", { overrideAccess: true });
  const data = ((read as { data?: unknown }).data ?? read) as Record<
    string,
    unknown
  >;
  return data.hero as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "a held component edit is validated when saved (integration, %s)",
  dialect => {
    it.each([
      ["a required component field left empty", { heading: "", code: "ok" }],
      [
        "a component field's own validator",
        { heading: "Live", code: "forbidden" },
      ],
    ])(
      "refuses %s as its publish would, and writes nothing",
      async (_label, hero) => {
        const singles = await bootSingle(dialect);
        const rowsBefore = await versionRows(current!);

        // What the publish of this value says today.
        const onPublish = await outcomeOf(() =>
          singles.update(
            "home",
            { hero, status: "published" },
            { overrideAccess: true }
          )
        );
        expect(onPublish.ok).toBe(false);
        expect(onPublish.issues.length).toBeGreaterThan(0);

        // The same value, held.
        const onSave = await outcomeOf(() =>
          singles.update("home", { hero }, { overrideAccess: true })
        );

        expect(onSave).toEqual(onPublish);
        expect(await versionRows(current!)).toHaveLength(rowsBefore.length);
        expect(
          (await versionRows(current!)).filter(r => r.versionNo === null)
        ).toHaveLength(0);
        expect(await liveHero(current!)).toMatchObject({
          heading: "Live",
          code: "ok",
        });
      }
    );
  }
);

const cases = [
  ["a required component field left empty", { heading: "", code: "ok" }],
  ["a component field's own validator", { heading: "Live", code: "forbidden" }],
] as const;

async function bootCollection(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [heroGroup()],
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
  });
  const created = (await current.nextly.create({
    collection: "pages" as never,
    data: {
      title: "T",
      hero: { heading: "Live", code: "ok" },
      status: "published",
    } as never,
  })) as unknown as { item: { id: string | number } };
  return String(created.item.id);
}

describe.each(getConfiguredTestDialects())(
  "a held collection component edit is validated when saved (integration, %s)",
  dialect => {
    it.each(cases)(
      "refuses %s as its publish would, and writes nothing",
      async (_label, hero) => {
        const id = await bootCollection(dialect);
        const t = current!;
        const update = (data: Record<string, unknown>) =>
          outcomeOf(() =>
            t.nextly.update({
              collection: "pages" as never,
              id,
              data: data as never,
            })
          );
        const rowsBefore = await versionRows(t, "pages");

        const onPublish = await update({ hero, status: "published" });
        expect(onPublish.ok).toBe(false);
        expect(onPublish.issues.length).toBeGreaterThan(0);

        const onSave = await update({ hero });

        expect(onSave).toEqual(onPublish);
        expect(await versionRows(t, "pages")).toHaveLength(rowsBefore.length);
        const live = (await t.nextly.findByID({
          collection: "pages" as never,
          id,
          overrideAccess: true,
        } as never)) as { hero?: unknown };
        expect(live.hero).toMatchObject({ heading: "Live", code: "ok" });
      }
    );
  }
);
