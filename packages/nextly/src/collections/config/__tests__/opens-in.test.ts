/**
 * The boot's judgement of a collection's `admin.opensIn`: "form", or the path
 * of a document view the collection has. A path no view answers, or a view
 * offered on a field type the collection does not hold at its top level, stops
 * the boot naming the collection and the view.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { assertCollectionOpensIn } from "../opens-in";

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

describe("assertCollectionOpensIn", () => {
  it("accepts the form, and a collection that declares nothing", () => {
    expect(() =>
      assertCollectionOpensIn(
        [collection("posts", "form"), { slug: "tags", fields: [title] }],
        []
      )
    ).not.toThrow();
  });

  it("accepts a view declared on the collection itself", () => {
    expect(() =>
      assertCollectionOpensIn([collection("posts", "review")], [viewPlugin()])
    ).not.toThrow();
  });

  it("accepts a field-type view whose field type the collection holds at its top level", () => {
    expect(() =>
      assertCollectionOpensIn([collection("notes", "builder")], [viewPlugin()])
    ).not.toThrow();
  });

  it("reads into an unnamed group, as the form lays it out", () => {
    const fields = [title, { type: "group", fields: [sections] }];
    expect(() =>
      assertCollectionOpensIn(
        [collection("notes", "builder", fields)],
        [viewPlugin()]
      )
    ).not.toThrow();
  });

  it("refuses a view the collection does not have, naming the collection and the view", () => {
    const error = refusal(() =>
      assertCollectionOpensIn([collection("posts", "nope")], [viewPlugin()])
    );
    expect(error.logMessage ?? error.message).toContain('"posts"');
    expect(error.logMessage ?? error.message).toContain('"nope"');
  });

  it("refuses a slug view declared on another collection", () => {
    const error = refusal(() =>
      assertCollectionOpensIn([collection("notes", "review")], [viewPlugin()])
    );
    expect(error.message).toContain('"notes"');
    expect(error.message).toContain('"review"');
  });

  it("refuses a field-type view whose field type is not among the top-level fields", () => {
    // Held only inside a named group: the view could edit it, but the entry
    // would open on a field the form shows one level down.
    const fields = [title, { type: "group", name: "hero", fields: [sections] }];
    const error = refusal(() =>
      assertCollectionOpensIn(
        [collection("notes", "builder", fields)],
        [viewPlugin()]
      )
    );
    expect(error.message).toContain('"notes"');
    expect(error.message).toContain('"builder"');
    expect(error.message).toContain('"blocks"');
  });

  it("refuses a field-type view on a collection with no field of its type", () => {
    const error = refusal(() =>
      assertCollectionOpensIn(
        [collection("tags", "builder", [title])],
        [viewPlugin()]
      )
    );
    expect(error.message).toContain('"tags"');
  });

  it("judges against a disabled plugin's views too, so switching it off never stops a boot", () => {
    expect(() =>
      assertCollectionOpensIn(
        [collection("notes", "builder")],
        [viewPlugin({ enabled: false })]
      )
    ).not.toThrow();
  });

  it("refuses a view once its plugin is removed", () => {
    const error = refusal(() =>
      assertCollectionOpensIn([collection("notes", "builder")], [])
    );
    expect(error.message).toContain('"builder"');
  });

  it("refuses a value that is not text", () => {
    const error = refusal(() =>
      assertCollectionOpensIn([collection("posts", 3)], [viewPlugin()])
    );
    expect(error.message).toContain('"posts"');
  });

  it("reads a plugin's slug view on the slug it is routed under, after a rename", () => {
    const renamed = viewPlugin({ renameMap: { posts: "articles" } });
    expect(() =>
      assertCollectionOpensIn([collection("articles", "review")], [renamed])
    ).not.toThrow();
  });
});
