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

/**
 * Asserts the write was refused BY THE REDIRECT RULE.
 *
 * A bare `rejects.toThrow()` passes on any failure — an unregistered
 * collection, a schema error, a boot problem — so it cannot tell "the rule
 * refused this" from "the fixture was wrong". Matching the message does not
 * help either: `NextlyError.validation` carries the generic
 * `"Validation failed."` and puts the detail in `publicData.errors`, so every
 * validation rule in the collection produces the same string.
 *
 * The field path is the thing that identifies WHICH rule fired.
 */
async function expectRedirectRefusal(
  write: Promise<unknown>,
  field = "settings.redirectPage"
) {
  let refusal: unknown;
  try {
    await write;
  } catch (error) {
    refusal = error;
  }

  expect(refusal, "expected the write to be refused").toBeDefined();
  const errors =
    (refusal as { publicData?: { errors?: { path?: string }[] } })?.publicData
      ?.errors ?? [];
  expect(errors.map(entry => entry.path)).toContain(field);
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pagesCollection = defineCollection({
  slug: "pages",
  fields: [text({ name: "title" }), text({ name: "slug" })],
});

/**
 * Stands in for the page id a caller cannot know yet.
 *
 * The harness — and therefore the page — is created INSIDE the helpers below,
 * so a test naming its target has nothing real to name at the point it writes
 * the settings. It names this instead and the helper substitutes.
 */
const SEEDED_PAGE = "__seeded_page__";

/** Settings with the sentinel replaced by the page that now exists. */
function withSeededPage(
  settings: Record<string, unknown>,
  pageId: string
): Record<string, unknown> {
  const target = settings.redirectPage as
    | { relationTo?: string; value?: unknown }
    | undefined;
  if (!target || target.value !== SEEDED_PAGE) return settings;
  return { ...settings, redirectPage: { ...target, value: pageId } };
}

/** A real page in the harness, so a reference points at something. */
async function seedPage(harness: TestNextly, slug = "thank-you") {
  const page = await harness.nextly.create({
    collection: "pages",
    data: { title: "Thank you", slug },
  });
  return (page as { item: { id: string } }).item.id;
}

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
    // Reached the way it happens in practice: the form is saved against a real
    // page and the page is deleted afterwards. A fabricated id cannot get here
    // any more — the save reads the target and refuses one that is not there —
    // and that difference is the point. The submission is what must not fail:
    // the visitor's data is already saved by the time a destination is looked
    // up.
    const { plugin, config } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [pagesCollection],
    });

    const pageId = await seedPage(current);
    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings: {
          confirmationType: "relationship",
          redirectPage: { relationTo: "pages", value: pageId },
        },
      },
    });

    await current.nextly.delete({ collection: "pages", id: pageId });

    const pluginContext = createPluginContext(
      ((name: string) =>
        name === "db" ? {} : current?.getService(name as never)) as never,
      current.hooks as never
    );

    const result = await submitForm(
      { formSlug: "contact", data: { message: "hello" } },
      { pluginContext, pluginConfig: config }
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
    await expectRedirectRefusal(
      submitPointingAt((id: string) => ({ relationTo: "pages", value: id }), {
        redirectRelationships: { posts: "/blog/{slug}" },
      })
    );
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

    const pageId = await seedPage(current);
    return current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings: withSeededPage(settings, pageId),
      },
    });
  }

  it("refuses one that names no page", async () => {
    // Through the write path the admin actually uses. `validateFormConfig` is
    // a library entry point that no save goes through, so a rule living only
    // there would let this save and fail at submit time instead.
    await expectRedirectRefusal(create({ confirmationType: "relationship" }));
  });

  it("refuses a reference that names nothing", async () => {
    // Truthy and unreadable: a presence check admits exactly the values that
    // resolve to no destination.
    await expectRedirectRefusal(
      create({ confirmationType: "relationship", redirectPage: {} })
    );
    await expectRedirectRefusal(
      create({
        confirmationType: "relationship",
        redirectPage: { relationTo: "pages" },
      })
    );
  });

  it("refuses a page that has been deleted", async () => {
    // `findByID` throws NOT_FOUND rather than returning null, so this refusal
    // is only reachable if a not-found error is told apart from an unreadable
    // one. Catching everything loses it, and the form saves pointing at a
    // page that is gone.
    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [pagesCollection],
    });

    const pageId = await seedPage(current);
    await current.nextly.delete({ collection: "pages", id: pageId });

    await expectRedirectRefusal(
      current.nextly.create({
        collection: "forms",
        data: {
          name: "Contact",
          slug: "contact",
          status: "published",
          fields: [{ type: "text", name: "message", label: "Message" }],
          settings: {
            confirmationType: "relationship",
            redirectPage: { relationTo: "pages", value: pageId },
          },
        },
      })
    );
  });

  it("refuses a page that cannot fill the URL pattern", async () => {
    // Shape and membership are not enough: `/{slug}` over a page whose slug is
    // blank produces no URL, so the form would save cleanly and redirect
    // nobody. Caught while the author still has the page in front of them.
    // The pattern names a field these pages do not carry, which is the same
    // condition as a blank slug and does not depend on how the store treats an
    // empty string.
    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{section}/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [pagesCollection],
    });

    const blankId = await seedPage(current);

    await expectRedirectRefusal(
      current.nextly.create({
        collection: "forms",
        data: {
          name: "Contact",
          slug: "contact",
          status: "published",
          fields: [{ type: "text", name: "message", label: "Message" }],
          settings: {
            confirmationType: "relationship",
            redirectPage: { relationTo: "pages", value: blankId },
          },
        },
      })
    );
  });

  it("stores the collection name trimmed, not merely accepts it", async () => {
    // Trimming only the parsed copy leaves the padded name in the row, so the
    // plugin accepts the write while the framework's own relationship
    // validator still sees a name that matches no collection.
    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [pagesCollection],
    });
    const pageId = await seedPage(current);

    const saved = (await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings: {
          confirmationType: "relationship",
          redirectPage: { relationTo: "  pages  ", value: pageId },
        },
      },
    })) as { item: { id: string } };

    const row = (await current.nextly.findByID({
      collection: "forms",
      id: saved.item.id,
    })) as { settings?: { redirectPage?: { relationTo?: string } } };

    expect(row.settings?.redirectPage?.relationTo).toBe("pages");
  });

  it("accepts one that names a page", async () => {
    const saved = await create({
      confirmationType: "relationship",
      redirectPage: { relationTo: "pages", value: SEEDED_PAGE },
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
    await expectRedirectRefusal(save({ confirmationType: "relationship" }));

    // ...and the host's hook is genuinely wired, not merely tolerated.
    const pageId = await seedPage(current);
    await save({
      confirmationType: "relationship",
      redirectPage: { relationTo: "pages", value: pageId },
    });
    expect(hostRan).toContain("beforeValidate");
  });
});

