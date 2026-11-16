// @vitest-environment jsdom

/**
 * A block that renders asynchronously, drawn by the EDITOR, which renders the
 * page on the client.
 *
 * The published page renders on the server, where an async component is
 * allowed. The editor's canvas renders the same tree in the browser, where it
 * is not: React refuses an async client component and suspends on a promise
 * made afresh by every render. And the editor's next render of the page, for a
 * selection or a panel opening, ran the block again and showed its fallback
 * while the new promise settled, so an image or a button blinked out.
 *
 * Every render is awaited inside `act`, as the browser would let it settle: a
 * suspension inside a render nobody awaits is never retried under `act`.
 *
 * @module async-blocks-on-the-client.test
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import {
  createStandaloneContext,
  defineBlock,
  type PageContext,
} from "./context";
import { NODE_ID_ATTRIBUTE, PROP_ATTRIBUTE } from "./editor-markers";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

afterEach(cleanup);
afterEach(() => {
  vi.restoreAllMocks();
});

/** The shape of `core/image` and `core/button`: an `async` render. */
function lateBlock(renders: { count: number }): AnyBlockDefinition {
  return defineBlock<{ value: string }>({
    name: "test/late",
    version: 1,
    description: "Renders after a promise settles.",
    example: { props: { value: "late" } },
    defaultProps: { value: "" },
    render: async ({ props, className }) => {
      renders.count += 1;
      await Promise.resolve();
      return (
        <p className={className} data-testid="late">
          {props.value}
        </p>
      );
    },
  }) as AnyBlockDefinition;
}

function documentWith(value: string): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [{ id: "a", type: "test/late", version: 1, props: { value } }],
  };
}

/** The canvas as the editor draws it: one context for as long as it is open. */
function canvas(
  document: BlockDocument,
  renders: { count: number },
  context: PageContext
): ReactElement {
  return (
    <PageRenderer
      document={document}
      blocks={createBlockResolver([lateBlock(renders)])}
      context={context}
      nodeAttribute
    />
  );
}

