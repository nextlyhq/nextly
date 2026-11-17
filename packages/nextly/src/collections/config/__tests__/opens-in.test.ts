/**
 * The boot's judgement of a collection's or a Single's `admin.opensIn`:
 * "form", or the path of a document view it has. A path no view answers, or a
 * view offered on a field type it does not hold at its top level, stops the
 * boot naming the collection or Single and the view. A view declared on a
 * slug is a collection's, so it is never a Single's.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { assertOpensIn } from "../opens-in";

/** A plugin contributing a `blocks` field type with a `builder` view on it, and a `review` view on `posts`. */
function viewPlugin(extra: Record<string, unknown> = {}): PluginDefinition {
  return {
    name: "@acme/views",
    version: "1.0.0",
    nextly: "*",
    ...extra,
    contributes: {
      fieldTypes: [
        { type: "blocks", storage: "json", component: "@acme/views#Field" },
      ],
      admin: {
        documentViews: [
          {
            fieldType: "blocks",
            path: "builder",
            component: "@acme/views#Builder",
          },
        ],
        views: {
          posts: {
            documentViews: [
              { path: "review", component: "@acme/views#Review" },
            ],
          },
        },
      },
    },
  } as unknown as PluginDefinition;
}

const title = { type: "text", name: "title" };
const excerpt = { type: "textarea", name: "excerpt" };
const sections = { type: "blocks", name: "sections" };

function collection(
  slug: string,
  opensIn: unknown,
  fields: unknown[] = [title, excerpt, sections]
) {
  return { slug, fields, admin: { opensIn } };
}

function refusal(run: () => void): NextlyError {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("the declaration was accepted");
}

describe("assertOpensIn", () => {
  it("accepts the form, and a collection that declares nothing", () => {
    expect(() =>
      assertOpensIn(
        [collection("posts", "form"), { slug: "tags", fields: [title] }],
        [],
        []
      )
    ).not.toThrow();
  });

  it("accepts a view declared on the collection itself", () => {
    expect(() =>
      assertOpensIn([collection("posts", "review")], [viewPlugin()], [])
    ).not.toThrow();
  });

  it("accepts a field-type view whose field type the collection holds at its top level", () => {
    expect(() =>
      assertOpensIn([collection("notes", "builder")], [viewPlugin()], [])
    ).not.toThrow();
  });

  it("reads into an unnamed group, as the form lays it out", () => {
    const fields = [title, { type: "group", fields: [sections] }];
    expect(() =>
      assertOpensIn(
        [collection("notes", "builder", fields)],
        [viewPlugin()],
        []
      )
    ).not.toThrow();
  });

  it("refuses a view the collection does not have, naming the collection and the view", () => {
    const error = refusal(() =>
      assertOpensIn([collection("posts", "nope")], [viewPlugin()], [])
    );
    expect(error.logMessage ?? error.message).toContain('"posts"');
    expect(error.logMessage ?? error.message).toContain('"nope"');
  });

  it("refuses a slug view declared on another collection", () => {
    const error = refusal(() =>
      assertOpensIn([collection("notes", "review")], [viewPlugin()], [])
    );
    expect(error.message).toContain('"notes"');
    expect(error.message).toContain('"review"');
  });

  it("refuses a field-type view whose field type is not among the top-level fields", () => {
    // Held only inside a named group: the view could edit it, but the entry
    // would open on a field the form shows one level down.
    const fields = [title, { type: "group", name: "hero", fields: [sections] }];
    const error = refusal(() =>
      assertOpensIn(
        [collection("notes", "builder", fields)],
        [viewPlugin()],
        []
      )
    );
    expect(error.message).toContain('"notes"');
    expect(error.message).toContain('"builder"');
    expect(error.message).toContain('"blocks"');
  });

  it("refuses a field-type view on a collection with no field of its type", () => {
    const error = refusal(() =>
      assertOpensIn(
        [collection("tags", "builder", [title])],
        [viewPlugin()],
        []
      )
    );
    expect(error.message).toContain('"tags"');
  });

  it("judges against a disabled plugin's views too, so switching it off never stops a boot", () => {
    expect(() =>
      assertOpensIn(
        [collection("notes", "builder")],
        [viewPlugin({ enabled: false })],
        []
      )
    ).not.toThrow();
  });

  it("refuses a view once its plugin is removed", () => {
    const error = refusal(() =>
      assertOpensIn([collection("notes", "builder")], [], [])
    );
    expect(error.message).toContain('"builder"');
  });

  it("refuses a value that is not text", () => {
    const error = refusal(() =>
      assertOpensIn([collection("posts", 3)], [viewPlugin()], [])
    );
    expect(error.message).toContain('"posts"');
  });

  it("reads a group that lays itself out without recursing for ever", () => {
    // Raw config can hold a cycle; the refusal is still named.
    const loop: Record<string, unknown> = { type: "group", fields: [] };
    (loop.fields as unknown[]).push(loop);
    const error = refusal(() =>
      assertOpensIn(
        [collection("notes", "builder", [title, loop])],
        [viewPlugin()],
        []
      )
    );
    expect(error.message).toContain('"notes"');
  });

  it("reads a plugin's slug view on the slug it is routed under, after a rename", () => {
    const renamed = viewPlugin({ renameMap: { posts: "articles" } });
    expect(() =>
      assertOpensIn([collection("articles", "review")], [renamed], [])
    ).not.toThrow();
  });
});

describe("assertOpensIn on a Single", () => {
  /** A Homepage: a title and a page layout. */
  const homepage = (
    opensIn: unknown,
    fields: unknown[] = [title, sections]
  ) => ({
    slug: "homepage",
    fields,
    admin: { opensIn },
  });

  it("accepts the form, a field-type view it holds a field of, and nothing", () => {
    expect(() =>
      assertOpensIn(
        [],
        [viewPlugin()],
        [
          homepage("form"),
          homepage("builder"),
          { slug: "site", fields: [title] },
        ]
      )
    ).not.toThrow();
  });

  it("refuses a field-type view whose field type it does not hold, naming the Single", () => {
    const error = refusal(() =>
      assertOpensIn([], [viewPlugin()], [homepage("builder", [title])])
    );
    expect(error.message).toContain('The Single "homepage"');
    expect(error.message).toContain('"builder"');
  });

  it("refuses a view declared on a collection's slug, even one named like the Single", () => {
    // `views.posts` declares a collection's `review`; a Single called
    // "posts" has no view of it to open in.
    const error = refusal(() =>
      assertOpensIn(
        [],
        [viewPlugin()],
        [{ slug: "posts", fields: [title], admin: { opensIn: "review" } }]
      )
    );
    expect(error.message).toContain('The Single "posts"');
    expect(error.message).toContain('"review"');
  });

  it("refuses a view no plugin declares, and a value that is not text", () => {
    expect(
      refusal(() => assertOpensIn([], [viewPlugin()], [homepage("nope")]))
        .message
    ).toContain('"nope"');
    expect(
      refusal(() => assertOpensIn([], [viewPlugin()], [homepage(3)])).message
    ).toContain('The Single "homepage"');
  });

  it("names a collection and a Single together when both are refused", () => {
    const error = refusal(() =>
      assertOpensIn(
        [collection("posts", "nope")],
        [viewPlugin()],
        [homepage("nope")]
      )
    );
    expect(error.message).toContain('The collection "posts"');
    expect(error.message).toContain('The Single "homepage"');
  });
});