describe("a host hook that rewrites the payload after validation", () => {
  let seededPageId = "";

  /** A host `beforeValidate` that turns a valid form into an invalid one. */
  async function saveThrough(
    hostHook: (data: Record<string, unknown>, pageId: string) => void
  ) {
    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
      formOverrides: {
        hooks: {
          beforeValidate: [
            (context: { data?: Record<string, unknown> }) => {
              if (context.data) hostHook(context.data, seededPageId);
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

    // Seeded BEFORE the write, so the host hook has a real page to name when
    // it rewrites the payload mid-flight.
    seededPageId = await seedPage(current);
    return current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings: { confirmationType: "message" },
      },
    });
  }

  it("still refuses a target the host cleared after the first check", async () => {
    // The plugin's `beforeValidate` runs FIRST so a rejection precedes host
    // mutation — which means a host that mutates AFTERWARDS was judged on a
    // payload it then replaced. The trailing `beforeChange` call is what makes
    // this an invariant rather than a check.
    await expectRedirectRefusal(
      saveThrough(data => {
        data.settings = { confirmationType: "relationship" };
      })
    );
  });

  it("still refuses a reference the host rewrote into an unusable one", async () => {
    await expectRedirectRefusal(
      saveThrough(data => {
        data.settings = {
          confirmationType: "relationship",
          redirectPage: { relationTo: "unconfigured", value: "x1" },
        };
      })
    );
  });

  it("accepts what the host rewrites into something usable", async () => {
    // The guarantee must not become "reject anything a host touched".
    const saved = await saveThrough((data, pageId) => {
      data.settings = {
        confirmationType: "relationship",
        redirectPage: { relationTo: "pages", value: pageId },
      };
    });
    expect(saved).toMatchObject({ item: { id: expect.any(String) } });
  });
});

describe("updating a form that already redirects to a page", () => {
  /** A saved, valid form; returns its id and the harness it lives in. */
  async function savedForm() {
    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [pagesCollection],
    });

    const pageId = await seedPage(current);
    const created = await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings: {
          confirmationType: "relationship",
          redirectPage: { relationTo: "pages", value: pageId },
        },
      },
    });
    return (created as { item: { id: string } }).item.id;
  }

  it("does not reject an update that leaves the settings alone", async () => {
    // The partial-update trap the fields rule beside it already documents: an
    // update carries the patch, so treating an absent `settings` as empty
    // would refuse a rename for a setting it never touched.
    const id = await savedForm();
    const renamed = await current!.nextly.update({
      collection: "forms",
      id,
      data: { name: "Renamed" },
    });
    expect(renamed).toMatchObject({ item: { id } });
  });

  it("rejects an update that clears the page", async () => {
    // The other half: an update that DOES set settings is judged on what it
    // sets, so removing the target is refused rather than silently leaving a
    // form that submits to nowhere.
    const id = await savedForm();
    await expectRedirectRefusal(
      current!.nextly.update({
        collection: "forms",
        id,
        data: { settings: { confirmationType: "relationship" } },
      })
    );
  });
});

