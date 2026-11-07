// @vitest-environment jsdom

/**
 * The Entry content block's Content tab: Field offers the template's
 * collection's top-level blocks fields, a choice the collection no longer has
 * stays chosen and reads "(removed)", and Open post opens the previewed
 * entry's edit screen in a new tab.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ENTRY_CONTENT_TYPE,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { useEntryContentDrawing } from "./entry-content-canvas";
import { EntryFieldControl } from "./entry-field-control";
import type { EditableProp } from "./inspector";
import {
  entryContentLabel,
  PreviewedEntryProvider,
  type PreviewedCollection,
  type PreviewedEntry,
} from "./previewed-entry";

beforeAll(() => {
  // The menu's primitives size and scroll their list, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The builder's sheet, which jsdom does not apply. */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

const POSTS: PreviewedCollection = {
  slug: "posts",
  singular: "post",
  plural: "Posts",
  blocksFields: [
    { name: "body", label: "Body" },
    { name: "sidebar", label: "Sidebar" },
  ],
  // Its label where it has one, else the host's words for a key: here a
  // stand-in that says which it took.
  fieldLabel: name =>
    (({ body: "Body", sidebar: "Sidebar" }) as Record<string, string>)[name] ??
    `Words for ${name}`,
  entryHref: id => `/admin/collections/posts/${id}`,
};

/** A template whose Entry content block names a field. */
const TEMPLATE: BlockDocument = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    {
      id: "ec",
      type: ENTRY_CONTENT_TYPE,
      version: 1,
      props: { field: "membersOnly" },
    },
  ],
};

const PREVIEWED: PreviewedEntry = {
  kind: "entry",
  collection: "posts",
  id: "p1",
  title: "Building a content model that lasts",
  editorValues: {},
  publicValues: null,
  fields: [],
};

function prop(value: unknown): EditableProp {
  return {
    name: "field",
    schema: { type: "entryField", label: "Field" },
    value,
    supported: true,
    options: [],
    offered: true,
    readOnly: false,
  };
}

function draw(
  value: unknown,
  collection: PreviewedCollection = POSTS,
  previewed: PreviewedEntry = PREVIEWED
) {
  const onCommit = vi.fn();
  render(
    <PreviewedEntryProvider value={previewed} collection={collection}>
      <EntryFieldControl
        id="field"
        prop={prop(value)}
        disabled={false}
        onCommit={onCommit}
      />
    </PreviewedEntryProvider>
  );
  return { onCommit, trigger: screen.getByRole("combobox", { name: "Field" }) };
}

describe("Entry content's Field", () => {
  it("offers both of a collection's blocks fields, and commits the one chosen", () => {
    const { onCommit, trigger } = draw("body");
    expect(trigger.textContent).toContain("Body");
    expect(trigger.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(trigger);
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["Body", "Sidebar"]);
    fireEvent.click(screen.getByRole("option", { name: "Sidebar" }));
    expect(onCommit).toHaveBeenCalledWith("field", "sidebar");
  });

  it("keeps a removed choice chosen, read as removed and marked invalid", () => {
    const { trigger } = draw("summary");
    expect(trigger.textContent).toContain("Words for summary (removed)");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
  });

  it("names the whole of a long choice in the trigger's title, as it is cut to one line", () => {
    // "membersOnly" the collection no longer has: the longest the trigger
    // reads, cut with an ellipsis by the sheet, whole in its title.
    const { trigger } = draw("membersOnly");
    expect(trigger.getAttribute("title")).toBe(
      "Words for membersOnly (removed)"
    );
  });

  it("titles a field the collection has by its own label (the control)", () => {
    expect(draw("sidebar").trigger.getAttribute("title")).toBe("Sidebar");
  });

  it("is cut to one line with an ellipsis by the sheet, as the inspector's other menus are", () => {
    // jsdom applies no stylesheet, so the rule that keeps the trigger to
    // one line is held to the sheet: a sheet missing it wraps the words.
    const selector =
      '.nx-inspector__field[data-content-control="entryField"]\n  [data-slot="select-value"]';
    const at = CHROME.indexOf(selector);
    expect(at).toBeGreaterThan(-1);
    const open = CHROME.indexOf("{", at);
    const body = CHROME.slice(open, CHROME.indexOf("}", open));
    expect(body).toContain("white-space: nowrap;");
    expect(body).toContain("text-overflow: ellipsis;");
    expect(body).toContain("overflow: hidden;");
    expect(body).toContain("min-width: 0;");
  });

  it("never calls a choice removed while the collection's fields are not known (the control)", () => {
    const { trigger } = draw("summary", { ...POSTS, blocksFields: undefined });
    expect(trigger.textContent).toContain("Words for summary");
    expect(trigger.textContent).not.toContain("(removed)");
    expect(trigger.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("one name for a removed field", () => {
  it("is the same in the Field menu, the canvas's tab and its red note", () => {
    // The collection's own naming of a field it no longer has, asked of the
    // one derivation every surface reads.
    const { trigger } = draw("membersOnly");
    expect(trigger.textContent).toContain("Words for membersOnly (removed)");
    expect(entryContentLabel("membersOnly", POSTS)).toBe(
      "Entry content · Words for membersOnly"
    );
    const { result } = renderHook(
      () => useEntryContentDrawing(TEMPLATE, undefined),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <PreviewedEntryProvider value={PREVIEWED} collection={POSTS}>
            {children}
          </PreviewedEntryProvider>
        ),
      }
    );
    const note =
      result.current.render?.context?.entryContentCanvas?.noteFor(
        "membersOnly"
      );
    expect(note).toEqual({
      tone: "failed",
      words:
        "The Words for membersOnly field no longer exists in Posts, so this shows nothing. Choose another field.",
    });
  });
});

describe("whose content it is, and the way to it", () => {
  it("says the content is the post's own, and opens the previewed post in a new tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    draw("body");
    expect(
      screen.getByText("This is the post’s own content, edited on the post.")
    ).toBeTruthy();
    const button = screen.getByRole("button", {
      name: "Open post in a new tab",
    });
    expect(button.textContent).toContain("Open post");
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith(
      "/admin/collections/posts/p1",
      "_blank",
      "noopener"
    );
  });

  it("offers no way to an entry while none is previewed", () => {
    draw("body", POSTS, { kind: "none", reason: "empty" });
    const button = screen.getByRole("button", {
      name: "Open post in a new tab",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
