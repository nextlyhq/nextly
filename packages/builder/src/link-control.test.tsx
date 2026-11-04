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
    expect(trigger().textContent).toBe("Search pages or paste a URL");
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