describe("an async block in the editor's client render", () => {
  it("draws its output, by a path React supports in the browser", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      render(
        canvas(documentWith("Drawn"), { count: 0 }, createStandaloneContext())
      );
    });
    expect(screen.getByTestId("late").textContent).toBe("Drawn");
    expect(errors.mock.calls.flat().join("\n")).not.toMatch(
      /async Client Component|uncached promise/
    );
  });

  it("stays drawn, without running again, when the editor renders the page again", async () => {
    const renders = { count: 0 };
    const context = createStandaloneContext();
    const { rerender } = await act(async () =>
      render(canvas(documentWith("Drawn"), renders, context))
    );
    const drawn = screen.getByTestId("late");
    const before = renders.count;

    // The editor renders the page again for a selection: the same document,
    // read afresh, so none of its objects are the ones drawn before.
    await act(async () => {
      rerender(canvas(documentWith("Drawn"), renders, context));
    });
    expect(screen.getByTestId("late")).toBe(drawn);
    expect(renders.count).toBe(before);
  });

  it("runs again when the block's own props change", async () => {
    const renders = { count: 0 };
    const context = createStandaloneContext();
    const { rerender } = await act(async () =>
      render(canvas(documentWith("Drawn"), renders, context))
    );
    await act(async () => {
      rerender(canvas(documentWith("Edited"), renders, context));
    });
    expect(screen.getByTestId("late").textContent).toBe("Edited");
  });

  it("is kept for an editor drawing that addresses no node, such as a Layout's header", async () => {
    const renders = { count: 0 };
    const context = createStandaloneContext();
    const region = (value: string): ReactElement => (
      <PageRenderer
        document={documentWith(value)}
        blocks={createBlockResolver([lateBlock(renders)])}
        context={context}
        keepAsyncOutputs
      />
    );
    const { rerender } = await act(async () => render(region("Drawn")));
    const drawn = screen.getByTestId("late");
    const before = renders.count;
    await act(async () => {
      rerender(region("Drawn"));
    });
    expect(screen.getByTestId("late")).toBe(drawn);
    expect(renders.count).toBe(before);
    // Kept without the editor's addressing: no node of it is selectable.
    expect(document.querySelector(`[${NODE_ID_ATTRIBUTE}]`)).toBeNull();
  });

  it("is kept for a block inside another block's slot, in a drawing that addresses no node", async () => {
    const renders = { count: 0 };
    const context = createStandaloneContext();
    const holder = defineBlock<Record<string, never>>({
      name: "test/holder",
      version: 1,
      description: "Draws its one slot.",
      example: { props: {} },
      defaultProps: {},
      slots: { body: {} },
      render: ({ className, renderSlot }) => (
        <div className={className}>{renderSlot("body")}</div>
      ),
    }) as AnyBlockDefinition;
    const nested = (): BlockDocument => ({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "h",
          type: "test/holder",
          version: 1,
          props: {},
          slots: {
            body: [
              {
                id: "a",
                type: "test/late",
                version: 1,
                props: { value: "In" },
              },
            ],
          },
        },
      ],
    });
    const blocks = createBlockResolver([holder, lateBlock(renders)]);
    const region = (): ReactElement => (
      <PageRenderer
        document={nested()}
        blocks={blocks}
        context={context}
        keepAsyncOutputs
      />
    );
    const { rerender } = await act(async () => render(region()));
    const before = renders.count;
    await act(async () => {
      rerender(region());
    });
    expect(screen.getByTestId("late").textContent).toBe("In");
    expect(renders.count).toBe(before);
  });

  it("is kept apart for a drawing that addresses no node, which never wears the page's markers", async () => {
    // A Layout's header shares the canvas's context with the page, and a
    // block in it can be stored exactly as one on the page. The page's output
    // carries the editor's prop markers; the header's must not.
    const renders = { count: 0 };
    const context = createStandaloneContext();
    const marked = defineBlock<{ value: string }>({
      name: "test/late",
      version: 1,
      description: "Renders after a promise settles, marking its text.",
      example: { props: { value: "late" } },
      defaultProps: { value: "" },
      props: {
        value: { label: "Value", role: "content", type: "text", inline: true },
      },
      render: async ({ props, className, markProp }) => {
        renders.count += 1;
        await Promise.resolve();
        return (
          <p className={className} data-testid="late" {...markProp?.("value")}>
            {props.value}
          </p>
        );
      },
    }) as AnyBlockDefinition;
    const blocks = createBlockResolver([marked]);
    const view = await act(async () =>
      render(
        <PageRenderer
          document={documentWith("Same")}
          blocks={blocks}
          context={context}
          nodeAttribute
        />
      )
    );
    const drawnIn = (container: HTMLElement): Element | null =>
      container.querySelector('[data-testid="late"]');
    expect(drawnIn(view.container)?.hasAttribute(PROP_ATTRIBUTE)).toBe(true);
    const region = await act(async () =>
      render(
        <PageRenderer
          document={documentWith("Same")}
          blocks={blocks}
          context={context}
          keepAsyncOutputs
        />
      )
    );
    const regionLate = drawnIn(region.container);
    expect(regionLate).not.toBeNull();
    expect(regionLate?.hasAttribute(PROP_ATTRIBUTE)).toBe(false);
    expect(renders.count).toBe(2);
  });

  it("is not kept for a published page, which renders per request", async () => {
    const renders = { count: 0 };
    const context = createStandaloneContext();
    const page = (value: string): ReactElement => (
      <PageRenderer
        document={documentWith(value)}
        blocks={createBlockResolver([lateBlock(renders)])}
        context={context}
      />
    );
    const { rerender } = await act(async () => render(page("Drawn")));
    await act(async () => {
      rerender(page("Drawn"));
    });
    expect(renders.count).toBe(2);
  });
});
