import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_FORMAT_VERSION,
  NODE_CLASS_PREFIX,
  blockTypeClassName,
  defineBlock,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { PageContext } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

/**
 * Render to HTML the way a server actually would.
 *
 * `renderToReadableStream` rather than `renderToStaticMarkup`, because the
 * properties under test are the streaming ones: an async block has to suspend
 * and resolve, and the static renderer cannot express that. Reading the stream
 * to completion also means an error thrown outside this package's containment
 * surfaces as a rejection here rather than as a silently truncated string.
 */
async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    // A throw that escapes containment must fail the test rather than be
    // reported to a console no assertion reads.
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

/**
 * Render and keep the stream's chunks separate.
 *
 * Whether a boundary was placed is not visible in the finished HTML — the page
 * contains the same markup either way. It is visible in WHEN each part arrives:
 * with a boundary the shell flushes while the slow part is still pending,
 * without one the whole page waits for it.
 */
async function renderToChunks(element: ReactElement): Promise<string[]> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  const tail = decoder.decode();
  if (tail) chunks.push(tail);
  return chunks;
}

/** A node with the fields every document node carries. */
function node(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props: {}, ...extra };
}

/** A document wrapping the given nodes. */
function doc(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** The marker every placeholder carries, in both development and production. */
const PLACEHOLDER = /data-nx-block-placeholder="([a-z-]+)"/g;

/**
 * The class attribute a block must end up with: its own node class AND its
 * block-type class, in that order. Built from the engine's own helpers so a
 * change to either prefix fails here rather than silently passing a pattern
 * that no longer describes anything.
 */
function bothClasses(type: string): RegExp {
  return new RegExp(
    `class="${NODE_CLASS_PREFIX}[a-z0-9]+ ${blockTypeClassName(type)}"`
  );
}

function placeholderReasons(html: string): string[] {
  return [...html.matchAll(PLACEHOLDER)].map(match => match[1]!);
}

const text = defineBlock<{ value: string }>({
  name: "test/text",
  version: 1,
  description: "Renders its value.",
  example: { props: { value: "hi" } },
  defaultProps: { value: "" },
  render: ({ props, className }) => <p className={className}>{props.value}</p>,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PageRenderer", () => {
  it("renders a block and gives it both of its classes", async () => {
    const html = await renderToHtml(
      <PageRenderer
        document={doc(node("a", "test/text", { props: { value: "hello" } }))}
        blocks={createBlockResolver([text as AnyBlockDefinition])}
      />
    );

    expect(html).toContain("hello");
    // The type class carries the block's shared defaults and the node class
    // carries this instance's own values; a block needs both or it silently
    // loses one layer of styling.
    expect(html).toContain(blockTypeClassName("test/text"));
    expect(html).toMatch(bothClasses("test/text"));
  });

  it("renders the page root class the compiler anchors every selector to", async () => {
    const html = await renderToHtml(
      <PageRenderer document={doc()} blocks={createBlockResolver([])} />
    );
    expect(html).toContain('class="nx-pb-page"');
  });

  describe("containment", () => {
    it("replaces an unregistered block and keeps its siblings", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", { props: { value: "before" } }),
            node("b", "test/missing"),
            node("c", "test/text", { props: { value: "after" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["unknown-block"]);
      // The point of forgiving rendering is what SURVIVES, so both siblings are
      // asserted rather than only the placeholder.
      expect(html).toContain("before");
      expect(html).toContain("after");
    });

    it("contains a block that throws synchronously", async () => {
      const boom = defineBlock({
        name: "test/boom",
        version: 1,
        description: "Throws.",
        example: { props: {} },
        render: () => {
          throw new Error("sync failure");
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/boom"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            boom as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["render-error"]);
      expect(html).toContain("sync failure");
      expect(html).toContain("survivor");
    });

    it("contains a block whose async render rejects", async () => {
      const boom = defineBlock({
        name: "test/async-boom",
        version: 1,
        description: "Rejects.",
        example: { props: {} },
        render: async () => {
          await Promise.resolve();
          throw new Error("async failure");
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/async-boom"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            boom as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["render-error"]);
      expect(html).toContain("async failure");
      expect(html).toContain("survivor");
    });

    it("contains a block that returns something React cannot render", async () => {
      // The failure this guards is not hypothetical politeness: React throws on
      // a plain-object child from inside its own render, which is after this
      // package's try/catch has returned, so an unchecked value escapes
      // containment and takes the whole page with it.
      const wrong = defineBlock({
        name: "test/wrong",
        version: 1,
        description: "Returns a plain object.",
        example: { props: {} },
        render: () => ({ not: "a node" }),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/wrong"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            wrong as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("renders a block that returns a non-array iterable", async () => {
      // `ReactNode` includes `Iterable<ReactNode>`, so a Set or a generator of
      // elements is valid output. Refusing it would replace a working block
      // with a placeholder in production.
      const setBlock = defineBlock({
        name: "test/set",
        version: 1,
        description: "Returns a Set of elements.",
        example: { props: {} },
        render: () =>
          new Set([<span key="a">one</span>, <span key="b">two</span>]),
      });
      const generatorBlock = defineBlock({
        name: "test/generator",
        version: 1,
        description: "Returns a generator of elements.",
        example: { props: {} },
        render: function* () {
          yield <span key="c">three</span>;
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/set"), node("b", "test/generator"))}
          blocks={createBlockResolver([
            setBlock as AnyBlockDefinition,
            generatorBlock as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("one");
      expect(html).toContain("two");
      expect(html).toContain("three");
    });

    it("refuses a Map, which React does not render", async () => {
      const mapBlock = defineBlock({
        name: "test/map",
        version: 1,
        description: "Returns a Map.",
        example: { props: {} },
        render: () => new Map([["a", <span key="a">x</span>]]),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/map"))}
          blocks={createBlockResolver([mapBlock as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
    });

    it("contains an invalid value nested deep inside arrays", async () => {
      // The check must not give up part way down and pass the rest through: a
      // value it stopped inspecting reaches React and throws there, which is
      // the exact escape this containment exists to prevent.
      let nested: unknown = { not: "a node" };
      for (let depth = 0; depth < 20; depth++) nested = [nested];
      const deep = defineBlock({
        name: "test/deep",
        version: 1,
        description: "Returns a deeply nested invalid value.",
        example: { props: {} },
        render: () => nested,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/deep"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            deep as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("refuses output that never ends instead of hanging on it", async () => {
      const endless = defineBlock({
        name: "test/endless",
        version: 1,
        description: "Returns an iterable with no end.",
        example: { props: {} },
        render: function* () {
          for (;;) yield "x";
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/endless"))}
          blocks={createBlockResolver([endless as AnyBlockDefinition])}
        />
      );

      // Failing closed is the point: an unbounded iterable handed to React
      // would never finish rendering the page.
      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
    });

    it("renders promise children inside a list", async () => {
      // React 19 renders a promise child by suspending on it, so this is valid
      // output; refusing it would reject a block that composes async children.
      const withPromises = defineBlock({
        name: "test/promise-children",
        version: 1,
        description: "Returns a list containing a promise child.",
        example: { props: {} },
        render: () => [
          <span key="s">sync part</span>,
          Promise.resolve(<span key="a">async part</span>),
        ],
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/promise-children"))}
          blocks={createBlockResolver([withPromises as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("sync part");
      expect(html).toContain("async part");
    });

    it("does not let a promise child hold back the rest of the page", async () => {
      // The reason the boundary exists. Without one the suspension travels up
      // past every sibling to whatever boundary sits above the whole page, so
      // one slow async child delays everything around it. Asserting only that
      // the content eventually appears cannot tell the two apart: the finished
      // HTML is identical. The arrival ORDER is what differs.
      const slowChild = defineBlock({
        name: "test/slow-child",
        version: 1,
        description: "Returns a list containing a slow promise child.",
        example: { props: {} },
        render: () => [
          new Promise<ReactElement>(resolve => {
            setTimeout(() => resolve(<span key="a">late part</span>), 50);
          }),
        ],
      });

      const chunks = await renderToChunks(
        <PageRenderer
          document={doc(
            node("a", "test/slow-child"),
            node("b", "test/text", { props: { value: "immediate part" } })
          )}
          blocks={createBlockResolver([
            slowChild as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toContain("immediate part");
      expect(chunks[0]).not.toContain("late part");
      expect(chunks.join("")).toContain("late part");
    });

    it("contains an invalid value embedded in returned JSX", async () => {
      // The common shape of this mistake. React throws on it from inside its own
      // render, after the block-level try/catch has finished, so it has to be
      // caught while the value is still just data.
      const embedded = defineBlock({
        name: "test/embedded",
        version: 1,
        description: "Puts a plain object inside its JSX.",
        example: { props: {} },
        render: ({ className }) => (
          <div className={className}>
            <span>{{ not: "a node" } as unknown as string}</span>
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/embedded"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            embedded as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("does not consume a generator passed as a JSX child", async () => {
      // Checking a borrowed iterable would exhaust it and leave React nothing
      // to render, so children are inspected without being read.
      const withGenerator = defineBlock({
        name: "test/generator-child",
        version: 1,
        description: "Puts a generator inside its JSX.",
        example: { props: {} },
        render: ({ className }) => (
          <div className={className}>
            {(function* () {
              yield <span key="a">first</span>;
              yield <span key="b">second</span>;
            })()}
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/generator-child"))}
          blocks={createBlockResolver([withGenerator as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("first");
      expect(html).toContain("second");
    });

    it("contains an iterable that throws while being read", async () => {
      // Reading the iterable happens after the block returned, so an exception
      // here would be raised outside the try block that wraps the render call.
      const hostile = defineBlock({
        name: "test/hostile-iterable",
        version: 1,
        description: "Returns an iterable whose next() throws.",
        example: { props: {} },
        render: () => ({
          [Symbol.iterator]: () => ({
            next: () => {
              throw new Error("iteration failure");
            },
          }),
        }),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/hostile-iterable"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            hostile as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("iteration failure");
      expect(html).toContain("survivor");
    });

    it("shows nothing but a marker in production", async () => {
      vi.stubEnv("NODE_ENV", "production");

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/missing"))}
          blocks={createBlockResolver([])}
        />
      );

      // The marker is the stable contract in both modes.
      expect(html).toContain('data-nx-block-placeholder="unknown-block"');
      expect(html).toContain('data-nx-block-type="test/missing"');
      // A visitor must not be shown internals, and a diagnostic panel on a live
      // page is worse than the block being absent.
      expect(html).toContain("hidden");
      expect(html).not.toContain("No block is registered");
    });
  });

  describe("slots", () => {
    const box = defineBlock({
      name: "test/box",
      version: 1,
      description: "Renders one slot.",
      example: { props: {} },
      slots: { children: {} },
      render: ({ className, renderSlot }) => (
        <div className={className}>{renderSlot("children")}</div>
      ),
    });

    it("renders nested children", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/box", {
              slots: {
                children: [
                  node("b", "test/text", { props: { value: "nested" } }),
                ],
              },
            })
          )}
          blocks={createBlockResolver([
            box as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(html).toContain("nested");
    });

    it("contains a failing child without losing its parent", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/box", {
              slots: { children: [node("b", "test/missing")] },
            })
          )}
          blocks={createBlockResolver([box as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["unknown-block"]);
      expect(html).toContain(blockTypeClassName("test/box"));
    });

    it("does not render a slot the block never asks for", async () => {
      // Laziness is the reason `renderSlot` is a function rather than
      // pre-rendered children: a tab that is never shown must not run the work
      // inside it. A spy on the child's render is the only way to see that a
      // slot was skipped rather than rendered to nothing.
      const rendered = vi.fn();
      const tracked = defineBlock({
        name: "test/tracked",
        version: 1,
        description: "Records that it rendered.",
        example: { props: {} },
        render: () => {
          rendered();
          return <span>tracked</span>;
        },
      });
      const ignores = defineBlock({
        name: "test/ignores-slot",
        version: 1,
        description: "Declares a slot and never renders it.",
        example: { props: {} },
        slots: { children: {} },
        render: ({ className }) => <div className={className} />,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/ignores-slot", {
              slots: { children: [node("b", "test/tracked")] },
            })
          )}
          blocks={createBlockResolver([
            ignores as AnyBlockDefinition,
            tracked as AnyBlockDefinition,
          ])}
        />
      );

      expect(html).not.toContain("tracked");
      expect(rendered).not.toHaveBeenCalled();
    });

    it("passes a replacement context down one slot only", async () => {
      // A repeater's whole purpose: the same template drawn once per item, each
      // time saying which item this one is for.
      const reader = defineBlock({
        name: "test/reader",
        version: 1,
        description: "Prints the locale from its context.",
        example: { props: {} },
        render: ({ ctx }) => (
          <span>{(ctx as PageContext).locale ?? "none"}</span>
        ),
      });
      const repeater = defineBlock({
        name: "test/repeater",
        version: 1,
        description: "Draws its slot twice under two contexts.",
        example: { props: {} },
        slots: { children: {} },
        render: ({ ctx, renderSlot }) => (
          <div>
            {renderSlot("children", { ...(ctx as PageContext), locale: "en" })}
            {renderSlot("children", { ...(ctx as PageContext), locale: "fr" })}
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/repeater", {
              slots: { children: [node("b", "test/reader")] },
            })
          )}
          blocks={createBlockResolver([
            repeater as AnyBlockDefinition,
            reader as AnyBlockDefinition,
          ])}
        />
      );

      expect(html).toContain("en");
      expect(html).toContain("fr");
    });
  });

  describe("suspense", () => {
    /**
     * React marks a Suspense boundary in streamed HTML with `<!--$-->`
     * comments. Their absence is what "this page created no boundary" looks
     * like from the outside.
     */
    const BOUNDARY_MARKER = "<!--$";

    it("creates no boundary for a document of synchronous blocks", async () => {
      // The property this protects is the static page: a boundary per block
      // would turn forty ordinary sections into forty streamed chunks, each
      // arriving after its own fallback.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", { props: { value: "one" } }),
            node("b", "test/text", { props: { value: "two" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).not.toContain(BOUNDARY_MARKER);
    });

    it("creates one for an asynchronous block", async () => {
      const slow = defineBlock({
        name: "test/slow",
        version: 1,
        description: "Awaits before rendering.",
        example: { props: {} },
        render: async () => {
          await Promise.resolve();
          return <span>late</span>;
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/slow"))}
          blocks={createBlockResolver([slow as AnyBlockDefinition])}
        />
      );

      // Asserted together: a marker with no content would mean the boundary
      // never resolved, which is a different outcome from streaming correctly.
      expect(html).toContain(BOUNDARY_MARKER);
      expect(html).toContain("late");
    });
  });

  describe("styles", () => {
    it("injects the supplied stylesheet and uses its classes", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/text", { props: { value: "x" } }))}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            css: ".nx-from-artifact { color: red }",
            classes: { a: "nx-from-artifact" },
          }}
        />
      );

      expect(html).toContain("<style>.nx-from-artifact { color: red }</style>");
      // The class must come FROM the artifact. Recomputing it would hand the
      // node a class the supplied sheet has no rule for.
      expect(html).toContain("nx-from-artifact");
    });

    it("renders selectors unescaped", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc()}
          blocks={createBlockResolver([])}
          styles={{ css: ".a > .b { content: '&' }", classes: {} }}
        />
      );

      // A stylesheet cannot survive HTML escaping: `>` and `&` are ordinary in
      // CSS and would arrive as entities that match nothing.
      expect(html).toContain(".a > .b { content: '&' }");
      expect(html).not.toContain("&gt;");
    });

    it("neutralises a closing style tag hidden in the css", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc()}
          blocks={createBlockResolver([])}
          styles={{
            css: ".a { color: red }</style><script>alert(1)</script>",
            classes: {},
          }}
        />
      );

      // The invariant is that the element closes exactly once, where this
      // renderer put it. `<script>` remaining in the text is harmless while the
      // parser is still inside `<style>`, and asserting its absence would be
      // asserting the wrong thing; what must never happen is a second closing
      // tag letting the rest of the payload become markup.
      expect(html.match(/<\/style>/g)).toHaveLength(1);
      expect(html).toContain("<\\/style");
      // And the escape must not be reachable as a real close.
      expect(
        /<\/style[\s/>]/.test(html.slice(0, html.lastIndexOf("</style>")))
      ).toBe(false);
    });

    it("takes the root scope from the artifact that carries it", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc()}
          blocks={createBlockResolver([])}
          styles={{ css: ".x{}", classes: {}, scope: "nx-doc-a" }}
        />
      );
      expect(html).toContain('class="nx-pb-page nx-doc-a"');
    });

    it("takes the root scope from the compile context", async () => {
      // The selectors compiled here are anchored under the scope, so a root
      // without that class means every compiled rule matches nothing.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/text", { props: { value: "x" } }))}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styleContext={{
            breakpoints: { viewport: [], container: [] },
            scope: "nx-doc-b",
          }}
        />
      );
      expect(html).toContain('class="nx-pb-page nx-doc-b"');
    });

    it("emits no style element when there is no css", async () => {
      const html = await renderToHtml(
        <PageRenderer document={doc()} blocks={createBlockResolver([])} />
      );
      expect(html).not.toContain("<style");
    });

    it("still assigns classes with no stylesheet at all", async () => {
      // A document must render without a write path, and every block is handed
      // a class whether or not any rule targets it.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/text", { props: { value: "x" } }))}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );
      expect(html).toMatch(bothClasses("test/text"));
    });
  });

  describe("migration", () => {
    const upgraded = defineBlock<{ label: string }>({
      name: "test/upgraded",
      version: 2,
      description: "Renamed its prop in version 2.",
      example: { props: { label: "hi" } },
      defaultProps: { label: "" },
      migrate: {
        1: props => ({ label: props.title }),
      },
      render: ({ props }) => <p>{props.label}</p>,
    });

    it("upgrades a stored node before rendering it", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/upgraded", { version: 1, props: { title: "old" } })
          )}
          blocks={createBlockResolver([upgraded as AnyBlockDefinition])}
        />
      );

      expect(html).toContain("old");
      expect(placeholderReasons(html)).toEqual([]);
    });

    it("replaces a node it cannot upgrade", async () => {
      const gap = defineBlock({
        name: "test/gap",
        version: 3,
        description: "Has no step from version 1.",
        example: { props: {} },
        migrate: { 2: props => props },
        render: () => <p>never</p>,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/gap", { version: 1 }))}
          blocks={createBlockResolver([gap as AnyBlockDefinition])}
        />
      );

      // Rendering it anyway would run the current version's code against props
      // shaped for an older one, which is a wrong page rather than a missing
      // block.
      expect(placeholderReasons(html)).toEqual(["migration-failed"]);
      expect(html).not.toContain("never");
    });

    it("migrates against the resolver it renders with", async () => {
      // The two must agree. Migrating from the global registry while rendering
      // from a fixture set would upgrade nodes to versions the definitions
      // doing the rendering have never heard of, and the mismatch shows up as
      // wrong props with nothing to explain them.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/upgraded", { version: 1, props: { title: "via" } })
          )}
          blocks={createBlockResolver([upgraded as AnyBlockDefinition])}
        />
      );

      expect(html).toContain("via");
    });
  });
});
