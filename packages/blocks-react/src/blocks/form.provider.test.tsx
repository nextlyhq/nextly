// @vitest-environment jsdom
/**
 * A form picked from a provider, drawn on the published path: the page
 * renderer with a route's `ctx.forms`, and no script but the provider's.
 *
 * The provider here is a fake that answers as the contract says a provider
 * answers; the block knows only the description it gives.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createStandaloneContext,
  type FormDrawing,
  type FormReference,
  type FormUnavailableDrawing,
  type PageForms,
} from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { FORM_REFUSALS, FORM_SENT_MESSAGE, type FormProps } from "./form";
import { coreBlocks } from "./index";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

const blocks = createBlockResolver(coreBlocks as AnyBlockDefinition[]);

/** A provider's contact form, as the contract describes one. */
const CONTACT: FormDrawing = {
  ref: "contact",
  title: "Contact",
  fields: [
    {
      name: "email",
      label: "Email",
      kind: "email",
      required: true,
      help: "We reply within a day.",
      placeholder: "you@example.com",
    },
    {
      name: "service",
      label: "Service",
      kind: "select",
      options: [
        { value: "design", label: "Design" },
        { value: "build", label: "Build" },
      ],
    },
    {
      name: "when",
      label: "When",
      kind: "time",
      // The provider's own script reads these; the block never does.
      provider: { "shown-if": "service=build", "nx-owned": "refused" },
    },
    { name: "brief", label: "Brief", kind: "file", accept: ".pdf" },
  ],
  submitText: "Request a quote",
  afterSending: { kind: "message", message: "Thanks, we'll be in touch." },
  encoding: "multipart",
};

/** A route's forms, with a fake provider answering `answer` for every form. */
function formsAnswering(
  answer: (form: FormReference) => Promise<FormDrawing | FormUnavailableDrawing>
): PageForms & { asked: FormReference[] } {
  const asked: FormReference[] = [];
  return {
    asked,
    action: "/admin/api/plugins/@nextlyhq/plugin-page-builder/forms/send",
    document: "page:p1",
    returnTo: "/quote",
    describe: form => {
      asked.push(form);
      return answer(form);
    },
  };
}

/** A published page holding forms with these props, drawn with `forms`. */
async function page(
  forms: PageForms | undefined,
  ...props: FormProps[]
): Promise<string> {
  return renderToHtml(
    <PageRenderer
      document={{
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: props.map((each, index) => ({
          id: `form${index}`,
          type: "core/form",
          version: 2,
          props: each as Record<string, unknown>,
        })),
      }}
      blocks={blocks}
      context={createStandaloneContext(forms === undefined ? {} : { forms })}
    />
  );
}

const PICKED: FormProps = { form: { provider: "acme-forms", ref: "contact" } };

