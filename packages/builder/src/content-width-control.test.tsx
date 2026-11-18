// @vitest-environment jsdom

/**
 * Content width in a container's Style › Layout: Boxed and Full width as
 * picture buttons, the line saying the width in force and where it comes
 * from, a width of the container's own and the way back to the site's.
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ContentWidthControl, typedWidth } from "./content-width-control";
import type { EditorState } from "./editor-state";
import { StyleInspectorPanel } from "./style-inspector-panel";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** The site's tokens, with its content width and one wider width. */
function siteTokens(width: string): SiteTokenSet {
  return {
    tokens: [
      { name: "content.width", kind: "dimension", values: { light: width } },
      { name: "content.wide", kind: "dimension", values: { light: "1600px" } },
    ],
  } as SiteTokenSet;
}

const node = (
  id: string,
  type: string,
  props: Record<string, unknown>,
  children: BlockNode[] = []
): BlockNode =>
  ({
    id,
    type,
    version: 1,
    props,
    ...(children.length === 0 ? {} : { slots: { children } }),
  }) as BlockNode;

function mount(
  nodes: BlockNode[],
  selectedId: string,
  panel: Partial<React.ComponentProps<typeof StyleInspectorPanel>> = {}
) {
  registerBlocks(coreBlocks as never, { source: "core" });
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes,
  } as unknown as BlockDocument;
  const editor = {
    document,
    selectedId,
    selection: { ids: [selectedId], primary: selectedId },
    applyAll: vi.fn(() => document),
    apply: vi.fn(() => document),
    select: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  render(
    <StyleInspectorPanel
      editor={editor}
      tokens={siteTokens("1152px")}
      {...panel}
    />
  );
  openLayout();
  return editor;
}

/** Open the Layout section, where Content width is drawn. */
function openLayout(): void {
  const trigger = screen.queryByRole("button", { name: /^Layout/ });
  if (trigger !== null && trigger.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(trigger);
  }
}

