// @vitest-environment jsdom

/**
 * The link group in the inspector, with the host's `findLinkTargets` stood
 * in for and the core blocks' link props declared as `blocks-react` declares
 * them.
 *
 * - The link is one combobox row; the target, rel and entry props get no row
 *   of their own, and Open in new tab and Link options appear only once a
 *   link is set.
 * - The keyboard chooses: arrows move, Enter takes the active row, and typed
 *   text that reads as an address puts "Use as a URL" first.
 * - A page writes its path; on a button an entry writes its reference and
 *   clears the address, and an address clears the reference, each as ONE
 *   write. A page with no address is listed but cannot be chosen where only
 *   an address will do.
 * - A stored path names its page; one matching no page shows as itself.
 * - The switch writes `_blank` or clears the target, the flags write `rel`
 *   tokens keeping the others, and ✕ clears the link, its target and its rel.
 * - Without the service the control still takes a typed address.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type {
  ContentServices,
  LinkTarget,
  LinkTargetQuery,
} from "./content-controls";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import { commitLinkChanges } from "./link-control";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
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
  vi.useRealTimers();
});

const TARGET = {
  label: "Open link in",
  optionLabels: { _self: "This tab", _blank: "New tab" },
  type: "select",
  options: ["_self", "_blank"],
};

function register(): void {
  registerBlocks(
    [
      {
        name: "acme/heading",
        version: 1,
        description: "A heading.",
        example: { props: {} },
        editor: { label: "Heading" },
        props: {
          text: { label: "Text", role: "content", type: "text" },
          href: { label: "Link", role: "content", type: "url" },
          target: TARGET,
          rel: { label: "Link relationship", type: "text" },
        },
        render: () => null,
      },
      {
        name: "acme/button",
        version: 1,
        description: "A button.",
        example: { props: {} },
        editor: { label: "Button" },
        props: {
          label: { label: "Label", role: "content", type: "text" },
          href: { label: "Link", role: "content", type: "url" },
          entryCollection: {
            label: "Linked collection",
            role: "content",
            type: "text",
          },
          entryId: { label: "Linked entry", role: "content", type: "text" },
          target: TARGET,
          rel: { label: "Link relationship", type: "text" },
          // As the button block declares it: offered only without a link.
          type: {
            label: "Acts as",
            type: "select",
            options: ["button", "submit", "reset"],
            onlyWithout: ["href", ["entryCollection", "entryId"]],
          },
        },
        render: () => null,
      },
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { link: { label: "Link", role: "content", type: "url" } },
        render: () => null,
      },
    ] as never,
    { source: "link-control-test" }
  );
}

function editorFor(type: string, props: Record<string, unknown>) {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "a", type, version: 1, props } as BlockNode],
  } as BlockDocument;
  return {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

const TARGETS: readonly LinkTarget[] = [
  {
    id: "p-1",
    collection: "pages",
    group: "Pages",
    title: "Pricing",
    path: "/pricing",
  },
  { id: "p-2", collection: "pages", group: "Pages", title: "Pricing draft" },
  {
    id: "l-1",
    collection: "landing",
    group: "Landing pages",
    title: "Pricing promo",
  },
];

/** A service answering from TARGETS by a case-blind title match. */
function targetsService() {
  return vi.fn(
    async (query: LinkTargetQuery): Promise<readonly LinkTarget[]> =>
      TARGETS.filter(target =>
        target.title.toLowerCase().includes(query.search.toLowerCase())
      )
  );
}

function mount(
  type: string,
  props: Record<string, unknown>,
  services: ContentServices | undefined
) {
  register();
  const editor = editorFor(type, props);
  render(
    <InspectorPanel
      editor={editor}
      {...(services === undefined ? {} : { contentServices: services })}
    />
  );
  return editor;
}

/** The props the one write stored. */
function written(editor: { apply: ReturnType<typeof vi.fn> }): unknown {
  expect(editor.apply).toHaveBeenCalledTimes(1);
  return (editor.apply.mock.calls[0]?.[0] as { patch: { props: unknown } })
    .patch.props;
}

