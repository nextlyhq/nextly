/**
 * `/api/forms/*` answers the same after the plugin took it over from core.
 *
 * The core dispatcher used to serve these three addresses and had its own
 * regression test pinning the canonical shapes. That test mocked the collections
 * handler and called the dispatcher directly, so it could prove the body and
 * nothing about the URL. These go through `createDynamicHandlers`, which is the
 * only way to prove the part that actually moved: the request still arrives, the
 * built-in router declines it, and the plugin's ROOT-mounted route answers.
 *
 * The shapes are the contract. A caller already posting to
 * `/api/forms/contact/submit` reads `{ message, submissionId }` out of a 201,
 * and preserving the URL while changing the body would break it just as surely
 * as moving the URL.
 */
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { NO_SUCH_FORM } from "nextly";
import { defineCollection, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The catch-all's params for a `/api/...` path, as Next.js supplies them. */
function params(...segments: string[]) {
  return { params: Promise.resolve({ params: segments }) };
}

async function bootWithForm(
  form: Record<string, unknown>,
  options?: { honeypot?: boolean }
) {
  const fb = formBuilder({
    spamProtection: {
      honeypot: options?.honeypot ?? false,
      recaptcha: { enabled: false },
    },
  });
  current = await createTestNextly({ plugins: [fb.plugin] });
  await current.nextly.create({ collection: "forms", data: form });
  return createDynamicHandlers();
}

const CONTACT = {
  name: "Contact",
  slug: "contact",
  status: "published",
  fields: [{ type: "text", name: "message", label: "Message", required: true }],
  // `honeypotEnabled` is set explicitly because supplying `settings` at all
  // materialises the whole group, and the stored `false` then wins over the
  // plugin-level default via the per-form override.
  settings: { successMessage: "Got it, thanks.", honeypotEnabled: true },
};

/**
 * The two halves of the move, asserted directly.
 *
 * Every shape test below passed against core's old dispatcher too, which is the
 * point: the contract did not change. It also means none of them can say WHICH
 * implementation answered, so on its own the suite would keep reporting green
 * if the endpoint had never moved at all.
 */
describe("who serves /api/forms", () => {
  it("is declared by this plugin, at the root mount", () => {
    const { plugin } = formBuilder();
    const routes = plugin.contributes?.routes ?? [];

    for (const expected of [
      { method: "GET", path: "/forms" },
      { method: "GET", path: "/forms/:slug" },
      { method: "POST", path: "/forms/:slug/submit" },
    ]) {
      expect(routes).toContainEqual(
        expect.objectContaining({ ...expected, mount: "root", public: true })
      );
    }
  });

  it("is not served by the core router when the plugin is absent", async () => {
    // Core registers no `forms` collection, so its endpoints only ever worked
    // with this plugin installed. Now the addresses go with it: without the
    // plugin the built-in router declines and no root route answers.
    current = await createTestNextly({ plugins: [] });
    const handlers = createDynamicHandlers();

    const res = await handlers.GET(
      new Request("http://localhost/api/forms"),
      params("forms")
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /api/forms", () => {
  it("answers the paginated envelope, from the plugin's route", async () => {
    const handlers = await bootWithForm(CONTACT);

    const res = await handlers.GET(
      new Request("http://localhost/api/forms"),
      params("forms")
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { slug: string }[];
      meta: Record<string, unknown>;
    };
    // `{ items, meta }`, not a bare array and not `{ docs, totalDocs }`: the
    // shape core answered in, which is what every existing caller parses.
    expect(body.items.map(f => f.slug)).toEqual(["contact"]);
    expect(body.meta).toMatchObject({
      total: 1,
      page: 1,
      hasPrev: false,
    });
  });

  it("lists published forms only", async () => {
    const handlers = await bootWithForm({ ...CONTACT, status: "draft" });

    const res = await handlers.GET(
      new Request("http://localhost/api/forms"),
      params("forms")
    );

    const body = (await res.json()) as { items: unknown[] };
    // The one enumerable surface. A draft appearing here would leak a form its
    // author has not published to anyone who asks for the list.
    expect(body.items).toEqual([]);
  });
});

describe("GET /api/forms/:slug", () => {
  it("answers the bare document", async () => {
    const handlers = await bootWithForm(CONTACT);

    const res = await handlers.GET(
      new Request("http://localhost/api/forms/contact"),
      params("forms", "contact")
    );

    expect(res.status).toBe(200);
    // Bare, not wrapped in `{ item }` or `{ data }`. A client renders fields
    // off the top level of this body.
    const body = (await res.json()) as { slug: string; fields: unknown[] };
    expect(body.slug).toBe("contact");
    expect(body.fields).toHaveLength(1);
  });

  it("answers 404 with the shared sentence for a slug nobody used", async () => {
    const handlers = await bootWithForm(CONTACT);

    const res = await handlers.GET(
      new Request("http://localhost/api/forms/nope"),
      params("forms", "nope")
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    // The same sentence the Direct API and the helper give. The canonical
    // "Not found." would make what a visitor is told depend on their client.
    expect(body.error.message).toBe(NO_SUCH_FORM);
  });

  it("explains a closed form rather than hiding it", async () => {
    // Published FIRST, then closed. `formAvailability` explains a form only
    // once it has been public, which `wentLiveAt` records: a form that closed
    // without ever publishing answers as an unused address, so creating one
    // directly in the closed state would be testing the 404 branch instead.
    const handlers = await bootWithForm(CONTACT);
    const existing = await current!.nextly.find({ collection: "forms" });
    await current!.nextly.update({
      collection: "forms",
      id: (existing.items[0] as { id: string }).id,
      data: { status: "closed", closedMessage: "Applications closed." },
    });

    const res = await handlers.GET(
      new Request("http://localhost/api/forms/contact"),
      params("forms", "contact")
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // The author's sentence and nothing else off the row: a closed form renders
    // a message, not fields, so returning the row was disclosure the feature
    // never needed.
    expect(body).toMatchObject({
      slug: "contact",
      status: "closed",
      closedMessage: "Applications closed.",
    });
    expect(body).not.toHaveProperty("fields");
  });
});

describe("POST /api/forms/:slug/submit", () => {
  async function submit(
    handlers: ReturnType<typeof createDynamicHandlers>,
    body: unknown
  ) {
    return handlers.POST(
      new Request("http://localhost/api/forms/contact/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      params("forms", "contact", "submit")
    );
  }

  it("answers 201 with the author's message and the new id", async () => {
    const handlers = await bootWithForm(CONTACT);

    const res = await submit(handlers, { data: { message: "hello" } });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      message: string;
      submissionId: string;
    };
    expect(body.message).toBe("Got it, thanks.");
    expect(body.submissionId).toEqual(expect.any(String));
  });

  it("answers 400 when the body carries no data object", async () => {
    const handlers = await bootWithForm(CONTACT);

    const res = await submit(handlers, { nope: true });

    expect(res.status).toBe(400);
  });

  it("answers 400 when a required field is missing", async () => {
    const handlers = await bootWithForm(CONTACT);

    const res = await submit(handlers, { data: {} });

    expect(res.status).toBe(400);
  });

  /**
   * The finding this move exists to close. Core validated BEFORE the spam
   * decision, so a bot that tripped the honeypot while omitting a required
   * field got a distinguishable 400 and left no evidence behind. It now
   * receives exactly what a successful submission receives.
   */
  it("gives a honeypot hit the same answer as a real submission, even when it fails validation", async () => {
    const handlers = await bootWithForm(CONTACT, { honeypot: true });

    const res = await submit(handlers, {
      data: { website: "http://spam.example" },
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Got it, thanks.");
  });
});

describe("POST /api/forms/:slug/submit?locale=", () => {
  /**
   * The wire half of the visitor's language. The handler test proves a named
   * locale reaches the target read; this proves the built-in route NAMES it,
   * from the same place core's own routes read a locale on the wire.
   */
  async function bootLocalizedRedirect() {
    const fb = formBuilder({
      spamProtection: { honeypot: false, recaptcha: { enabled: false } },
      redirectRelationships: { pages: "/{slug}" },
    });
    current = await createTestNextly({
      plugins: [fb.plugin],
      collections: [
        defineCollection({
          slug: "pages",
          localized: true,
          fields: [
            text({ name: "title" }),
            text({ name: "slug", localized: true }),
          ],
        }),
      ],
      localization: { locales: ["en", "fr"], defaultLocale: "en" },
    });
    const page = await current.nextly.create({
      collection: "pages",
      data: { title: "Thank you", slug: "thanks" },
    });
    const pageId = (page as { item: { id: string } }).item.id;
    await current.nextly.update({
      collection: "pages",
      id: pageId,
      data: { slug: "merci" },
      locale: "fr",
    });
    await current.nextly.create({
      collection: "forms",
      data: {
        ...CONTACT,
        settings: {
          ...CONTACT.settings,
          confirmationType: "relationship",
          redirectPage: { relationTo: "pages", value: pageId },
        },
      },
    });
    return createDynamicHandlers();
  }

  async function submitAt(
    handlers: ReturnType<typeof createDynamicHandlers>,
    query: string
  ) {
    const res = await handlers.POST(
      new Request(`http://localhost/api/forms/contact/submit${query}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { message: "bonjour" } }),
      }),
      params("forms", "contact", "submit")
    );
    expect(res.status).toBe(201);
    return (await res.json()) as { redirect?: string };
  }

  it("sends a French submission to the French URL", async () => {
    const handlers = await bootLocalizedRedirect();
    expect((await submitAt(handlers, "?locale=fr")).redirect).toBe("/merci");
  });

  it("sends one that names no language to the default URL", async () => {
    const handlers = await bootLocalizedRedirect();
    expect((await submitAt(handlers, "")).redirect).toBe("/thanks");
  });
});
