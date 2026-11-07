/**
 * The templates guard, judged one write at a time with its lookups stubbed:
 * the collections that may have a template, the refusal naming the template
 * already there, and a collection that does not move while it exists.
 *
 * That the unique index refuses a second template when two creates race past
 * the guard is a property of the database, proved on every dialect by
 * `__tests__/templates.integration.test.ts`.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  guardWrite,
  templateCollectionProblem,
  type TemplateGuardSetup,
} from "./template-guard";

const POSTS = {
  slug: "posts",
  fields: [
    { name: "title", type: "text" },
    { name: "slug", type: "text" },
  ],
};

function setup(
  overrides: Partial<TemplateGuardSetup> = {}
): TemplateGuardSetup {
  return {
    templatesCollection: "templates",
    ownCollections: () => new Set(["pages", "templates", "components"]),
    readCollection: async slug => (slug === "posts" ? POSTS : null),
    holderOf: async () => null,
    lockEntry: async () => undefined,
    entryExists: async (collection, id) =>
      collection === "posts" && id === "p1",
    ...overrides,
  };
}

async function refusalOf(run: () => Promise<unknown>): Promise<NextlyError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("the write was not refused");
}

function messagesOf(error: NextlyError): string[] {
  const listed = (error.publicData as { errors?: { message: string }[] })
    ?.errors;
  return listed === undefined
    ? [error.publicMessage]
    : listed.map(item => item.message);
}

describe("a new template", () => {
  it("is let through for a collection that may have one and has none", async () => {
    const holderOf = vi.fn(async () => null);
    const data: Record<string, unknown> = {
      title: "Post",
      collection: "posts",
    };
    await guardWrite(setup({ holderOf }), { operation: "create", data });
    expect(holderOf).toHaveBeenCalledWith("posts");
    expect(data).toEqual({ title: "Post", collection: "posts" });
  });

  it("is refused for a collection that already has one, naming it by title for a reader", async () => {
    const findByID = vi.fn(async () => ({ id: "t1" }));
    const error = await refusalOf(() =>
      guardWrite(
        setup({ holderOf: async () => ({ id: "t1", title: "Post page" }) }),
        {
          operation: "create",
          data: { title: "Second", collection: "posts" },
          user: { id: "u1" },
          req: { nextly: { findByID } },
        }
      )
    );
    expect(NextlyError.isConflict(error)).toBe(true);
    expect(error.publicMessage).toBe(
      'The collection "posts" already has a template: "Post page" (t1). ' +
        "A collection has one template; change that one, or delete it first."
    );
    // Asked as the writer, so the title is shown only to someone who may read it.
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "templates",
        id: "t1",
        overrideAccess: false,
        user: { id: "u1" },
      })
    );
  });

  it("names the existing one by id alone to someone who may not read it", async () => {
    const findByID = vi.fn(async () => {
      throw NextlyError.forbidden();
    });
    const error = await refusalOf(() =>
      guardWrite(
        setup({ holderOf: async () => ({ id: "t1", title: "Secret" }) }),
        {
          operation: "create",
          data: { title: "Second", collection: "posts" },
          user: { id: "u1" },
          req: { nextly: { findByID } },
        }
      )
    );
    expect(error.publicMessage).toContain("a template you cannot open (t1)");
    expect(error.publicMessage).not.toContain("Secret");
  });

  it("reads nothing inside a caller's transaction: a dry run's judging write goes to the index, any other is refused", async () => {
    const holderOf = vi.fn(async () => ({ id: "t1", title: "Post page" }));
    const readCollection = vi.fn(async () => POSTS);
    await guardWrite(setup({ holderOf, readCollection }), {
      operation: "create",
      data: { title: "Post", collection: "posts" },
      executor: {},
      context: { "pageBuilder.transferJudgement": true },
    });
    expect(holderOf).not.toHaveBeenCalled();
    expect(readCollection).not.toHaveBeenCalled();

    const error = await refusalOf(() =>
      guardWrite(setup({ holderOf, readCollection }), {
        operation: "create",
        data: { title: "Post", collection: "posts" },
        executor: {},
      })
    );
    expect(NextlyError.isValidation(error)).toBe(true);
    expect(readCollection).not.toHaveBeenCalled();
  });
});

describe("which collections may have a template", () => {
  const own = new Set(["pages", "templates"]);
  const records: Record<string, Record<string, unknown>> = {
    posts: POSTS,
    // Declared through the Schema Builder: its fields under the schema.
    runtime: {
      slug: "runtime",
      schemaDefinition: { fields: [{ name: "slug", type: "text" }] },
    },
    notes: { slug: "notes", fields: [{ name: "slug", type: "textarea" }] },
    // A plugin's private collection, as the registry records it: hidden,
    // with the slug field every code-first collection is given.
    bookkeeping: {
      slug: "bookkeeping",
      admin: { hidden: true },
      fields: [{ name: "slug", type: "text" }],
    },
  };
  const read = async (slug: string) => records[slug] ?? null;

  it("is any content collection with a slug text field", async () => {
    expect(await templateCollectionProblem("posts", read, own)).toBeNull();
    expect(await templateCollectionProblem("runtime", read, own)).toBeNull();
  });

  it("refuses the page builder's own, an unknown one, bookkeeping, and one with no slug text field", async () => {
    expect(await templateCollectionProblem("pages", read, own)).toBe(
      '"pages" belongs to the page builder, and its documents are not drawn with a template.'
    );
    expect(await templateCollectionProblem("ghosts", read, own)).toBe(
      'There is no collection "ghosts" to give a template.'
    );
    expect(await templateCollectionProblem("bookkeeping", read, own)).toBe(
      'The collection "bookkeeping" is kept out of the admin, so its entries are not drawn with a template.'
    );
    expect(await templateCollectionProblem("notes", read, own)).toBe(
      'The collection "notes" has no text field named "slug", so its entries ' +
        "have no address to be served at. Add one, then give it a template."
    );
  });

  it("is refused on the write, on the collection field", async () => {
    const error = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "create",
        data: { title: "Page", collection: "pages" },
      })
    );
    expect(NextlyError.isValidation(error)).toBe(true);
    expect(error.publicData).toEqual({
      errors: [
        {
          path: "collection",
          code: "NOT_TEMPLATABLE",
          message:
            '"pages" belongs to the page builder, and its documents are not drawn with a template.',
        },
      ],
    });
  });
});

describe("a saved template", () => {
  it("is let through when it leaves its collection alone", async () => {
    const holderOf = vi.fn(async () => null);
    for (const data of [{ title: "Renamed" }, { collection: "posts" }]) {
      await guardWrite(setup({ holderOf }), {
        operation: "update",
        data,
        originalData: { id: "t1", collection: "posts" },
      });
    }
    expect(holderOf).not.toHaveBeenCalled();
  });

  it("keeps its collection while that collection exists", async () => {
    const error = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "update",
        data: { collection: "articles" },
        originalData: { id: "t1", collection: "posts" },
      })
    );
    expect(messagesOf(error)).toEqual([
      "A template's collection cannot be changed while that collection exists. Create a template for the other collection instead.",
    ]);
  });

  it("may be pointed at another collection once its own is gone, judged as a new one", async () => {
    // `old-posts` was renamed to `posts`: the template it drew is repaired,
    // and is not named as its own rival.
    const holderOf = vi.fn(async () => ({ id: "t1", title: "Post page" }));
    await guardWrite(setup({ holderOf }), {
      operation: "update",
      data: { collection: "posts" },
      originalData: { id: "t1", collection: "old-posts" },
    });
    expect(holderOf).toHaveBeenCalledWith("posts");

    // Another template already draws the new collection: refused, naming it.
    const taken = await refusalOf(() =>
      guardWrite(
        setup({ holderOf: async () => ({ id: "t2", title: "Other" }) }),
        {
          operation: "update",
          data: { collection: "posts" },
          originalData: { id: "t1", collection: "old-posts" },
        }
      )
    );
    expect(NextlyError.isConflict(taken)).toBe(true);
    expect(taken.publicMessage).toContain("(t2)");

    // And it may not be pointed at one that cannot have a template.
    const refused = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "update",
        data: { collection: "pages" },
        originalData: { id: "t1", collection: "old-posts" },
      })
    );
    expect(NextlyError.isValidation(refused)).toBe(true);
  });
});

describe("an entry's own design", () => {
  const design = (extra: Record<string, unknown> = {}) => ({
    title: "Hello world design",
    entry: "posts/p1",
    entryCollection: "posts",
    entryId: "p1",
    ...extra,
  });

  it("is let through for an entry that exists, without asking for a collection's template", async () => {
    const holderOf = vi.fn(async () => ({ id: "t1", title: "Post page" }));
    await guardWrite(setup({ holderOf }), {
      operation: "create",
      data: design(),
    });
    expect(holderOf).not.toHaveBeenCalled();
  });

  it("is refused when it also names a collection", async () => {
    const refused = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "create",
        data: design({ collection: "posts" }),
      })
    );
    expect(messagesOf(refused)).toEqual([
      "An entry's own design serves its entry, not a collection: leave its collection out.",
    ]);
  });

  it("is refused when it gives its collection an empty value, which the unique index would hold", async () => {
    const refused = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "create",
        data: design({ collection: "" }),
      })
    );
    expect(refused.code).toBe("VALIDATION_ERROR");
  });

  it("is refused under a key its entry does not make", async () => {
    const refused = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "create",
        data: design({ entry: "posts/p2" }),
      })
    );
    expect(messagesOf(refused)[0]).toContain('"posts/p1"');
  });

  it("is refused for an entry that does not exist", async () => {
    const refused = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "create",
        data: design({ entry: "posts/p9", entryId: "p9" }),
      })
    );
    expect(messagesOf(refused)).toEqual([
      'The collection "posts" has no entry "p9" to give its own design.',
    ]);
  });

  it("keeps its entry, and a collection's template never becomes one", async () => {
    const moved = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "update",
        originalData: { id: "d1", ...design() },
        data: { entryId: "p2" },
      })
    );
    expect(moved.code).toBe("VALIDATION_ERROR");
    const turned = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "update",
        originalData: { id: "t1", title: "Post page", collection: "posts" },
        data: { entry: "posts/p1" },
      })
    );
    expect(turned.code).toBe("VALIDATION_ERROR");
  });

  it("saves its design without its entry being judged again", async () => {
    const entryExists = vi.fn(async () => false);
    await guardWrite(setup({ entryExists }), {
      operation: "update",
      originalData: { id: "d1", ...design() },
      data: { title: "Renamed" },
    });
    expect(entryExists).not.toHaveBeenCalled();
  });
});

describe("a collection's template without its collection", () => {
  it("is refused, since only an own design leaves it empty", async () => {
    const refused = await refusalOf(() =>
      guardWrite(setup(), { operation: "create", data: { title: "Post" } })
    );
    expect(messagesOf(refused)).toEqual([
      "A template names the collection whose entries it draws.",
    ]);
  });
});
