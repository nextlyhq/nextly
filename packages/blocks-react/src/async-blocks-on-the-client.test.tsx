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

  it("runs again when the site's spacing model changes", async () => {
    // A block whose markup reads the model, as a render argument offers it.
    const modeBlock = defineBlock<Record<string, never>>({
      name: "test/mode",
      version: 1,
      description: "Draws the spacing model it was rendered under.",
      example: { props: {} },
      defaultProps: {},
      render: async ({ className, spacingMode }) => {
        await Promise.resolve();
        return (
          <p className={className} data-testid="mode">
            {spacingMode ?? "none"}
          </p>
        );
      },
    }) as AnyBlockDefinition;
    const context = createStandaloneContext();
    const drawn = (spacingMode: "classic" | "gaps"): ReactElement => (
      <PageRenderer
        document={{
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "page",
          nodes: [{ id: "m", type: "test/mode", version: 1, props: {} }],
        }}
        blocks={createBlockResolver([modeBlock])}
        context={context}
        styleContext={{
          breakpoints: { viewport: [], container: [] },
          spacingMode,
        }}
        nodeAttribute
      />
    );
    const { rerender } = await act(async () => render(drawn("gaps")));
    expect(screen.getByTestId("mode").textContent).toBe("gaps");
    await act(async () => {
      rerender(drawn("classic"));
    });
    expect(screen.getByTestId("mode").textContent).toBe("classic");
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
