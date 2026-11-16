/**
 * A save carries the document's declared fields, its system columns and the keys that say how to
 * write (`_rev`, `_overwrite`, `_restoredFrom`), and nothing else. A key that names none of them is
 * refused as a validation error naming it: never written to a column or a language's row of the
 * same name, and never left to fail in the database as an internal error.
 *
 * The plausible broken implementations pass every key on to the write, where a name that happens
 * to be a column of the language rows is stored there and any other fails the statement; or strip
 * unknown keys silently, which hides a caller's typo. A document read and sent back whole is still
 * accepted, so the rule does not refuse what a read hands out.
 */
import { afterEach, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

/** What a refusal says, read off whatever the call threw. */
function refusalOf(promise: Promise<unknown>): Promise<{
  code?: string;
  statusCode?: number;
  data: string;
}> {
  return promise.then(
    () => ({ data: "accepted" }),
    (error: unknown) => {
      const thrown = error as {
        code?: string;
        statusCode?: number;
        publicData?: unknown;
      };
      return {
        code: thrown.code,
        statusCode: thrown.statusCode,
        data: JSON.stringify(thrown.publicData ?? null),
      };
    }
  );
}

describeEachDialect("a save accepts only what it may carry", dialect => {
  let t: TestNextly | undefined;

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
  });

  async function boot(): Promise<TestNextly> {
    t = await createTestNextly({
      dialect,
      singles: [
        defineSingle({
          slug: "site",
          localized: true,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" })],
        }),
      ],
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
      localization: { locales: ["en", "es"], defaultLocale: "en" },
    });
    return t;
  }

  /** Spanish's own publishing state on the Single, as stored. */
  async function spanishStatus(): Promise<unknown> {
    const [row] = await t!.adapter.select<{ _status?: unknown }>(
      "single_site_locales",
      { where: { and: [{ column: "_locale", op: "=", value: "es" }] } }
    );
    return row?._status;
  }

  it("refuses a language's status sent as a value by someone who may only edit, and stores nothing of it", async () => {
    await boot();
    await t!.nextly.updateSingle({
      slug: "site",
      locale: "es",
      data: { title: "Hola", _overwrite: true },
    } as never);
    const editor = await userWhoMay(t!, "editor", "update", ["site"]);
    await grantTo(t!, editor, "read", ["site"]);
    const before = await spanishStatus();

    const refusal = await refusalOf(
      t!.nextly.updateSingle({
        slug: "site",
        locale: "es",
        overrideAccess: false,
        user: { id: editor, email: "editor@example.test", roles: [] },
        data: { title: "Hola 2", _status: "published", _overwrite: true },
      } as never)
    );

    expect(refusal.code).toBe("VALIDATION_ERROR");
    expect(refusal.data).toContain("_status");
    expect(await spanishStatus()).toBe(before);
    expect(await spanishStatus()).not.toBe("published");
  });

  it("refuses a key a Single does not have as a validation error, not an internal one", async () => {
    await boot();

    const refusal = await refusalOf(
      t!.nextly.updateSingle({
        slug: "site",
        data: { title: "Hello", nope: 1, _overwrite: true },
      } as never)
    );

    expect(refusal.code).toBe("VALIDATION_ERROR");
    expect(refusal.statusCode).toBe(400);
    expect(refusal.data).toContain("nope");
  });

  it("refuses a key a collection does not have as a validation error, not an internal one", async () => {
    await boot();
    const created = await t!.nextly.create({
      collection: "posts",
      data: { title: "Hello" },
    } as never);
    const id = String((created as { item: { id: unknown } }).item.id);

    const refusal = await refusalOf(
      t!.nextly.update({
        collection: "posts",
        id,
        data: { title: "Hello again", nope: 1, _overwrite: true },
      } as never)
    );

    expect(refusal.code).toBe("VALIDATION_ERROR");
    expect(refusal.statusCode).toBe(400);
    expect(refusal.data).toContain("nope");
  });

  // What a read hands out is what a client sends back: it stays accepted.
  it("accepts a Single read and sent back whole with a change", async () => {
    await boot();
    await t!.nextly.updateSingle({
      slug: "site",
      data: { title: "Hello", _overwrite: true },
    } as never);
    const read = (await t!.nextly.findSingle({
      slug: "site",
    } as never)) as Record<string, unknown>;

    const saved = await refusalOf(
      t!.nextly.updateSingle({
        slug: "site",
        data: { ...read, title: "Hello again", _overwrite: true },
      } as never)
    );

    expect(saved.data).toBe("accepted");
  });
});
