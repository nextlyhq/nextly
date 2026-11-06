/**
 * Stored bindings start filling their props on published pages. Until now
 * the validator checked only a binding's path syntax and source, so a stored
 * binding may break any of the rules it is now checked against. Each kind
 * renders as the compatibility rules say, and none fails the page:
 *
 * - a format this release does not apply shows the value as it is when the
 *   value fits the prop by itself, and the fallback otherwise;
 * - a binding to a prop the block does not have fills nothing;
 * - any other broken binding shows its fallback, or the prop's own value when
 *   the fallback is not itself a valid value of the prop.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  defineBlock as defineEngineBlock,
  isErrorIssue,
  validateDocument,
  type AnyBlockDefinition,
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

/** A block that shows which props it was handed. */
const propsShown = defineEngineBlock<{ text?: string }>({
  name: "test/props",
  version: 1,
  description: "Lists the props it receives.",
  example: { props: {} },
  props: { text: { type: "text" } },
  render: ({ props }) => (
    <pre data-keys={Object.keys(props).sort().join(",")}>{props.text}</pre>
  ),
});

const resolver = createBlockResolver([
  ...coreBlocks,
  propsShown as AnyBlockDefinition,
]);

/** A heading bound one way, its own value and fallback numbered apart. */
function heading(id: string, n: number, binding: Record<string, unknown>) {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text: `Own ${String(n)}`, level: "h2" },
    bindings: { text: { fallback: `Fallback ${String(n)}`, ...binding } },
  };
}

/** One stored binding of each kind, as a database hands it back. */
const document = JSON.parse(
  JSON.stringify({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      heading("relative-number", 1, {
        $bind: "price",
        format: { type: "relativeTime" },
      }),
      heading("list-list", 2, { $bind: "tags", format: { type: "list" } }),
      heading("relative-text", 3, {
        $bind: "title",
        format: { type: "relativeTime" },
      }),
      {
        id: "missing-prop",
        type: "test/props",
        version: 1,
        props: { text: "Own 4" },
        bindings: { subtitle: { $bind: "title", fallback: "Fallback 4" } },
      },
      heading("two-hops", 5, { $bind: "author.company.name" }),
      heading("to-many", 6, { $bind: "tags.name" }),
      heading("missing-field", 7, { $bind: "subtitle" }),
      heading("misfit", 8, { $bind: "price" }),
      heading("malformed-format", 9, {
        $bind: "price",
        format: { type: "currency", currency: "XYZ" },
      }),
      {
        ...heading("wrong-fallback", 10, { $bind: "summary" }),
        bindings: { text: { $bind: "summary", fallback: 7 } },
      },
    ],
  })
) as BlockDocument;

const FIELDS: Readonly<Record<string, readonly BindingFieldShape[]>> = {
  posts: [
    { name: "title", type: "text" },
    { name: "summary", type: "text" },
    { name: "price", type: "number" },
    { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
    { name: "author", type: "relationship", relationTo: "authors" },
  ],
  authors: [
    { name: "name", type: "text" },
    { name: "company", type: "relationship", relationTo: "companies" },
  ],
};

const bindings: PageBindings = {
  entry: {
    title: "Hello",
    summary: "",
    price: 5,
    tags: ["t1", "t2"],
    subtitle: "Hidden",
    author: { name: "Ada", company: "c1" },
  },
  entryRef: { collection: "posts" },
  fieldShapes: {
    fieldsOf: ref => ("collection" in ref ? FIELDS[ref.collection] : undefined),
  },
};

describe("stored bindings from before they were checked", () => {
  it("could have been stored: today's validator accepts every one", () => {
    const result = validateDocument(document, {
      breakpoints: { viewport: [], container: [] },
      mode: "strict",
    });
    expect(result.issues.filter(isErrorIssue)).toEqual([]);
  });

  it("a stored binding of each kind renders as the compatibility rules say", async () => {
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
    const shown = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(
      match => match[1]
    );
    expect(shown).toEqual([
      "Fallback 1",
      "Fallback 2",
      "Hello",
      "Fallback 5",
      "Fallback 6",
      "Fallback 7",
      "Fallback 8",
      "Fallback 9",
      "Own 10",
    ]);
    // The missing prop fills nothing: the block is handed exactly its own
    // props, with no key added for the prop it does not have.
    expect(html).toContain('<pre data-keys="text">Own 4</pre>');

    const codes = Object.fromEntries(
      issues.map(issue => [issue.nodeId, issue.code])
    );
    expect(codes).toEqual({
      "relative-number": "binding-format-unsupported",
      "list-list": "binding-format-unsupported",
      "relative-text": "binding-format-unsupported",
      "missing-prop": "binding-prop-missing",
      "two-hops": "binding-path-too-deep",
      "to-many": "binding-path-to-many",
      "missing-field": "binding-field-missing",
      misfit: "binding-type-misfit",
      "malformed-format": "binding-format-invalid",
      "wrong-fallback": "binding-fallback-invalid",
    });
    expect(issues).toHaveLength(10);
  });
});
