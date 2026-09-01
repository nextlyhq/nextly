/**
 * @vitest-environment jsdom
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PageBuilderCard } from "./PageBuilderCard";

// Derived from the block's own definition rather than pinned: the renderer
// drops a node whose version it cannot reconcile, and it drops it silently.
const TEXT = coreBlocks.find(block => block.name === "core/text");
if (!TEXT) throw new Error("core/text is missing from coreBlocks");

function doc(count: number): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      type: TEXT.name,
      version: TEXT.version,
      props: { text: `Block ${i}` },
    })),
  } as unknown as BlockDocument;
}

const base = {
  siteStyles: undefined,
  stylePending: false,
  canEdit: true,
  onOpen: () => {},
};

const MINIATURE = '[data-slot="page-miniature-surface"]';

describe("PageBuilderCard", () => {
  it("invites the author to build when the page is empty", () => {
    render(<PageBuilderCard {...base} document={doc(0)} />);

    expect(
      screen.getByRole("button", { name: /build this page/i })
    ).toBeDefined();
  });

  it("does not draw an empty frame for a page with nothing in it", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(0)} />
    );

    expect(container.querySelector(MINIATURE)).toBeNull();
  });

  it("reads out how many blocks the page holds", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(3)} />
    );

    expect(container.textContent).toContain("3 blocks");
  });

  it("counts one block in the singular", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(1)} />
    );

    expect(container.textContent).toContain("1 block");
    expect(container.textContent).not.toContain("1 blocks");
  });

  /*
   * The trap this guards.
   *
   * Omitting `siteStyles` still emits the DEFAULT token set, so a page rendered
   * without the site's own sheet looks entirely plausible while missing the
   * site's named classes and block defaults. The canvas makes the sheet a
   * required prop for exactly this reason — a faithful-LOOKING preview that is
   * wrong is worse than one that is visibly not ready yet.
   */
  it("draws no page at all while the site style is still arriving", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(2)} stylePending />
    );

    expect(container.querySelector(MINIATURE)).toBeNull();
    expect(container.textContent).not.toContain("Block 0");
  });

  it("draws the page once the site style has resolved", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(2)} stylePending={false} />
    );

    expect(container.querySelector(MINIATURE)).not.toBeNull();
    expect(container.textContent).toContain("Block 0");
  });

  it("still reports what the page holds while the style is pending", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(2)} stylePending />
    );

    expect(container.textContent).toContain("2 blocks");
  });

  /*
   * Kept from the behaviour this replaces, whose reasoning is recorded in
   * BlocksField: a disabled control says "you could do this, but not now",
   * which is the wrong sentence for a document nobody may edit at all.
   */
  it("offers no action when the field cannot be edited", () => {
    render(<PageBuilderCard {...base} document={doc(2)} canEdit={false} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("still shows the page when the field cannot be edited", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(2)} canEdit={false} />
    );

    expect(container.querySelector(MINIATURE)).not.toBeNull();
  });

  it("opens the builder when the action is pressed", () => {
    const onOpen = vi.fn();
    render(<PageBuilderCard {...base} document={doc(2)} onOpen={onOpen} />);

    screen.getByRole("button", { name: /open page builder/i }).click();

    expect(onOpen).toHaveBeenCalledOnce();
  });
});
