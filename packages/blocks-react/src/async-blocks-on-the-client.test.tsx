// @vitest-environment jsdom

/**
 * A block that renders asynchronously, drawn by the EDITOR, which renders the
 * page on the client.
 *
 * The published page renders on the server, where an async component is
 * allowed. The editor's canvas renders the same tree in the browser, where it
 * is not: React refuses an async client component and suspends on a promise
 * made afresh by every render, so the block never drew. And where it did, the
 * editor's next render of the page, for a selection or a panel opening, made a
 * new promise and showed the block's fallback while it settled again, so an
 * image or a button blinked out.
 *
 * @module async-blocks-on-the-client.test
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { defineBlock } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

afterEach(cleanup);
afterEach(() => {
  vi.restoreAllMocks();
});

/** The shape of `core/image` and `core/button`: an `async` render. */
function lateBlock(renders: { count: number }) {
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
  });
}

const DOCUMENT: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    { id: "a", type: "test/late", version: 1, props: { value: "Drawn" } },
  ],
};

describe("an async block in the editor's client render", () => {
  it("draws its output", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocks = createBlockResolver([
      lateBlock({ count: 0 }) as AnyBlockDefinition,
    ]);
    render(<PageRenderer document={DOCUMENT} blocks={blocks} nodeAttribute />);
    expect(await screen.findByTestId("late")).toHaveTextContent("Drawn");
    // Not drawn by a path React warns about.
    expect(
      errors.mock.calls.flat().join("\n"),
      "React refused an async client component"
    ).not.toMatch(/async Client Component|uncached promise/);
  });

  it("stays drawn, without running again, when the editor renders the page again", async () => {
    const renders = { count: 0 };
    const blocks = createBlockResolver([
      lateBlock(renders) as AnyBlockDefinition,
    ]);
    const { rerender } = render(
      <PageRenderer document={DOCUMENT} blocks={blocks} nodeAttribute />
    );
    const drawn = await screen.findByTestId("late");
    const before = renders.count;

    // The editor renders the page again for a selection: the same document,
    // read afresh, so none of its objects are the ones drawn before.
    act(() => {
      rerender(
        <PageRenderer
          document={structuredClone(DOCUMENT)}
          blocks={blocks}
          nodeAttribute
        />
      );
    });
    expect(screen.getByTestId("late")).toBe(drawn);
    expect(drawn).toBeVisible();
    expect(renders.count).toBe(before);
  });

  it("runs again when the block's own props change", async () => {
    const renders = { count: 0 };
    const blocks = createBlockResolver([
      lateBlock(renders) as AnyBlockDefinition,
    ]);
    const { rerender } = render(
      <PageRenderer document={DOCUMENT} blocks={blocks} nodeAttribute />
    );
    await screen.findByTestId("late");
    const edited = structuredClone(DOCUMENT);
    const [first] = edited.nodes;
    if (first !== undefined) first.props = { value: "Edited" };
    rerender(<PageRenderer document={edited} blocks={blocks} nodeAttribute />);
    expect(await screen.findByText("Edited")).toBeInTheDocument();
  });
});