const trigger = () => screen.getByRole("button", { name: /^Link:/ });
const search = () => screen.getByRole("combobox");

/** Open the list and type into its search, waiting out the pause. */
async function typeInto(text: string): Promise<void> {
  fireEvent.click(trigger());
  fireEvent.change(search(), { target: { value: text } });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
  });
}

describe("the link group", () => {
  it("draws one link row, and the new-tab and rel rows only once a link is set", () => {
    mount("acme/heading", {}, { findLinkTargets: targetsService() });
    expect(trigger().textContent).toBe("Search or paste a URL");
    expect(screen.queryByText("Open link in")).toBeNull();
    expect(screen.queryByText("Link relationship")).toBeNull();
    expect(
      screen.queryByRole("switch", { name: "Open in new tab" })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Link options/ })).toBeNull();
    // The heading's other props keep their rows.
    expect(screen.getByLabelText("Text")).toBeDefined();
  });

  it("shows the new-tab switch and Link options under a set link", () => {
    mount(
      "acme/heading",
      { href: "https://example.com" },
      { findLinkTargets: targetsService() }
    );
    expect(
      screen.getByRole("switch", { name: "Open in new tab" })
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Link options/ })).toBeDefined();
  });

  it("offers a button's Acts as only while the button has no link", () => {
    // The link group draws the link; what the block offers beside it still
    // follows what is stored, a page's address or an entry alike.
    const actsAs = () => screen.queryByText("Acts as");
    mount("acme/button", {}, { findLinkTargets: targetsService() });
    expect(actsAs()).not.toBeNull();
    cleanup();
    clearBlocks();
    mount("acme/button", { href: "/pricing" }, undefined);
    expect(actsAs()).toBeNull();
    cleanup();
    clearBlocks();
    mount(
      "acme/button",
      { entryCollection: "landing", entryId: "l-1" },
      { findLinkTargets: targetsService() }
    );
    expect(actsAs()).toBeNull();
  });

  it("hides a button's entry rows behind its link", () => {
    mount("acme/button", {}, { findLinkTargets: targetsService() });
    expect(screen.queryByText("Linked collection")).toBeNull();
    expect(screen.queryByText("Linked entry")).toBeNull();
    expect(screen.getByLabelText("Label")).toBeDefined();
  });

  it("chooses with the keyboard: arrows move, Enter writes the page's path", async () => {
    const editor = mount(
      "acme/heading",
      {},
      {
        findLinkTargets: targetsService(),
      }
    );
    await typeInto("pric");
    const list = screen.getByRole("listbox");
    expect(within(list).getByRole("group", { name: "Pages" })).toBeDefined();
    expect(
      within(list).getByRole("group", { name: "Landing pages" })
    ).toBeDefined();
    // The first row that can be chosen is active; a page with no address on
    // a heading is listed but skipped.
    const active = () =>
      document.getElementById(
        search().getAttribute("aria-activedescendant") ?? ""
      )?.textContent;
    expect(active()).toContain("Pricing/pricing");
    // Only the address after the pages is pinned to the list's foot.
    const pinned = list.querySelectorAll(".nx-link-pick__option--pinned");
    expect([...pinned].map(row => row.textContent)).toEqual([
      "Use “pric” as a URL",
    ]);
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(active()).toBe("Use “pric” as a URL");
    fireEvent.keyDown(search(), { key: "ArrowUp" });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(written(editor)).toEqual({ href: "/pricing" });
  });

  it("lists a page with no address as unusable on a heading", async () => {
    const editor = mount(
      "acme/heading",
      {},
      {
        findLinkTargets: targetsService(),
      }
    );
    await typeInto("draft");
    const row = screen.getByRole("option", { name: /Pricing draft/ });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.textContent).toContain("No address known for this page");
    fireEvent.click(row);
    expect(editor.apply).not.toHaveBeenCalled();
    // Not taken as a choice: the list stays open for another one.
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("puts a typed address first, so Enter takes it", async () => {
    // A host that answers with pages whatever is typed: the address must
    // still come first.
    const editor = mount(
      "acme/heading",
      {},
      { findLinkTargets: vi.fn(async () => TARGETS) }
    );
    await typeInto("mailto:hi@example.com");
    expect(screen.getAllByRole("option")[0]?.textContent).toBe(
      "Use “mailto:hi@example.com” as a URL"
    );
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(written(editor)).toEqual({ href: "mailto:hi@example.com" });
  });

  it("links a button to an entry by its reference, clearing the address", async () => {
    const editor = mount(
      "acme/button",
      { label: "Go", href: "/old" },
      { findLinkTargets: targetsService() }
    );
    await typeInto("promo");
    fireEvent.click(screen.getByRole("option", { name: /Pricing promo/ }));
    expect(written(editor)).toEqual({
      label: "Go",
      entryCollection: "landing",
      entryId: "l-1",
    });
  });

  it("links a button to a page by its path, clearing the entry", async () => {
    const editor = mount(
      "acme/button",
      { label: "Go", entryCollection: "landing", entryId: "l-1" },
      { findLinkTargets: targetsService() }
    );
    await typeInto("pric");
    fireEvent.click(screen.getByRole("option", { name: /^Pricing\/pricing$/ }));
    expect(written(editor)).toEqual({ label: "Go", href: "/pricing" });
  });

  it("names a button's linked entry in its chip", async () => {
    mount(
      "acme/button",
      { entryCollection: "landing", entryId: "l-1" },
      { findLinkTargets: targetsService() }
    );
    await screen.findByRole("button", {
      name: "Link: Pricing promo, Landing pages. Change",
    });
  });

  it("names a stored path by its page, and shows an unmatched one as itself", async () => {
    mount(
      "acme/heading",
      { href: "/pricing" },
      {
        findLinkTargets: targetsService(),
      }
    );
    await screen.findByRole("button", {
      name: "Link: Pricing, /pricing. Change",
    });
    cleanup();
    clearBlocks();
    mount(
      "acme/heading",
      { href: "/nowhere" },
      {
        findLinkTargets: targetsService(),
      }
    );
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(trigger().getAttribute("aria-label")).toBe("Link: /nowhere. Change");
  });

  it("opens in a new tab with the switch on, and clears the target with it off", () => {
    const on = mount(
      "acme/heading",
      { href: "#faq" },
      { findLinkTargets: targetsService() }
    );
    fireEvent.click(screen.getByRole("switch", { name: "Open in new tab" }));
    expect(written(on)).toEqual({ href: "#faq", target: "_blank" });
    cleanup();
    clearBlocks();
    const off = mount(
      "acme/heading",
      { href: "#faq", target: "_blank" },
      { findLinkTargets: targetsService() }
    );
    fireEvent.click(screen.getByRole("switch", { name: "Open in new tab" }));
    expect(written(off)).toEqual({ href: "#faq" });
  });

  it("writes rel flags keeping other tokens, and removes an other token by its chip", () => {
    const editor = mount(
      "acme/heading",
      { href: "/x", rel: "me" },
      { findLinkTargets: targetsService() }
    );
    // Opened on its own: a token is stored.
    fireEvent.click(screen.getByRole("checkbox", { name: "Nofollow" }));
    expect(written(editor)).toEqual({ href: "/x", rel: "me nofollow" });
    editor.apply.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Remove me" }));
    expect(written(editor)).toEqual({ href: "/x" });
  });

  it("clears the link, its target and its rel in one write", () => {
    const editor = mount(
      "acme/heading",
      { text: "Hi", href: "/x", target: "_blank", rel: "nofollow" },
      { findLinkTargets: targetsService() }
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(written(editor)).toEqual({ text: "Hi" });
  });

  it("takes a typed address without the host's search", () => {
    const editor = mount("acme/box", {}, undefined);
    fireEvent.click(trigger());
    expect(screen.getByText("Type or paste an address.")).toBeDefined();
    fireEvent.change(search(), { target: { value: "example.com" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(written(editor)).toEqual({ link: "https://example.com" });
  });
});

describe("a stored link the host cannot name", () => {
  it("shows an entry reference as itself without a search, and still clears it", () => {
    const editor = mount(
      "acme/button",
      { label: "Go", entryCollection: "landing", entryId: "l-1" },
      undefined
    );
    expect(trigger().getAttribute("aria-label")).toBe(
      "Link: An entry in landing, l-1. Change"
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(written(editor)).toEqual({ label: "Go" });
  });

  it("says a failed lookup failed, and asks again once when the link is next focused", async () => {
    let failing = true;
    const findLinkTargets = vi.fn(async (): Promise<readonly LinkTarget[]> => {
      if (failing) throw new Error("offline");
      return TARGETS;
    });
    mount(
      "acme/button",
      { entryCollection: "landing", entryId: "l-1" },
      { findLinkTargets }
    );
    await screen.findByRole("button", {
      name: "Link: The linked entry couldn't be loaded, landing. Change",
    });
    const asked = findLinkTargets.mock.calls.length;
    // Not asked again on its own, however often the panel draws.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(findLinkTargets).toHaveBeenCalledTimes(asked);

    failing = false;
    fireEvent.focus(trigger());
    await screen.findByRole("button", {
      name: "Link: Pricing promo, Landing pages. Change",
    });
    expect(findLinkTargets.mock.calls.length).toBeGreaterThan(asked);
  });
});

describe("collections that share a name", () => {
  it("lists each collection's pages under its own heading", async () => {
    const shared: readonly LinkTarget[] = [
      { id: "a-1", collection: "pages", group: "Pages", title: "Pricing" },
      { id: "b-1", collection: "docs", group: "Pages", title: "Pricing API" },
    ];
    mount("acme/button", {}, { findLinkTargets: vi.fn(async () => shared) });
    await typeInto("pric");
    const groups = screen.getAllByRole("group", { name: "Pages" });
    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.textContent)).toEqual([
      expect.stringContaining("Pricing"),
      expect.stringContaining("Pricing API"),
    ]);
  });
});

/**
 * A button whose entry id is not content, inside a `contentOnly` area: its
 * address may change there and half of its entry reference may not.
 */
function registerHeld(): void {
  register();
  registerBlocks(
    [
      {
        name: "acme/half-button",
        version: 1,
        description: "A button whose entry id is fixed by an area.",
        example: { props: {} },
        editor: { label: "Half button" },
        props: {
          label: { label: "Label", role: "content", type: "text" },
          href: { label: "Link", role: "content", type: "url" },
          entryCollection: { role: "content", type: "text" },
          entryId: { type: "text" },
        },
        render: () => null,
      },
      {
        name: "acme/frame",
        version: 1,
        description: "A frame whose children keep their design.",
        example: { props: {} },
        editor: { label: "Frame" },
        props: {},
        slots: { children: { lock: "contentOnly" } },
        render: () => null,
      },
    ] as never,
    { source: "link-control-held-test" }
  );
}

/** An editor over one block, selected, inside a `contentOnly` frame. */
function heldEditorFor(type: string, props: Record<string, unknown>) {
  const editor = editorFor(type, props);
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "frame",
        type: "acme/frame",
        version: 1,
        props: {},
        slots: { children: [{ id: "a", type, version: 1, props }] },
      },
    ],
  } as unknown as BlockDocument;
  Object.assign(editor, {
    document,
    apply: vi.fn(() => document),
  });
  return editor;
}

