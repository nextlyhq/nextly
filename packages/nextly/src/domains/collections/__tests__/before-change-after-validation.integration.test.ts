/**
 * `beforeChange` runs AFTER the validation gate, on both write paths.
 *
 * The declaration used to register onto `beforeCreate`/`beforeUpdate`, which
 * fire before validation, so the phase documented as the last chance to shape a
 * stored value ran on data the schema's rules had not been applied to. What made
 * that hard to see is that the FIELD-level phase of the same name was already in
 * the right place, so the two `beforeChange`s meant different moments.
 *
 * The observable difference is whether a handler runs at all for a write that
 * validation rejects: it must not, because there is no change to prepare for.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this suite keeps its own
// slugs to avoid colliding with a concurrently-running file.
const DOCS = "beforechange_docs";
const SETTINGS = "beforechange_settings";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  // Hooks register into the process-wide registry; clear between tests so one
  // boot's handlers cannot answer for the next.
  resetHookRegistry();
});

type Phases = { beforeValidate: number; beforeChange: number };

async function bootCollection(seen: Phases): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: DOCS,
        access: { create: () => true, read: () => true, update: () => true },
        hooks: {
          beforeValidate: [
            ctx => {
              seen.beforeValidate++;
              return ctx.data;
            },
          ],
          beforeChange: [
            ctx => {
              seen.beforeChange++;
              return ctx.data;
            },
          ],
        },
        fields: [
          text({ name: "title" }),
          // The gate. A write missing it cannot reach the phase that prepares
          // the stored row.
          text({ name: "code", required: true }),
        ],
      }),
    ],
  });
  return current;
}

describe("beforeChange runs after the validation gate", () => {
  it("does not run when a create fails validation", async () => {
    const seen: Phases = { beforeValidate: 0, beforeChange: 0 };
    const t = await bootCollection(seen);

    await expect(
      t.nextly.create({ collection: DOCS, data: { title: "no code" } })
    ).rejects.toThrow();

    // The control: `beforeValidate` DID run, so the write reached the hook
    // pipeline and the counts are not both zero for an unrelated reason.
    expect(seen.beforeValidate).toBe(1);
    expect(seen.beforeChange).toBe(0);
  });

  it("runs when a create passes validation", async () => {
    // The mirror. Without it, "did not run" could just as well mean the phase
    // never runs at all any more.
    const seen: Phases = { beforeValidate: 0, beforeChange: 0 };
    const t = await bootCollection(seen);

    await t.nextly.create({
      collection: DOCS,
      data: { title: "ok", code: "A1" },
    });

    expect(seen.beforeChange).toBe(1);
  });

  it("does not run when an update fails validation", async () => {
    const seen: Phases = { beforeValidate: 0, beforeChange: 0 };
    const t = await bootCollection(seen);

    const created = await t.nextly.create({
      collection: DOCS,
      data: { title: "ok", code: "A1" },
    });
    const id = String(created.item.id);

    seen.beforeValidate = 0;
    seen.beforeChange = 0;

    await expect(
      t.nextly.update({ collection: DOCS, id, data: { code: "" } })
    ).rejects.toThrow();

    expect(seen.beforeValidate).toBe(1);
    expect(seen.beforeChange).toBe(0);
  });

  it("sees a value a beforeValidate hook supplied to satisfy the rules", async () => {
    // The two phases are distinct now, and the earlier one still feeds the
    // gate: a required field filled in by `beforeValidate` lets the write pass,
    // and `beforeChange` is handed the repaired document.
    const seen: Phases = { beforeValidate: 0, beforeChange: 0 };
    let observed: unknown;
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: DOCS,
          access: { create: () => true, read: () => true },
          hooks: {
            beforeValidate: [
              ctx => {
                seen.beforeValidate++;
                return {
                  ...(ctx.data as Record<string, unknown>),
                  code: "GEN",
                };
              },
            ],
            beforeChange: [
              ctx => {
                seen.beforeChange++;
                observed = (ctx.data as Record<string, unknown>).code;
                return ctx.data;
              },
            ],
          },
          fields: [
            text({ name: "title" }),
            text({ name: "code", required: true }),
          ],
        }),
      ],
    });

    await current.nextly.create({
      collection: DOCS,
      data: { title: "supplied" },
    });

    expect(seen.beforeChange).toBe(1);
    expect(observed).toBe("GEN");
  });

  it("hands an update handler the row it is changing", async () => {
    // A handler comparing old against new is the ordinary use of the phase, and
    // it worked while the declaration sat on the `beforeUpdate` queue, whose
    // context carries `originalData`. Giving the phase its own execution point
    // is where that gets dropped silently: the handler sees `undefined` and
    // either throws or decides on nothing.
    const seen: Phases = { beforeValidate: 0, beforeChange: 0 };
    let observedOriginal: unknown;
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: DOCS,
          access: { create: () => true, read: () => true, update: () => true },
          hooks: {
            beforeChange: [
              ctx => {
                seen.beforeChange++;
                const original = (ctx as { originalData?: unknown })
                  .originalData;
                observedOriginal = (
                  original as Record<string, unknown> | undefined
                )?.code;
                return ctx.data;
              },
            ],
          },
          fields: [
            text({ name: "title" }),
            text({ name: "code", required: true }),
          ],
        }),
      ],
    });

    const created = await current.nextly.create({
      collection: DOCS,
      data: { title: "ok", code: "BEFORE" },
    });
    await current.nextly.update({
      collection: DOCS,
      id: String(created.item.id),
      data: { code: "AFTER" },
    });

    // The stored value, not the patch: the handler can tell what changed.
    expect(seen.beforeChange).toBe(2);
    expect(observedOriginal).toBe("BEFORE");
  });

  it("does not run on a single whose update fails validation", async () => {
    // Singles register through their own mapping and execute on their own
    // write path, so the collection fix does not cover them by construction.
    const seen: Phases = { beforeValidate: 0, beforeChange: 0 };
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: SETTINGS,
          fields: [
            text({ name: "siteName" }),
            text({ name: "contact", required: true }),
          ],
          hooks: {
            beforeChange: [
              ctx => {
                seen.beforeChange++;
                return ctx.data;
              },
            ],
          },
        }),
      ],
    });

    await expect(
      current.nextly.updateSingle({
        slug: SETTINGS,
        data: { contact: "" },
        overrideAccess: true,
      })
    ).rejects.toThrow();

    expect(seen.beforeChange).toBe(0);
  });
});
