import {
  Activity,
  StrictMode,
  Suspense,
  createContext,
  createElement,
  forwardRef,
  memo,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  nodeClassNames,
  NODE_CLASS_PREFIX,
  blockTypeClassName,
  type AnyBlockDefinition,
  type BlockDocument,
  type StyleCompileContext,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { PageContext } from "./context";
import { createStandaloneContext, defineBlock } from "./context";
import { PageRenderer, withoutStatedNulls } from "./page-renderer";
import { createBlockResolver } from "./resolver";
import { resolvePageStyles, type PageStyles } from "./styles";

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

/**
 * A block that answers whether these props make it draw, so one document can
 * hold an instance on each side of the declaration.
 */
const drawless = defineBlock<{ draw: boolean }>({
  name: "test/drawless",
  version: 1,
  description: "Draws only when told to.",
  example: { props: { draw: true } },
  defaultProps: { draw: false },
  rendersNothing: props => props.draw !== true,
  render: ({ props, className }) =>
    props.draw ? <p className={className}>drawn</p> : null,
});

/**
 * A block whose declaration throws when asked. Style resolution runs with no
 * block boundary above it, so a throw here must cost the node's exemption
 * rather than the page.
 */
const drawlessThrows = defineBlock<{ value: string }>({
  name: "test/drawless-throws",
  version: 1,
  description: "Its declaration throws.",
  example: { props: { value: "x" } },
  defaultProps: { value: "" },
  rendersNothing: () => {
    throw new Error("declaration is broken");
  },
  render: ({ props, className }) => <p className={className}>{props.value}</p>,
});

/**
 * A block declared `async` by mistake. The call itself never throws — it returns
 * a promise, so the comparison against `true` is simply false — and the REJECTION
 * is the hazard: Node reports it as unhandled and can end the process.
 */
const drawlessRejects = defineBlock<{ value: string }>({
  name: "test/drawless-rejects",
  version: 1,
  description: "Its declaration rejects.",
  example: { props: { value: "x" } },
  defaultProps: { value: "" },
  rendersNothing: (() =>
    Promise.reject(new Error("late"))) as unknown as (props: {
    value: string;
  }) => boolean,
  render: ({ props, className }) => <p className={className}>{props.value}</p>,
});

/** A second type, so a document can lose every instance of one and keep the other. */
const onlyHidden = defineBlock<{ value: string }>({
  name: "test/only-hidden",
  version: 1,
  description: "Renders its value.",
  example: { props: { value: "hi" } },
  defaultProps: { value: "" },
  render: ({ props, className }) => <p className={className}>{props.value}</p>,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
        render: () => ({ not: "a node" }) as unknown as ReactNode,
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
        render: () => nested as ReactNode,
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

    it("refuses a generator passed as a JSX child", async () => {
      // A borrowed single-use iterator has no good outcome: reading it to check
      // it exhausts it and leaves React nothing to render, and passing it
      // through leaves the only pass over its values to React, after this
      // boundary has returned. There, a yielded object throws uncontained and
      // an endless generator hangs the WHOLE page — which is the containment
      // guarantee failing outright rather than one block degrading.
      //
      // React documents iterators as children as unsupported for the same
      // reason ("enumerating a generator mutates it") and points at
      // `Array.from()` or a spread, so refusing agrees with React rather than
      // being stricter than it. The refusal says so.
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

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      // The yielded elements, specifically — the refusal text names the fix and
      // says "first" itself.
      expect(html).not.toContain("<span>first</span>");
      expect(html).not.toContain("<span>second</span>");
    });

    it("renders the same values once they are an array", async () => {
      // The fix the refusal names has to actually work, or refusing is just a
      // dead end for the author.
      const spread = defineBlock({
        name: "test/generator-spread",
        version: 1,
        description: "Spreads a generator before putting it in its JSX.",
        example: { props: {} },
        render: ({ className }) => (
          <div className={className}>
            {[
              ...(function* () {
                yield <span key="a">first</span>;
                yield <span key="b">second</span>;
              })(),
            ]}
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/generator-spread"))}
          blocks={createBlockResolver([spread as AnyBlockDefinition])}
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

    it("refuses a component type returned in place of an element", async () => {
      // `React.memo(C)` carries a `react.*` tag but is a component TYPE, not a
      // node: `isValidElement` is false and React throws on it as a child. A
      // rule that accepted every React-tagged object would wave it through.
      const Component = () => <span>never</span>;
      const wrong = defineBlock({
        name: "test/component-type",
        version: 1,
        description: "Returns a memo component instead of an element.",
        example: { props: {} },
        render: () => memo(Component) as unknown as ReactNode,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/component-type"),
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

    it("inspects a re-readable iterable passed as a JSX child", async () => {
      // A Set can be read without being used up, so declining to check it would
      // let an invalid entry through for no benefit. Only single-use iterables
      // are exempt.
      const withSet = defineBlock({
        name: "test/set-child",
        version: 1,
        description: "Puts a Set containing an invalid entry inside its JSX.",
        example: { props: {} },
        render: ({ className }) => (
          <div className={className}>
            {new Set([{ bad: true }]) as unknown as ReactElement}
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/set-child"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            withSet as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("contains a throw that cannot be converted to a string", async () => {
      // `String(Object.create(null))` throws, and it would throw inside the
      // handler that exists to contain the first failure.
      const hostile = defineBlock({
        name: "test/undescribable",
        version: 1,
        description: "Throws a value with no string form.",
        example: { props: {} },
        render: () => {
          throw Object.create(null) as Error;
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/undescribable"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            hostile as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["render-error"]);
      expect(html).toContain("survivor");
    });

    it("contains a value whose then getter throws", async () => {
      // The thenable check runs after the render try/catch, so a throwing
      // getter there would escape the block boundary entirely.
      const hostile = defineBlock({
        name: "test/hostile-thenable",
        version: 1,
        description: "Returns an object whose then getter throws.",
        example: { props: {} },
        render: () =>
          ({
            get then() {
              throw new Error("then getter");
            },
          }) as unknown as ReactNode,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/hostile-thenable"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            hostile as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("contains a promise child that rejects", async () => {
      // Suspense resolves a promise child; it does not catch one that rejects.
      // Without substituting something that awaits under containment, the
      // rejection surfaces inside React after the boundary has returned.
      const rejecting = defineBlock({
        name: "test/rejecting-child",
        version: 1,
        description: "Returns a list containing a rejecting promise.",
        example: { props: {} },
        render: () => [
          <span key="s">kept</span>,
          Promise.reject(new Error("child rejected")),
        ],
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/rejecting-child"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            rejecting as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["render-error"]);
      expect(html).toContain("child rejected");
      // The rest of the block survives too: only the failing child is replaced.
      expect(html).toContain("kept");
      expect(html).toContain("survivor");
    });

    it("accepts children a custom component owns", async () => {
      // React hands a component its children as an ordinary prop, so a render
      // prop and an ignored opaque value are both legitimate. Judging them
      // would replace working blocks with placeholders, which is a worse
      // failure than the escape it would close.
      const List = ({
        children,
      }: {
        children: (item: string) => ReactElement;
      }) => <ul>{children("item")}</ul>;
      const renderProp = defineBlock({
        name: "test/render-prop",
        version: 1,
        description: "Passes a function as children to a custom component.",
        example: { props: {} },
        render: () => <List>{(item: string) => <li>{item}</li>}</List>,
      });

      const Ignores = (_props: { children?: unknown }) => <p>ignored ok</p>;
      const opaque = defineBlock({
        name: "test/opaque-children",
        version: 1,
        description: "Passes an opaque object to a component that ignores it.",
        example: { props: {} },
        render: () => (
          <Ignores>{{ opaque: true } as unknown as ReactElement}</Ignores>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/render-prop"),
            node("b", "test/opaque-children")
          )}
          blocks={createBlockResolver([
            renderProp as AnyBlockDefinition,
            opaque as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("<li>item</li>");
      expect(html).toContain("ignored ok");
    });

    it("contains a host element whose style prop React refuses", async () => {
      // React's server renderer throws on a non-object style while writing the
      // attribute, well after containment has returned. It is worth pre-empting
      // because it arrives from stored content: a text field read into `style`.
      const styled = defineBlock<{ style: string }>({
        name: "test/string-style",
        version: 1,
        description: "Reads a stored text value into the style prop.",
        example: { props: { style: "color: red" } },
        defaultProps: { style: "" },
        render: ({ props }) => (
          <div style={props.style as unknown as React.CSSProperties} />
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/string-style", {
              props: { style: "color: red" },
            }),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            styled as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("refuses a portal, which no server renderer can render", async () => {
      // Constructed by shape rather than with `createPortal`, which cannot even
      // be called without a DOM container.
      const portalLike = {
        $$typeof: Symbol.for("react.portal"),
        key: null,
        children: "inside",
        containerInfo: {},
        implementation: null,
      };
      const withPortal = defineBlock({
        name: "test/portal",
        version: 1,
        description: "Returns a portal.",
        example: { props: {} },
        render: () => portalLike as unknown as ReactNode,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/portal"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            withPortal as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("refuses a node saved by a newer definition than this app has", async () => {
      // Migration only ever upgrades, so a node from the future is left
      // untouched and the older renderer would read props for a schema it has
      // never seen. That is a wrong page, not a missing block.
      const current = defineBlock({
        name: "test/rolled-back",
        version: 2,
        description: "This app is behind the document.",
        example: { props: {} },
        render: () => <p>rendered anyway</p>,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/rolled-back", { version: 5 }),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            current as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["version-ahead"]);
      expect(html).not.toContain("rendered anyway");
      expect(html).toContain("survivor");
    });

    it("renders an empty slot when the stored value is not a list", async () => {
      // Stored documents are JSON from a database and can hold anything. A
      // malformed slot would reach `nodes.map` inside React, past the boundary
      // that called the block.
      const box = defineBlock({
        name: "test/bad-slot",
        version: 1,
        description: "Renders a slot whose stored value is malformed.",
        example: { props: {} },
        slots: { children: {} },
        render: ({ className, renderSlot }) => (
          <div className={className}>{renderSlot("children")}</div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/bad-slot", {
              slots: { children: { nope: true } as unknown as [] },
            }),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            box as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("survivor");
    });
  });

  describe("node fields the block cannot receive", () => {
    it("puts cssId and attributes on the block's root element", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "anchored" },
              cssId: "section-one",
              attributes: { "data-track": "hero", title: "A section" },
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      // Stored and silently dropped is what breaks anchors and author data
      // attributes, since `BlockRenderArgs` carries only `className`.
      expect(html).toContain('id="section-one"');
      expect(html).toContain('data-track="hero"');
      expect(html).toContain('title="A section"');
      // The class the block was handed must survive the clone.
      expect(html).toMatch(bothClasses("test/text"));
    });

    it("never lets a stored attribute reinterpret the element", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "kept" },
              attributes: {
                children: "hijacked",
                className: "nx-not-this",
                style: "color: red",
              },
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      // These keys change how React reads the element rather than what it
      // renders, so author data must never reach them.
      expect(html).toContain("kept");
      expect(html).not.toContain("hijacked");
      expect(html).not.toContain("nx-not-this");
      expect(html).toMatch(bothClasses("test/text"));
    });
  });

  describe("hostile stored documents", () => {
    it("does not decorate an awaited child of a list root", async () => {
      // Output validation is re-entered for each awaited child, and the node's
      // root-level fields belong to the block's own root. A list root has none,
      // so nothing may be applied to the items either — re-entry that forgot
      // that would decorate a nested element with fields no root received.
      const listWithPromise = defineBlock({
        name: "test/async-list",
        version: 1,
        description: "Returns a list containing a promise child.",
        example: { props: {} },
        render: () => [
          <span key="s">sync child</span>,
          Promise.resolve(<em key="a">async child</em>),
        ],
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/async-list"))}
          blocks={createBlockResolver([listWithPromise as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("sync child");
      expect(html).toContain("async child");
      expect(html).not.toContain(" id=");
    });

    it("refuses a node whose block returns no element at all", async () => {
      // A primitive or a list has no root to carry the node's DOM fields, and
      // losing them is as silent as losing them on a fragment root: the anchor,
      // the `label for=`, the `#id` selector all stop working on a page that
      // still looks right.
      const listRoot = defineBlock({
        name: "test/list-root",
        version: 1,
        description: "Returns a list rather than an element.",
        example: { props: {} },
        render: () => [<span key="a">one</span>, <span key="b">two</span>],
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/list-root", { cssId: "anchor" }),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            listRoot as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).not.toContain('id="anchor"');
      expect(html).toContain("survivor");
    });

    it("leaves a list root alone when the node asks for nothing", async () => {
      const listRoot = defineBlock({
        name: "test/list-plain",
        version: 1,
        description: "Returns a list and is asked for no DOM fields.",
        example: { props: {} },
        render: () => [<span key="a">one</span>, <span key="b">two</span>],
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/list-plain"))}
          blocks={createBlockResolver([listRoot as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("one");
      expect(html).toContain("two");
    });

    it("survives an attributes envelope that is not a record", async () => {
      // `Object.keys(null)` throws, and it would throw after the render
      // try/catch and after normalization.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "still here" },
              attributes: null as unknown as Record<string, string>,
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("still here");
    });

    it("drops a node whose identity fields are not text", async () => {
      // The unknown-block placeholder writes the type into the DOM, so an
      // object there would throw inside React instead of being contained.
      const html = await renderToHtml(
        <PageRenderer
          document={{
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "page",
            nodes: [
              {
                id: "a",
                type: {},
                version: 1,
                props: {},
              } as unknown as BlockNode,
              node("b", "test/text", { props: { value: "survivor" } }),
            ],
          }}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("survivor");
    });

    it("renders a document nested deeper than the format allows", async () => {
      // The repair walk runs before any block boundary exists, so an over-deep
      // chain would exhaust the call stack and fail the whole request.
      const box = defineBlock({
        name: "test/deep-box",
        version: 1,
        description: "Nests one slot.",
        example: { props: {} },
        slots: { children: {} },
        render: ({ className, renderSlot }) => (
          <div className={className}>{renderSlot("children")}</div>
        ),
      });

      let deepest: BlockNode = node("leaf", "test/text", {
        props: { value: "too deep" },
      });
      for (let level = 0; level < 200; level++) {
        deepest = node(`box-${level}`, "test/deep-box", {
          slots: { children: [deepest] },
        });
      }

      const html = await renderToHtml(
        <PageRenderer
          document={doc(deepest)}
          blocks={createBlockResolver([
            box as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      // Truncated rather than thrown: the page renders what fits.
      expect(html).toContain("nx-pb-page");
      expect(html).not.toContain("too deep");
    });

    it("withholds a node whose conditions are malformed", async () => {
      // A flat list of predicates instead of OR-of-AND groups is still an
      // author saying this node is restricted.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "gated somehow" },
              visibility: {
                conditions: [
                  { field: "tier", op: "eq", value: "vip" },
                ] as unknown as [][],
              },
            }),
            node("b", "test/text", { props: { value: "everyone" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).not.toContain("gated somehow");
      expect(html).toContain("everyone");
    });

    it("refuses a borrowed iterable whose iterator cannot be obtained", async () => {
      const hostile = defineBlock({
        name: "test/unopenable",
        version: 1,
        description: "Puts an unopenable iterable inside its JSX.",
        example: { props: {} },
        render: ({ className }) => (
          <div className={className}>
            {
              {
                [Symbol.iterator]() {
                  throw new Error("cannot open");
                },
              } as unknown as ReactElement
            }
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/unopenable"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            hostile as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("refuses an iterable that delegates to a generator", async () => {
      // The wrapper's iterator is neither itself nor fresh, so an
      // identity-based test would call it re-readable and walk it — draining
      // the generator it delegates to and leaving React nothing. Asking twice
      // classifies it single-use, which is what it behaves like, and a borrowed
      // single-use iterator is refused.
      const delegating = defineBlock({
        name: "test/delegating",
        version: 1,
        description: "Puts a delegating iterable inside its JSX.",
        example: { props: {} },
        render: ({ className }) => {
          const source = (function* () {
            yield <span key="a">first</span>;
            yield <span key="b">second</span>;
          })();
          const wrapper = { [Symbol.iterator]: () => source };
          return (
            <div className={className}>
              {wrapper as unknown as ReactElement}
            </div>
          );
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/delegating"))}
          blocks={createBlockResolver([delegating as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      // The yielded elements, specifically — the refusal text names the fix and
      // says "first" itself.
      expect(html).not.toContain("<span>first</span>");
      expect(html).not.toContain("<span>second</span>");
    });

    it("keeps a healthy node's anchor when another node with that id fails", async () => {
      // The reason DOM ids are not settled before rendering. A block that
      // throws is replaced by a placeholder emitting no id at all, so reserving
      // ids in advance meant the failing node had already taken `hero` and the
      // healthy one was stripped in exchange for nothing.
      const boom = defineBlock({
        name: "test/boom",
        version: 1,
        description: "Throws.",
        example: { props: {} },
        defaultProps: {},
        render: () => {
          throw new Error("nope");
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/boom", { cssId: "hero" }),
            node("b", "test/text", {
              props: { value: "healthy" },
              cssId: "hero",
            })
          )}
          blocks={createBlockResolver([
            boom as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["render-error"]);
      expect(html.match(/id="hero"/g)).toHaveLength(1);
      expect(html).toContain("healthy");
    });

    it("lets a stored duplicate reach the page rather than repairing it", async () => {
      // The cost of the above, stated rather than discovered. `duplicate-dom-id`
      // is a write-time validation error, so this shape can only arrive from a
      // row edited outside the product — and a browser resolves a duplicated id
      // to the first match rather than failing, which is a smaller cost than
      // silently unsticking an anchor on a page where nothing is wrong.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", { props: { value: "first" }, cssId: "dup" }),
            node("b", "test/text", { props: { value: "second" }, cssId: "dup" })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html.match(/id="dup"/g)).toHaveLength(2);
      expect(html).toContain("first");
      expect(html).toContain("second");
    });

    it("does not reserve a dom id for a node that renders a placeholder", async () => {
      // A node whose block is unknown, or whose migration failed, emits no `id`
      // of its own — the placeholder carries markers, not the modelled field.
      // Reserving one for it would strip the anchor off a healthy node in
      // exchange for an id nothing was going to use.
      for (const broken of [
        node("a", "test/missing", { cssId: "anchor" }),
        node("a", "test/text", {
          props: { value: "stale" },
          cssId: "anchor",
          migrationFailed: true,
        }),
      ]) {
        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              broken,
              node("b", "test/text", {
                props: { value: "healthy" },
                cssId: "anchor",
              })
            )}
            blocks={createBlockResolver([text as AnyBlockDefinition])}
          />
        );

        expect(html).toContain("healthy");
        expect(html).toContain('id="anchor"');
      }
    });

    it("does not reserve a node id for a child that never reaches the page", async () => {
      // The same rule one level down, for node ids rather than DOM ids. A
      // placeholder replaces its node ENTIRELY, so the subtree under an unknown
      // type never renders — but walking into it anyway let a child claim an id
      // and delete the later visible sibling that shares it.
      //
      // `duplicate-node-id` is a write-time validation error, so this arrives
      // only from a row edited outside the product. What matters is which side
      // survives when it does: content over a diagnostic for something that was
      // never going to be drawn.
      for (const broken of [
        node("wrapper", "test/missing", {
          slots: {
            main: [node("dup", "test/text", { props: { value: "buried" } })],
          },
        }),
        node("wrapper", "test/text", {
          props: { value: "stale" },
          migrationFailed: true,
          slots: {
            main: [node("dup", "test/text", { props: { value: "buried" } })],
          },
        }),
      ]) {
        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              broken,
              node("dup", "test/text", { props: { value: "healthy" } })
            )}
            blocks={createBlockResolver([text as AnyBlockDefinition])}
          />
        );

        // The point of the test: the visible sibling is still on the page.
        expect(html).toContain("healthy");
        // And the child that took its id never was, so nothing was traded away.
        expect(html).not.toContain("buried");
        // The broken node still reports itself. Skipping the descent must not
        // also skip the diagnostic that says why the subtree is gone.
        expect(placeholderReasons(html)).toHaveLength(1);
      }
    });

    it("does not let attributes that never render force a placeholder", async () => {
      // The refusal is about DOM fields being LOST. `style` and `onClick` are
      // dropped by the allowlist whatever the root is, so a node carrying only
      // those loses nothing by having no element — placeholdering it would take
      // a working block over fields that were never going to appear.
      const fragmentRoot = defineBlock({
        name: "test/fragment-ignored-attrs",
        version: 1,
        description: "Returns a fragment.",
        example: { props: {} },
        render: () => (
          <>
            <span>one</span>
            <span>two</span>
          </>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/fragment-ignored-attrs", {
              attributes: {
                style: "color:red",
                onClick: "boom",
                "data-n": 5 as unknown as string,
              },
            })
          )}
          blocks={createBlockResolver([fragmentRoot as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("one");
    });

    it("keeps ids that differ only in case", async () => {
      // DOM ids are case-SENSITIVE even though attribute names are not, so
      // `#Hero` and `#hero` address different elements and folding them
      // together would strip an anchor that was never ambiguous.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "first" },
              cssId: "Hero",
            }),
            node("b", "test/text", {
              props: { value: "second" },
              cssId: "hero",
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).toContain('id="Hero"');
      expect(html).toContain('id="hero"');
    });

    it("takes over a promise it wrapped when it refuses the output around it", async () => {
      // Wrapping substitutes a component that awaits the promise; refusing the
      // output discards that wrapper, so nothing is left listening to a promise
      // the block already started. Under Node's default
      // `--unhandled-rejections=throw` an unheard rejection ends the process.
      //
      // Asserted as the MECHANISM rather than the symptom: whether a rejection
      // handler was attached is deterministic, while whether an unhandled
      // rejection surfaces depends on timing.
      let rejectionHandler: unknown = null;
      const pending = {
        then(
          _resolve: (value: unknown) => void,
          reject?: (reason: unknown) => void
        ) {
          rejectionHandler = reject ?? null;
          reject?.(new Error("the block's own failure"));
        },
      };
      const refused = defineBlock({
        name: "test/refused-with-promise",
        version: 1,
        description: "Returns a promise beside a value that cannot render.",
        example: { props: {} },
        render: () => [pending, { not: "a node" }] as unknown as ReactElement,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/refused-with-promise"))}
          blocks={createBlockResolver([refused as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(typeof rejectionHandler).toBe("function");
    });
  });

  describe("react built-ins and awaitables", () => {
    it("contains an invalid child inside a React-owned wrapper", async () => {
      // React renders a Suspense or StrictMode child itself, exactly as it does
      // a host element's, so skipping the walk there left the same escape open
      // one element higher.
      const wrapped = defineBlock({
        name: "test/wrapper-child",
        version: 1,
        description: "Puts a plain object inside a Suspense wrapper.",
        example: { props: {} },
        render: () => (
          <Suspense fallback={null}>
            {{ not: "a node" } as unknown as ReactElement}
          </Suspense>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/wrapper-child"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            wrapped as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("awaits a callable thenable", async () => {
      // `await` looks for a `then` method, not for a particular typeof, so a
      // library's callable promise-like is legitimate async output.
      const callable = defineBlock({
        name: "test/callable-thenable",
        version: 1,
        description: "Returns a function carrying a then method.",
        example: { props: {} },
        render: () => {
          const thenable = () => undefined;
          Object.assign(thenable, {
            then: (resolve: (value: ReactElement) => void) => {
              resolve(<span>awaited</span>);
            },
          });
          return thenable as unknown as ReactNode;
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/callable-thenable"))}
          blocks={createBlockResolver([callable as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("awaited");
    });

    it("refuses a symbol that only describes itself as one of React's", async () => {
      // `Symbol("react.fragment")` is not `Symbol.for("react.fragment")`: it is
      // a private symbol wearing the same description. It passes
      // `isValidElement`, and React then answers it with "Element type is
      // invalid" from inside its own render — so a description prefix is not
      // something a type check can be built on.
      const impostor = defineBlock({
        name: "test/impostor-symbol",
        version: 1,
        description: "Builds an element from a look-alike symbol.",
        example: { props: {} },
        render: () =>
          createElement(
            Symbol("react.fragment") as unknown as string,
            null,
            "x"
          ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/impostor-symbol"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            impostor as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("refuses a React symbol that is not an element type", async () => {
      // `react.memo` is genuinely React's own registered symbol, and it tags a
      // component WRAPPER rather than naming an element type. React refuses it
      // with the same message a foreign symbol gets, so belonging to React is
      // not the property worth testing for.
      const wrapperTag = defineBlock({
        name: "test/wrapper-tag-symbol",
        version: 1,
        description: "Builds an element from a component-wrapper tag.",
        example: { props: {} },
        render: () =>
          createElement(
            Symbol.for("react.memo") as unknown as string,
            null,
            "x"
          ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/wrapper-tag-symbol"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            wrapperTag as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("walks the children of a built-in it accepts as a type", async () => {
      // One list decides both whether a symbol names a renderable type and
      // whether React renders that element's children. Were StrictMode absent
      // from it the element would be accepted unwalked, and the invalid child
      // would reach React one level higher.
      const strict = defineBlock({
        name: "test/strict-child",
        version: 1,
        description: "Puts a plain object inside StrictMode.",
        example: { props: {} },
        render: () => (
          <StrictMode>
            {{ not: "a node" } as unknown as ReactElement}
          </StrictMode>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/strict-child"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            strict as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("renders React 19's Activity and walks what is inside it", async () => {
      // The cost of enumerating element types, paid: a built-in this list has
      // not heard of is refused, so every one React ships has to be here. The
      // second half is the reason it cannot just be added to the type list —
      // Activity renders its children itself, so they are walked like a
      // fragment's.
      const visible = defineBlock({
        name: "test/activity-visible",
        version: 1,
        description: "Puts a real element inside Activity.",
        example: { props: {} },
        render: () => (
          <Activity mode="visible">
            <span>inside activity</span>
          </Activity>
        ),
      });
      const bad = defineBlock({
        name: "test/activity-bad-child",
        version: 1,
        description: "Puts a plain object inside Activity.",
        example: { props: {} },
        render: () => (
          <Activity mode="visible">
            {{ not: "a node" } as unknown as ReactElement}
          </Activity>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/activity-visible"),
            node("b", "test/activity-bad-child"),
            node("c", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            visible as AnyBlockDefinition,
            bad as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(html).toContain("inside activity");
      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("refuses an object element type React only appears to own", async () => {
      // The same enumeration mistake as the symbol one, a level over: an object
      // whose `$$typeof` merely starts with `react.` is not an element type.
      // `react.portal` is React's own tag on a value React refuses as a type,
      // `react.whatever` is not React's at all, and `Symbol("react.context")`
      // is a private symbol wearing the right name. All three were verified to
      // reach "Element type is invalid" from inside React's render.
      const tags: Array<[string, unknown]> = [
        ["portal", Symbol.for("react.portal")],
        ["invented", Symbol.for("react.whatever")],
        ["unregistered", Symbol("react.context")],
      ];

      for (const [label, tag] of tags) {
        const forged = defineBlock({
          name: `test/forged-${label}`,
          version: 1,
          description: "Builds an element from a React-looking object.",
          example: { props: {} },
          render: () =>
            createElement({ $$typeof: tag } as unknown as string, null, "x"),
        });

        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              node("a", `test/forged-${label}`),
              node("b", "test/text", { props: { value: "survivor" } })
            )}
            blocks={createBlockResolver([
              forged as AnyBlockDefinition,
              text as AnyBlockDefinition,
            ])}
          />
        );

        expect(placeholderReasons(html)).toEqual(["invalid-output"]);
        expect(html).toContain("survivor");
      }
    });

    it("refuses a React-tagged object that carries nothing to render", async () => {
      // A tag is not a wrapper. `{ $$typeof: Symbol.for("react.forward_ref") }`
      // has the right tag and no `render`, and React answers it with "Cannot
      // read properties of undefined" from inside its own render — a crash
      // rather than the refusal an unknown element type gets, so the
      // placeholder path is bypassed entirely.
      for (const tag of [
        "react.memo",
        "react.forward_ref",
        "react.lazy",
        "react.consumer",
      ]) {
        const hollow = defineBlock({
          name: `test/hollow-${tag}`,
          version: 1,
          description:
            "Builds an element from a tag with no wrapper behind it.",
          example: { props: {} },
          render: () =>
            createElement(
              { $$typeof: Symbol.for(tag) } as unknown as string,
              null,
              "x"
            ),
        });

        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              node("a", `test/hollow-${tag}`),
              node("b", "test/text", { props: { value: "survivor" } })
            )}
            blocks={createBlockResolver([
              hollow as AnyBlockDefinition,
              text as AnyBlockDefinition,
            ])}
          />
        );

        expect(placeholderReasons(html)).toEqual(["invalid-output"]);
        expect(html).toContain("survivor");
      }
    });

    it("accepts-real-wrappers built by React's own factories", async () => {
      // The shape check above names fields that are React internals, and this
      // is what makes that safe: the real wrappers always carry them, so a
      // rename fails HERE, loudly, in CI — instead of silently refusing valid
      // blocks in production.
      const Inner = (): ReactElement => <i>wrapped</i>;
      const Memo = memo(Inner);
      const Forwarded = forwardRef<HTMLElement>(() => <b>forwarded</b>);
      const Ctx = createContext("light");

      const wrappers = defineBlock({
        name: "test/real-wrappers",
        version: 1,
        description: "Renders every object element type React can build.",
        example: { props: {} },
        render: () => (
          <>
            <Memo />
            <Forwarded />
            <Ctx.Provider value="dark">
              <span>provided</span>
              <Ctx.Consumer>{value => <em>{value}</em>}</Ctx.Consumer>
            </Ctx.Provider>
          </>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/real-wrappers"))}
          blocks={createBlockResolver([wrappers as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      for (const body of ["wrapped", "forwarded", "provided", "dark"]) {
        expect(html).toContain(body);
      }
    });

    it("refuses a consumer whose context is not one", async () => {
      // React reads through `_context` for the current value, so the key being
      // present is not enough — `_context: null` throws while rendering.
      const forged = defineBlock({
        name: "test/forged-consumer",
        version: 1,
        description: "Builds a consumer with no context behind it.",
        example: { props: {} },
        render: () =>
          createElement(
            {
              $$typeof: Symbol.for("react.consumer"),
              _context: null,
            } as unknown as string,
            null,
            (() => null) as unknown as ReactElement
          ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/forged-consumer"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            forged as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("refuses the pre-19 provider tag this package cannot see", async () => {
      // The package peers React 19 only, where `react.provider` is no longer an
      // element type React renders — so accepting it would admit a value that
      // throws, for the sake of a version that cannot be installed.
      const legacy = defineBlock({
        name: "test/legacy-provider",
        version: 1,
        description: "Builds an element from the pre-19 provider tag.",
        example: { props: {} },
        render: () =>
          createElement(
            { $$typeof: Symbol.for("react.provider") } as unknown as string,
            null,
            "x"
          ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/legacy-provider"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            legacy as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("renders the ordinary use of that same built-in", async () => {
      // Refusing the two cases above must not be paid for by refusing this one.
      const strictOk = defineBlock({
        name: "test/strict-ok",
        version: 1,
        description: "Puts a real element inside StrictMode.",
        example: { props: {} },
        render: () => (
          <StrictMode>
            <span>strict child</span>
          </StrictMode>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/strict-ok"))}
          blocks={createBlockResolver([strictOk as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("strict child");
    });
  });

  describe("attribute safety", () => {
    it("passes through only inert author attributes", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "kept" },
              cssId: "anchor",
              attributes: {
                "data-track": "hero",
                "aria-label": "A section",
                role: "region",
                title: "Tooltip",
                lang: "en",
              },
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).toContain('id="anchor"');
      expect(html).toContain('data-track="hero"');
      expect(html).toContain('aria-label="A section"');
      expect(html).toContain('role="region"');
      expect(html).toContain('title="Tooltip"');
      expect(html).toContain('lang="en"');
    });

    it("refuses attributes that fetch, navigate or inject", async () => {
      // The engine rejects `on*` and leaves this list to the renderer, so an
      // allowlist is the only thing standing between stored content and an
      // attribute with reach.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "kept" },
              attributes: {
                srcDoc: "<script>alert(1)</script>",
                href: "javascript:alert(1)",
                formAction: "https://evil.example",
                src: "https://evil.example/x.png",
                target: "_blank",
                style: "color: red",
              },
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).toContain("kept");
      for (const forbidden of [
        "srcDoc",
        "srcdoc",
        "javascript:alert",
        "formAction",
        "formaction",
        "evil.example",
        "_blank",
      ]) {
        expect(html).not.toContain(forbidden);
      }
    });

    it("refuses a node whose block gives its fields no DOM root", async () => {
      // `cssId` and `attributes` are DOM props, and a fragment root renders no
      // element to put them on — React drops them without throwing, and in
      // production without saying anything. What is lost is an anchor target, a
      // `label for=`, an `#id` selector: navigation and styling that silently
      // stop working on a page that otherwise looks right.
      const fragmentRoot = defineBlock({
        name: "test/fragment-root",
        version: 1,
        description: "Returns a fragment rather than an element.",
        example: { props: {} },
        render: () => (
          <>
            <span>one</span>
            <span>two</span>
          </>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/fragment-root", { cssId: "anchor" }),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            fragmentRoot as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).not.toContain('id="anchor"');
      expect(html).toContain("survivor");
    });

    it("leaves a wrapper root alone when the node asks for nothing", async () => {
      // Only the combination is refused. A block returning a fragment is
      // ordinary and must keep working.
      const fragmentRoot = defineBlock({
        name: "test/fragment-plain",
        version: 1,
        description: "Returns a fragment and is asked for no DOM fields.",
        example: { props: {} },
        render: () => (
          <>
            <span>one</span>
            <span>two</span>
          </>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/fragment-plain"))}
          blocks={createBlockResolver([fragmentRoot as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("one");
      expect(html).toContain("two");
    });

    it("does not let a case variant shadow a modelled field", async () => {
      // HTML attribute names are ASCII case-insensitive, but React treats `ID`
      // and `id` as different props. Lowercasing only to CHECK the allowlist
      // would admit `ID` under its stored spelling, and it would then be
      // written beside the modelled `cssId` — two id attributes on one element,
      // which is the ambiguity `cssId` exists to keep out.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "kept" },
              cssId: "anchor",
              attributes: { ID: "spoofed", TITLE: "shouted" },
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).toContain("kept");
      expect(html).toContain('id="anchor"');
      expect(html).not.toContain("spoofed");
      expect(html.match(/ id="/g)).toHaveLength(1);
      // Lowercasing normalises rather than rejects: an allowed name in an
      // unusual case still arrives, under its canonical spelling.
      expect(html).toContain('title="shouted"');
    });
  });

  describe("documents this renderer cannot read", () => {
    it("refuses a document from a newer formatter", async () => {
      // The envelope itself may mean something different, so reading whatever
      // sits under `nodes` would show content that was never authored that way.
      const html = await renderToHtml(
        <PageRenderer
          document={{
            formatVersion: 2 as unknown as typeof DOCUMENT_FORMAT_VERSION,
            kind: "page",
            nodes: [node("a", "test/text", { props: { value: "guessed" } })],
          }}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["unsupported-format"]);
      expect(html).not.toContain("guessed");
    });

    it("repairs against the caller's limits, not the defaults", async () => {
      // A site that raised its caps validates and compiles against them, so
      // repairing against the default would truncate content that is
      // legitimately there.
      const box = defineBlock({
        name: "test/limit-box",
        version: 1,
        description: "Nests one slot.",
        example: { props: {} },
        slots: { children: {} },
        render: ({ className, renderSlot }) => (
          <div className={className}>{renderSlot("children")}</div>
        ),
      });

      let deep: BlockNode = node("leaf", "test/text", {
        props: { value: "deep leaf" },
      });
      // Past the engine's default depth of 12, but within a raised cap.
      for (let level = 0; level < 20; level++) {
        deep = node(`box-${level}`, "test/limit-box", {
          slots: { children: [deep] },
        });
      }
      const blocks = createBlockResolver([
        box as AnyBlockDefinition,
        text as AnyBlockDefinition,
      ]);

      const withDefaults = await renderToHtml(
        <PageRenderer document={doc(deep)} blocks={blocks} />
      );
      const withRaised = await renderToHtml(
        <PageRenderer
          document={doc(deep)}
          blocks={blocks}
          limits={{ maxDepth: 40, maxNodes: 5000, maxBytes: 2 * 1024 * 1024 }}
        />
      );

      // The same document, truncated under one cap and whole under the other:
      // asserting both is what shows the limit is being honoured rather than
      // that the tree happened to fit.
      expect(withDefaults).not.toContain("deep leaf");
      expect(withRaised).toContain("deep leaf");
    });

    it("drops a node whose version is not a positive integer", async () => {
      // `-1` and `1.5` are numbers. The migrator only upgrades non-negative
      // integers and the version-ahead guard only catches values above the
      // definition, so an impossible version slips between the two.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              version: 1.5,
              props: { value: "fractional" },
            }),
            node("b", "test/text", {
              version: -1,
              props: { value: "negative" },
            }),
            node("c", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).not.toContain("fractional");
      expect(html).not.toContain("negative");
      expect(html).toContain("survivor");
    });
  });

  describe("element shapes React refuses, part 2", () => {
    it("refuses an element type that is a foreign symbol", async () => {
      const foreign = defineBlock({
        name: "test/foreign-symbol",
        version: 1,
        description: "Builds an element from a symbol that is not React's.",
        example: { props: {} },
        render: () =>
          createElement(Symbol("not-react") as unknown as string, null, "x"),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/foreign-symbol"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            foreign as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("refuses a context consumer whose child is not a function", async () => {
      const Theme = createContext("light");
      const consumer = defineBlock({
        name: "test/consumer-child",
        version: 1,
        description: "Gives a consumer an object child.",
        example: { props: {} },
        render: () => (
          <Theme.Consumer>
            {
              { not: "a function" } as unknown as (
                value: string
              ) => ReactElement
            }
          </Theme.Consumer>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/consumer-child"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            consumer as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("still renders a consumer given a proper function child", async () => {
      const Theme = createContext("light");
      const consumer = defineBlock({
        name: "test/consumer-ok",
        version: 1,
        description: "Gives a consumer a function child.",
        example: { props: {} },
        render: () => (
          <Theme.Consumer>{value => <span>{value}</span>}</Theme.Consumer>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/consumer-ok"))}
          blocks={createBlockResolver([consumer as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("light");
    });

    it("refuses an unrenderable Suspense fallback", async () => {
      const bad = defineBlock({
        name: "test/bad-fallback",
        version: 1,
        description: "Gives Suspense an object fallback.",
        example: { props: {} },
        render: () => (
          <Suspense fallback={{ bad: true } as unknown as ReactElement}>
            <span>content</span>
          </Suspense>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/bad-fallback"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            bad as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("marks a refused promise handled so it cannot crash the process", async () => {
      // Refusing to render it does not make it go away. The block already
      // started this promise, and under Node's default
      // `--unhandled-rejections=throw` a rejection nobody listens for takes the
      // server down — which would be worse than the escape the refusal closes.
      let rejectionHandlerAttached = false;
      const watched = {
        then(_onFulfilled: unknown, onRejected: unknown) {
          if (typeof onRejected === "function") rejectionHandlerAttached = true;
        },
      };
      const watchedBlock = defineBlock({
        name: "test/watched-promise",
        version: 1,
        description: "Puts a watched thenable inside its JSX.",
        example: { props: {} },
        render: ({ className }) => (
          <div className={className}>{watched as unknown as ReactElement}</div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/watched-promise"))}
          blocks={createBlockResolver([watchedBlock as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(rejectionHandlerAttached).toBe(true);
    });

    it("refuses a promise buried inside JSX it does not own", async () => {
      const buried = defineBlock({
        name: "test/buried-promise",
        version: 1,
        description: "Puts a rejecting promise inside its JSX.",
        example: { props: {} },
        render: ({ className }) => (
          <div className={className}>
            {Promise.reject(new Error("boom")) as unknown as ReactElement}
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/buried-promise"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            buried as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });
  });

  describe("addressing a stored document cannot survive", () => {
    it("drops a node repeating an id already seen", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("dup", "test/text", { props: { value: "first" } }),
            node("dup", "test/text", { props: { value: "second" } }),
            node("c", "test/text", { props: { value: "third" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).toContain("first");
      expect(html).not.toContain("second");
      expect(html).toContain("third");
    });

    it("repairs a class map that does not cover every node", async () => {
      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/text", { props: { value: "kept" } }))}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{ css: ".nx-stale { color: red }", classes: {} }}
        />
      );

      expect(html).toContain("kept");
      expect(html).not.toContain("nx-stale");
      expect(html).toMatch(bothClasses("test/text"));
    });
  });

  describe("element shapes React refuses", () => {
    it("contains an element whose type React cannot render", async () => {
      // `createElement(props.as)` with `as` stored as a number produces a valid
      // element whose type React refuses from inside its own render.
      const built = defineBlock({
        name: "test/bad-element-type",
        version: 1,
        description: "Builds JSX from a stored element type.",
        example: { props: {} },
        render: () => createElement(42 as unknown as string, null, "x"),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/bad-element-type"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            built as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("contains a host element whose tag name is not one", async () => {
      // React creates a valid element for these and then throws `Invalid tag:`
      // while writing it, after the boundary has returned. A block building a
      // host element from a stored `as` field is how such a name arrives.
      for (const tag of ["bad tag", "1div", "a/b", "-x", "div>"]) {
        const built = defineBlock({
          name: `test/tag-${tag.replace(/[^a-z]/gi, "")}`,
          version: 1,
          description: "Builds a host element from a stored tag name.",
          example: { props: {} },
          render: () => createElement(tag, null, "x"),
        });

        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              node("a", built.name),
              node("b", "test/text", { props: { value: "survivor" } })
            )}
            blocks={createBlockResolver([
              built as AnyBlockDefinition,
              text as AnyBlockDefinition,
            ])}
          />
        );

        expect(placeholderReasons(html), tag).toEqual(["invalid-output"]);
        expect(html, tag).toContain("survivor");
      }
    });

    it("still renders the tag names HTML actually allows", async () => {
      // Custom elements and namespaced tags are ordinary output, so the grammar
      // has to admit them or the guard costs working blocks.
      const tags = defineBlock({
        name: "test/tag-shapes",
        version: 1,
        description: "Uses the less common tag shapes HTML allows.",
        example: { props: {} },
        render: () => (
          <div>
            {createElement("my-el", null, "custom")}
            {createElement("x:y", null, "namespaced")}
            {createElement("a_b", null, "underscored")}
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/tag-shapes"))}
          blocks={createBlockResolver([tags as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      for (const body of ["custom", "namespaced", "underscored"]) {
        expect(html).toContain(body);
      }
    });

    it("refuses a memo whose inner type React cannot render", async () => {
      // The field-presence check is not enough: React unwraps the memo and
      // renders what is inside, so `{ $$typeof: memo, type: 42 }` has the field
      // and still reaches "Element type is invalid".
      const forged = defineBlock({
        name: "test/forged-memo-inner",
        version: 1,
        description: "Builds an element from a memo wrapping a number.",
        example: { props: {} },
        render: () =>
          createElement(
            {
              $$typeof: Symbol.for("react.memo"),
              type: 42,
            } as unknown as string,
            null,
            "x"
          ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/forged-memo-inner"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            forged as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("survives a wrapper that points at itself", async () => {
      // Unwrapping is recursive and a stored object can cite itself, so the
      // walk is bounded. Without the bound this is a stack overflow in the page
      // component, where nothing can contain it.
      const cyclic: { $$typeof: symbol; type?: unknown } = {
        $$typeof: Symbol.for("react.memo"),
      };
      cyclic.type = cyclic;
      const looping = defineBlock({
        name: "test/cyclic-memo",
        version: 1,
        description: "Builds an element from a self-referencing wrapper.",
        example: { props: {} },
        render: () => createElement(cyclic as unknown as string, null, "x"),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/cyclic-memo"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            looping as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
      // Refused by the bound, NOT by a stack overflow the boundary happened to
      // catch — both produce a placeholder, so only the reason separates a
      // working guard from an accident.
      expect(html).not.toContain("failed while being read");
    });

    it("contains an invalid child inside a context provider", async () => {
      // React renders a provider's children itself, but its element type is an
      // object, so the rule that covers Suspense by symbol does not reach it.
      const Theme = createContext("light");
      const provided = defineBlock({
        name: "test/provider-child",
        version: 1,
        description: "Puts a plain object inside a context provider.",
        example: { props: {} },
        render: () => (
          <Theme.Provider value="dark">
            {{ not: "a node" } as unknown as ReactElement}
          </Theme.Provider>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/provider-child"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            provided as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("still accepts a render prop passed to a memo component", async () => {
      // `memo` carries a react.* tag like a provider does but wraps a COMPONENT,
      // so its children are an ordinary prop. Treating every tagged object as
      // owning its children would reject this.
      const List = memo(
        ({ children }: { children: (item: string) => ReactElement }) => (
          <ul>{children("item")}</ul>
        )
      );
      const withMemo = defineBlock({
        name: "test/memo-render-prop",
        version: 1,
        description: "Passes a function as children to a memo component.",
        example: { props: {} },
        render: () => <List>{(item: string) => <li>{item}</li>}</List>,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/memo-render-prop"))}
          blocks={createBlockResolver([withMemo as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("<li>item</li>");
    });

    it("contains a dangerouslySetInnerHTML that is not { __html }", async () => {
      // React requires that exact shape and throws otherwise, while writing the
      // element — after this block's boundary has returned. A block reading a
      // stored HTML string straight into the prop is how the wrong shape gets
      // there.
      const raw = defineBlock({
        name: "test/raw-html-string",
        version: 1,
        description: "Sets inner HTML from a bare string.",
        example: { props: {} },
        render: () =>
          createElement("div", { dangerouslySetInnerHTML: "<b>x</b>" }),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/raw-html-string"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            raw as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("contains children and dangerouslySetInnerHTML on one element", async () => {
      // React refuses to be told an element's contents twice, and it tests the
      // PROP rather than what the prop would render to — `false` fails it as
      // readily as a string does.
      const both = defineBlock({
        name: "test/html-and-children",
        version: 1,
        description: "Sets inner HTML on an element that also has children.",
        example: { props: {} },
        render: () =>
          createElement(
            "div",
            { dangerouslySetInnerHTML: { __html: "<b>x</b>" } },
            "kid"
          ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/html-and-children"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            both as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("contains contents given to a void element", async () => {
      // A void tag has no closing tag and so no contents. React throws rather
      // than dropping them, and it throws while writing the element — a caption
      // read out of stored content into an `<img>` is how it happens.
      const cases: Array<[string, () => ReactElement]> = [
        ["img-children", () => createElement("img", null, "caption")],
        ["br-children", () => createElement("br", null, "x")],
        [
          "input-html",
          () =>
            createElement("input", {
              dangerouslySetInnerHTML: { __html: "x" },
            }),
        ],
      ];

      for (const [label, render] of cases) {
        const block = defineBlock({
          name: `test/void-${label}`,
          version: 1,
          description: "Gives a void element contents.",
          example: { props: {} },
          render,
        });

        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              node("a", `test/void-${label}`),
              node("b", "test/text", { props: { value: "survivor" } })
            )}
            blocks={createBlockResolver([
              block as AnyBlockDefinition,
              text as AnyBlockDefinition,
            ])}
          />
        );

        expect(placeholderReasons(html)).toEqual(["invalid-output"]);
        expect(html).toContain("survivor");
      }
    });

    it("contains a textarea told its contents twice", async () => {
      // `<textarea>` holds its text in a prop. React THROWS for these two, and
      // only these two — a lone child merely warns and renders, so refusing it
      // would take a page React was willing to serve.
      const cases: Array<[string, () => ReactElement]> = [
        [
          "default-and-children",
          () => createElement("textarea", { defaultValue: "x" }, "child"),
        ],
        ["two-children", () => createElement("textarea", null, "a", "b")],
      ];

      for (const [label, render] of cases) {
        const block = defineBlock({
          name: `test/textarea-${label}`,
          version: 1,
          description: "Gives a textarea its contents twice.",
          example: { props: {} },
          render,
        });

        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              node("a", `test/textarea-${label}`),
              node("b", "test/text", { props: { value: "survivor" } })
            )}
            blocks={createBlockResolver([
              block as AnyBlockDefinition,
              text as AnyBlockDefinition,
            ])}
          />
        );

        expect(placeholderReasons(html)).toEqual(["invalid-output"]);
        expect(html).toContain("survivor");
      }
    });

    it("contains a textarea given a value prop and children", async () => {
      // The prop is `value` here rather than `defaultValue`, and React throws
      // for it just the same.
      const both = defineBlock({
        name: "test/textarea-value-children",
        version: 1,
        description: "Gives a textarea a value prop and children.",
        example: { props: {} },
        render: () =>
          createElement("textarea", { value: "x", readOnly: true }, "child"),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/textarea-value-children"),
            node("b", "test/text", { props: { value: "survivor" } })
          )}
          blocks={createBlockResolver([
            both as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(html).toContain("survivor");
    });

    it("still renders the form controls React only warns about", async () => {
      // A mismatched `value` on `<select multiple>` and a lone `<textarea>`
      // child are warnings, not throws — React renders both. Refusing them
      // would be stricter than React, which costs working blocks for nothing.
      const forms = defineBlock({
        name: "test/forms-warned",
        version: 1,
        description: "Uses the form shapes React warns about but renders.",
        example: { props: {} },
        render: () => (
          <div>
            {createElement("select", { multiple: true, defaultValue: "x" })}
            {createElement("textarea", null, "lone child")}
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/forms-warned"))}
          blocks={createBlockResolver([forms as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("lone child");
    });

    it("still renders a void element used correctly", async () => {
      // React skips a null `children` on a void tag exactly as it skips a null
      // `dangerouslySetInnerHTML`, so the guard has to stop where React's does.
      const ok = defineBlock({
        name: "test/void-ok",
        version: 1,
        description: "Uses void elements the way HTML allows.",
        example: { props: {} },
        render: () => (
          <div>
            <img src="/a.png" alt="" />
            {createElement("br", { children: null })}
          </div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/void-ok"))}
          blocks={createBlockResolver([ok as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("/a.png");
      expect(html).toContain("<br/>");
    });

    it("still renders the ordinary uses of dangerouslySetInnerHTML", async () => {
      // React skips the prop entirely when it is absent or null, so neither may
      // be refused here: a guard stricter than React's turns working blocks
      // into placeholders, which is the cost this whole check has to stay
      // under.
      const ordinary = defineBlock({
        name: "test/html-ordinary",
        version: 1,
        description: "Uses inner HTML the way React documents it.",
        example: { props: {} },
        render: () => (
          <>
            <div dangerouslySetInnerHTML={{ __html: "<b>raw</b>" }} />
            <div
              dangerouslySetInnerHTML={null as unknown as { __html: string }}
            >
              plain child
            </div>
          </>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/html-ordinary"))}
          blocks={createBlockResolver([ordinary as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("<b>raw</b>");
      expect(html).toContain("plain child");
    });
  });

  describe("visibility", () => {
    it("withholds a stored stylesheet compiled before the node was gated", async () => {
      // The artifact is compiled at WRITE time from the whole document, and
      // conditions are decided at READ time, so a sheet saved before any gating
      // still carries the gated node's rules — and any URL inside them. The
      // markup being withheld while the assets it referenced are published is
      // the leak, so with nothing to recompile from the sheet is withheld.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "gated body" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            css: ".nx-a { background-image: url(/gated-asset.png) }",
            classes: { a: "nx-a", b: "nx-b" },
          }}
        />
      );

      expect(html).not.toContain("gated body");
      expect(html).not.toContain("gated-asset.png");
      expect(html).not.toContain("<style");
      // The page still renders, and blocks still carry their classes.
      expect(html).toContain("public body");
      expect(html).toContain("nx-b");
    });

    it("keeps a stored stylesheet when the artifact carries the gated rules", async () => {
      // An artifact with `gated` holds the conditioned node's rules SEPARATELY, so the sheet it
      // ships never contained them. There is nothing stale to withhold: the visible nodes keep
      // their styling and the gated node contributes nothing, with no recompile and no compile
      // context needed.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "gated body" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            css: ".nx-b { color: teal }",
            classes: { a: "nx-a", b: "nx-b" },
            gated: { a: ".nx-a { background-image: url(/gated-asset.png) }" },
          }}
        />
      );

      expect(html).not.toContain("gated body");
      // The leak the split exists to stop: the withheld node's asset stays out.
      expect(html).not.toContain("gated-asset.png");
      // ...and, unlike the withholding path above, the sheet SURVIVES.
      expect(html).toContain("color: teal");
      expect(html).toContain("public body");
    });

    it("still withholds when the artifact has no gated map at all", async () => {
      // A missing map means the sheet was compiled before the split existed, not that nothing was
      // gated — the two are indistinguishable from the artifact alone. Reading absence as "nothing
      // gated" would trust a sheet that predates gating entirely.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "gated body" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            css: ".nx-b { color: teal }",
            classes: { a: "nx-a", b: "nx-b" },
          }}
        />
      );

      expect(html).not.toContain("gated body");
      expect(html).not.toContain("color: teal");
      expect(html).toContain("public body");
    });

    it("still withholds when a repair other than gating is also needed", async () => {
      // `gated` answers ONE of the four repair causes. Here two nodes share an id, so the class map
      // is rebuilt — a staleness the per-node split cannot fix — and the sheet must still go.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "gated body" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("dup", "test/text", { props: { value: "first body" } }),
            node("dup", "test/text", { props: { value: "second body" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            css: ".nx-b { color: teal }",
            classes: { a: "nx-a", dup: "nx-dup" },
            gated: { a: ".nx-a { color: rebeccapurple }" },
          }}
        />
      );

      expect(html).not.toContain("gated body");
      expect(html).not.toContain("color: teal");
      expect(html).not.toContain("rebeccapurple");
    });

    it("still withholds when the stored document had a duplicate id the prune hid", async () => {
      // `dup` appears twice and one copy is gated. Pruning removes the gated copy, so the tree that
      // renders has no collision left and nothing after the prune can see there was one — while the
      // stored sheet, compiled when both were present, carries no rules for EITHER, because nodes
      // sharing an id cannot be styled apart. Trusting the artifact here serves the survivor
      // unstyled.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("dup", "test/text", {
              props: { value: "gated twin" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("dup", "test/text", { props: { value: "surviving twin" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            css: ".nx-dup { color: teal }",
            classes: { dup: "nx-dup" },
            gated: { dup: ".nx-dup { color: rebeccapurple }" },
          }}
        />
      );

      expect(html).not.toContain("gated twin");
      expect(html).not.toContain("color: teal");
      expect(html).not.toContain("rebeccapurple");
    });

    it.each([
      ["null", null],
      ["an array", []],
      ["a string", "nope"],
    ])(
      "still withholds when the stored gated map is %s",
      async (_label, malformed) => {
        // A malformed map is not a map. Counting it as coverage skips the repair while the
        // delivery half correctly refuses to read it, so the stale main sheet ships with the
        // hidden node's rules and asset URLs still in it.
        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              node("a", "test/text", {
                props: { value: "gated body" },
                visibility: {
                  conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
                },
              }),
              node("b", "test/text", { props: { value: "public body" } })
            )}
            blocks={createBlockResolver([text as AnyBlockDefinition])}
            styles={{
              css: ".nx-a { background-image: url(/gated-asset.png) }",
              classes: { a: "nx-a", b: "nx-b" },
              gated: malformed as unknown as Record<string, string>,
            }}
          />
        );

        expect(html).not.toContain("gated body");
        expect(html).not.toContain("gated-asset.png");
        expect(html).toContain("public body");
      }
    );

    it("still withholds when the gated map does not cover every pruned node", async () => {
      // A stored artifact can be stale relative to the document it is rendered with: compiled when
      // `a` was unconditional, so `a`'s rules are in `css`, while `b` was already gated and has an
      // entry. If `a` later gains conditions, it is pruned — and a coverage test that only asks
      // whether a map EXISTS sees `b`'s entry, calls gating covered, and serves the stored sheet
      // with `a`'s asset still in it.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "newly gated body" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", {
              props: { value: "long gated body" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("c", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            css: ".nx-a { background-image: url(/stale-asset.png) }",
            classes: { a: "nx-a", b: "nx-b", c: "nx-c" },
            // Covers `b` only. `a` was compiled into `css` before it was gated.
            gated: { b: ".nx-b { color: teal }" },
          }}
        />
      );

      expect(html).not.toContain("newly gated body");
      expect(html).not.toContain("stale-asset.png");
      expect(html).toContain("public body");
    });

    it("still withholds when a covering entry is not a usable rule string", async () => {
      // Coverage that only asks whether the KEY exists certifies a node whose entry the delivery
      // then refuses to read. The repair is skipped and the stale sheet ships with that node's
      // asset in it.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "gated body" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            // `a` is deliberately ABSENT from `classes`: naming it would make the artifact
            // describe a node the document lacks, and the unaccounted-nodes guard would refuse
            // the sheet before the coverage check under test ran.
            css: ".nx-a { background-image: url(/gated-asset.png) }",
            classes: { b: "nx-b" },
            gated: { a: null } as unknown as Record<string, string>,
          }}
        />
      );

      expect(html).not.toContain("gated body");
      expect(html).not.toContain("gated-asset.png");
      expect(html).toContain("public body");
    });

    it("still withholds when pruning removes the last node of a block type", async () => {
      // A block type's defaults are emitted ONCE into the main sheet, shared by every instance, so
      // no per-node entry can account for them. When the last instance of a type is pruned, the
      // stored sheet keeps publishing that type's defaults for a block nobody was served.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/only-hidden", {
              props: { value: "gated body" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([
            text as AnyBlockDefinition,
            onlyHidden as AnyBlockDefinition,
          ])}
          styles={{
            css: ".nx-bt-test--only-hidden { background-image: url(/type-default.png) }",
            classes: { a: "nx-a", b: "nx-b" },
            gated: { a: "" },
          }}
        />
      );

      expect(html).not.toContain("gated body");
      expect(html).not.toContain("type-default.png");
      expect(html).toContain("public body");
    });

    it("keeps the sheet when a gated node's entry is legitimately empty", async () => {
      // A gated node with no node-local rules of its own compiles to `serializeRules([])`, which
      // is `""`. That is the compiler RECORDING the node, not failing to. Reading it as uncovered
      // forces the repair, and on this path — stored artifact, no compile context — the repair
      // clears the whole sheet, so a visible sibling loses its styling because a hidden node
      // happened to carry no rules.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "gated body" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            css: ".nx-b { color: teal }",
            classes: { a: "nx-a", b: "nx-b" },
            gated: { a: "" },
          }}
        />
      );

      expect(html).not.toContain("gated body");
      expect(html).toContain("public body");
      expect(html).toContain("color: teal");
    });

    it("recompiles rather than withholding when it can", async () => {
      // With a compile context present there is no need to lose the styling:
      // the sheet is rebuilt from the pruned document, so the visible nodes keep
      // their rules and the gated one contributes none.
      const styled = defineBlock({
        name: "test/recompiled",
        version: 1,
        description: "A block whose instance carries styles.",
        example: { props: {} },
        render: ({ className }) => <p className={className}>visible body</p>,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/recompiled", {
              styles: { base: { base: { color: "rebeccapurple" } } },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/recompiled", {
              styles: { base: { base: { color: "teal" } } },
            })
          )}
          blocks={createBlockResolver([styled as AnyBlockDefinition])}
          styles={{ css: ".stale { color: red }", classes: {} }}
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
        />
      );

      expect(html).toContain("teal");
      expect(html).not.toContain("rebeccapurple");
      expect(html).not.toContain("stale");
      expect(html).toContain("visible body");
    });

    it("keeps a gated node's styles out of the page too", async () => {
      // The tree is read twice — once for HTML, once for the stylesheet. If only
      // the render is filtered, a gated node's markup is withheld while its
      // scoped CSS still ships, announcing whatever that CSS referenced.
      const styled = defineBlock({
        name: "test/gated-styles",
        version: 1,
        description: "A block whose instance carries styles.",
        example: { props: {} },
        render: ({ className }) => <p className={className}>gated body</p>,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/gated-styles", {
              styles: { base: { base: { color: "rebeccapurple" } } },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([
            styled as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
        />
      );

      expect(html).not.toContain("gated body");
      // The value the gated node carried must not appear in the stylesheet.
      expect(html).not.toContain("rebeccapurple");
      expect(html).toContain("public body");
    });

    it("omits a node gated behind conditions nothing can evaluate", async () => {
      // The format says conditionally hidden nodes are OMITTED from server
      // output, and no evaluator exists yet. Showing everyone what was meant
      // for some of them is the failure that cannot be taken back.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "vip only" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", { props: { value: "everyone" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).not.toContain("vip only");
      expect(html).toContain("everyone");
    });

    it("keeps a node whose conditions list is empty", async () => {
      // An empty envelope is not a gate, and treating it as one would hide
      // content nobody restricted.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "ungated" },
              visibility: { conditions: [] },
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).toContain("ungated");
    });

    it("shows a node whose only condition group is empty", async () => {
      // Storage is OR-of-AND, and an AND of nothing is satisfied. A group left
      // empty by removing its last predicate is not a gate, and treating it as
      // one would drop public content until the array itself was rewritten.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "ungated again" },
              visibility: { conditions: [[]] },
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).toContain("ungated again");
    });

    it("omits a gated node inside a slot too", async () => {
      const box = defineBlock({
        name: "test/gate-box",
        version: 1,
        description: "Renders a slot.",
        example: { props: {} },
        slots: { children: {} },
        render: ({ className, renderSlot }) => (
          <div className={className}>{renderSlot("children")}</div>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/gate-box", {
              slots: {
                children: [
                  node("b", "test/text", {
                    props: { value: "nested vip" },
                    visibility: {
                      conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
                    },
                  }),
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

      expect(html).not.toContain("nested vip");
    });

    it("withholds a node whose visibility envelope cannot be read", async () => {
      // `visibility: "hidden"` answers `undefined` to a property read, and
      // `undefined` means "no gate" — so an unreadable envelope was resolving
      // in favour of showing the node, which is the one direction the
      // fail-closed rule exists to forbid.
      for (const envelope of ["hidden", ["tier"], 1]) {
        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              node("a", "test/text", {
                props: { value: "gated body" },
                visibility: envelope as unknown as BlockNode["visibility"],
              }),
              node("b", "test/text", { props: { value: "public body" } })
            )}
            blocks={createBlockResolver([text as AnyBlockDefinition])}
          />
        );

        expect(html).not.toContain("gated body");
        expect(html).toContain("public body");
      }
    });

    it("shows a node with no visibility field at all", async () => {
      // Absent and null are not restrictions, so failing closed must not reach
      // them: every ordinary node has no envelope.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "no envelope" },
              visibility: null as unknown as BlockNode["visibility"],
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).toContain("no envelope");
    });

    it("does not let a gated node take an address from a visible one", async () => {
      // Addresses are made unique over what will RENDER. A hidden node never
      // reaches the page, so letting it reserve a node id or a DOM id would
      // drop or strip the visible node it collided with — and then prune the
      // node it collided with, leaving content or an anchor missing for no
      // reason at all.
      const gated = {
        conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
      };

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("hero", "test/text", {
              props: { value: "gated body" },
              cssId: "anchor",
              visibility: gated,
            }),
            node("hero", "test/text", {
              props: { value: "public body" },
              cssId: "anchor",
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).not.toContain("gated body");
      expect(html).toContain("public body");
      expect(html).toContain('id="anchor"');
    });

    it("does not trust a stored sheet after any repair, not just gating", async () => {
      // Gating is one of three ways the rendered tree stops matching the tree
      // the sheet was compiled from. Shape repair drops a node whose identity
      // is unreadable, and address repair drops a repeat — and with duplicate
      // node ids the stale rules target the class the SURVIVING node now wears,
      // so the wrong element gets styled and a dropped node's asset URLs still
      // ship.
      const repairs: Array<[string, BlockDocument]> = [
        [
          "shape",
          {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "page",
            nodes: [
              {
                id: "a",
                type: {},
                version: 1,
                props: {},
              } as unknown as BlockNode,
              node("b", "test/text", { props: { value: "survivor" } }),
            ],
          },
        ],
        [
          "address",
          doc(
            node("a", "test/text", { props: { value: "survivor" } }),
            node("a", "test/text", { props: { value: "repeat" } })
          ),
        ],
      ];

      for (const [label, document] of repairs) {
        const html = await renderToHtml(
          <PageRenderer
            document={document}
            blocks={createBlockResolver([text as AnyBlockDefinition])}
            styles={{
              css: ".nx-a { background-image: url(/dropped-asset.png) }",
              classes: { a: "nx-a", b: "nx-b" },
            }}
          />
        );

        expect(html, label).toContain("survivor");
        expect(html, label).not.toContain("dropped-asset.png");
        expect(html, label).not.toContain("<style");
      }
    });

    it("still trusts a stored sheet when nothing needed repairing", async () => {
      // The common case must stay the cheap one: a sound document keeps its
      // stored stylesheet and compiles nothing.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/text", { props: { value: "body" } }))}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{ css: ".nx-a { color: red }", classes: { a: "nx-a" } }}
        />
      );

      expect(html).toContain("<style>.nx-a { color: red }</style>");
      expect(html).toContain("nx-a");
    });

    it("recompiles under the scope the stored artifact was anchored to", async () => {
      // The scope travels on the artifact rather than in the compile context,
      // so a recompile that took only the context would rebuild a scoped page
      // UNSCOPED — and its rules, no longer anchored to this document, would
      // reach any other one rendered beside it.
      const styled = defineBlock({
        name: "test/scoped-base",
        version: 1,
        description: "Declares shared defaults for its type.",
        example: { props: {} },
        baseStyles: { base: { base: { color: "rebeccapurple" } } },
        render: ({ className }) => <p className={className}>public</p>,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "gated" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/scoped-base")
          )}
          blocks={createBlockResolver([
            styled as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          styles={{
            css: ".stale{}",
            classes: { a: "nx-a", b: "nx-b" },
            scope: "nx-doc-a",
          }}
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
        />
      );

      expect(html).not.toContain("gated");
      expect(html).toContain("public");
      // The root must carry the scope, and the rebuilt selectors must be
      // anchored under it — a root without it means every rule matches nothing,
      // and rules without it match everything.
      expect(html).toContain('class="nx-pb-page nx-doc-a"');
      expect(html).toContain("rebeccapurple");
      expect(html).toContain(".nx-doc-a");
    });

    it("recompiles without a stored scope that is not text", async () => {
      // The artifact is a database record, so `scope` can be null or a number,
      // and the compiler dereferences it before any block boundary exists — a
      // malformed one would fail the whole page rather than render it unstyled.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "gated" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            node("b", "test/text", { props: { value: "public" } })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={
            {
              css: ".stale{}",
              classes: { a: "nx-a", b: "nx-b" },
              scope: null,
            } as unknown as { css: string; classes: Record<string, string> }
          }
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("public");
      expect(html).not.toContain("gated");
    });

    it("recompiles against the limits the caller enforces", async () => {
      // The compile has to be held to the same caps as the repair pass that ran
      // just before it. A site that raised `maxDepth` for deeply nested layouts
      // keeps those nodes through repair, and a compile still bounded by the
      // default would emit no rule for the deepest of them — a page whose
      // markup is complete and whose styling silently stops partway down.
      const box = defineBlock({
        name: "test/deep-box",
        version: 1,
        description: "Renders one slot.",
        example: { props: {} },
        slots: { children: {} },
        render: ({ className, renderSlot }) => (
          <div className={className}>{renderSlot("children")}</div>
        ),
      });
      const leaf = defineBlock({
        name: "test/deep-leaf",
        version: 1,
        description: "Declares defaults and sits below the default depth cap.",
        example: { props: {} },
        baseStyles: { base: { base: { color: "rebeccapurple" } } },
        render: ({ className }) => <p className={className}>deep leaf</p>,
      });

      // Depth 13, one below a `maxDepth` the caller raised to hold it: the leaf
      // is the only node of its type, so a rule for it appears only if the
      // compile walked that far.
      let nested = node("n13", "test/deep-leaf");
      for (let depth = 12; depth >= 1; depth--) {
        nested = node(`n${depth}`, "test/deep-box", {
          slots: { children: [nested] },
        });
      }

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("gate", "test/text", {
              props: { value: "gated" },
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
              },
            }),
            nested
          )}
          blocks={createBlockResolver([
            box as AnyBlockDefinition,
            leaf as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          limits={{ ...DEFAULT_LIMITS, maxDepth: 13 }}
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
        />
      );

      expect(html).not.toContain("gated");
      expect(html).toContain("deep leaf");
      expect(html).toContain("rebeccapurple");
    });
  });

  describe("a block that declares it draws nothing", () => {
    it("keeps its rules out of the sheet when the artifact holds them per node", async () => {
      // The point of the whole pass. `a` draws nothing, so every rule compiled
      // for the markup it would have drawn matches no element and ships anyway,
      // carrying whatever it named. An artifact that holds those rules per node
      // lets the reader leave them out without recompiling anything.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/drawless", { props: { draw: false } }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([
            drawless as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          styles={{
            css: ".nx-b { color: teal }",
            classes: { a: "nx-a", b: "nx-b" },
            gated: { a: ".nx-a { background-image: url(/unpainted.png) }" },
          }}
        />
      );

      expect(html).not.toContain("unpainted.png");
      // And the constraint that made this hard: the REST of the sheet survives.
      expect(html).toContain("color: teal");
      expect(html).toContain("public body");
    });

    it("keeps the whole sheet when the artifact predates the split", async () => {
      // The direction that matters more than the drop. An artifact with no entry
      // for `a` was compiled before anything asked whether `a` draws, so its
      // rules are in `css` and cannot be separated out. Treating that as a repair
      // would withhold the sheet, and blanking a page because one image is
      // waiting for its picture is a far larger regression than the unused rules
      // it would save. So the node stays and the sheet ships whole.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/drawless", { props: { draw: false } }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([
            drawless as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          styles={{
            css: ".nx-a { background-image: url(/unpainted.png) } .nx-b { color: teal }",
            classes: { a: "nx-a", b: "nx-b" },
          }}
        />
      );

      expect(html).toContain("color: teal");
      expect(html).toContain("public body");
      // Stated rather than left implied: this is the cost the design accepts.
      expect(html).toContain("unpainted.png");
    });

    it("never emits its rules when the sheet is compiled on this render", async () => {
      // The compiler half, and the reason the renderer drops nothing here. A
      // sheet built on this render holds a drawless node's rules per node rather
      // than in `css`, so they are never emitted instead of emitted and then
      // withheld — which is also what makes the NEXT render able to drop them
      // from the stored artifact.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/drawless", {
              props: { draw: false },
              styles: { base: { base: { color: "rebeccapurple" } } },
            }),
            node("b", "test/text", {
              props: { value: "public body" },
              styles: { base: { base: { color: "teal" } } },
            })
          )}
          blocks={createBlockResolver([
            drawless as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
        />
      );

      expect(html).not.toContain("rebeccapurple");
      expect(html).toContain("teal");
      expect(html).toContain("public body");
    });

    it("leaves a node that does draw completely alone", async () => {
      // The control. Without it every assertion above could pass because the
      // pass removes everything, or because the fixture never declares anything.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/drawless", {
              props: { draw: true },
              styles: { base: { base: { color: "rebeccapurple" } } },
            })
          )}
          blocks={createBlockResolver([drawless as AnyBlockDefinition])}
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
        />
      );

      expect(html).toContain("rebeccapurple");
      expect(html).toContain("drawn");
    });

    it("is not covered by a gated map that never mentions it", async () => {
      // A map being PRESENT is not coverage. This artifact gates something else
      // entirely, so it was compiled while `a` was still being served and `a`'s
      // rules are in `css` where nothing can separate them out.
      //
      // Read through what happens to the node rather than to those rules, because
      // they ship either way — the artifact carries them and this pass does not
      // rewrite `css`. Wrongly counted as covered, `a` would leave the document
      // and the artifact's class map would look complete without it; correctly
      // refused, `a` stays, the map is missing its class, and the whole sheet is
      // rebuilt rather than trusted.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/drawless", { props: { draw: false } }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([
            drawless as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          styles={{
            css: ".nx-b { color: teal }",
            classes: { b: "nx-b" },
            gated: { z: ".nx-z { color: red }" },
          }}
        />
      );

      expect(html).not.toContain("color: teal");
      expect(html).toContain("public body");
    });

    it("still repairs when it is ALSO a known placeholder", async () => {
      // The two passes can reject the SAME node. `a` has `migrationFailed`, so it
      // draws a placeholder, and its stored props also make its block declare it
      // draws nothing — so the drawless drop removes it first and the placeholder
      // pass finds nothing left to do.
      //
      // The artifact covers the node's own rules, which is what makes the drop
      // honest. What it cannot cover is the rest of what a placeholder means for
      // the sheet, and that answer must not turn on which pass reached the node
      // first: `c`'s rules are in the stored `css` under a class the map never
      // mentioned, and only a recompile can drop them.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/drawless", {
              props: { draw: false },
              migrationFailed: true,
            }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([
            drawless as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          styles={{
            css: ".nx-a { background-image: url(/unpainted.png) } .nx-b { color: teal }",
            classes: { b: "nx-b" },
            gated: { a: ".nx-a { background-image: url(/gated-a.png) }" },
          }}
        />
      );

      expect(html).not.toContain("unpainted.png");
      expect(html).not.toContain("gated-a.png");
      expect(html).toContain("public body");
    });

    it("still repairs when a placeholder is removed in the same render", async () => {
      // Each prune is compared against its OWN input rather than folded into one
      // identity test, so a drop the artifact covers cannot excuse one it does
      // not. `a` is covered; `c` resolves to a placeholder, which only a
      // recompile can account for.
      //
      // The artifact names no class for `c` while its `css` still carries `c`'s
      // rules — a stale record, which is what a stored artifact can always be.
      // Nothing downstream catches that: the unaccounted-nodes check reads the
      // CLASS MAP, and a node the map never mentioned is not unaccounted for.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/drawless", { props: { draw: false } }),
            node("b", "test/text", { props: { value: "public body" } }),
            node("c", "test/unregistered")
          )}
          blocks={createBlockResolver([
            drawless as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          styles={{
            css: ".nx-c { background-image: url(/placeholder-asset.png) } .nx-b { color: teal }",
            classes: { a: "nx-a", b: "nx-b" },
            gated: { a: ".nx-a { background-image: url(/unpainted.png) }" },
          }}
        />
      );

      expect(html).not.toContain("placeholder-asset.png");
      expect(html).not.toContain("unpainted.png");
      // The page still renders; only its stale sheet is withheld.
      expect(html).toContain("public body");
    });
  });

  describe("a consumer assembling styles by hand", () => {
    /**
     * A hand-written artifact carrying the stamp a real compile would give it.
     *
     * These cases are about gated rules, not about staleness — they need the
     * artifact REUSED so the appending is observable. An unstamped one is
     * refused as stale, correctly, so the base comes from an actual compile and
     * only the hand-written parts are laid over it.
     */
    const assembled = (
      document: BlockDocument,
      context: StyleCompileContext,
      resolver: ReturnType<typeof createBlockResolver>,
      parts: Partial<PageStyles>
    ): PageStyles => ({
      ...resolvePageStyles(document, undefined, context, resolver),
      ...parts,
    });
    it("does not get a drawless node's rules appended back", async () => {
      // The documented direct flow is `prepareDocumentForRead` then
      // `resolvePageStyles`, and it has no pass that removes a node whose block
      // declares it draws nothing — the prepared tree keeps it, correctly, so it
      // can still be rendered. Appending its gated entry here would put back
      // exactly what holding those rules per node was for, and a consumer
      // following the documented flow could not prevent it.
      const artifact = resolvePageStyles(
        doc(
          node("a", "test/drawless", { props: { draw: false } }),
          node("b", "test/text", { props: { value: "x" } })
        ),
        {
          css: ".nx-b { color: teal }",
          classes: { a: "nx-a", b: "nx-b" },
          gated: { a: ".nx-a { background-image: url(/unpainted.png) }" },
        },
        undefined,
        createBlockResolver([
          drawless as AnyBlockDefinition,
          text as AnyBlockDefinition,
        ])
      );

      expect(artifact.css).not.toContain("unpainted.png");
      expect(artifact.css).toContain("color: teal");
    });

    it("withholds a drawless container's slot children too", async () => {
      // A block that draws nothing places NONE of its slot children, so the
      // compiler holds the whole subtree back — and each of those descendants
      // answers "I draw" about itself. Skipping only the container would append
      // every child's rules under a parent that never rendered.
      const artifact = resolvePageStyles(
        doc(
          node("a", "test/drawless", {
            props: { draw: false },
            slots: {
              children: [node("child", "test/text", { props: { value: "x" } })],
            },
          }),
          node("b", "test/text", { props: { value: "y" } })
        ),
        {
          css: ".nx-b { color: teal }",
          classes: { a: "nx-a", child: "nx-child", b: "nx-b" },
          gated: {
            a: ".nx-a { background-image: url(/unpainted.png) }",
            child: ".nx-child { background-image: url(/child-asset.png) }",
          },
        },
        undefined,
        createBlockResolver([
          drawless as AnyBlockDefinition,
          text as AnyBlockDefinition,
        ])
      );

      expect(artifact.css).not.toContain("unpainted.png");
      expect(artifact.css).not.toContain("child-asset.png");
      expect(artifact.css).toContain("color: teal");
    });

    it("keeps the children of a container that DOES draw", async () => {
      // The control for the case above: pruning a subtree is only right when the
      // container is the one that drew nothing.
      const artifact = resolvePageStyles(
        doc(
          node("a", "test/drawless", {
            props: { draw: true },
            slots: {
              children: [node("child", "test/text", { props: { value: "x" } })],
            },
          })
        ),
        {
          css: "",
          classes: { a: "nx-a", child: "nx-child" },
          gated: {
            child: ".nx-child { background-image: url(/child-asset.png) }",
          },
        },
        undefined,
        createBlockResolver([
          drawless as AnyBlockDefinition,
          text as AnyBlockDefinition,
        ])
      );

      expect(artifact.css).toContain("child-asset.png");
    });

    it("ignores a caller's predicate when reading a stored artifact", async () => {
      // The block's declaration is the only source. `BlockBoundary` asks it for
      // what to draw, so a caller answering differently here could only publish
      // rules for markup that never appears — this node DOES draw, and gets its
      // rules however the caller answers.
      const document = doc(
        node("a", "test/drawless", { props: { draw: true } }),
        node("b", "test/text", { props: { value: "y" } })
      );
      const styleContext = {
        breakpoints: { viewport: [], container: [] },
        drawsNothing: (candidate: BlockNode) => candidate.id === "a",
      };
      const resolver = createBlockResolver([
        drawless as AnyBlockDefinition,
        text as AnyBlockDefinition,
      ]);
      const artifact = resolvePageStyles(
        document,
        assembled(document, styleContext, resolver, {
          css: ".nx-b { color: teal }",
          classes: { a: "nx-a", b: "nx-b" },
          gated: { a: ".nx-a { background-image: url(/host-gated.png) }" },
        }),
        styleContext,
        resolver
      );

      expect(artifact.css).toContain("host-gated.png");
    });

    it("keeps the page when a block's declaration throws", async () => {
      // Style resolution runs with no block boundary above it, so a throw must
      // cost the node's exemption rather than the page.
      const document = doc(
        node("a", "test/drawless-throws", { props: { value: "x" } })
      );
      const styleContext = { breakpoints: { viewport: [], container: [] } };
      const resolver = createBlockResolver([
        drawlessThrows as AnyBlockDefinition,
      ]);
      const artifact = resolvePageStyles(
        document,
        assembled(document, styleContext, resolver, {
          css: ".nx-a { color: teal }",
          classes: { a: "nx-a" },
          gated: { a: ".nx-a { background-image: url(/host-gated.png) }" },
        }),
        styleContext,
        resolver
      );

      // Answered "draws", so the node keeps its styling rather than losing it.
      expect(artifact.css).toContain("host-gated.png");
    });

    it("contains a rejection from a block's async declaration", async () => {
      // A mistakenly `async rendersNothing` returns a promise, so the call
      // itself never throws and the comparison against `true` is simply false.
      // The REJECTION is the hazard: Node reports it as unhandled and can end
      // the process, during style resolution, outside any block boundary.
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const document = doc(
          node("a", "test/drawless-rejects", { props: { value: "x" } })
        );
        const styleContext = { breakpoints: { viewport: [], container: [] } };
        const resolver = createBlockResolver([
          drawlessRejects as AnyBlockDefinition,
        ]);
        const artifact = resolvePageStyles(
          document,
          assembled(document, styleContext, resolver, {
            css: ".nx-a { color: teal }",
            classes: { a: "nx-a" },
            gated: { a: ".nx-a { background-image: url(/host-gated.png) }" },
          }),
          styleContext,
          resolver
        );

        // Answered "draws", so the node keeps its styling.
        expect(artifact.css).toContain("host-gated.png");
        // A rejection surfaces on a later turn, so this has to wait for one;
        // asserting synchronously would pass whether or not it was contained.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });

    it("drops a drawless node's rules however the caller answers", async () => {
      // A caller answering `false` for a node its block declares drawless cannot
      // keep that node's rules, because it cannot keep its markup: the boundary
      // renders what the declaration says. Honouring the caller here would ship
      // rules selecting nothing.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/drawless", { props: { draw: false } }),
            node("b", "test/text", { props: { value: "public body" } })
          )}
          blocks={createBlockResolver([
            drawless as AnyBlockDefinition,
            text as AnyBlockDefinition,
          ])}
          styles={{
            css: ".nx-b { color: teal }",
            classes: { a: "nx-a", b: "nx-b" },
            gated: { a: ".nx-a { background-image: url(/kept.png) }" },
          }}
          styleContext={{
            breakpoints: { viewport: [], container: [] },
            drawsNothing: () => false,
          }}
        />
      );

      expect(html).not.toContain("kept.png");
      // The control: the rest of the page is unaffected.
      expect(html).toContain("public body");
    });

    it("still gets the rules of a node that DOES draw", async () => {
      // The control. Without it the assertion above would pass on a resolver
      // that appends nothing at all, which would leave every gated node on every
      // page unstyled.
      const artifact = resolvePageStyles(
        doc(
          node("a", "test/drawless", { props: { draw: true } }),
          node("b", "test/text", { props: { value: "x" } })
        ),
        {
          css: ".nx-b { color: teal }",
          classes: { a: "nx-a", b: "nx-b" },
          gated: { a: ".nx-a { background-image: url(/painted.png) }" },
        },
        undefined,
        createBlockResolver([
          drawless as AnyBlockDefinition,
          text as AnyBlockDefinition,
        ])
      );

      expect(artifact.css).toContain("painted.png");
      expect(artifact.css).toContain("color: teal");
    });
  });

  describe("a write path that compiles its own artifact", () => {
    it("gets the drawless split without asking for it", async () => {
      // `resolvePageStyles` is exported, and a write path uses it directly to
      // produce the artifact it stores. A predicate injected only by the
      // renderer would mean every sheet written that way keeps its drawless
      // nodes' rules in `css` and carries no entry for them — so republishing
      // would never enable the drop this change describes.
      const artifact = resolvePageStyles(
        doc(
          node("a", "test/drawless", {
            props: { draw: false },
            styles: { base: { base: { color: "rebeccapurple" } } },
          }),
          node("b", "test/text", {
            props: { value: "x" },
            styles: { base: { base: { color: "teal" } } },
          })
        ),
        undefined,
        { breakpoints: { viewport: [], container: [] } },
        createBlockResolver([
          drawless as AnyBlockDefinition,
          text as AnyBlockDefinition,
        ])
      );

      expect(artifact.css).not.toContain("rebeccapurple");
      expect(artifact.gated?.a).toContain("rebeccapurple");
      // The control: the node that DOES draw keeps its rules in the main sheet.
      expect(artifact.css).toContain("teal");
    });

    it("compiles from the declaration, not from a caller's answer", async () => {
      // The context field is how this layer states its derived answer to the
      // compiler, not a way to be told one. A caller's value is replaced, so a
      // sheet written through this entry gates exactly the nodes the renderer
      // will decline to draw.
      const artifact = resolvePageStyles(
        doc(
          node("a", "test/drawless", {
            props: { draw: false },
            styles: { base: { base: { color: "rebeccapurple" } } },
          })
        ),
        undefined,
        {
          breakpoints: { viewport: [], container: [] },
          drawsNothing: () => false,
        },
        createBlockResolver([drawless as AnyBlockDefinition])
      );

      expect(artifact.css).not.toContain("rebeccapurple");
      expect(artifact.gated?.a).toContain("rebeccapurple");
    });
  });

  describe("containment (continued)", () => {
    it("shows a placeholder where `process` does not exist", async () => {
      // This renderer is meant to run anywhere React does, and an Edge or
      // Worker runtime need not define `process`. A bare `process.env` read
      // would throw on the one path that exists to CONTAIN a failure, turning a
      // contained block error into a page-level crash.
      vi.stubGlobal("process", undefined);
      try {
        const html = await renderToHtml(
          <PageRenderer
            document={doc(
              node("a", "test/missing"),
              node("b", "test/text", { props: { value: "survivor" } })
            )}
            blocks={createBlockResolver([text as AnyBlockDefinition])}
          />
        );

        expect(placeholderReasons(html)).toEqual(["unknown-block"]);
        expect(html).toContain("survivor");
      } finally {
        vi.unstubAllGlobals();
      }
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

  describe("host policy", () => {
    const container = defineBlock({
      name: "test/policy-box",
      version: 1,
      description: "Renders one slot.",
      example: { props: {} },
      slots: { children: {} },
      render: ({ className, renderSlot }) => (
        <div className={className}>{renderSlot("children")}</div>
      ),
    });

    const reader = defineBlock({
      name: "test/policy-reader",
      version: 1,
      description: "Reports what policy reached it.",
      example: { props: {} },
      render: ({ hostPolicy }) => (
        <p>{(hostPolicy?.trustedFrameOrigins ?? []).join(",") || "none"}</p>
      ),
    });

    const blocks = createBlockResolver([
      container as AnyBlockDefinition,
      reader as AnyBlockDefinition,
    ]);

    it("reaches a block nested inside a slot", async () => {
      // The prop is the seam that matters. A policy that only reached top-level
      // blocks would be one a nested block silently rendered without, which is
      // the failure a security default exists to prevent.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/policy-box", {
              slots: { children: [node("b", "test/policy-reader")] },
            })
          )}
          blocks={blocks}
          hostPolicy={{ trustedFrameOrigins: ["https://player.example.com"] }}
        />
      );

      expect(html).toContain("https://player.example.com");
    });

    it("gives a block no policy when the host configured none", async () => {
      // Absent must read as absent rather than as anything permissive.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/policy-reader"))}
          blocks={blocks}
        />
      );

      expect(html).toContain("none");
    });

    it("leaves the host's own context object untouched", async () => {
      // The policy travels beside the context, never on it. Copying a host's
      // context to add a field cannot be done faithfully: a spread drops the
      // prototype methods of a class-based context, and even a
      // prototype-preserving clone fails a method that reads a private field,
      // because the clone is not branded with it.
      const supplied = createStandaloneContext();
      const before = Object.keys(supplied).sort();

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/policy-reader"))}
          blocks={blocks}
          context={supplied}
          hostPolicy={{ trustedFrameOrigins: ["https://current.example"] }}
        />
      );

      expect(html).toContain("https://current.example");
      expect(Object.keys(supplied).sort()).toEqual(before);
      expect("hostPolicy" in supplied).toBe(false);
    });

    it("reaches a slot whose container replaced the context", async () => {
      // A repeater replaces the context to set `item` per iteration. The policy
      // is the HOST's, not the block's, so it has to survive that replacement —
      // otherwise an allowlisted embed loses its grant for being nested.
      const replacing = defineBlock({
        name: "test/policy-replacer",
        version: 1,
        description: "Renders its slot under a context of its own making.",
        example: { props: {} },
        slots: { children: {} },
        // BUILT, not spread. A container that spreads the context it was given
        // carries the policy along by accident, so a fixture written that way
        // passes whether or not the renderer reapplies anything. This is the
        // shape that actually loses it.
        render: ({ ctx, renderSlot }) =>
          renderSlot("children", {
            entry: ctx.entry,
            item: { id: "1" },
            resolveMedia: ctx.resolveMedia,
            resolveEntryPath: ctx.resolveEntryPath,
          }) as ReactElement,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/policy-replacer", {
              slots: { children: [node("b", "test/policy-reader")] },
            })
          )}
          blocks={createBlockResolver([
            replacing as AnyBlockDefinition,
            reader as AnyBlockDefinition,
          ])}
          hostPolicy={{ trustedFrameOrigins: ["https://player.example.com"] }}
        />
      );

      expect(html).toContain("https://player.example.com");
    });

    it("does not let a block grant itself a policy through a slot", async () => {
      // The other direction, and the one that matters more. A block hands
      // `renderSlot` a context it built, so a block able to leave a `hostPolicy`
      // on it would be issuing itself permissions the site operator declined.
      const forging = defineBlock({
        name: "test/policy-forger",
        version: 1,
        description: "Tries to widen the policy for its children.",
        example: { props: {} },
        slots: { children: {} },
        render: ({ ctx, renderSlot }) =>
          renderSlot("children", {
            ...ctx,
            // Not a field a context has, so this is the closest a block can get
            // to fabricating one. It must reach the child as nothing.
            ...{
              hostPolicy: { trustedFrameOrigins: ["https://attacker.example"] },
            },
          } as PageContext) as ReactElement,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/policy-forger", {
              slots: { children: [node("b", "test/policy-reader")] },
            })
          )}
          blocks={createBlockResolver([
            forging as AnyBlockDefinition,
            reader as AnyBlockDefinition,
          ])}
        />
      );

      expect(html).not.toContain("attacker.example");
      expect(html).toContain("none");
    });

    it("keeps a host's prototype methods when applying the policy", async () => {
      // A host may implement the context with a class, where `resolveMedia` and
      // `resolveEntryPath` live on the prototype. A spread copies only own
      // enumerable properties, so it would drop them — and only for hosts that
      // supplied a policy, which is the worst way to find out.
      // The private field is the point. A prototype-preserving clone keeps
      // method LOOKUP working, so a class without one would pass even against a
      // clone; a method reading `#paths` throws on any object not branded with
      // it, which is what proves the host's own instance is the receiver.
      class HostContext implements PageContext {
        entry = null;
        #paths = new Map([["posts:1", "/resolved"]]);
        resolveMedia(): Promise<null> {
          return Promise.resolve(null);
        }
        resolveEntryPath(collection: string, id: string): Promise<string> {
          return Promise.resolve(this.#paths.get(`${collection}:${id}`) ?? "");
        }
      }

      const caller = defineBlock({
        name: "test/policy-resolver-caller",
        version: 1,
        description: "Calls a context method that lives on the prototype.",
        example: { props: {} },
        render: async ({ ctx }) => (
          <p>{await ctx.resolveEntryPath("posts", "1")}</p>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/policy-resolver-caller"))}
          blocks={createBlockResolver([caller as AnyBlockDefinition])}
          context={new HostContext()}
          hostPolicy={{ trustedFrameOrigins: ["https://player.example.com"] }}
        />
      );

      // The method still resolved, rather than the block being replaced by a
      // render-error placeholder for calling something the copy no longer had.
      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("/resolved");
    });

    it("keeps a class-based context usable with no policy at all", async () => {
      // The control for the case above: the class path has to work whether or
      // not a policy is supplied, since the original defect appeared ONLY when
      // one was, which is the worst way for a host to discover it.
      class HostContext implements PageContext {
        entry = null;
        resolveMedia(): Promise<null> {
          return Promise.resolve(null);
        }
        resolveEntryPath(): Promise<string> {
          return Promise.resolve("/resolved");
        }
      }

      const caller = defineBlock({
        name: "test/policy-absent-caller",
        version: 1,
        description: "Calls a prototype method with no policy configured.",
        example: { props: {} },
        render: async ({ ctx }) => (
          <p>{await ctx.resolveEntryPath("posts", "1")}</p>
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/policy-absent-caller"))}
          blocks={createBlockResolver([caller as AnyBlockDefinition])}
          context={new HostContext()}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("/resolved");
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

    it("compiles a block's base styles without being told them twice", async () => {
      // The compiler emits one rule per block TYPE and takes those defaults
      // from its context. The renderer already holds the resolver whose
      // definitions it will render, so requiring the caller to mirror
      // `baseStyles` into `styleContext` is a coupling that fails silently: the
      // block-type class is still written and the sheet simply has no rule for
      // it.
      const styled = defineBlock({
        name: "test/with-base",
        version: 1,
        description: "Declares shared defaults for its type.",
        example: { props: {} },
        baseStyles: { base: { base: { color: "rebeccapurple" } } },
        render: ({ className }) => <p className={className}>styled</p>,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/with-base"))}
          blocks={createBlockResolver([styled as AnyBlockDefinition])}
          styleContext={{ breakpoints: { viewport: [], container: [] } }}
        />
      );

      expect(html).toContain("rebeccapurple");
      expect(html).toContain(blockTypeClassName("test/with-base"));
    });

    it("lets a caller's own blockBases win", async () => {
      // An explicit choice outranks anything derived here.
      const styled = defineBlock({
        name: "test/with-base-2",
        version: 1,
        description: "Declares defaults the caller overrides.",
        example: { props: {} },
        baseStyles: { base: { base: { color: "rebeccapurple" } } },
        render: ({ className }) => <p className={className}>styled</p>,
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/with-base-2"))}
          blocks={createBlockResolver([styled as AnyBlockDefinition])}
          styleContext={{
            breakpoints: { viewport: [], container: [] },
            blockBases: {
              "test/with-base-2": { base: { base: { color: "teal" } } },
            },
          }}
        />
      );

      expect(html).toContain("teal");
      expect(html).not.toContain("rebeccapurple");
    });

    it("renders unstyled rather than not at all when the artifact is broken", async () => {
      // The artifact is a database record and can predate the current shape.
      // The class lookup runs while assembling a block's arguments, before the
      // try/catch around its render, so a missing map would throw in the page
      // component where no block boundary can contain it.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/text", { props: { value: "kept" } }))}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={
            { css: ".x{}", classes: undefined } as unknown as {
              css: string;
              classes: Record<string, string>;
            }
          }
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("kept");
      // A sheet written against classes nobody carries would match nothing, so
      // it goes with them.
      expect(html).not.toContain("<style");
      expect(html).toMatch(bothClasses("test/text"));
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

    it("renders a node whose stored flag is not the boolean true", async () => {
      // The flag is written by the migrator, but what comes back is whatever
      // the database holds, and both `"false"` and `{}` are truthy. Reading it
      // loosely takes down public content that never failed a migration —
      // silently, since the placeholder says only that migration failed.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "never failed" },
              migrationFailed: "false" as unknown as boolean,
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual([]);
      expect(html).toContain("never failed");
    });

    it("still replaces a node carrying the flag itself", async () => {
      // The strictness above must not cost the case the flag exists for.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "stale props" },
              migrationFailed: true,
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["migration-failed"]);
      expect(html).not.toContain("stale props");
    });
  });

  describe("hostile stored input", () => {
    it("refuses a document envelope that is not an object", async () => {
      // The envelope is database input too, and it is read before any of the
      // repair passes. `null` throws on the first property access, inside the
      // page component, where no block boundary exists to contain it.
      for (const stored of [null, undefined, 42, "a page", []]) {
        const html = await renderToHtml(
          <PageRenderer
            document={stored as unknown as BlockDocument}
            blocks={createBlockResolver([text as AnyBlockDefinition])}
          />
        );

        expect(placeholderReasons(html)).toEqual(["unsupported-format"]);
      }
    });

    it("renders the last string case-variant of an attribute id", async () => {
      // The render path lowercases each attribute name into one bag, so the
      // LAST string case-variant is what reaches the DOM. Worth pinning on its
      // own: it decides which id an anchor resolves against.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", {
              props: { value: "first" },
              attributes: { id: "old", ID: "hero" },
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(html).toContain('id="hero"');
      expect(html).not.toContain('id="old"');
    });

    it("does not let a version-ahead node reserve a DOM id", async () => {
      // A node stored ahead of its definition renders a placeholder, which
      // emits no modelled id — so reserving one would strip the anchor off a
      // healthy node for nothing.
      const html = await renderToHtml(
        <PageRenderer
          document={doc(
            node("a", "test/text", { version: 9, cssId: "hero" }),
            node("b", "test/text", {
              props: { value: "healthy" },
              cssId: "hero",
            })
          )}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["version-ahead"]);
      expect(html).toContain('id="hero"');
      expect(html).toContain("healthy");
    });

    it("refuses inner HTML React cannot convert to a string", async () => {
      // React stringifies `__html` while serializing, after this boundary has
      // returned, so a value that cannot be coerced throws uncontained.
      const hostile = defineBlock({
        name: "test/hostile-html",
        version: 1,
        description: "Returns an uncoercible __html value.",
        example: { props: {} },
        defaultProps: {},
        render: () => (
          <div
            dangerouslySetInnerHTML={
              { __html: { toString: null, valueOf: null } } as unknown as {
                __html: string;
              }
            }
          />
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/hostile-html"))}
          blocks={createBlockResolver([hostile as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
    });

    it("refuses a lazy wrapper that only impersonates the shape", async () => {
      // What a lazy resolves to cannot be checked without calling `_init`, but
      // React's own `lazy()` always sets `_payload` — so an object missing it is
      // an impersonation, and one that resolves to a non-component throws
      // "Element type is invalid" from inside React's render.
      const forged = defineBlock({
        name: "test/forged-lazy",
        version: 1,
        description: "Returns an object impersonating React.lazy.",
        example: { props: {} },
        defaultProps: {},
        render: () =>
          createElement({
            $$typeof: Symbol.for("react.lazy"),
            _init: () => 42,
          } as unknown as Parameters<typeof createElement>[0]),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/forged-lazy"))}
          blocks={createBlockResolver([forged as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
    });

    it("marks a rejecting child of an element refused for its own shape", async () => {
      // The element is judged by its own shape BEFORE its children are looked
      // at, so refusing it returns before anything descends. A promise the
      // block already started would be left with no handler, and Node's default
      // `--unhandled-rejections=throw` turns that into a process exit: worse
      // than the escape the refusal closed.
      let handlerAttached = false;
      const rejecting: PromiseLike<never> = {
        then(_resolve, reject) {
          if (typeof reject === "function") handlerAttached = true;
          return rejecting as never;
        },
      };

      const voidWithPromise = defineBlock({
        name: "test/void-with-promise",
        version: 1,
        description: "Puts a rejecting promise inside a void element.",
        example: { props: {} },
        defaultProps: {},
        // `<br>` is a void element and cannot have contents, so the element is
        // refused for its own shape and its child is never inspected.
        render: () => createElement("br", null, rejecting as unknown as string),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/void-with-promise"))}
          blocks={createBlockResolver([voidWithPromise as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
      expect(handlerAttached).toBe(true);
    });

    it("refuses inner HTML whose Symbol.toPrimitive is not callable", async () => {
      // Coercion consults `Symbol.toPrimitive` BEFORE `toString`/`valueOf`, so
      // an object carrying a non-callable one throws even though both of the
      // others are inherited and callable.
      const hostile = defineBlock({
        name: "test/bad-to-primitive",
        version: 1,
        description: "Returns __html with a non-callable Symbol.toPrimitive.",
        example: { props: {} },
        defaultProps: {},
        render: () => (
          <div
            dangerouslySetInnerHTML={
              { __html: { [Symbol.toPrimitive]: 1 } } as unknown as {
                __html: string;
              }
            }
          />
        ),
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/bad-to-primitive"))}
          blocks={createBlockResolver([hostile as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
    });

    it("abandons an endless child rather than sweeping it forever", async () => {
      // The refusal sweep marks promises inside a subtree nothing will render.
      // Its budget makes each recursive call return, but the loop that FEEDS it
      // must stop pulling too, or an endless generator child spins here instead
      // of being abandoned.
      const endless = defineBlock({
        name: "test/endless-child",
        version: 1,
        description: "Puts an endless generator inside a void element.",
        example: { props: {} },
        defaultProps: {},
        render: () => {
          function* forever(): Generator<string> {
            while (true) yield "x";
          }
          // `<br>` is void, so the element is refused for its own shape and the
          // sweep is what walks this child.
          return createElement("br", null, forever() as unknown as string);
        },
      });

      const html = await renderToHtml(
        <PageRenderer
          document={doc(node("a", "test/endless-child"))}
          blocks={createBlockResolver([endless as AnyBlockDefinition])}
        />
      );

      expect(placeholderReasons(html)).toEqual(["invalid-output"]);
    });

    it("recompiles without the placeholder node's own rules", async () => {
      // Withholding the sheet is the fallback when there is nothing to
      // recompile from. With a compile context present the sheet IS rebuilt,
      // and rebuilding from a tree that still held the node would emit its
      // rules again — so the style input is a tree with it removed, while the
      // render keeps it to draw the placeholder.
      //
      // Both nodes carry styles, so the assertion can tell "the placeholder's
      // rules are gone" from "no rules were compiled at all".
      const ahead = doc(
        node("a", "test/text", {
          version: 9,
          props: { value: "ahead" },
          styles: { base: { base: { color: "#ff0000" } } },
        }),
        node("b", "test/text", {
          props: { value: "healthy" },
          styles: { base: { base: { color: "#00ff00" } } },
        })
      );

      const html = await renderToHtml(
        <PageRenderer
          document={ahead}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styleContext={{
            breakpoints: { viewport: [], container: [] },
            limits: DEFAULT_LIMITS,
          }}
        />
      );

      expect(placeholderReasons(html)).toEqual(["version-ahead"]);
      // The healthy node keeps its rule; the placeholder's is gone. Asserting
      // both is what separates the prune from a sheet that failed to compile.
      expect(html).toContain("#00ff00");
      expect(html).not.toContain("#ff0000");
    });

    it("recompiles a real breakpoint's rules without the placeholder's", async () => {
      // Every other `styleContext` fixture declares empty breakpoint lists, so
      // the recompile-after-prune path had never run with a breakpoint at all:
      // a responsive rule belonging to a pruned node could have shipped inside
      // its media query and no test would have looked there.
      const ahead = doc(
        node("a", "test/text", {
          version: 9,
          props: { value: "ahead" },
          styles: { base: { narrow: { color: "#ff0000" } } },
        }),
        node("b", "test/text", {
          props: { value: "healthy" },
          styles: { base: { narrow: { color: "#00ff00" } } },
        })
      );

      const html = await renderToHtml(
        <PageRenderer
          document={ahead}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styleContext={{
            breakpoints: {
              viewport: [{ id: "narrow", label: "Narrow", maxWidth: 600 }],
              container: [],
            },
            limits: DEFAULT_LIMITS,
          }}
        />
      );

      // The breakpoint really compiled, so the assertions below are about the
      // prune rather than about a query that was never emitted.
      expect(html).toContain("max-width: 600px");
      expect(html).toContain("#00ff00");
      expect(html).not.toContain("#ff0000");
    });

    it("does not trust a stored stylesheet when a node becomes a placeholder", async () => {
      // A knowable placeholder emits only a hidden marker, so a sheet compiled
      // for the markup it WOULD have rendered ships rules for content that is
      // not on the page. Identity alone misses it: the node is skipped by the
      // address predicate, so with nothing else to repair the tree comes back
      // unchanged and the stale sheet would be trusted.
      const ahead = doc(
        node("a", "test/text", { version: 9, props: { value: "ahead" } })
      );
      // The map has to cover every node id or the stored sheet is discarded for
      // an unrelated reason, and the assertion below would hold either way.
      const stored = {
        css: ".nx-stale{color:red}",
        classes: Object.fromEntries(nodeClassNames(["a"])),
      };
      // The fixture is only meaningful if this sheet WOULD otherwise be
      // trusted, so pin that: a healthy document ships it.
      const healthyDoc = doc(
        node("a", "test/text", { props: { value: "fine" } })
      );
      const healthy = await renderToHtml(
        <PageRenderer
          document={healthyDoc}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={{
            css: ".nx-stale{color:red}",
            classes: Object.fromEntries(nodeClassNames(["a"])),
          }}
        />
      );
      expect(healthy).toContain("nx-stale");

      const html = await renderToHtml(
        <PageRenderer
          document={ahead}
          blocks={createBlockResolver([text as AnyBlockDefinition])}
          styles={stored}
        />
      );

      expect(placeholderReasons(html)).toEqual(["version-ahead"]);
      expect(html).not.toContain("nx-stale");
    });
  });
});

describe("a block that does not render a single element", () => {
  /*
   * `BlockRenderArgs.className` is the contract every block author is handed:
   * "The generated class the block MUST place on its own root element. Blocks
   * render a single element and never wrap it, so styles target that element."
   *
   * A block returning a Fragment has no root element of its own for that class,
   * so it is already outside the contract. Until now the only signal came from
   * the placeholder, which fires when a DOCUMENT asks for `cssId` or an
   * attribute: the page author who set an anchor watched the block vanish,
   * while the block author never heard about it.
   *
   * NOT "its compiled styles never apply", which is the stronger claim and is
   * false for a shape tested directly below: `test/fragment-forwards` places
   * the supplied class on a child, and the assertions there read it back out of
   * the served HTML. What such a block certainly loses is the node's ROOT
   * FIELDS, which the renderer attaches to a root element it does not have.
   */
  const wrapped = defineBlock<{ value: string }>({
    name: "test/wrapped",
    version: 1,
    description: "Wraps its output in a fragment, against the contract.",
    example: { props: { value: "hi" } },
    defaultProps: { value: "" },
    render: ({ props }) => (
      <>
        <p>{props.value}</p>
      </>
    ),
  });

  const renderWith = async (
    definition: AnyBlockDefinition,
    extra: Partial<BlockNode> = {}
  ): Promise<string> =>
    renderToHtml(
      <PageRenderer
        document={doc(node("a", definition.name, extra))}
        blocks={createBlockResolver([definition])}
      />
    );

  it("warns the BLOCK author on the first render, asked for nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = await renderWith(wrapped as AnyBlockDefinition);
      // The control on the assertions below: the block RENDERED. Its output is
      // on the page, so this is not a placeholder case and nobody asked for a
      // root field — the warning is the only thing that fired.
      expect(html).not.toMatch(PLACEHOLDER);
      expect(html).toContain("<p>");
      const said = warn.mock.calls.map(call => String(call[0])).join("\n");
      expect(said).toContain("test/wrapped");
      expect(said).toContain("returned a wrapper rather than an element");
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about a wrapper root that DOES forward the class to a child", async () => {
    /*
     * The fixture that separates wrapper DETECTION from style LOSS, which the
     * fragment above cannot: it drops `className` entirely, so a message
     * claiming its styles were lost and a message claiming its shape is wrong
     * both pass against it.
     *
     * This block wraps, against the contract, and forwards the class to the
     * child it wraps. Both halves are then measurable at once: the class is on
     * the page, and the warning still fires — because the shape is what it
     * reports, not a styling outcome it cannot know.
     *
     * The oracle is the RENDER. Asking the renderer a second time whether the
     * class "would" land compares two derivations of one source and agrees with
     * whichever is wrong; the served HTML is the only witness that the CSS
     * matches something.
     */
    const forwarding = defineBlock({
      name: "test/fragment-forwards",
      version: 1,
      description: "Wraps a child and forwards the class to it.",
      example: { props: {} },
      defaultProps: {},
      render: ({ className }) => (
        <>
          <div className={className}>forwarded</div>
        </>
      ),
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = await renderWith(forwarding as AnyBlockDefinition);
      // The class REACHED the DOM, so this block's compiled styles do apply.
      expect(html).toContain("forwarded");
      expect(html).toMatch(bothClasses("test/fragment-forwards"));
      const said = warn.mock.calls.map(call => String(call[0])).join("\n");
      // Warned all the same: the shape is outside the contract, and the node's
      // root fields still have nowhere to go.
      expect(said).toContain("test/fragment-forwards");
      expect(said).toContain("returned a wrapper rather than an element");
      // And it must NOT tell this author their styles are gone. They are on the
      // page two assertions above.
      expect(said).not.toMatch(/styles do not apply|nowhere to go/);
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing about a block that renders one element", async () => {
    // The control that stops this warning firing on every conforming block.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await renderWith(text as AnyBlockDefinition);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing about a block whose root is a COMPONENT", async () => {
    /*
     * The shape this must not scold. A component that renders one host element
     * and forwards `className` gets its compiled styles applied, so it is not
     * broken — even though the placeholder path still refuses to attach root
     * fields to it, because the renderer cannot know the component forwards
     * those. Two questions, two answers, and only the narrower one belongs in a
     * diagnostic: a warning that is sometimes false is one people scroll past.
     */
    const Root = ({ className }: { className: string }) => (
      <div className={className}>via a component</div>
    );
    const componentRoot = defineBlock({
      name: "test/component-root",
      version: 1,
      description: "Renders its root through a component.",
      example: { props: {} },
      defaultProps: {},
      render: ({ className }) => <Root className={className} />,
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = await renderWith(componentRoot as AnyBlockDefinition);
      // Population first: the block rendered AND its class landed, which is
      // what makes "not broken" a measurement rather than an assumption.
      expect(html).toContain("via a component");
      expect(html).toMatch(bothClasses("test/component-root"));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing in production, including where `process` is absent", async () => {
    /*
     * The diagnostic is undeduplicated by design, so a production runtime that
     * still evaluated it would write a line on every render of every such
     * block. An Edge or Worker runtime need not define `process` at all, and
     * unable to tell, this says nothing — the opposite default to the
     * placeholder, which is a visible box rather than a log.
     */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Modelled the way the placeholder's own absent-runtime test models it,
      // and without disabling type checking to do so.
      vi.stubGlobal("process", undefined);
      await renderWith(wrapped as AnyBlockDefinition);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  });

  it("warns about a React wrapper that is not a fragment", async () => {
    /*
     * `Suspense`, `StrictMode` and `Profiler` have symbol types like `Fragment`
     * and render no element of their own, so the generated class has nowhere to
     * go in any of them. Special-casing `Fragment` alone left the diagnostic
     * silent about the rest — and a list of the wrappers that exist today is
     * the instrument that falls behind as React adds more.
     */
    const suspended = defineBlock({
      name: "test/suspense-root",
      version: 1,
      description: "Wraps its output in Suspense, against the contract.",
      example: { props: {} },
      defaultProps: {},
      render: () => <Suspense fallback={null}>held</Suspense>,
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = await renderWith(suspended as AnyBlockDefinition);
      // Population first: it rendered, so this is a warning about working
      // output rather than about a block that failed some other way.
      expect(html).toContain("held");
      const said = warn.mock.calls.map(call => String(call[0])).join("\n");
      expect(said).toContain("test/suspense-root");
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about output that is not an element at all", async () => {
    /*
     * The `none` branch, which nothing reached: a block returning a string
     * renders visible output with no element to carry the class. Distinct from
     * drawing nothing, which is a decision and is exempt below.
     */
    const bare = defineBlock({
      name: "test/bare-string",
      version: 1,
      description: "Returns a string, against the contract.",
      example: { props: {} },
      defaultProps: {},
      render: () => "just text" as never,
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = await renderWith(bare as AnyBlockDefinition);
      expect(html).toContain("just text");
      const said = warn.mock.calls.map(call => String(call[0])).join("\n");
      expect(said).toContain("test/bare-string");
      expect(said).toContain("returned no element");
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing in a production runtime that DOES define `process`", async () => {
    /*
     * The ordinary production build, and the branch the absent-runtime test
     * cannot reach: with `process` undefined the check exits at the first
     * condition, so `NODE_ENV === "production"` is never evaluated. Both halves
     * of that expression need a test or half of it is unmeasured.
     */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubGlobal("process", { env: { NODE_ENV: "production" } });
      await renderWith(wrapped as AnyBlockDefinition);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  });

  it("warns about a context PROVIDER root", async () => {
    /*
     * React 19 tags both `Ctx` and `Ctx.Provider` as `react.context`, and
     * renders their children itself — so there is no element of its own for the
     * generated class, exactly as with a fragment. Classifying by "is the type
     * a symbol" missed it, because a provider's type is a tagged OBJECT.
     */
    const Ctx = createContext("none");
    const provided = defineBlock({
      name: "test/provider-root",
      version: 1,
      description: "Roots at a context provider, against the contract.",
      example: { props: {} },
      defaultProps: {},
      render: () => <Ctx value="held">shown</Ctx>,
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = await renderWith(provided as AnyBlockDefinition);
      // Population first: it rendered, so this is a warning about working
      // output rather than about a block that failed some other way.
      expect(html).toContain("shown");
      const said = warn.mock.calls.map(call => String(call[0])).join("\n");
      expect(said).toContain("test/provider-root");
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing about a `memo` root, which may forward the class", async () => {
    /*
     * The boundary that stops the provider fix from becoming "every tagged
     * object is broken". `memo` wraps a component that may render a host
     * element and forward `className` to it, and only calling it would say —
     * so warning about it would be false.
     */
    const Inner = ({ className }: { className: string }) => (
      <div className={className}>memoised</div>
    );
    const Memo = memo(Inner);
    const memoised = defineBlock({
      name: "test/memo-root",
      version: 1,
      description: "Roots at a memoised component.",
      example: { props: {} },
      defaultProps: {},
      render: ({ className }) => <Memo className={className} />,
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = await renderWith(memoised as AnyBlockDefinition);
      expect(html).toContain("memoised");
      expect(html).toMatch(bothClasses("test/memo-root"));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing about a block that DECLARES it draws nothing", async () => {
    /*
     * The declaration exemption on its own. A block that also RETURNS nothing
     * is exempted by `rendersNothing(output)` whatever the declaration says, so
     * a fixture doing both cannot tell the two apart — this one declares it
     * draws nothing while returning a fragment, which only the declaration
     * excuses.
     */
    const declares = defineBlock({
      name: "test/declares-drawless",
      version: 1,
      description: "Says it draws nothing, and returns a fragment.",
      example: { props: {} },
      defaultProps: {},
      rendersNothing: () => true,
      render: () => <></>,
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await renderWith(declares as AnyBlockDefinition);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing about a block that draws nothing on purpose", async () => {
    /*
     * Rendering nothing is a DECISION, not a violation — `core/image` with no
     * source returns null deliberately. The same exemption the placeholder
     * grants, asked the same way, or every conditional block would be scolded
     * for working correctly.
     */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await renderWith(drawless as AnyBlockDefinition, {
        props: { draw: false },
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("an element type that answers differently on a later read", () => {
  /*
   * The root shape is a reading of author-controlled data: `output.type`, and
   * the tag on the type object. Nothing makes that reading stable — a getter
   * can count, a proxy can flip — so every place that reads it is a place the
   * author can raise from.
   *
   * It used to be read twice per block root: once by the contract warning,
   * which had a floor under it, and again by the placeholder policy, which had
   * none. A type whose accessor threw on that second read left this package
   * entirely: the stream never settled, so not even an error page.
   *
   * Now it is read ONCE, under one floor, and both policies are handed the
   * result. This asserts the property that follows and not the arithmetic
   * behind it: WHICHEVER read the accessor picks to throw on, containment
   * holds. Pinning the index instead would pass forever after any change to how
   * many times the value happens to be read.
   */
  const trickyBlock = (onRead: () => void): AnyBlockDefinition =>
    defineBlock({
      name: "test/stateful-type-tag",
      version: 1,
      description: "Roots at a type whose tag accessor is stateful.",
      example: { props: {} },
      defaultProps: {},
      render: () =>
        createElement(
          {
            get $$typeof() {
              onRead();
              // A context object, which React 19 renders as a provider — a
              // wrapper root, so the shape question is genuinely asked of it.
              return Symbol.for("react.context");
            },
            _currentValue: "held",
          } as never,
          null,
          "shown"
        ),
    }) as AnyBlockDefinition;

  const renderTricky = async (
    onRead: () => void,
    extra: Partial<BlockNode> = {}
  ): Promise<string> => {
    const definition = trickyBlock(onRead);
    return renderToHtml(
      <PageRenderer
        document={doc(node("a", definition.name, extra))}
        blocks={createBlockResolver([definition])}
      />
    );
  };

  it("renders the fixture when its tag accessor behaves", async () => {
    /*
     * The control, and the thing that stops every assertion below passing
     * because the fixture is broken in some other way: with the accessor
     * answering consistently, React renders it and its children reach the page.
     */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const html = await renderTricky(() => {});
      expect(html).toContain("shown");
      expect(html).not.toMatch(PLACEHOLDER);
    } finally {
      warn.mockRestore();
    }
  });

  it("placeholders instead of escaping, whichever read throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      /*
       * `cssId` is set so BOTH policies run: the warning classifies, and the
       * placeholder policy — the one that had no floor — classifies too.
       *
       * The bound is MEASURED rather than picked. A sweep past the last read is
       * a run of iterations whose accessor never throws, and every one of them
       * passes anyway — this node carries `cssId` on a wrapper root, so it is
       * replaced by an ordinary `invalid-output` placeholder whether anything
       * raised or not. Those iterations would report containment without ever
       * reaching the mechanism, and the count they pad is the only number that
       * says how much of it was covered.
       */
      let observed = 0;
      await renderTricky(
        () => {
          observed += 1;
        },
        { cssId: "anchor" }
      );
      // The premise of the whole finding: this path reads the tag more than
      // once. If that stops being true there is nothing here to contain.
      expect(observed).toBeGreaterThan(1);

      for (let throwOn = 1; throwOn <= observed; throwOn += 1) {
        let reads = 0;
        let threw = false;
        const html = await renderTricky(
          () => {
            reads += 1;
            if (reads === throwOn) {
              threw = true;
              throw new Error("tag read");
            }
          },
          { cssId: "anchor" }
        );
        // Evidence before verdict: this iteration actually reached the read it
        // names. Without it the assertion below is satisfied by a placeholder
        // the node was getting anyway.
        expect(threw).toBe(true);
        /*
         * Contained: the render RESOLVED, and what came back is this block's
         * placeholder rather than its output.
         *
         * Which placeholder depends on where the throw lands, and both are
         * containment: React validates a type inside `createElement`, so the
         * earliest read happens while the block's own `render` is running and
         * the render guard answers it. The later reads are this renderer's, and
         * they answer `invalid-output`. What matters is that neither escapes,
         * so the assertion names both rather than pinning an index.
         */
        expect(placeholderReasons(html)).toEqual([
          expect.stringMatching(/^(render-error|invalid-output)$/),
        ]);
        expect(html).not.toContain("shown");
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe("which runtimes the contract warning is willing to speak in", () => {
  const wrapped2 = defineBlock({
    name: "test/wrapped-env",
    version: 1,
    description: "Wraps its output in a fragment, against the contract.",
    example: { props: {} },
    defaultProps: {},
    render: () => <>{"held"}</>,
  });

  const renderIt = async (): Promise<string> =>
    renderToHtml(
      <PageRenderer
        document={doc(node("a", "test/wrapped-env"))}
        blocks={createBlockResolver([wrapped2 as AnyBlockDefinition])}
      />
    );

  const saysNothingWhen = async (env: unknown): Promise<void> => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubGlobal("process", { env });
      await renderIt();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  };

  it("says nothing when NODE_ENV is absent from a real `process`", async () => {
    /*
     * A standalone SSR runtime can expose a partial Node shim and never set
     * `NODE_ENV`. Reading only "is `process` absent" covered ONE way of being
     * unable to tell, so this one warned — undeduplicated, on every render of
     * every affected block, in something that may well be production.
     */
    await saysNothingWhen({});
  });

  it("says nothing for an environment name it does not recognise", async () => {
    // `staging` is neither development nor production, and guessing which it
    // resembles is exactly the judgement a diagnostic should decline to make.
    await saysNothingWhen({ NODE_ENV: "staging" });
  });

  it("says nothing when reading the environment THROWS", async () => {
    /*
     * A standalone SSR host supplies its own `process`, and nothing says its
     * `env` has to be a plain object — a throwing getter or a proxy is a shape
     * this renderer will meet. The read used to sit ahead of the diagnostic's
     * own guard, so it raised before there was anything to catch it.
     *
     * Where that lands is the point. `checkedOutput` is called PAST the try
     * that contains the block's `render` on the synchronous path, so the throw
     * is not contained into a placeholder: it leaves the package and takes the
     * page — `renderToHtml` fails the test through its `onError`. An advisory
     * warning must never be able to do that.
     */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubGlobal("process", {
        get env(): never {
          throw new Error("no env here");
        },
      });
      // Population first: the render COMPLETED and the block's output is on the
      // page, so this is containment rather than a page that failed some other
      // way and happened to log nothing.
      const html = await renderIt();
      expect(html).toContain("held");
      expect(html).not.toMatch(PLACEHOLDER);
      // And unable to tell, it stayed quiet — the same answer every other
      // unidentifiable environment gets.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  });

  it("DOES speak in development", async () => {
    /*
     * The control on all three silences above, and the one that stops this
     * being satisfied by a warning that never fires at all.
     */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubGlobal("process", { env: { NODE_ENV: "development" } });
      const html = await renderIt();
      expect(html).toContain("held");
      const said = warn.mock.calls.map(call => String(call[0])).join("\n");
      expect(said).toContain("test/wrapped-env");
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  });
});

describe("a stated NULL among the reconciled inputs", () => {
  /*
   * `firstStated` keeps a stored `null` because it OUTRANKS a lower tier: a
   * site stating null for a field is saying it has none, and that has to beat a
   * route context which has some. So the reconciler's published type admits it,
   * and every compile boundary has to deal with it — a compile context declares
   * these slots as values rather than nullable ones, and a null spread into one
   * was a lie no type was catching.
   */
  it("is dropped from the inputs a compile is given", () => {
    /*
     * `breakpoints` is deliberately absent from this: for that field alone,
     * DROPPING is the wrong answer, because a missing set falls through to
     * whatever the route context carries — which is exactly what a stated null
     * exists to override. It is normalised to an empty set instead, and the
     * canvas suite pins that behaviour end to end.
     */
    const stripped = withoutStatedNulls({
      namedClasses: null,
      blockBases: null,
      tokenPrefix: null,
      previewContainer: null,
      previewStates: null,
    });

    /*
     * Present and `undefined`, not absent. This patch is spread OVER a route
     * context, and an absent key leaves the route's own value standing — so a
     * site's null would silently fail to override the value it was stated to
     * beat, which is the whole reason `firstStated` keeps it.
     */
    expect(Object.keys(stripped).sort()).toEqual([
      "blockBases",
      "namedClasses",
      "previewContainer",
      "previewStates",
      "tokenPrefix",
    ]);
    expect(Object.values(stripped).every(v => v === undefined)).toBe(true);
  });

  it("OVERRIDES a lower tier's value when spread over it", () => {
    /*
     * The property the shape above exists for, asserted as the merge rather
     * than as the patch: a route context supplying a prefix, and a site stating
     * null, must compile with no prefix at all.
     */
    const route = { tokenPrefix: "route" };
    const merged = { ...route, ...withoutStatedNulls({ tokenPrefix: null }) };

    expect(merged.tokenPrefix).toBeUndefined();
  });

  it("KEEPS a value that was actually stated", () => {
    /*
     * The control, and it has to come out non-empty or the case above says only
     * that this returns nothing. A helper that dropped everything would satisfy
     * it while removing the whole reconciliation from every compile.
     */
    const kept = withoutStatedNulls({
      namedClasses: [],
      tokenPrefix: "nx",
      previewContainer: "nx-preview-viewport",
    });

    expect(kept.namedClasses).toEqual([]);
    expect(kept.tokenPrefix).toBe("nx");
    expect(kept.previewContainer).toBe("nx-preview-viewport");
  });

  it("does not confuse a stated null with an unstated field", () => {
    // Both end up absent from a compile, and they are different statements —
    // the distinction lives in what the reconciler REPORTS, which is why it
    // keeps the null rather than normalising at source.
    expect(
      withoutStatedNulls({ tokenPrefix: null }).tokenPrefix
    ).toBeUndefined();
    expect(withoutStatedNulls({}).tokenPrefix).toBeUndefined();
  });
});
