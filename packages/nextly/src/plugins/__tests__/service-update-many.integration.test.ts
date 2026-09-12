/**
 * `ctx.services.collections.updateMany` through a live boot.
 *
 * The plugin facade ended at `createMany`: a plugin could write many rows and
 * then had no way to change them in one call, elevated or not, so the only
 * batch update available to plugin code was a loop of `updateEntry` calls,
 * each with its own transaction.
 *
 * What this pins: one call carries a DIFFERENT patch per row; `{as:'system'}`
 * reaches rows an unprivileged caller cannot; `{as:'user'}` is still judged;
 * a failed row does not stop the rest and is reported by the index of the
 * entry the caller passed; and a locale is refused by name rather than
 * dropped.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Services = any;

async function boot(): Promise<{ services: Services; handle: TestNextly }> {
  let services: Services;
  const probe = definePlugin({
    name: "@test/update-many",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: ctx => {
      services = ctx.services;
    },
  });
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "widgets",
        fields: [text({ name: "title" }), text({ name: "kind" })],
      }),
    ],
    plugins: [probe],
  });
  return { services: services!, handle: current };
}

async function seed(handle: TestNextly, titles: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) {
    const created = await handle.nextly.create({
      collection: "widgets",
      data: { title, kind: "draft" },
    });
    ids.push((created.item as { id: string }).id);
  }
  return ids;
}

describe("ctx.services.collections.updateMany", () => {
  it("applies a different patch to each row under {as:'system'}", async () => {
    const { services, handle } = await boot();
    const [a, b] = await seed(handle, ["one", "two"]);

    const result = await services.collections.updateMany(
      "widgets",
      [
        { id: a, data: { kind: "published" } },
        { id: b, data: { title: "renamed" } },
      ],
      { as: "system" }
    );

    expect(result.failed, JSON.stringify(result.errors)).toBe(0);
    expect(result.successful).toBe(2);
    expect([...result.ids].sort()).toEqual([a, b].sort());

    const first = (await handle.nextly.findByID({
      collection: "widgets",
      id: a,
    })) as { kind?: string; title?: string };
    const second = (await handle.nextly.findByID({
      collection: "widgets",
      id: b,
    })) as { kind?: string; title?: string };
    // Each row took its own patch, and neither took the other's.
    expect(first.kind).toBe("published");
    expect(first.title).toBe("one");
    expect(second.title).toBe("renamed");
    expect(second.kind).toBe("draft");
  });

  it("reports a failed row by the index of the entry passed, and commits the rest", async () => {
    const { services, handle } = await boot();
    const [a] = await seed(handle, ["one"]);

    const result = await services.collections.updateMany(
      "widgets",
      [
        { id: "missing-id", data: { kind: "published" } },
        { id: a, data: { kind: "published" } },
      ],
      { as: "system" }
    );

    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.ids).toEqual([a]);
    // The index is into the array THIS caller passed, so the row a failure is
    // about is `entries[index].id`.
    expect(result.errors.map((e: { index: number }) => e.index)).toEqual([0]);
  });

  it("refuses a locale by name rather than writing the default language", async () => {
    const { services, handle } = await boot();
    const [a] = await seed(handle, ["one"]);

    await expect(
      services.collections.updateMany(
        "widgets",
        [{ id: a, data: { kind: "published" } }],
        { as: "system", locale: "fr" }
      )
    ).rejects.toThrow(/locale/);
  });

  it("is judged as the caller under {as:'user'}", async () => {
    const { services, handle } = await boot();
    const [a] = await seed(handle, ["one"]);

    const result = await services.collections.updateMany(
      "widgets",
      [{ id: a, data: { kind: "published" } }],
      { as: "user", user: { id: "nobody", email: "nobody@x.test", roles: [] } }
    );

    // Not elevated: the collection gate judges an unprivileged caller, so the
    // row is not written.
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(1);
    const after = (await handle.nextly.findByID({
      collection: "widgets",
      id: a,
    })) as { kind?: string };
    expect(after.kind).toBe("draft");
  });
  it("pairs with createMany: seed a batch, then patch the batch", async () => {
    const { services, handle } = await boot();

    const created = await services.collections.createMany(
      "widgets",
      [
        { title: "a", kind: "draft" },
        { title: "b", kind: "draft" },
      ],
      { as: "system" }
    );
    expect(created.failed, JSON.stringify(created.errors)).toBe(0);

    const result = await services.collections.updateMany(
      "widgets",
      created.ids.map((id: string) => ({ id, data: { kind: "published" } })),
      { as: "system" }
    );
    expect(result.failed, JSON.stringify(result.errors)).toBe(0);

    for (const id of created.ids) {
      const row = (await handle.nextly.findByID({
        collection: "widgets",
        id,
      })) as { kind?: string };
      expect(row.kind).toBe("published");
    }
  });
});
