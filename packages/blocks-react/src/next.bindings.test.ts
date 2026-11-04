/**
 * What a routed page's bindings read: the entry again, through the route's
 * public reader, never the row the route resolved, which a public route reads
 * with trusted access and a preview reads as its draft.
 *
 * Driven through the real route and the real reader, with only the Direct
 * API below them faked, so what is asserted is what reaches the database
 * layer and what a visitor is served.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real reader, told the faked instance's declarations: no Nextly services
// are registered in this process, so the reader cannot read a schema and would
// refuse every read. The fake declares no hidden field, which is what its rows
// hold; the reader's own stripping and refusals still run.
vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  return {
    ...actual,
    createPublicReader: (
      ...[source, binding]: Parameters<typeof actual.createPublicReader>
    ) =>
      actual.createPublicReader(source, {
        ...binding,
        declarations: { hiddenFields: () => [] },
      }),
  };
});

import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import { createBlocksPage, createPublicBlocksPage } from "./next";
import type { PageRendererProps } from "./page-renderer";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const blocks = createBlockResolver(coreBlocks);

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

/** A page of one heading bound to the entry. */
function boundPage(binding: Record<string, unknown>): BlockDocument {
  return JSON.parse(
    JSON.stringify({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: { text: "Own", level: "h1" },
          bindings: { text: { fallback: "Fallback", ...binding } },
        },
      ],
    })
  ) as BlockDocument;
}

/** Whether a Direct API read is the public reader's: its fixed options. */
function isPublicRead(args: Record<string, unknown>): boolean {
  return (
    args.status === "published" &&
    args.overrideAccess === false &&
    args.unknownSort === "refuse"
  );
}

/**
 * A Direct API whose route read and public read answer differently: the row
 * the route resolves says "Trusted", the public's says "Public".
 */
