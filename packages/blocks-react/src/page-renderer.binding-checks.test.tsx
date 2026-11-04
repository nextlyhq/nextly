/**
 * Every binding is checked before its value is used, whether or not anything
 * checked it when it was saved: none of these documents is validated first.
 * A binding that breaks a rule never hands its block a value that breaks it,
 * never fails the render, and is reported. A sibling block renders in each,
 * so a failure cannot hide behind a page that drew nothing.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BindingFieldShape,
  type BindingIssue,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import type { PageBindings } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

const resolver = createBlockResolver(coreBlocks);

/** A stored document, as a database hands one back: parsed JSON. */
function stored(value: unknown): BlockDocument {
  return JSON.parse(JSON.stringify(value)) as BlockDocument;
}

/** A page of one bound heading and an unbound sibling. */
function pageWith(binding: unknown, prop = "text"): BlockDocument {
  return stored({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "bound",
        type: "core/heading",
        version: 1,
        props: { text: "Own", level: "h2" },
        bindings: { [prop]: binding },
      },
      {
        id: "sibling",
        type: "core/text",
        version: 1,
        props: { text: "Sibling renders" },
      },
    ],
  });
}

const POSTS: readonly BindingFieldShape[] = [
  { name: "title", type: "text" },
  { name: "price", type: "number" },
];

async function renderChecked(
  document: BlockDocument,
  bindings: PageBindings
): Promise<{ html: string; issues: BindingIssue[] }> {
  const issues: BindingIssue[] = [];
  const html = await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      bindings={bindings}
      onBindingIssues={reported => issues.push(...reported)}
    />
  );
  expect(html).toContain("Sibling renders");
  return { html, issues };
}

/** The heading's text, with any markup inside it removed. */
function headingText(html: string): string | undefined {
  return /<h2[^>]*>(.*?)<\/h2>/.exec(html)?.[1]?.replace(/<[^>]+>/g, "");
}

const withSchema: PageBindings = {
  entry: { title: "From entry", price: 42 },
  entryRef: { collection: "posts" },
  fieldShapes: {
    fieldsOf: ref =>
      "collection" in ref && ref.collection === "posts" ? POSTS : undefined,
  },
};

describe("checking every binding at render", () => {
  it("a binding to a prop the block lacks fills nothing and is reported", async () => {
    const issues: BindingIssue[] = [];
    const html = await renderToHtml(
      <PageRenderer
        document={pageWith(
          { $bind: "title", fallback: "Fallback" },
          "subtitle"
        )}
        blocks={resolver}
        siteStyles={false}
        bindings={withSchema}
        onBindingIssues={reported => issues.push(...reported)}
      />
    );
    expect(headingText(html)).toBe("Own");
    expect(html).not.toContain("From entry");
    expect(issues.map(issue => [issue.prop, issue.code])).toEqual([
      ["subtitle", "binding-prop-missing"],
    ]);
  });

  it("a binding to a field the source lacks renders its fallback and is reported", async () => {
    const { html, issues } = await renderChecked(
      pageWith({ $bind: "subtitle", fallback: "Fallback" }),
      { ...withSchema, entry: { ...withSchema.entry, subtitle: "Hidden" } }
    );
    expect(headingText(html)).toBe("Fallback");
    expect(issues.map(issue => issue.code)).toEqual(["binding-field-missing"]);
  });

  it("a number field bound to a text prop without a format renders its fallback and is reported", async () => {
    const withShapes = await renderChecked(
      pageWith({ $bind: "price", fallback: "Fallback" }),
      withSchema
    );
    expect(headingText(withShapes.html)).toBe("Fallback");
    expect(withShapes.issues.map(issue => issue.code)).toEqual([
      "binding-type-misfit",
    ]);
    // Without the schema, the value itself is judged, with the same answer.
    const byValue = await renderChecked(
      pageWith({ $bind: "price", fallback: "Fallback" }),
      { entry: { price: 42 } }
    );
    expect(headingText(byValue.html)).toBe("Fallback");
    expect(byValue.issues.map(issue => issue.code)).toEqual([
      "binding-type-misfit",
    ]);
  });

  it.each([
    ["an unknown currency", { type: "currency", currency: "XYZ" }],
    ["a malformed currency code", { type: "currency", currency: "eur!" }],
    ["a malformed locale", { type: "number", options: { locale: "en_US!!" } }],
    ["an unknown preset", { type: "date", options: { dateStyle: "bogus" } }],
    [
      "a preset beside a component",
      { type: "date", options: { dateStyle: "long", hour: "numeric" } },
    ],
    [
      "a digit count out of range",
      { type: "number", options: { minimumFractionDigits: 200 } },
    ],
  ])(
    "each malformed format renders its fallback and is reported without throwing: %s",
    async (_name, format) => {
      const path = format.type === "date" ? "publishedAt" : "price";
      const { html, issues } = await renderChecked(
        pageWith({ $bind: path, fallback: "Fallback", format }),
        { entry: { price: 42, publishedAt: "2026-03-29T00:00:00.000Z" } }
      );
      expect(headingText(html)).toBe("Fallback");
      expect(issues.map(issue => issue.code)).toEqual([
        "binding-format-invalid",
      ]);
    }
  );

  it.each([
    ["a malformed path", { $bind: "bad path", fallback: "Unavailable" }],
    [
      "an unknown source",
      { $bind: "title", source: "nowhere", fallback: "Unavailable" },
    ],
    [
      "a Single with no key",
      { $bind: "title", source: "single", fallback: "Unavailable" },
    ],
  ])(
    "a binding with %s still renders its valid fallback and is reported",
    async (_name, binding) => {
      const { html, issues } = await renderChecked(
        pageWith(binding),
        withSchema
      );
      expect(headingText(html)).toBe("Unavailable");
      expect(issues.map(issue => issue.code)).toEqual(["binding-malformed"]);
    }
  );

  it("a malformed binding with a fallback the prop cannot hold renders the prop's own value", async () => {
    const { html } = await renderChecked(
      pageWith({ $bind: "bad path", fallback: 7 }),
      withSchema
    );
    expect(headingText(html)).toBe("Own");
  });

  it("a list item binding outside a list renders its fallback and is reported once", async () => {
    const { html, issues } = await renderChecked(
      pageWith({ $bind: "title", source: "item", fallback: "Fallback" }),
      {}
    );
    expect(headingText(html)).toBe("Fallback");
    expect(issues.map(issue => issue.code)).toEqual([
      "binding-source-unavailable",
    ]);
  });

  it("an entry the page did not read renders the fallback and is reported, never a value from elsewhere", async () => {
    const { html, issues } = await renderChecked(
      pageWith({ $bind: "title", fallback: "Fallback" }),
      {}
    );
    expect(headingText(html)).toBe("Fallback");
    expect(issues.map(issue => issue.code)).toEqual([
      "binding-source-unavailable",
    ]);
  });

  it("reports where a binding is and what is wrong, never the value its source holds", async () => {
    const { issues } = await renderChecked(
      pageWith({ $bind: "price", fallback: "Fallback" }),
      { entry: { price: 987654 } }
    );
    expect(issues).toHaveLength(1);
    expect(JSON.stringify(issues)).not.toContain("987654");
    expect(issues[0]).toMatchObject({
      nodeId: "bound",
      prop: "text",
      path: "price",
    });
  });
});
