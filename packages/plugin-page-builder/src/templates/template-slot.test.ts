/**
 * The templates guard, judged one write at a time with its lookups stubbed:
 * the place a new template holds, the collections that may have one, the
 * refusal naming the template already there, and a place that never moves.
 *
 * That the unique index refuses a second template when two creates race past
 * the guard is a property of the database, proved on every dialect by
 * `__tests__/templates.integration.test.ts`.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  baseSlotKey,
  guardWrite,
  templateCollectionProblem,
  type TemplateGuardSetup,
} from "./template-slot";

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
  it("holds its collection's place", async () => {
    const data: Record<string, unknown> = {
      title: "Post",
      collection: "posts",
    };
    await guardWrite(setup(), { operation: "create", data });
    expect(data.slotKey).toBe("base:posts");
    expect(baseSlotKey("posts")).toBe("base:posts");
  });

  it("takes the place from its collection, whatever a client sent for it", async () => {
    const data: Record<string, unknown> = {
      title: "Post",
      collection: "posts",
      slotKey: "base:elsewhere",
    };
    await guardWrite(setup(), { operation: "create", data });
    expect(data.slotKey).toBe("base:posts");
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

  it("leaves the second template to the index inside a caller's transaction", async () => {
    const holderOf = vi.fn(async () => ({ id: "t1", title: "Post page" }));
    const data: Record<string, unknown> = {
      title: "Post",
      collection: "posts",
    };
    await guardWrite(setup({ holderOf }), {
      operation: "create",
      data,
      executor: {},
    });
    expect(holderOf).not.toHaveBeenCalled();
    expect(data.slotKey).toBe("base:posts");
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
    bookkeeping: {
      slug: "bookkeeping",
      internal: true,
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
      'There is no collection "bookkeeping" to give a template.'
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
  it("keeps its place: a value sent for it is dropped", async () => {
    const data: Record<string, unknown> = {
      title: "Renamed",
      slotKey: "base:other",
    };
    await guardWrite(setup(), {
      operation: "update",
      data,
      originalData: { collection: "posts", slotKey: "base:posts" },
    });
    expect(data).toEqual({ title: "Renamed" });
  });

  it("keeps its collection", async () => {
    const error = await refusalOf(() =>
      guardWrite(setup(), {
        operation: "update",
        data: { collection: "articles" },
        originalData: { collection: "posts" },
      })
    );
    expect(messagesOf(error)).toEqual([
      "A template's collection cannot be changed. Create a template for the other collection instead.",
    ]);
  });

  it("accepts its own collection sent back unchanged", async () => {
    const data: Record<string, unknown> = { collection: "posts", title: "T" };
    await guardWrite(setup(), {
      operation: "update",
      data,
      originalData: { collection: "posts" },
    });
    expect(data).toEqual({ collection: "posts", title: "T" });
  });
});
