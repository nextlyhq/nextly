// @vitest-environment jsdom
/**
 * The handle's size classes are keyed off an attribute the library controls, and the mapping is
 * the kind that reads correctly while being backwards: `aria-orientation` describes the
 * SEPARATOR, not the group, so a horizontal group produces a vertical separator. Written from
 * the group's point of view instead, the divider gets its thickness on the wrong axis and
 * disappears — a failure nothing else would report, because the markup is still valid.
 *
 * So the mapping is measured here rather than assumed.
 */
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./resizable";

beforeAll(() => {
  // The library observes its own size, and jsdom has no ResizeObserver. A stub is enough: these
  // assertions are about the emitted attributes, not about measured geometry.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

const renderGroup = (orientation: "horizontal" | "vertical") => {
  const { container } = render(
    <ResizablePanelGroup orientation={orientation}>
      <ResizablePanel id="a" />
      <ResizableHandle aria-label="A and B" />
      <ResizablePanel id="b" />
    </ResizablePanelGroup>
  );
  return container.querySelector('[role="separator"]');
};

describe("the resize handle", () => {
  it("is a vertical separator when the panels sit side by side", () => {
    expect(renderGroup("horizontal")?.getAttribute("aria-orientation")).toBe(
      "vertical"
    );
  });

  it("is a horizontal separator when the panels are stacked", () => {
    expect(renderGroup("vertical")?.getAttribute("aria-orientation")).toBe(
      "horizontal"
    );
  });

  it("carries the classes that draw the line across that orientation", () => {
    // `w-px` on a vertical separator draws the line; `h-px` on it would collapse to nothing.
    const cls = renderGroup("horizontal")?.getAttribute("class") ?? "";
    expect(cls).toContain("aria-[orientation=vertical]:w-px");
    expect(cls).toContain("aria-[orientation=horizontal]:h-px");
  });

  it("announces its position, which is what makes it operable without sight", () => {
    const separator = renderGroup("horizontal");
    expect(separator?.getAttribute("aria-valuenow")).toBeTruthy();
    expect(separator?.getAttribute("aria-valuemin")).toBe("0");
    expect(separator?.getAttribute("aria-valuemax")).toBe("100");
    // Reachable by keyboard at all.
    expect(separator?.getAttribute("tabindex")).toBe("0");
  });
});

describe("naming the splitter", () => {
  it("carries the accessible name the caller gave it", () => {
    /*
     * The handle is FOCUSABLE, so a keyboard user lands on it whether or not
     * anyone remembered to name it, and the library supplies everything about
     * this element except the name: role, orientation, and a position between
     * a minimum and a maximum. Announced without a name that is "74" and
     * nothing about what is at 74.
     *
     * The range attributes are asserted alongside, as the control. They come
     * from the library rather than from this component, so a case checking
     * only the name would keep passing if the element stopped being a
     * splitter at all.
     */
    const separator = renderGroup("horizontal");

    expect(separator?.getAttribute("aria-label")).toBe("A and B");
    expect(separator?.getAttribute("role")).toBe("separator");
    expect(separator?.getAttribute("tabindex")).toBe("0");
    expect(separator?.getAttribute("aria-valuemin")).toBe("0");
    expect(separator?.getAttribute("aria-valuemax")).toBe("100");
    expect(separator?.getAttribute("aria-valuenow")).not.toBeNull();
  });
});