describe("a link inside a contentOnly area", () => {
  it("holds a destination the area holds in part, and writes nothing", () => {
    registerHeld();
    const editor = heldEditorFor("acme/half-button", { href: "/x" });
    render(<InspectorPanel editor={editor} />);
    const control = trigger();
    expect(control.matches(":disabled")).toBe(true);
    expect(control.closest("fieldset[aria-describedby]")).not.toBeNull();
    // Asked directly, the write refuses the whole destination rather than
    // storing the address without the entry reference it replaces.
    expect(
      commitLinkChanges(editor, "a", {
        href: "/pricing",
        entryCollection: undefined,
        entryId: undefined,
      })
    ).toBeNull();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("still clears a link the area lets change, leaving its held target and rel", () => {
    registerHeld();
    const editor = heldEditorFor("acme/heading", {
      text: "Hi",
      href: "/x",
      target: "_blank",
      rel: "nofollow",
    });
    render(<InspectorPanel editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(written(editor)).toEqual({
      text: "Hi",
      target: "_blank",
      rel: "nofollow",
    });
  });
});

describe("what the group reads of the block", () => {
  function registerExtra(): void {
    register();
    registerBlocks(
      [
        {
          name: "acme/kiosk-link",
          version: 1,
          description: "A link that never opens a tab in kiosk mode.",
          example: { props: {} },
          editor: { label: "Kiosk link" },
          props: {
            href: { label: "Link", role: "content", type: "url" },
            kiosk: { label: "Kiosk", type: "checkbox" },
            target: { ...TARGET, onlyWithout: "kiosk" },
          },
          render: () => null,
        },
        {
          name: "acme/default-link-heading",
          version: 1,
          description: "A heading that links to pricing unless told otherwise.",
          example: { props: {} },
          editor: { label: "Default-link heading" },
          props: {
            href: { label: "Link", role: "content", type: "url" },
            target: TARGET,
          },
          defaultProps: { href: "/pricing" },
          render: () => null,
        },
        {
          name: "acme/new-tab-heading",
          version: 1,
          description:
            "A heading whose links open a new tab unless told not to.",
          example: { props: {} },
          editor: { label: "New-tab heading" },
          props: {
            href: { label: "Link", role: "content", type: "url" },
            target: TARGET,
          },
          defaultProps: { target: "_blank" },
          render: () => null,
        },
      ] as never,
      { source: "link-control-extra-test" }
    );
  }

  function mountExtra(type: string, props: Record<string, unknown>) {
    registerExtra();
    const editor = editorFor(type, props);
    render(<InspectorPanel editor={editor} />);
    return editor;
  }

  it("reads a stored address the page would never follow as no link", () => {
    mount("acme/heading", { href: "javascript:alert(1)" }, undefined);
    expect(trigger().textContent).toBe("Search or paste a URL");
    expect(
      screen.queryByRole("switch", { name: "Open in new tab" })
    ).toBeNull();
  });

  it("leaves out a sibling its own onlyWithout hides: not drawn, not cleared", () => {
    const editor = mountExtra("acme/kiosk-link", {
      href: "/x",
      kiosk: true,
      target: "_blank",
    });
    expect(
      screen.queryByRole("switch", { name: "Open in new tab" })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(written(editor)).toEqual({ kiosk: true, target: "_blank" });
  });

  it("reads the block's default link while none is stored", () => {
    mountExtra("acme/default-link-heading", {});
    expect(trigger().getAttribute("aria-label")).toBe("Link: /pricing. Change");
    expect(
      screen.getByRole("switch", { name: "Open in new tab" })
    ).toBeDefined();
    // Nothing is stored, so there is nothing for ✕ to remove: it would leave
    // the default applying and look like a click that did nothing.
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("offers to remove a stored link over the block's default", () => {
    mountExtra("acme/default-link-heading", { href: "/other" });
    expect(screen.queryByRole("button", { name: /^Remove / })).not.toBeNull();
  });

  it("stores this tab when switched off over a new-tab default", () => {
    // Cleared, the target would fall back to the default and the switch
    // would come straight back on.
    const editor = mountExtra("acme/new-tab-heading", { href: "/x" });
    fireEvent.click(screen.getByRole("switch", { name: "Open in new tab" }));
    expect(written(editor)).toEqual({ href: "/x", target: "_self" });
  });

  it("shows the block's default target while none is stored", () => {
    mountExtra("acme/new-tab-heading", { href: "/x" });
    expect(
      screen
        .getByRole("switch", { name: "Open in new tab" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });
});
