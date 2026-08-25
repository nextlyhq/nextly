/**
 * A form whose author picked a PAGE as its destination, through the real
 * submission handler.
 *
 * The unit tests beside the resolver cover its decisions; this covers the
 * wiring, which is where the behaviour was missing. Every part existed — the
 * `redirectPage` relationship field, a `"relationship"` confirmation type the
 * admin offers as "Redirect to Page", a settings normaliser that preserved the
 * value — and a submission still returned no destination, because nothing
 * joined them up. Only a test that submits can see that.
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createPluginContext } from "nextly";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pagesCollection = defineCollection({
  slug: "pages",
  fields: [text({ name: "title" }), text({ name: "slug" })],
});

/** A form pointed at `pageId`, submitted; returns what the handler answered. */
async function submitPointingAt(
  redirectPage: unknown,
  options: Parameters<typeof formBuilder>[0]
) {
  const { plugin, config } = formBuilder(options);

  current = await createTestNextly({
    plugins: [plugin],
    collections: [pagesCollection],
  });

  const page = await current.nextly.create({
    collection: "pages",
    data: { title: "Thank you", slug: "thank-you" },
  });
  const pageId = (page as { item: { id: string } }).item.id;

  await current.nextly.create({
    collection: "forms",
    data: {
      name: "Contact",
      slug: "contact",
      status: "published",
      fields: [{ type: "text", name: "message", label: "Message" }],
      settings: {
        confirmationType: "relationship",
        redirectPage:
          typeof redirectPage === "function"
            ? (redirectPage as (id: string) => unknown)(pageId)
            : redirectPage,
      },
    },
  });

  // `db` is the raw-database escape hatch, resolved eagerly when the context
  // is built and not registered by the harness. The submission path never
  // touches it — it goes through the collections service — so a stub keeps the
  // rest of the context real rather than mocking the part under test.
  const getService = ((name: string) =>
    name === "db" ? {} : current?.getService(name as never)) as never;

  const pluginContext = createPluginContext(getService, current.hooks as never);

  return submitForm(
    { formSlug: "contact", data: { message: "hello" } },
    { pluginContext, pluginConfig: config }
  );
}

describe("a form that redirects to a picked page", () => {
  it("answers with the page's real URL", async () => {
    const result = await submitPointingAt(
      (id: string) => ({ relationTo: "pages", value: id }),
      { redirectRelationships: { pages: "/{slug}" } }
    );

    expect(result.success).toBe(true);
    // The destination, built from the page that was picked — not a protocol
    // for somebody else to resolve, and not nothing.
    expect(result.redirect).toBe("/thank-you");
  });

  it("uses the collection's own pattern", async () => {
    const result = await submitPointingAt(
      (id: string) => ({ relationTo: "pages", value: id }),
      { redirectRelationships: { pages: "/help/{slug}" } }
    );

    expect(result.redirect).toBe("/help/thank-you");
  });

  it("takes /{slug} for the array shorthand", async () => {
    const result = await submitPointingAt(
      (id: string) => ({ relationTo: "pages", value: id }),
      { redirectRelationships: ["pages"] }
    );

    expect(result.redirect).toBe("/thank-you");
  });

  it("still submits, with no destination, when the target was deleted", async () => {
    // The submission is the thing that must not fail: the visitor's data is
    // already saved by the time a destination is looked up.
    const result = await submitPointingAt(
      { relationTo: "pages", value: "pg_missing" },
      { redirectRelationships: { pages: "/{slug}" } }
    );

    expect(result.success).toBe(true);
    expect(result.submission).toBeDefined();
    expect(result.redirect).toBeUndefined();
  });

  it("still submits when a pattern function throws", async () => {
    // A pattern may be host code. Letting it throw would reach submitForm's
    // outer catch AFTER the submission row exists, telling the caller the
    // submission failed — and a caller that retries creates a duplicate of a
    // submission that was already saved.
    const result = await submitPointingAt(
      (id: string) => ({ relationTo: "pages", value: id }),
      {
        redirectRelationships: {
          pages: () => {
            throw new Error("pattern exploded");
          },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.submission).toBeDefined();
    expect(result.redirect).toBeUndefined();
  });

  it("refuses to save a target in a collection with no pattern", async () => {
    // Previously this saved and then produced no destination on every
    // submission. The write path now refuses it, because a reference into a
    // collection the plugin cannot build a URL for is not a destination.
    await expect(
      submitPointingAt((id: string) => ({ relationTo: "pages", value: id }), {
        redirectRelationships: { posts: "/blog/{slug}" },
      })
    ).rejects.toThrow();
  });
});

describe("saving a form that redirects to a page", () => {
  /** Create through the collection, which is what the browser posts to. */
  async function create(settings: Record<string, unknown>) {
    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [pagesCollection],
    });

    return current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings,
      },
    });
  }

  it("refuses one that names no page", async () => {
    // Through the write path the admin actually uses. `validateFormConfig` is
    // a library entry point that no save goes through, so a rule living only
    // there would let this save and fail at submit time instead.
    await expect(
      create({ confirmationType: "relationship" })
    ).rejects.toThrow();
  });

  it("refuses a reference that names nothing", async () => {
    // Truthy and unreadable: a presence check admits exactly the values that
    // resolve to no destination.
    await expect(
      create({ confirmationType: "relationship", redirectPage: {} })
    ).rejects.toThrow();
    await expect(
      create({
        confirmationType: "relationship",
        redirectPage: { relationTo: "pages" },
      })
    ).rejects.toThrow();
  });

  it("accepts one that names a page", async () => {
    const saved = await create({
      confirmationType: "relationship",
      redirectPage: { relationTo: "pages", value: "pg1" },
    });
    expect(saved).toMatchObject({ item: { id: expect.any(String) } });
  });

  it("leaves the other confirmations alone", async () => {
    // The rule is about one option; a message form has no page to name.
    const saved = await create({ confirmationType: "message" });
    expect(saved).toMatchObject({ item: { id: expect.any(String) } });
  });
});

describe("a host that overrides the forms collection's hooks", () => {
  it("keeps the plugin's validation and runs its own hook too", async () => {
    // `formOverrides.hooks` is a supported option, and a trailing spread would
    // replace this collection's hooks outright — removing the slug
    // generation, the at-least-one-field rule and the redirect check, none of
    // which are the host's to remove. An override extends the collection; it
    // does not disarm it.
    const hostRan: string[] = [];

    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
      formOverrides: {
        hooks: {
          beforeValidate: [
            (context: { data?: Record<string, unknown> }) => {
              hostRan.push("beforeValidate");
              return context.data;
            },
          ],
        },
      },
    } as Parameters<typeof formBuilder>[0]);

    current = await createTestNextly({
      plugins: [plugin],
      collections: [pagesCollection],
    });

    const save = (settings: Record<string, unknown>) =>
      current!.nextly.create({
        collection: "forms",
        data: {
          name: "Contact",
          slug: "contact",
          status: "published",
          fields: [{ type: "text", name: "message", label: "Message" }],
          settings,
        },
      });

    // The plugin's rule still refuses...
    await expect(save({ confirmationType: "relationship" })).rejects.toThrow();

    // ...and the host's hook is genuinely wired, not merely tolerated.
    await save({
      confirmationType: "relationship",
      redirectPage: { relationTo: "pages", value: "pg1" },
    });
    expect(hostRan).toContain("beforeValidate");
  });
});
