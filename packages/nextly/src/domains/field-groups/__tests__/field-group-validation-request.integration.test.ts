/**
 * The parent write carries its request into a field group's validators.
 *
 * The service-level cases prove the value travels once it is handed over; this
 * proves the entity write paths hand it over at all. Each of them builds the
 * request itself, so each is a place the forwarding can be missing
 * independently of the others — a collection create, a collection update, and
 * a single update.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  pluginField,
  text,
} from "../../../config";
import type { PluginFieldValidateArgs } from "../../../plugins/contributions";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

/** The signed-in caller a write is attributed to. */
const USER = { id: "u1", email: "editor@example.com" };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * A plugin field type whose rule depends on who is writing — the capability
 * that silently did nothing inside a field group, because it fails OPEN: with
 * no user in scope the safe-looking answer is to accept.
 */
const ownerOnlyPlugin = definePlugin({
  name: "@test/owner-only",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    fieldTypes: [
      {
        type: "owner-only",
        storage: "text",
        component: "@test/owner-only/admin#OwnerOnlyInput",
        validate: (_value: unknown, args: PluginFieldValidateArgs) =>
          args.req.user ? true : "Only a signed-in user may set a badge",
      },
    ],
  },
});

async function boot(): Promise<TestNextly> {
  return createTestNextly({
    plugins: [ownerOnlyPlugin],
    fieldGroups: [
      defineFieldGroup({
        slug: "badged",
        fields: [pluginField({ name: "badge", type: "owner-only" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: "pages",
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "badge", component: "badged" }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "landing",
        fields: [
          text({ name: "headline" }),
          fieldGroup({ name: "badge", component: "badged" }),
        ],
      }),
    ],
  });
}

describe("a field group's validators and the parent write's request", () => {
  it("a collection create forwards its user", async () => {
    current = await boot();

    const created = await current.nextly.create({
      collection: "pages",
      data: { title: "About", badge: { badge: "gold" } },
      user: USER,
      overrideAccess: true,
    });

    expect((created.item as { title?: string }).title).toBe("About");
  });

  it("refuses the same create when nobody is signed in", async () => {
    // The control: without it a passing case above could be a validator that
    // never ran rather than one that was given the user.
    current = await boot();

    const error = await current.nextly
      .create({
        collection: "pages",
        data: { title: "About", badge: { badge: "gold" } },
        overrideAccess: true,
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "badge",
            code: "CUSTOM",
            message: "Only a signed-in user may set a badge.",
          },
        ],
      },
    });
  });

  it("a collection update forwards its user", async () => {
    current = await boot();

    const created = await current.nextly.create({
      collection: "pages",
      data: { title: "About", badge: { badge: "gold" } },
      user: USER,
      overrideAccess: true,
    });

    const updated = await current.nextly.update({
      collection: "pages",
      id: (created.item as { id: string }).id,
      data: { badge: { badge: "silver" } },
      user: USER,
      overrideAccess: true,
    });

    expect((updated.item as { id?: string }).id).toBe(
      (created.item as { id: string }).id
    );
  });

  it("a single update forwards its user", async () => {
    current = await boot();

    const updated = await current.nextly.updateSingle({
      slug: "landing",
      data: { headline: "Hello", badge: { badge: "gold" } },
      user: USER,
      overrideAccess: true,
    });

    expect((updated as { headline?: string }).headline).toBe("Hello");
  });

  it("refuses the same single update when nobody is signed in", async () => {
    // The same refusal on the singles path, which reports it the same way.
    current = await boot();

    const error = await current.nextly
      .updateSingle({
        slug: "landing",
        data: { headline: "Hello", badge: { badge: "gold" } },
        overrideAccess: true,
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "badge",
            code: "CUSTOM",
            message: "Only a signed-in user may set a badge.",
          },
        ],
      },
    });
  });
});
