/**
 * A checked call with no caller, which the Public role doesn't cover, is
 * answered 401 AUTH_REQUIRED at the Direct API and the plugin services, as
 * REST answers it: signing in could grant what it asked for. A rule that
 * refuses a visitor the Public role does cover is answered 403, as it is for
 * anyone the rule refuses.
 *
 * The visitor is a Direct API call with `overrideAccess: false` and no user.
 * The harness runs the boot's seeding, so the Public role holds the reads boot
 * grants and no write, unless a case grants one.
 */
import { afterEach, describe, expect, it } from "vitest";

import { grantPublic } from "../../__tests__/helpers/public-role";
import { defineCollection, defineSingle, text } from "../../config";
import { NextlyError } from "../../errors/nextly-error";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

// Integration files share fixed system-table names, so this file keeps its
// own slugs.
const NOTES = "unauth_notes";
// The update rule refuses everyone, so a refusal there is the rule's.
const LOCKED = "unauth_locked";
const SETTINGS = "unauth_settings";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    seedPublic: true,
    collections: [
      defineCollection({
        slug: NOTES,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: LOCKED,
        access: { read: () => true, update: () => false },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SETTINGS,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return current;
}

/** The error a call threw. */
async function errorOf(call: () => Promise<unknown>): Promise<NextlyError> {
  try {
    await call();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("the call succeeded");
}

describe("a visitor the Public role doesn't cover", () => {
  it("is answered 401 AUTH_REQUIRED by a collection's update", async () => {
    const t = await boot();
    const { item } = await t.nextly.create({
      collection: NOTES,
      data: { title: "kept" },
    });

    const refused = await errorOf(() =>
      t.nextly.update({
        collection: NOTES,
        id: String(item.id),
        data: { title: "changed" },
        overrideAccess: false,
      } as never)
    );

    expect(refused.statusCode).toBe(401);
    expect(refused.code).toBe("AUTH_REQUIRED");
  });

  it("is answered 401 AUTH_REQUIRED by a Single's update", async () => {
    const t = await boot();
    await t.nextly.updateSingle({ slug: SETTINGS, data: { title: "kept" } });

    const refused = await errorOf(() =>
      t.nextly.updateSingle({
        slug: SETTINGS,
        data: { title: "changed" },
        overrideAccess: false,
      } as never)
    );

    expect(refused.statusCode).toBe(401);
    expect(refused.code).toBe("AUTH_REQUIRED");
  });
});

describe("a visitor the Public role covers", () => {
  it("is answered 403 where the target's rule refuses it", async () => {
    // The control: Public holds the update, so the refusal is the rule's,
    // and signing in would not change it.
    const t = await boot();
    await grantPublic(t, [`update-${LOCKED}`]);
    const { item } = await t.nextly.create({
      collection: LOCKED,
      data: { title: "kept" },
    });

    const refused = await errorOf(() =>
      t.nextly.update({
        collection: LOCKED,
        id: String(item.id),
        data: { title: "changed" },
        overrideAccess: false,
      } as never)
    );

    expect(refused.statusCode).toBe(403);
  });
});