describe("a target collection with the publish lifecycle", () => {
  /**
   * The picker offers drafts deliberately (`status=all`), and the save rule is
   * conditional rather than absolute: refused only when a PUBLISHED form
   * points at an unpublished page, which is the one pairing that sends a
   * visitor to a "page not found". A draft form pointing at a draft page is
   * allowed, because the two go live together.
   */
  const draftingPages = defineCollection({
    slug: "pages",
    status: true,
    versions: { drafts: true },
    fields: [text({ name: "title" }), text({ name: "slug" })],
  } as never);

  async function bootWithDraftingPages() {
    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [draftingPages],
    });
    return current;
  }

  async function page(status: "draft" | "published", slug: string) {
    const made = await current!.nextly.create({
      collection: "pages",
      data: { title: slug, slug, status },
    });
    const row = made as { item: { id: string; status?: string } };
    // The fixture is only meaningful if it really carries the status it names.
    // A collection whose lifecycle was not actually enabled would answer
    // `undefined` here and every assertion below would pass for the wrong
    // reason.
    expect(row.item.status).toBe(status);
    return row.item.id;
  }

  const formData = (
    status: string,
    pageId: string
  ): Record<string, unknown> => ({
    name: "Contact",
    slug: "contact",
    status,
    fields: [{ type: "text", name: "message", label: "Message" }],
    settings: {
      confirmationType: "relationship",
      redirectPage: { relationTo: "pages", value: pageId },
    },
  });

  it("accepts a draft page when the form is itself a draft", async () => {
    // Also pins that a by-id read REACHES drafts at all. If it ever became
    // published-only this would refuse a page the picker had just offered,
    // telling the author it "no longer exists" while it is on screen.
    await bootWithDraftingPages();
    const target = await page("draft", "draft-page");

    const saved = await current!.nextly.create({
      collection: "forms",
      data: formData("draft", target),
    });
    expect(saved).toMatchObject({ item: { id: expect.any(String) } });
  });

  it("refuses a published form pointing at a draft page", async () => {
    // The pairing the rule exists for: this form accepts submissions, so a
    // visitor really would be redirected to a page the public route 404s.
    await bootWithDraftingPages();
    const target = await page("draft", "draft-page");

    await expectRedirectRefusal(
      current!.nextly.create({
        collection: "forms",
        data: formData("published", target),
      })
    );
  });

  it("accepts a published form pointing at a published page", async () => {
    // The control. Without it the refusal above passes just as well against a
    // rule that refuses every published form, and nothing would say so.
    await bootWithDraftingPages();
    const target = await page("published", "live-page");

    const saved = await current!.nextly.create({
      collection: "forms",
      data: formData("published", target),
    });
    expect(saved).toMatchObject({ item: { id: expect.any(String) } });
  });

  it("refuses publishing a form over a draft target it never touches", async () => {
    // Publishing is a separate save that carries `status` and nothing else.
    // Judging only the write that PICKS a page would guard one path and leave
    // this one open, while looking like it covered both.
    await bootWithDraftingPages();
    const target = await page("draft", "draft-page");
    const created = (await current!.nextly.create({
      collection: "forms",
      data: formData("draft", target),
    })) as { item: { id: string } };

    await expectRedirectRefusal(
      current!.nextly.update({
        collection: "forms",
        id: created.item.id,
        data: { status: "published" },
      })
    );
  });

  it("refuses repointing a published form at a draft page", async () => {
    // This write carries `settings` and NOT `status`, so the form's published
    // state can only come from the stored row. Reading an absent `status` as
    // "not published" would wave this through — the same broken redirect,
    // reached by editing rather than by publishing.
    await bootWithDraftingPages();
    const live = await page("published", "live-page");
    const created = (await current!.nextly.create({
      collection: "forms",
      data: formData("published", live),
    })) as { item: { id: string } };

    const draftTarget = await page("draft", "draft-page");
    await expectRedirectRefusal(
      current!.nextly.update({
        collection: "forms",
        id: created.item.id,
        data: {
          settings: {
            confirmationType: "relationship",
            redirectPage: { relationTo: "pages", value: draftTarget },
          },
        },
      })
    );
  });

  it("lets an unrelated edit through on a published form with a draft target", async () => {
    // A published form can acquire a draft target without being touched: the
    // page is unpublished later. Refusing every rename after that holds the
    // form hostage to a state the write neither created nor mentions — and the
    // submission path already declines to send anyone there.
    await bootWithDraftingPages();
    const live = await page("published", "live-page");
    const created = (await current!.nextly.create({
      collection: "forms",
      data: formData("published", live),
    })) as { item: { id: string } };

    await current!.nextly.update({
      collection: "pages",
      id: live,
      data: { status: "draft" },
    });

    const renamed = await current!.nextly.update({
      collection: "forms",
      id: created.item.id,
      data: { name: "Renamed" },
    });
    expect(renamed).toMatchObject({ item: { id: created.item.id } });
  });

  it("lets a published form turn its page redirect OFF while the target is a draft", async () => {
    // The edit an author in that state actually needs to make. Inheriting the
    // old target here refuses the only write that removes the bad redirect.
    await bootWithDraftingPages();
    const live = await page("published", "live-page");
    const created = (await current!.nextly.create({
      collection: "forms",
      data: formData("published", live),
    })) as { item: { id: string } };

    await current!.nextly.update({
      collection: "pages",
      id: live,
      data: { status: "draft" },
    });

    const switched = await current!.nextly.update({
      collection: "forms",
      id: created.item.id,
      data: { settings: { confirmationType: "message" } },
    });
    expect(switched).toMatchObject({ item: { id: created.item.id } });
  });

  it("sends nobody to a page that was unpublished after the form was saved", async () => {
    // Nothing runs a forms hook when the TARGET changes, so the save-time rule
    // never sees this. Without a submit-time check the visitor is redirected to
    // a page the public route 404s — the outcome that rule exists to prevent,
    // reached by a path it cannot watch. The submission itself still succeeds:
    // the destination is what degrades.
    //
    // The collection here is not localized, which the plugin resolves at init,
    // so the main row's status does answer for the document. On a localized
    // one this would read `"unknown"` and the redirect would stand.
    const { plugin, config } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [draftingPages],
    });

    const target = await page("published", "live-page");
    await current.nextly.create({
      collection: "forms",
      data: formData("published", target),
    });

    const getService = ((name: string) =>
      name === "db" ? {} : current?.getService(name as never)) as never;
    const pluginContext = createPluginContext(
      getService,
      current.hooks as never
    );

    // The control: while the page is published the redirect resolves, so a
    // missing redirect below is the unpublishing and not a broken fixture.
    const before = await submitForm(
      { formSlug: "contact", data: { message: "hello" } },
      { pluginContext, pluginConfig: config }
    );
    expect(before.redirect).toBe("/live-page");

    await current.nextly.update({
      collection: "pages",
      id: target,
      data: { status: "draft" },
    });

    const after = await submitForm(
      { formSlug: "contact", data: { message: "hello" } },
      { pluginContext, pluginConfig: config }
    );
    expect(after.success).toBe(true);
    expect(after.submission).toBeDefined();
    expect(after.redirect).toBeUndefined();
  });

  it("lets one save both publish the form and turn its page redirect off", async () => {
    // The sharpest form of the same case, and the one that needs the stored
    // target skipped rather than merely unjudged: this write DOES publish, so
    // the inherited-target check applies — and the target it would inherit is
    // one this very write is removing. Refusing it leaves the author unable to
    // publish and unable to fix the redirect in the same breath.
    //
    // Separated from the rename above deliberately: that one passes whether or
    // not the stored target is skipped, because a rename is not judged at all.
    await bootWithDraftingPages();
    const live = await page("published", "live-page");
    const created = (await current!.nextly.create({
      collection: "forms",
      data: formData("draft", live),
    })) as { item: { id: string } };

    await current!.nextly.update({
      collection: "pages",
      id: live,
      data: { status: "draft" },
    });

    const saved = await current!.nextly.update({
      collection: "forms",
      id: created.item.id,
      data: {
        status: "published",
        settings: { confirmationType: "message" },
      },
    });
    expect(saved).toMatchObject({ item: { id: created.item.id } });
  });

  it("still refuses when that same save keeps the page redirect", async () => {
    // The control for the test above: identical write except that `settings`
    // still names the draft page. Without this, skipping the stored target
    // could be skipping the check entirely and nothing would say so.
    //
    // The page here has NEVER been published, which is the case the rule can
    // decide without knowing whether the collection is localized.
    await bootWithDraftingPages();
    const target = await page("draft", "draft-page");
    const created = (await current!.nextly.create({
      collection: "forms",
      data: formData("draft", target),
    })) as { item: { id: string } };

    await expectRedirectRefusal(
      current!.nextly.update({
        collection: "forms",
        id: created.item.id,
        data: { status: "published", ...formData("published", target) },
      })
    );
  });

  it("guards the relation the URL option falls back to", async () => {
    // `confirmationType: "redirect"` with no URL resolves `redirectRelation`
    // exactly like the picker's own field, and the save rule used to match
    // only "relationship" — so this pairing was resolved at submit time and
    // inspected by nothing. The author heard about it only by the redirect
    // silently not happening.
    await bootWithDraftingPages();
    const target = await page("draft", "draft-page");

    await expectRedirectRefusal(
      current!.nextly.create({
        collection: "forms",
        data: {
          name: "Contact",
          slug: "contact",
          status: "published",
          fields: [{ type: "text", name: "message", label: "Message" }],
          settings: {
            confirmationType: "redirect",
            redirectRelation: { relationTo: "pages", value: target },
          },
        },
      }),
      // The refusal names the field the author filled in, not the one the
      // picker would have written.
      "settings.redirectRelation"
    );
  });

  it("accepts that same relation when its page is published", async () => {
    // The control: without it the refusal above passes just as well against a
    // rule that refuses every `redirect`-with-relation form.
    await bootWithDraftingPages();
    const target = await page("published", "live-page");

    const saved = await current!.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings: {
          confirmationType: "redirect",
          redirectRelation: { relationTo: "pages", value: target },
        },
      },
    });
    expect(saved).toMatchObject({ item: { id: expect.any(String) } });
  });

  it("leaves a typed URL alone even with a relation stored beside it", async () => {
    // The URL wins, so nothing here names a document and the draft page is
    // not this write's business.
    await bootWithDraftingPages();
    const target = await page("draft", "draft-page");

    const saved = await current!.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings: {
          confirmationType: "redirect",
          redirectUrl: "https://example.test/thanks",
          redirectRelation: { relationTo: "pages", value: target },
        },
      },
    });
    expect(saved).toMatchObject({ item: { id: expect.any(String) } });
  });

  it("refuses publishing a form whose stored target was deleted", async () => {
    // Stricter than the unpublished case refused above: every submission
    // resolves a deleted target to no redirect at all. Publishing is the
    // moment that pairing starts reaching visitors, so it is the write that
    // answers for it even though it names no page.
    await bootWithDraftingPages();
    const target = await page("draft", "draft-page");
    const created = (await current!.nextly.create({
      collection: "forms",
      data: formData("draft", target),
    })) as { item: { id: string } };

    await current!.nextly.delete({ collection: "pages", id: target });

    await expectRedirectRefusal(
      current!.nextly.update({
        collection: "forms",
        id: created.item.id,
        data: { status: "published" },
      })
    );
  });

  it("lets a rename through after the stored target is deleted", async () => {
    // A write that does not name a page does not answer for that page still
    // existing. Refusing here would make a deleted target block every future
    // edit to the form, with a message about a setting the author never
    // touched.
    await bootWithDraftingPages();
    const target = await page("draft", "draft-page");
    const created = (await current!.nextly.create({
      collection: "forms",
      data: formData("draft", target),
    })) as { item: { id: string } };

    await current!.nextly.delete({ collection: "pages", id: target });

    const renamed = await current!.nextly.update({
      collection: "forms",
      id: created.item.id,
      data: { name: "Renamed" },
    });
    expect(renamed).toMatchObject({ item: { id: created.item.id } });
  });

  it("lets an unrelated edit through while the target is still a draft", async () => {
    // The other half of the partial-update trap: a rename inherits the stored
    // target and does not answer for it. Refusing here would block editing a
    // form's name because of a setting the write never mentioned.
    await bootWithDraftingPages();
    const target = await page("draft", "draft-page");
    const created = (await current!.nextly.create({
      collection: "forms",
      data: formData("draft", target),
    })) as { item: { id: string } };

    const renamed = await current!.nextly.update({
      collection: "forms",
      id: created.item.id,
      data: { name: "Renamed" },
    });
    expect(renamed).toMatchObject({ item: { id: created.item.id } });
  });
});