/** The line under the buttons, as it reads. */
function line(): string {
  const found = document.querySelector(".nx-content-width__line");
  return (found?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The props the last edit wrote. */
function written(editor: { apply: ReturnType<typeof vi.fn> }) {
  const op = editor.apply.mock.calls.at(-1)?.[0] as {
    patch: { props: Record<string, unknown> };
  };
  return op.patch.props;
}

const CONTAINERS: readonly [string, Record<string, unknown>][] = [
  ["core/section", { as: "section", contained: true }],
  ["core/box", { as: "div" }],
  ["core/columns", { as: "div" }],
  ["core/column", { as: "div" }],
  ["core/card", { as: "div" }],
  ["core/accordion", { as: "div" }],
  ["core/gallery", { as: "div" }],
  ["core/collection-loop", {}],
  ["core/entry-content", {}],
];

describe("Content width on every container", () => {
  it.each(CONTAINERS)(
    "%s offers Boxed and Full width as picture buttons",
    (type, props) => {
      mount([node("n1", type, props)], "n1");
      const group = screen.getByRole("radiogroup", { name: "Content width" });
      const choices = within(group).getAllByRole("radio");
      expect(choices.map(choice => choice.textContent)).toEqual([
        "Boxed",
        "Full width",
      ]);
      // Each shows the result in small.
      for (const choice of choices) {
        expect(choice.querySelector(".nx-content-width__picture")).not.toBe(
          null
        );
      }
    }
  );

  it("chooses Boxed on a new Section, and Full width on a new Box", () => {
    mount([node("s", "core/section", {})], "s");
    expect(
      screen.getByRole("radio", { name: "Boxed" }).getAttribute("aria-checked")
    ).toBe("true");
    cleanup();
    clearBlocks();
    mount([node("b", "core/box", {})], "b");
    expect(
      screen
        .getByRole("radio", { name: "Full width" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });
});

describe("the line under the buttons", () => {
  it.each(["1152px", "1280px"])(
    "says the site's width in force (%s) and offers a width of its own",
    width => {
      mount([node("s", "core/section", { contained: true })], "s", {
        tokens: siteTokens(width),
      });
      expect(line()).toBe(
        `Boxed to ${width} · site default · Change for this section`
      );
    }
  );

  it("says the content runs edge to edge while Full width", () => {
    mount([node("b", "core/box", { contained: false })], "b");
    expect(line()).toBe("Content runs edge to edge.");
  });

  it("says a width of the container's own, with the way back", () => {
    mount(
      [node("s", "core/section", { contained: true, contentWidth: "1400px" })],
      "s"
    );
    expect(line()).toBe("Boxed to 1400px · this section · Use site default");
  });

  it("says the value of a site variable chosen as the width", () => {
    mount(
      [
        node("s", "core/section", {
          contained: true,
          contentWidth: { $token: "content.wide" },
        }),
      ],
      "s"
    );
    expect(line()).toBe("Boxed to 1600px · this section · Use site default");
  });

  it("says the site's width for a Boxed container inside one with its own", () => {
    mount(
      [
        node(
          "outer",
          "core/section",
          { contained: true, contentWidth: "1400px" },
          [node("inner", "core/box", { contained: true })]
        ),
      ],
      "inner"
    );
    expect(line()).toBe(
      "Boxed to 1152px · site default · Change for this section"
    );
  });
});

describe("choosing", () => {
  it("writes Full width as the block's own setting", () => {
    const editor = mount([node("s", "core/section", { contained: true })], "s");
    fireEvent.click(screen.getByRole("radio", { name: "Full width" }));
    expect(written(editor)).toMatchObject({ contained: false });
  });

  it("moves between the two with the arrow keys, as a radio group", () => {
    const editor = mount([node("s", "core/section", { contained: true })], "s");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Boxed" }), {
      key: "ArrowRight",
    });
    expect(written(editor)).toMatchObject({ contained: false });
  });

  it("shows a width field on Change for this section, and writes what is typed", () => {
    const editor = mount([node("s", "core/section", { contained: true })], "s");
    expect(screen.queryByLabelText("Width")).toBe(null);
    fireEvent.click(
      screen.getByRole("button", { name: "Change for this section" })
    );
    const field = screen.getByLabelText("Width");
    fireEvent.change(field, { target: { value: "1400px" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(written(editor)).toMatchObject({ contentWidth: "1400px" });
  });

  it("refuses what is no width, and says what to type", () => {
    const editor = mount([node("s", "core/section", { contained: true })], "s");
    fireEvent.click(
      screen.getByRole("button", { name: "Change for this section" })
    );
    const field = screen.getByLabelText("Width");
    fireEvent.change(field, { target: { value: "wide" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Use a width such as 1400px or 90%."
    );
  });

  it("goes back to the site's width on Use site default", () => {
    const editor = mount(
      [node("s", "core/section", { contained: true, contentWidth: "1400px" })],
      "s"
    );
    fireEvent.click(screen.getByRole("button", { name: "Use site default" }));
    expect(written(editor)).not.toHaveProperty("contentWidth");
    expect(written(editor)).toMatchObject({ contained: true });
  });
});

describe("one value on every device", () => {
  it("says so under the control", () => {
    mount([node("s", "core/section", { contained: true })], "s");
    expect(screen.getByText("Same on every device")).toBeDefined();
  });

  it("is held while a state other than Normal is edited, and says why", () => {
    mount([node("s", "core/section", { contained: true })], "s", {
      state: "hover",
    });
    expect(
      (screen.getByRole("radio", { name: "Full width" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      screen.getByText("Part of this block, not of its style")
    ).toBeDefined();
  });
});

describe("held with a variable as the width", () => {
  it("disables the variable's chip and writes nothing", () => {
    const editor = mount(
      [
        node("s", "core/section", {
          contained: true,
          contentWidth: { $token: "content.wide" },
        }),
      ],
      "s",
      { state: "hover" }
    );
    const group =
      document.querySelector<HTMLFieldSetElement>(".nx-content-width");
    expect(group?.disabled).toBe(true);
    for (const button of group?.querySelectorAll("button") ?? []) {
      expect(button.matches(":disabled")).toBe(true);
      fireEvent.click(button);
    }
    expect(editor.apply).not.toHaveBeenCalled();
  });
});

describe("a typed width", () => {
  it.each([
    ["1400px", "1400px"],
    ["1400", "1400px"],
    ["90%", "90%"],
    ["min(1400px, 100%)", "min(1400px, 100%)"],
    ["wide", undefined],
    ["-10px", undefined],
    ["", undefined],
  ])("reads %j as %j", (text, stored) => {
    expect(typedWidth(text)).toBe(stored);
  });
});

describe("a site variable as the width", () => {
  it("is chosen from the width field's own menu, a chevron at its end", () => {
    const editor = mount([node("s", "core/section", { contained: true })], "s");
    fireEvent.click(
      screen.getByRole("button", { name: "Change for this section" })
    );
    const menu = screen.getByRole("button", { name: "Variables for Width" });
    expect(menu.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(menu.querySelector(".lucide-diamond")).toBeNull();
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("option", { name: /1600px$/ }));
    expect(written(editor)).toMatchObject({
      contentWidth: { $token: "content.wide" },
    });
  });

  it("shows as a green chip, and Unlink keeps its width as the container's own", () => {
    const editor = mount(
      [
        node("s", "core/section", {
          contained: true,
          contentWidth: { $token: "content.wide" },
        }),
      ],
      "s"
    );
    const chip = screen.getByRole("group", { name: "Width" });
    expect(chip.classList.contains("nx-variable-chip")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Unlink Width" }));
    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(written(editor)).toMatchObject({ contentWidth: "1600px" });
  });
});

describe("focus after Unlink", () => {
  it("lands on the width field, holding the width, once Unlink keeps it", async () => {
    const props = {
      contained: true,
      tokens: siteTokens("1152px"),
      variables: [],
      held: undefined,
      onContained: vi.fn(),
      onWidth: vi.fn(),
    };
    const { rerender } = render(
      <ContentWidthControl {...props} width={{ $token: "content.wide" }} />
    );
    const unlink = screen.getByRole("button", { name: "Unlink Width" });
    act(() => unlink.focus());
    fireEvent.click(unlink);
    expect(props.onWidth).toHaveBeenCalledWith("1600px");
    rerender(<ContentWidthControl {...props} width="1600px" />);
    const field = screen.getByLabelText("Width") as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.value).toBe("1600px");
  });
});
