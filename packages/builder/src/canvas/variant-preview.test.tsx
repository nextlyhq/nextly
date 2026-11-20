// @vitest-environment jsdom

/**
 * The variant open in a component's view, previewed on the canvas.
 *
 * The properties a plausible implementation gets wrong: a canvas that keeps
 * drawing the defaults while a variant is open, a preview left standing once
 * its variant is deleted, one drawn over a page, and a tag that does not say
 * which variant the canvas shows.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useVariantPreview, VariantPreviewTag } from "./variant-preview";

afterEach(() => cleanup());

const card: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    { id: "h", type: "core/heading", version: 1, props: { text: "Plain" } },
  ],
  exposed: [
    { id: "t", label: "Title", nodeId: "h", propPath: "text", type: "text" },
  ],
  variants: { night: { label: "Night", overrides: { t: "Late" } } },
};

const textOf = (document: BlockDocument) => document.nodes[0]?.props.text;

describe("the open variant's preview", () => {
  it("draws the defaults until a variant opens, then the variant", () => {
    const { result } = renderHook(() => useVariantPreview(card));
    expect(textOf(result.current.document)).toBe("Plain");
    expect(result.current.previewing).toBeUndefined();

    act(() => result.current.binding.onOpen("night"));
    expect(result.current.binding.open).toBe("night");
    expect(textOf(result.current.document)).toBe("Late");
    expect(result.current.previewing).toBe("Night");
    // The same node, so the canvas can still select and edit it.
    expect(result.current.document.nodes[0]?.id).toBe("h");

    act(() => result.current.binding.onOpen(undefined));
    expect(textOf(result.current.document)).toBe("Plain");
  });

  it("stops once its variant is gone", () => {
    const { result, rerender } = renderHook(
      ({ document }) => useVariantPreview(document),
      { initialProps: { document: card as BlockDocument } }
    );
    act(() => result.current.binding.onOpen("night"));
    rerender({ document: { ...card, variants: {} } as ComponentDocument });
    expect(result.current.previewing).toBeUndefined();
    expect(result.current.binding.open).toBeUndefined();
  });

  it("draws a page as it is", () => {
    const page: BlockDocument = { ...card, kind: "page" };
    const { result } = renderHook(() => useVariantPreview(page));
    act(() => result.current.binding.onOpen("night"));
    expect(result.current.document).toBe(page);
  });
});

describe("the tag over the canvas", () => {
  it("says which variant the canvas shows, and nothing otherwise", () => {
    const { rerender } = render(<VariantPreviewTag name="Night" />);
    expect(screen.getByRole("status").textContent).toBe("Previewing Night");
    rerender(<VariantPreviewTag name={undefined} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