describe("a target collection that publishes per locale", () => {
  it("accepts a published form pointing at a translation-only publication", async () => {
    // The main row stays `draft` when only a non-default locale goes public,
    // and no read available here can see the companion's status. Judging the
    // row would refuse a form pointing at a page visitors can reach in
    // Spanish, so the plugin resolves the collection's `localized` setting at
    // init and declines to decide instead.
    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [
        defineCollection({
          slug: "pages",
          status: true,
          localized: true,
          fields: [
            text({ name: "title", localized: true }),
            text({ name: "slug" }),
          ],
        } as never),
      ],
      localization: { locales: ["en", "es"], defaultLocale: "en" },
    } as never);

    const made = (await current.nextly.create({
      collection: "pages",
      data: { title: "wip", slug: "gracias", status: "draft" },
      locale: "en",
    } as never)) as { item: { id: string } };
    await current.nextly.update({
      collection: "pages",
      id: made.item.id,
      data: { title: "hola", status: "published" },
      locale: "es",
    } as never);

    // The fixture only means anything if the main row really does read draft.
    const row = (await current.nextly.findByID({
      collection: "pages",
      id: made.item.id,
    })) as { status?: string };
    expect(row.status).toBe("draft");

    const saved = await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings: {
          confirmationType: "relationship",
          redirectPage: { relationTo: "pages", value: made.item.id },
        },
      },
    });
    expect(saved).toMatchObject({ item: { id: expect.any(String) } });
  });
});

describe("a target collection with NO publish lifecycle", () => {
  it("never refuses a published form, because nothing there can be a draft", async () => {
    // A collection without the lifecycle carries no `status` field at all.
    // Read for truthiness that is the same absence as a draft and means the
    // opposite: every one of its documents is reachable. Getting this backwards
    // would refuse every redirect on every site that never turned drafts on.
    const { plugin } = formBuilder({
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [plugin],
      collections: [pagesCollection],
    });

    const made = (await current.nextly.create({
      collection: "pages",
      data: { title: "Thanks", slug: "thanks" },
    })) as { item: { id: string; status?: string } };
    // The fixture only proves anything if this collection really has no status.
    expect(made.item.status).toBeUndefined();

    const saved = await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        settings: {
          confirmationType: "relationship",
          redirectPage: { relationTo: "pages", value: made.item.id },
        },
      },
    });
    expect(saved).toMatchObject({ item: { id: expect.any(String) } });
  });
});