describe("a provider's form on a published page", () => {
  it("is drawn on the server from the provider's description", async () => {
    const forms = formsAnswering(() => Promise.resolve(CONTACT));
    const out = await page(forms, PICKED);

    expect(forms.asked).toEqual([{ provider: "acme-forms", ref: "contact" }]);
    expect(out).toMatch(/<input[^>]*type="email"[^>]*>/);
    expect(out).toContain('placeholder="you@example.com"');
    expect(out).toContain('<option value="build">Build</option>');
    expect(out).toMatch(/<input[^>]*type="time"/);
    expect(out).toMatch(/<input[^>]*type="file"[^>]*accept=".pdf"/);
    expect(out).toContain(">Request a quote</button>");
    // A file travels only in a multipart post.
    // Attribute names are read without case; React writes this one `encType`.
    expect(out).toMatch(/enctype="multipart\/form-data"/i);
  });

  it("is drawn with the same parts as the simple form, so Style reaches both", async () => {
    const forms = formsAnswering(() => Promise.resolve(CONTACT));
    const provided = await page(forms, PICKED);
    const simple = await page(forms, {
      fields: [{ label: "Email", type: "email", required: true }],
    });
    const partsOf = (out: string): Set<string> =>
      new Set(out.match(/nx-bp-core--form--[a-z]+/g) ?? []);
    // Must-be-found: the simple form draws parts at all.
    expect(partsOf(simple).size).toBeGreaterThan(3);
    for (const part of partsOf(simple)) {
      expect(partsOf(provided), part).toContain(part);
    }
  });

  it("names each field's help and error slot from its control", async () => {
    const out = await page(
      formsAnswering(() => Promise.resolve(CONTACT)),
      PICKED
    );
    const email = out.match(/<input[^>]*name="email"[^>]*>/)?.[0] ?? "";
    const ids = /aria-describedby="([^"]+)"/.exec(email)?.[1]?.split(" ") ?? [];
    expect(ids).toHaveLength(2);
    const [help, error] = ids;
    expect(out).toMatch(
      new RegExp(`<p id="${help}"[^>]*>We reply within a day.</p>`)
    );
    // The slot a provider's own script writes the reason into: empty and
    // hidden until it does.
    expect(out).toMatch(
      new RegExp(
        `<p id="${error}"[^>]*data-nx-form-error=""[^>]*hidden=""></p>`
      )
    );
  });

  it("carries the provider's opaque values for its own script, never the page builder's names", async () => {
    const out = await page(
      formsAnswering(() => Promise.resolve(CONTACT)),
      PICKED
    );
    const when = out.match(/<input[^>]*name="when"[^>]*>/)?.[0] ?? "";
    expect(when).toContain('data-shown-if="service=build"');
    expect(when).not.toContain("data-nx-owned");
  });

  it("says beside a file field that sending a file needs JavaScript", async () => {
    const out = await page(
      formsAnswering(() => Promise.resolve(CONTACT)),
      PICKED
    );
    const file = out.match(/<input[^>]*name="brief"[^>]*>/)?.[0] ?? "";
    const ids = /aria-describedby="([^"]+)"/.exec(file)?.[1]?.split(" ") ?? [];
    // Its own note, read with the control, and the error slot after it.
    expect(ids).toHaveLength(2);
    expect(out).toMatch(
      new RegExp(
        `<p id="${ids[0]}"[^>]*>This form needs JavaScript to send a file\\.</p>`
      )
    );
    // Only beside a file field.
    expect(out.match(/needs JavaScript to send a file/g)).toHaveLength(1);
  });

  it("posts to the receiver as the simple form does", async () => {
    const out = await page(
      formsAnswering(() => Promise.resolve(CONTACT)),
      PICKED
    );
    expect(out).toContain(
      '<input type="hidden" name="_form" value="page:p1"/>'
    );
    expect(out).toContain('<input type="hidden" name="_node" value="form0"/>');
    expect(out).toContain('name="_hp"');
  });

  it("is sent with the form's own message, or the block's where it chose one", async () => {
    const forms = formsAnswering(() => Promise.resolve(CONTACT));
    const own = await page(forms, PICKED);
    expect(own).toMatch(
      /id="form-form0-sent"[^>]*>Thanks, we&#x27;ll be in touch\.</
    );
    const chosen = await page(forms, {
      ...PICKED,
      afterSending: "message",
      message: "Got it.",
    });
    expect(chosen).toMatch(/id="form-form0-sent"[^>]*>Got it\.</);
    // A form whose own setting is a page: the receiver sends the visitor
    // there, and the message is what shows if it cannot.
    const elsewhere = await page(
      formsAnswering(() =>
        Promise.resolve({
          ...CONTACT,
          afterSending: { kind: "page", href: "/thanks" },
        })
      ),
      PICKED
    );
    expect(elsewhere).toMatch(
      new RegExp(`id="form-form0-sent"[^>]*>${FORM_SENT_MESSAGE}<`)
    );
  });

  it("shows a closed form's own message, and nothing for a form that is gone", async () => {
    const closed = await page(
      formsAnswering(() =>
        Promise.resolve({
          unavailable: "closed",
          message: "Entries closed on Friday.",
        })
      ),
      PICKED
    );
    expect(closed).toContain("Entries closed on Friday.");
    expect(closed).not.toContain("<form");

    const closedSilently = await page(
      formsAnswering(() => Promise.resolve({ unavailable: "closed" })),
      PICKED
    );
    expect(closedSilently).toContain(
      FORM_REFUSALS.closed.replaceAll("'", "&#x27;")
    );

    const gone = await page(
      formsAnswering(() => Promise.resolve({ unavailable: "missing" })),
      PICKED
    );
    expect(gone).not.toContain("<form");
    expect(gone).not.toMatch(/error|placeholder/i);
  });

  it("draws nothing, and no error, where the provider fails", async () => {
    const out = await page(
      formsAnswering(() => Promise.reject(new Error("down"))),
      PICKED
    );
    expect(out).not.toContain("<form");
    expect(out).not.toContain("down");
  });

  it("draws nothing where the page has no receiver to describe it", async () => {
    expect(await page(undefined, PICKED)).not.toContain("<form");
  });
});

describe("a provider's own script", () => {
  const WITH_CHECK: FormDrawing = {
    ...CONTACT,
    script: { module: "/forms/bot-check.js", reason: "bot check" },
  };

  it("is added to a page that draws its form, once however many it draws", async () => {
    const out = await page(
      formsAnswering(() => Promise.resolve(WITH_CHECK)),
      PICKED,
      PICKED
    );
    const scripts = out.match(/<script[^>]*src="\/forms\/bot-check.js"[^>]*>/g);
    expect(scripts).toHaveLength(1);
    expect(scripts?.[0]).toContain('type="module"');
  });

  it("is added to no page that draws no such form", async () => {
    const withoutScript = await page(
      formsAnswering(() => Promise.resolve(CONTACT)),
      PICKED
    );
    const simple = await page(
      formsAnswering(() => Promise.resolve(WITH_CHECK)),
      { fields: [{ label: "Name" }] }
    );
    expect(withoutScript).not.toContain("<script");
    expect(simple).not.toContain("<script");
  });

  it("is never one that runs from its address", async () => {
    const out = await page(
      formsAnswering(() =>
        Promise.resolve({
          ...CONTACT,
          script: { module: "javascript:alert(1)", reason: "x" },
        })
      ),
      PICKED
    );
    expect(out).not.toContain("<script");
  });
});