function instance(content: BlockDocument) {
  const find = vi.fn(async (args: Record<string, unknown>) => ({
    items: isPublicRead(args)
      ? [
          {
            id: "p1",
            title: "Public",
            startsAt: "2026-03-29T18:30:00.000Z",
          },
        ]
      : [
          {
            id: "p1",
            slug: "about",
            title: "Trusted",
            startsAt: "2026-03-29T18:30:00.000Z",
            content,
          },
        ],
    meta: { total: 1 },
  }));
  return {
    find,
    findByID: vi.fn(async () => null),
    findSingle: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

type Instance = ReturnType<typeof instance>;
type PageConfig = Omit<Parameters<typeof createBlocksPage>[0], "nextly">;

async function renderedPage(
  factory: typeof createBlocksPage | typeof createPublicBlocksPage,
  config: PageConfig,
  nextly: Instance
): Promise<{ element: ReactElement<PageRendererProps>; html: string }> {
  const route = factory({ ...config, nextly: nextly as never });
  const element = await throughBoundary<PageRendererProps>(
    route.ContentPage({ params: { slug: ["about"] } })
  );
  const html = await renderToHtml(createElement(PageRenderer, element.props));
  return { element, html };
}

/** The Direct API arguments of every public read. */
function publicReads(nextly: Instance): Record<string, unknown>[] {
  return nextly.find.mock.calls
    .map(([args]) => args)
    .filter(args => isPublicRead(args));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a routed page's bindings", () => {
  it.each([
    ["an access-enforced route", createBlocksPage],
    ["a public route", createPublicBlocksPage],
  ] as const)(
    "an entry binding reads the entry again through the public reader, never the row the route resolved (%s)",
    async (_name, factory) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const nextly = instance(boundPage({ $bind: "title" }));
      const { html } = await renderedPage(
        factory,
        { collections: ["pages"], field: "content", blocks },
        nextly
      );
      expect(html).toContain("Public");
      expect(html).not.toContain("Trusted");
      // One read of the entry, by its id, for the fields the page binds.
      expect(publicReads(nextly)).toEqual([
        expect.objectContaining({
          collection: "pages",
          where: { and: [{ id: { equals: "p1" } }] },
          select: { id: true, title: true },
          limit: 1,
        }),
      ]);
    }
  );

  it("an entry read costs a claim on the page's budget, and a refused claim renders the fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = instance(boundPage({ $bind: "title" }));
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks, maxQueries: 0 },
      nextly
    );
    expect(publicReads(nextly)).toEqual([]);
    expect(html).toContain("Fallback");
    expect(html).not.toContain("Trusted");
    // Reported once, naming the page and the problem, never a value.
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('"about"');
    expect(message).toContain("binding-source-unavailable");
    expect(message).not.toContain("Trusted");
  });

  it("passes the route's time zone to the render, and UTC when none or an invalid one is set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const document = boundPage({
      $bind: "startsAt",
      format: {
        type: "date",
        options: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      },
    });
    const base = { collections: ["pages"], field: "content", blocks };

    const paris = await renderedPage(
      createBlocksPage,
      { ...base, timeZone: "Europe/Paris" },
      instance(document)
    );
    expect(paris.element.props.bindings?.timeZone).toBe("Europe/Paris");
    expect(paris.html).toContain("20:30");

    const unset = await renderedPage(
      createBlocksPage,
      base,
      instance(document)
    );
    expect(unset.element.props.bindings?.timeZone).toBeUndefined();
    expect(unset.html).toContain("18:30");

    const invalid = await renderedPage(
      createBlocksPage,
      { ...base, timeZone: "Not/AZone" },
      instance(document)
    );
    expect(invalid.html).toContain("18:30");
    expect(
      warn.mock.calls.some(([message]) => String(message).includes("Not/AZone"))
    ).toBe(true);
  });

  it("metadata derives from bound props", async () => {
    let title: string | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks,
      nextly: instance(boundPage({ $bind: "title" })) as never,
      metadata: (_entry, _context, derived) => {
        title = derived.title;
        return {};
      },
    });
    await route.generateMetadata({ params: { slug: ["about"] } });
    expect(title).toBe("Public");
  });

  it("a page whose slots nest deeper than the call stack still renders", async () => {
    // Stored content that bypassed validation: a chain far past the caps the
    // read pipeline repairs to, holding a binding at the top.
    let chain: Record<string, unknown> = {
      id: "leaf",
      type: "core/text",
      version: 1,
      props: { text: "Deep" },
    };
    for (let depth = 0; depth < 50_000; depth += 1) {
      chain = {
        id: `box-${String(depth)}`,
        type: "core/box",
        version: 1,
        props: {},
        slots: { children: [chain] },
      };
    }
    const document = boundPage({ $bind: "title" });
    const content = { ...document, nodes: [...document.nodes, chain] };
    const nextly = instance(content as BlockDocument);
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks },
      nextly
    );
    expect(html).toContain("Public");
  });

  it("a binding on a node the shape repair drops claims no read", async () => {
    // A stored node with no usable version: the read pipeline drops it before
    // anything renders, so its entry binding must not spend the page's one
    // claim, which the list beside it needs.
    const content = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "dropped",
            type: "core/heading",
            version: 1.5,
            props: { text: "Own", level: "h1" },
            bindings: { text: { $bind: "title" } },
          },
          {
            id: "loop",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", limit: 1 },
            slots: {
              children: [
                {
                  id: "item",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Own", level: "h2" },
                  bindings: { text: { $bind: "title", source: "item" } },
                },
              ],
            },
          },
        ],
      })
    ) as BlockDocument;
    const nextly = instance(content);
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks, maxQueries: 1 },
      nextly
    );
    expect(publicReads(nextly).map(args => args.collection)).toEqual(["posts"]);
    expect(html).toContain("Public");
  });

  it("a binding on a node the page withholds or de-duplicates claims no read", async () => {
    // A condition-gated heading and a later node reusing the list's address:
    // neither reaches the page, so neither may spend the one claim the list
    // needs.
    const entryBound = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      type: "core/heading",
      version: 1,
      props: { text: "Own", level: "h1" },
      bindings: { text: { $bind: "title" } },
      ...extra,
    });
    const content = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          entryBound("gated", {
            visibility: {
              conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
            },
          }),
          {
            id: "loop",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", limit: 1 },
            slots: {
              children: [
                {
                  id: "item",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Own", level: "h2" },
                  bindings: { text: { $bind: "title", source: "item" } },
                },
              ],
            },
          },
          entryBound("loop"),
        ],
      })
    ) as BlockDocument;
    const nextly = instance(content);
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks, maxQueries: 1 },
      nextly
    );
    expect(publicReads(nextly).map(args => args.collection)).toEqual(["posts"]);
    expect(html).toContain("Public");
  });

  it("a page with no binding reads nothing more and renders as it did", async () => {
    const nextly = instance({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: { text: "Own", level: "h1" },
        },
      ],
    });
    const { element, html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks },
      nextly
    );
    expect(publicReads(nextly)).toEqual([]);
    expect(element.props.bindings).toBeUndefined();
    expect(html).toContain("Own");
  });
});
