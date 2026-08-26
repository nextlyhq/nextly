// @vitest-environment jsdom

/**
 * The affordance drawn over a container with nothing in it.
 *
 * Geometry is NOT asserted here: jsdom reports every element as zero-sized, so
 * a position assertion would pass against any implementation. Placement is
 * verified in a real browser in Task 8.
 *
 * `fireEvent` rather than `@testing-library/user-event`: this package does not
 * depend on that library and no other suite here does either, and the control
 * under test responds to a plain `onClick`, so one synthetic click exercises it
 * exactly as a full pointer-event sequence would.
 *
 * No jest-dom matcher is used, for the same reason `inspector-panel.test.tsx`
 * gives: this package does not register jest-dom, so a matcher like
 * `toBeEmptyDOMElement` is not available and every assertion below reaches for
 * a plain vitest one instead.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmptyContainerAppenders } from "./empty-container-appender";

// This suite queries by role against the whole document (`screen`), so a tree
// left mounted by one test is still there for the next `getByRole` to trip
// over — matching why `block-toolbar.test.tsx` and `spacing-overlay.test.tsx`
// both call this between cases.
afterEach(() => {
  cleanup();
});

const slots = {
  slotsOf: (type: string) =>
    type === "core/box" ? (["children"] as const) : undefined,
};

const blocks = {
  get: (type: string) =>
    type === "core/box" ? ({ editor: { label: "Box" } } as never) : undefined,
};

function doc(nodes: BlockDocument["nodes"]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

const emptyBox = { id: "box-1", type: "core/box", version: 1, props: {} };
const filledBox = {
  id: "box-2",
  type: "core/box",
  version: 1,
  props: {},
  slots: {
    children: [{ id: "h", type: "core/heading", version: 1, props: {} }],
  },
};

describe("the empty-container appender", () => {
  it("offers one control per empty container, naming the block", () => {
    render(
      <EmptyContainerAppenders
        document={doc([emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
      />
    );
    expect(screen.getByRole("button", { name: /Box/ })).toBeTruthy();
  });

  it("offers nothing for a container that already has a child", () => {
    render(
      <EmptyContainerAppenders
        document={doc([filledBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
      />
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("reports the container's id when pressed", () => {
    const onAppend = vi.fn();
    render(
      <EmptyContainerAppenders
        document={doc([emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={onAppend}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Box/ }));
    expect(onAppend).toHaveBeenCalledWith("box-1");
  });

  it("marks itself as chrome so a press does not clear the selection", () => {
    const { container } = render(
      <EmptyContainerAppenders
        document={doc([emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
      />
    );
    expect(container.querySelector("[data-nx-chrome]")).not.toBeNull();
  });

  it("renders nothing at all while hidden", () => {
    // Matching `BlockToolbar`: a control that is merely invisible would still
    // take a press, and a mid-drag press here would run an insert against a
    // container that is about to be somewhere else.
    const { container } = render(
      <EmptyContainerAppenders
        document={doc([emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
        hidden
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
