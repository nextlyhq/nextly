// @vitest-environment jsdom

/**
 * The inspector, driven through a host that renders it against a real editor.
 *
 * `inspector.ts` decides which controls a block offers and what op each edit
 * produces, and asserts that without a DOM. What is only true HERE is the
 * wiring: that an edit reaches `editor.apply` at the moment it should, and that
 * a field showing a stored value follows that value when something else changes
 * it.
 *
 * **Scoped to the identity fields.** `inspector-panel.tsx` had no test file at
 * all before this one, so the prop controls below it remain uncovered — stated
 * rather than implied, because a file that exists reads as a file that covers
 * the module.
 *
 * @module inspector-panel.test
 */
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as React from "react";

import { createBlockResolver } from "@nextlyhq/blocks-react";
import {
  BASE_BREAKPOINT,
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";

import { editedStyleState, InspectorPanel } from "./inspector-panel";
import { applyOp } from "./ops";
import type { EditorState } from "./editor-state";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither, and a missing one
  // throws during render rather than failing an assertion.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

function register() {
  if (hasBlock("acme/heading")) return;
  registerBlocks(
    [
      {
        name: "acme/heading",
        version: 1,
        description: "A heading.",
        example: { props: {} },
        editor: { label: "Heading" },
        props: { text: { type: "text" } },
        render: () => null,
      },
    ] as never,
    { source: "inspector-panel-test" }
  );
}

function documentOf(node: Partial<BlockNode>): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/heading", version: 1, props: {}, ...node },
    ] as BlockNode[],
  } as BlockDocument;
}

function editorFor(
  document: BlockDocument
): EditorState & { apply: ReturnType<typeof vi.fn> } {
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
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

function mount(node: Partial<BlockNode> = {}) {
  register();
  const editor = editorFor(documentOf(node));
  render(<InspectorPanel editor={editor} />);
  return editor;
}

describe("what InspectorPanel forwards to the style tab", () => {
  it("carries the class library through, so the bar lists the block's shared styles", () => {
    /*
     * The chain is the feature: a library dropped anywhere between the host
     * and the bar is invisible, the bar rendering fine with no chips at all.
     * Asserted through the rendered chip, because what matters is that it
     * arrives.
     */
    register();
    render(
      <InspectorPanel
        editor={editorFor(documentOf({ classes: ["id-hero"] }))}
        classLibrary={[
          {
            id: "id-hero",
            slug: "hero",
            label: "Hero",
            orderIndex: 0,
            styles: {},
          },
        ]}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(screen.getByRole("button", { name: "Hero" })).toBeDefined();
  });

  it("names Content and Style for the inspector's own tab rules", () => {
    // Named for the stylesheet's compact underlined tab rules, which apply
    // to the inspector's tabs only.
    register();
    render(<InspectorPanel editor={editorFor(documentOf({}))} />);
    const style = screen.getByRole("tab", { name: "Style" });
    expect(style.className).toContain("nx-inspector__tab");
    expect(style.closest('[role="tablist"]')?.className).toContain(
      "nx-inspector__tablist"
    );
  });

  it("lists no shared style when the host passed no library", () => {
    // The control: the assertion above must be about forwarding, not about a
    // chip drawn from the node's ids alone.
    register();
    render(
      <InspectorPanel
        editor={editorFor(documentOf({ classes: ["id-hero"] }))}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(screen.queryByRole("button", { name: /hero/i })).toBeNull();
  });

  it("offers the state switcher when the host can act on the choice", () => {
    register();
    render(
      <InspectorPanel
        editor={editorFor(documentOf({}))}
        styleState={{ onChange: vi.fn() }}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(screen.getByRole("button", { name: /^State: / })).toBeDefined();
  });

  it("withholds it from a host that cannot act on the choice", () => {
    /*
     * The control, and a contract rather than a tidiness rule: this panel's
     * state and `Canvas.forcedState` are ONE value, so a switcher whose
     * selection nothing carries to the canvas would report a state the author
     * is not looking at — the arrangement that contract exists to prevent.
     */
    register();
    render(<InspectorPanel editor={editorFor(documentOf({}))} />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(screen.queryByRole("button", { name: /^State: / })).toBeNull();
  });

  it("marks the states the SELECTED NODE has styles for", () => {
    /*
     * The chain, asserted through the rendered control rather than by
     * inspecting props: the marker is only useful if the node's own stored
     * styles reach it, and a switcher that received nothing renders perfectly
     * while marking nothing at all.
     */
    register();
    render(
      <InspectorPanel
        editor={editorFor(
          documentOf({
            styles: { hover: { base: { color: "#000001" } } },
          } as Partial<BlockNode>)
        )}
        styleState={{ onChange: vi.fn() }}
        /*
         * The site's tiers, because the marker answers "set here, and
         * expressible by this site" — without them it refuses rather than
         * guessing, so a case omitting them would assert the refusal instead of
         * the forwarding it is named for.
         */
        breakpoints={{
          viewport: [{ id: "base", label: "Desktop" }],
          container: [],
        }}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    // The State menu's trigger names a state with values the canvas is not
    // showing, and only that one.
    expect(
      screen.getByRole("button", { name: "State: Normal, Hover has values" })
    ).toBeDefined();
  });

  it("edits BASE when a host supplies a state with no setter", () => {
    /*
     * The binding permits `{ state: "hover" }` alone, and read literally that is
     * a state nobody can leave: the switcher is withheld because nothing could
     * act on a choice, the tab handler has no callback to return the canvas
     * with, and the controls below would go on reading and writing hover with
     * no visible control saying so — the arrangement this panel's contract
     * exists to prevent, reached through the type rather than a miswiring.
     *
     * Asserted through the rendered controls rather than on a prop, because
     * what matters is which state the panel EDITS. The class surface is the
     * cheapest observable that differs, so the case reads the switcher's
     * absence and the style panel's presence together.
     */
    register();
    render(
      <InspectorPanel
        editor={editorFor(documentOf({}))}
        styleState={{ state: "hover" }}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(screen.queryByRole("button", { name: /^State: / })).toBeNull();
    expect(editedStyleState({ state: "hover" })).toBe("base");
    expect(editedStyleState({ state: "hover", onChange: vi.fn() })).toBe(
      "hover"
    );
  });

  it("OPENS on Style when a host mounts with a state already chosen", () => {
    /*
     * A host restoring what an author was editing supplies a non-base state at
     * mount. The tab handler cannot catch that — it fires on a CHANGE, and a
     * mount is not one — so opening on Content would leave the canvas drawing
     * the block mid-hover with the only control that explains or clears it
     * behind a tab nobody was told to open.
     *
     * Asserted on the switcher being REACHABLE rather than on the tab's own
     * state, because what the author needs is the control, and a test on the
     * internal value would pass on a panel that opened the right tab and
     * rendered nothing in it.
     */
    register();
    render(
      <InspectorPanel
        editor={editorFor(documentOf({}))}
        styleState={{ state: "hover", onChange: vi.fn() }}
      />
    );

    expect(screen.getByRole("button", { name: /^State: / })).toBeDefined();
  });

  it("still opens on Content for an ordinary mount", () => {
    /*
     * The control, and it carries the whole default: every existing caller
     * names no state, and a panel that opened on Style for them would move a
     * surface nobody asked to move.
     */
    register();
    render(
      <InspectorPanel
        editor={editorFor(documentOf({}))}
        styleState={{ onChange: vi.fn() }}
      />
    );

    expect(screen.queryByRole("button", { name: /^State: / })).toBeNull();
  });

  it("reports the state the author chose", () => {
    register();
    const onStyleStateChange = vi.fn();
    render(
      <InspectorPanel
        editor={editorFor(documentOf({}))}
        styleState={{ onChange: onStyleStateChange }}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: /^State: / }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Hover" }));

    expect(onStyleStateChange).toHaveBeenCalledWith("hover");
  });

  it("drops the forced state when the author LEAVES the style tab", () => {
    /*
     * The one real cost of placing this control inside the Style tab is that it
     * goes off screen with the tab, so a state left switched on becomes a
     * canvas disagreeing with everything visible — editing the text of a button
     * drawn mid-press, with no control on screen saying why.
     *
     * Asserted as the LAST call rather than as any call, because selecting the
     * state also calls this and a test satisfied by that would pass with the
     * reset deleted.
     */
    register();
    const onStyleStateChange = vi.fn();
    render(
      <InspectorPanel
        editor={editorFor(documentOf({}))}
        styleState={{ state: "hover", onChange: onStyleStateChange }}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Content" }));

    expect(onStyleStateChange).toHaveBeenLastCalledWith("base");
  });
});

/** Open the card's "⋯" menu from the keyboard, as Radix's menu allows in jsdom. */
function openCardMenu(title: string): void {
  fireEvent.keyDown(
    screen.getByRole("button", { name: `Actions for ${title}` }),
    {
      key: "Enter",
    }
  );
}

/** Choose one item of an open menu, by its name. */
function choose(name: string | RegExp): void {
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

/**
 * Bring Content's Advanced section on screen, as an author does: back to the
 * Content tab if another is showing, then the summary, if it is closed.
 */
function openAdvanced(): void {
  const content = screen.getByRole("tab", { name: "Content" });
  if (content.getAttribute("aria-selected") !== "true") {
    fireEvent.mouseDown(content);
  }
  const summary = screen.getByText("Advanced", { selector: "summary" });
  if (!(summary.parentElement as HTMLDetailsElement).open) {
    fireEvent.click(summary);
  }
}

describe("the picture the canvas draws, carried to the focal point", () => {
  it("previews a contextual point where the canvas resolves it", () => {
    /*
     * The whole chain, from the canvas to the preview: the panel reads where
     * the canvas places the picture and lends it, through the style tab and
     * the panel's sections, to the focal point. A point the inspector cannot
     * resolve itself (a variable) previews where the canvas put it, and a
     * link dropped anywhere on the way previews the inspector's default.
     */
    // A block whose style tab offers only its dimensions, opened first.
    registerBlocks(
      [
        {
          name: "acme/picture",
          version: 1,
          description: "A picture.",
          example: { props: {} },
          editor: { label: "Picture" },
          props: {},
          supports: { dimensions: true },
          render: () => null,
        },
      ] as never,
      { source: "inspector-panel-test" }
    );
    const canvas = document.createElement("div");
    canvas.innerHTML =
      '<img data-nx-node="a" src="/team.png" alt="" style="object-position: 100% 0%">';
    const styles = {
      base: {
        [BASE_BREAKPOINT]: {
          objectFit: "cover",
          objectPosition: "var(--image-focus)",
        },
      },
    } as NodeStyles;
    render(
      <InspectorPanel
        editor={editorFor(documentOf({ type: "acme/picture", styles }))}
        canvasRoot={canvas}
      />
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    const backdrop = document.querySelector(
      ".nx-focal__picture"
    ) as HTMLImageElement | null;
    expect(backdrop?.getAttribute("src")).toBe("/team.png");
    expect(backdrop?.style.objectPosition).toBe("100% 0%");
  });
});

describe("InspectorPanel block card", () => {
  it("shows the icon, the author's label beside the type, and the description", () => {
    mount({ name: "Hero title" });

    const card = document.querySelector("[data-block-card]") as HTMLElement;
    expect(within(card).getByRole("heading").textContent).toBe(
      "Hero title · Heading"
    );
    expect(within(card).getByText("A heading.")).toBeDefined();
    expect(card.querySelector(".nx-block-icon")).not.toBeNull();
  });

  it("sets the icon in a tile, and the description on one line beside the name, whole in its title", () => {
    // The design's card: a tile, then the name over a one-line description.
    // Cut to one line on screen, so the whole sentence is kept in the
    // element (read in full by a screen reader) and offered on hover.
    mount({ name: "Hero title" });

    const card = document.querySelector("[data-block-card]") as HTMLElement;
    const tile = card.querySelector(".nx-block-card__icon");
    expect(tile?.querySelector(".nx-block-icon")).toBeTruthy();
    const text = card.querySelector(".nx-block-card__text");
    expect(text?.querySelector("h2")).toBeTruthy();
    const description = text?.querySelector(".nx-block-card__description");
    expect(description?.textContent).toBe("A heading.");
    expect(description?.getAttribute("title")).toBe("A heading.");
  });

  it("leaves the editor around the card's menu in the accessibility tree", () => {
    // A modal menu marks everything outside it aria-hidden while those
    // controls stay focusable (axe: aria-hidden-focus). Nothing is hidden.
    mount();
    openCardMenu("Heading");
    expect(screen.getByRole("menu")).toBeTruthy();

    expect(document.querySelector('[data-aria-hidden="true"]')).toBeNull();
  });

  it("titles the card by type alone when the block has no label", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Heading" })).toBeDefined();
  });

  it("renames from the menu, in one op through the store, on blur", async () => {
    // Through `editor.apply` rather than around it, so the rename is on the undo
    // stack with every other edit.
    const editor = mount();
    openCardMenu("Heading");
    choose("Rename");

    // Found, not got: the field opens once the menu has finished closing,
    // which the menu reports a tick after the choice.
    const field = await screen.findByLabelText("Label");
    expect(document.activeElement).toBe(field);
    expect(
      screen.getByText("Shown in Layers. Visitors never see it.")
    ).toBeDefined();
    fireEvent.change(field, { target: { value: "Hero title" } });
    expect(editor.apply).not.toHaveBeenCalled(); // not on every keystroke
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { name: "Hero title" },
    });
  });

  it("renames from a double-click on the title too", () => {
    const editor = mount({ name: "Hero title" });
    fireEvent.doubleClick(screen.getByRole("heading"));

    const field = screen.getByLabelText("Label");
    fireEvent.change(field, { target: { value: "Intro" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { name: "Intro" },
    });
  });

  it("writes nothing when the label is unchanged, or when Escape backs out", () => {
    // Blur fires whenever focus leaves, including when an author clicks into
    // the field and straight out of it. Writing there would put an op with no
    // effect on the undo stack, so one press of undo would appear to do nothing.
    const editor = mount({ name: "Hero title" });
    fireEvent.doubleClick(screen.getByRole("heading"));
    fireEvent.blur(screen.getByLabelText("Label"));

    fireEvent.doubleClick(screen.getByRole("heading"));
    const field = screen.getByLabelText("Label");
    fireEvent.change(field, { target: { value: "Something else" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("heading").textContent).toBe(
      "Hero title · Heading"
    );
  });

  it("clears the label by unsetting the field", () => {
    const editor = mount({ name: "Hero title" });
    fireEvent.doubleClick(screen.getByRole("heading"));
    const field = screen.getByLabelText("Label");
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["name"],
    });
  });

  it("locks from the menu, immediately", () => {
    const editor = mount();
    openCardMenu("Heading");
    choose("Lock");

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { locked: true },
    });
  });

  it("says a locked block is locked, offers Unlock, and shows every control read-only", () => {
    const editor = mount({ locked: true, props: { text: "Hi" } });

    expect(document.querySelector('[data-lock="layers"]')?.textContent).toMatch(
      /Locked.*can't be moved, deleted or edited/
    );
    expect((screen.getByLabelText("Text") as HTMLInputElement).disabled).toBe(
      true
    );
    openAdvanced();
    expect(
      (screen.getByLabelText("CSS id") as HTMLInputElement).matches(":disabled")
    ).toBe(true);

    openCardMenu("Heading");
    expect(screen.queryByRole("menuitem", { name: "Lock" })).toBeNull();
    choose("Unlock");
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["locked"],
    });
  });

  it("says why a locked block is held once, in its card, in one wording", () => {
    // The card's lock line already says it, and so does a held control's
    // tooltip: a line under the Style tab's bar said it a third time, and
    // in other words.
    mount({ locked: true, props: { text: "Hi" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(document.querySelector('[data-lock="layers"]')?.textContent).toBe(
      "Locked: it can't be moved, deleted or edited. Unlock it from the block's menu."
    );
    expect(document.querySelector('[data-read-only="style"]')).toBeNull();
  });

  it("says a block inside a locked one is locked by it, withholds Rename, and offers Lock", () => {
    // The lock covers everything inside the block: the selected heading is
    // not locked itself, so the card names the block that holds the lock,
    // where it is lifted, and withholds a rename. Its own Lock stays offered,
    // as the multi-selection card offers it: a change to the lock alone is
    // always allowed, so the action does not depend on how it was selected.
    register();
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "hero",
          type: "acme/heading",
          version: 1,
          props: {},
          locked: true,
          name: "Hero",
          slots: {
            children: [
              {
                id: "a",
                type: "acme/heading",
                version: 1,
                props: { text: "Hi" },
              },
            ],
          },
        },
      ],
    } as unknown as BlockDocument;
    const editor = editorFor(document);
    render(<InspectorPanel editor={editor} />);

    expect(
      document_().querySelector('[data-lock="layers-inherited"]')?.textContent
    ).toBe(
      "Locked by Hero: this block is inside it, so it can't be moved, deleted or edited. Unlock Hero to change it."
    );
    expect((screen.getByLabelText("Text") as HTMLInputElement).disabled).toBe(
      true
    );
    openCardMenu("Heading");
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    const lock = screen.getByRole("menuitem", { name: "Lock" });
    expect(lock.getAttribute("data-disabled")).toBeNull();
    choose("Lock");
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { locked: true },
    });
  });

  it("keeps every control editable on a block nothing locks", () => {
    // The control for the case above.
    mount({ props: { text: "Hi" } });
    expect((screen.getByLabelText("Text") as HTMLInputElement).disabled).toBe(
      false
    );
    openAdvanced();
    expect(
      (screen.getByLabelText("CSS id") as HTMLInputElement).matches(":disabled")
    ).toBe(false);
  });

  it("offers the shared block verbs, disabled with their reason when refused", () => {
    const run = vi.fn();
    register();
    render(
      <InspectorPanel
        editor={editorFor(documentOf({}))}
        verbs={{
          actions: [
            { id: "duplicate", label: "Duplicate", enabled: true },
            {
              id: "delete",
              label: "Delete",
              enabled: false,
              reason: "It is locked.",
            },
            { id: "move-up", label: "Move up", enabled: true },
          ],
          run,
        }}
      />
    );
    openCardMenu("Heading");
    choose("Duplicate");
    expect(run).toHaveBeenCalledWith("duplicate");

    openCardMenu("Heading");
    const remove = screen.getByRole("menuitem", { name: /Delete/ });
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(remove.textContent).toContain("It is locked.");
    // Only the card's verbs; moving lives on the toolbar and in Layers.
    expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
  });

  it("draws no card when nothing is selected", () => {
    // The control for every case above: they would all pass against a panel
    // that rendered the card unconditionally, and this is the state the
    // inspector spends most of its time in.
    register();
    const editor = editorFor(documentOf({}));
    render(
      <InspectorPanel
        editor={{ ...editor, selectedId: null } as unknown as EditorState}
      />
    );

    expect(document.querySelector("[data-block-card]")).toBeNull();
  });
});

describe("InspectorPanel with several blocks selected", () => {
  function manyEditor(locks: readonly boolean[]) {
    register();
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: locks.map((locked, i) => ({
        id: String(i),
        type: "acme/heading",
        version: 1,
        props: {},
        ...(locked ? { locked: true } : {}),
      })),
    } as unknown as BlockDocument;
    const editor = {
      ...editorFor(document),
      selectedId: "0",
      selection: { ids: locks.map((_, i) => String(i)), primary: "0" },
    } as unknown as EditorState & {
      applyAll: ReturnType<typeof vi.fn>;
    };
    render(<InspectorPanel editor={editor} />);
    return editor;
  }

  it("says how many, rather than describing one of them", () => {
    /*
     * Showing the primary's name and props while three blocks are selected
     * would describe one block on a screen where the canvas outlines three and
     * the toolbar's delete removes all of them.
     */
    manyEditor([false, false, false]);

    expect(screen.getByRole("heading", { name: "3 blocks" })).toBeDefined();
    expect(screen.queryByRole("tab", { name: "Content" })).toBeNull();
  });

  it("says when only some are locked, and when all are", () => {
    manyEditor([true, false]);
    expect(screen.getByText("Some of them are locked.")).toBeDefined();
    cleanup();
    manyEditor([true, true]);
    expect(screen.getByText("All of them are locked.")).toBeDefined();
  });

  it("LOCKS everything on the first press from mixed", () => {
    /*
     * Rather than unlocking. Unlocking from mixed is a first press that appears
     * to do nothing to the blocks that were already unlocked, and every file
     * manager and design tool resolves it this way.
     */
    const editor = manyEditor([true, false]);

    openCardMenu("2 blocks");
    choose("Lock all");

    /*
     * ONLY the block that changes. The already-locked one is omitted, because
     * `applyOp` refuses an update writing what a node already holds and the
     * group is atomic — planning it would abort the whole edit and lock
     * nothing.
     */
    expect(editor.applyAll).toHaveBeenCalledWith([
      { kind: "update", id: "1", patch: { locked: true } },
    ]);
  });

  it("unlocks everything when they are all locked", () => {
    const editor = manyEditor([true, true]);

    openCardMenu("2 blocks");
    choose("Unlock all");

    expect(editor.applyAll).toHaveBeenCalledWith([
      { kind: "update", id: "0", patch: {}, unset: ["locked"] },
      { kind: "update", id: "1", patch: {}, unset: ["locked"] },
    ]);
  });
});

/**
 * The Advanced tab: the block's `id` and the attributes an author may add.
 *
 * `custom-attributes.ts` decides which rows may land and asserts that without a
 * DOM. What is only true HERE is the wiring — that a refusal is shown against
 * the field it belongs to, that an edit reaches `editor.apply`, and that what
 * the page would drop is never stored.
 */
describe("InspectorPanel advanced fields", () => {
  it("shows the block's stored id and attributes", () => {
    mount({ cssId: "hero", attributes: { "data-x": "1" } });
    openAdvanced();

    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "hero"
    );
    expect(
      (screen.getByLabelText("Name of attribute 1") as HTMLInputElement).value
    ).toBe("data-x");
  });

  it("commits an id through the editor, so undo covers it", () => {
    const editor = mount({});
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    // Nothing yet: an op per keystroke would make one undo remove one letter.
    expect(editor.apply).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "hero" },
    });
  });

  it("REMOVES an id rather than storing an empty one", () => {
    // A node that never had an id and one whose id was cleared are the same
    // node; an empty string would be a third state that shadows the bag.
    const editor = mount({ cssId: "hero" });
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);
    /*
     * `unset`, never `undefined`. `applyOp` refuses an undefined patch value —
     * the key disappears when the op is stored, so a replayed edit would do
     * nothing — and the op below is checked against the REAL store in the
     * control beneath this describe, not only against a spy.
     */
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["cssId"],
    });
  });

  it("says why a refused attribute will not reach the page, and stores nothing", () => {
    /*
     * The whole point of the surface. Without it an author types `onclick`,
     * watches it save, and finds the page without it — the renderer drops the
     * name and nothing anywhere says so.
     */
    const editor = mount({ attributes: { "data-x": "1" } });
    openAdvanced();

    const name = screen.getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "onclick" } });
    fireEvent.blur(name);

    const said = screen.getByRole("alert");
    expect(said.textContent).toContain("does not put that attribute");
    // Named to the field, so a screen reader reaches the reason with it.
    expect(name.getAttribute("aria-describedby")).toBe(said.id);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    /*
     * And NOTHING is written. Renaming `data-x` to `onclick` means the author
     * typed something wrong, not that they want `data-x` removed — writing the
     * reduced set would delete it, and the row showing the mistake would be
     * replaced by the now-empty stored value, so the attribute and the reason
     * for the refusal would disappear together.
     */
    expect(editor.apply).not.toHaveBeenCalled();
    // The row and its explanation are still on screen for the author to fix.
    expect((name as HTMLInputElement).value).toBe("onclick");
  });

  it("says an id attribute loses to the CSS id field", () => {
    /*
     * The renderer resolves this in favour of `cssId` and says so. That is the
     * right precedence and it is invisible from here: without this the author
     * sets an id, sees it saved, and the page carries the other one.
     */
    mount({ cssId: "from-the-field", attributes: { id: "from-the-bag" } });
    openAdvanced();

    expect(screen.getByRole("alert").textContent).toContain("CSS id");
  });

  it("says nothing about an attribute that WILL reach the page", () => {
    // The control: a refusal shown on a valid row would make the surface noise,
    // and every assertion above would still pass.
    mount({ cssId: "hero", attributes: { "data-x": "1" } });
    openAdvanced();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives every row a distinct name, and does not collide with the block's", () => {
    /*
     * The visible labels are short because they sit inline, and short labels
     * repeat. Two rows called "Name" would announce the same word twice for
     * two different things, and a voice-control user saying "name" would have
     * no way to pick. The block's own label is called "Label", in the card.
     */
    mount({ attributes: { "data-a": "1", "data-b": "2" } });
    openAdvanced();

    expect(
      (screen.getByLabelText("Name of attribute 1") as HTMLInputElement).value
    ).toBe("data-a");
    expect(
      (screen.getByLabelText("Name of attribute 2") as HTMLInputElement).value
    ).toBe("data-b");
    // Each Remove is named too, for the same reason.
    expect(screen.getByRole("button", { name: "Remove data-a" })).toBeDefined();
  });

  it("keeps the block card above the tabs while Advanced is open", () => {
    // Advanced must not have moved the block's own label into it: the label
    // answers "which of six headings is this" under every tab.
    mount({ name: "Hero title" });
    openAdvanced();
    expect(screen.getByRole("heading").textContent).toBe(
      "Hero title · Heading"
    );
  });
});

/**
 * The ops the Advanced tab emits, applied for REAL.
 *
 * The tests above drive a spy, which records an op and never judges it — so an
 * op the store would refuse looks identical there to one it accepts. That is
 * how `{ cssId: undefined }` passed review here: the panel appeared to clear an
 * id, `applyOp` threw on the undefined value, and the document kept the old one
 * while the field showed it gone.
 *
 * So these hand the recorded op to the real `applyOp` and assert what the
 * DOCUMENT holds afterwards. A shape the store rejects fails here.
 */
describe("the Advanced tab's ops, through the real store", () => {
  const nodeWith = (node: Partial<BlockNode>): BlockNode =>
    ({
      id: "a",
      type: "acme/heading",
      version: 1,
      props: {},
      ...node,
    }) as BlockNode;

  const applyRecorded = (
    editor: { apply: ReturnType<typeof vi.fn> },
    before: BlockNode
  ): BlockNode => {
    const op = editor.apply.mock.calls.at(-1)?.[0] as never;
    const applied = applyOp(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [before],
      } as unknown as BlockDocument,
      op
    );
    return applied.document.nodes[0] as BlockNode;
  };

  it("actually REMOVES a cleared css id", () => {
    const before = nodeWith({ cssId: "hero" });
    const editor = mount({ cssId: "hero" });
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);

    // The control: the op was recorded at all, so an empty call list cannot
    // satisfy the assertion below.
    expect(editor.apply).toHaveBeenCalled();
    expect(applyRecorded(editor, before).cssId).toBeUndefined();
  });

  it("actually REMOVES the last attribute", () => {
    const before = nodeWith({ attributes: { "data-x": "1" } });
    const editor = mount({ attributes: { "data-x": "1" } });
    openAdvanced();

    fireEvent.click(screen.getByRole("button", { name: "Remove data-x" }));

    expect(editor.apply).toHaveBeenCalled();
    expect(applyRecorded(editor, before).attributes).toBeUndefined();
  });

  it("actually WRITES an id the author typed", () => {
    // The positive control on the pair above: the same route that removes must
    // be shown to store, or "undefined afterwards" would pass on a store that
    // never writes anything.
    const before = nodeWith({});
    const editor = mount({});
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(applyRecorded(editor, before).cssId).toBe("hero");
  });
});

/**
 * The two ways a draft used to be lost, and the shadowed id it left behind.
 */
describe("the Advanced tab keeps what the author typed", () => {
  it("commits a draft when the tab is switched away", () => {
    /*
     * The tabs activate on `mousedown` and unmount the inactive tab's content,
     * so the panel is removed before the browser delivers `blur` — and the
     * draft went with it, silently. Typing an id and clicking Style must not
     * throw the id away.
     */
    const editor = mount({});
    openAdvanced();
    fireEvent.change(screen.getByLabelText("CSS id"), {
      target: { value: "hero" },
    });
    // No blur: the tab is clicked with the field still focused, which is what
    // an author does.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "hero" },
    });
  });

  it("does not commit when nothing was typed", () => {
    // The control: an unmount that always wrote would put an empty edit in the
    // undo history every time an author looked at this tab.
    const editor = mount({ cssId: "hero" });
    openAdvanced();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("drops an id attribute the CSS id now shadows", () => {
    /*
     * Setting a CSS id used to patch only `cssId`, leaving the shadowed
     * attribute stored — so clearing the CSS id later brought a stale id back
     * to life on a block the author thought had none.
     */
    const editor = mount({ attributes: { id: "old" } });
    openAdvanced();
    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "new" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "new" },
      unset: ["attributes"],
    });
  });
});

describe("a refused row survives its own commit", () => {
  it("keeps the draft and the stored attribute when a rename is refused", () => {
    /*
     * The failure this closes needs the panel to RE-RENDER after a write, which
     * a spy-only editor never does. Here the parent is re-rendered with the
     * stored attributes unchanged, which is what a real store does when nothing
     * was written — and the refused row, its explanation, and the attribute it
     * replaced must all still be there.
     */
    const editor = mount({ attributes: { "data-x": "1" } });
    openAdvanced();

    const name = screen.getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "onclick" } });
    fireEvent.blur(name);

    // Nothing written, so `data-x` is still the stored value.
    expect(editor.apply).not.toHaveBeenCalled();
    // The draft the author is fixing is still on screen, with its reason.
    expect((name as HTMLInputElement).value).toBe("onclick");
    expect(screen.getByRole("alert").textContent).toContain(
      "does not put that attribute"
    );
  });

  it("still commits a CSS id while a row is refused", () => {
    // The id is a separate field, and holding it hostage to an unrelated typo
    // in the rows below would be its own surprise.
    const editor = mount({ attributes: { "data-x": "1" } });
    openAdvanced();

    const name = screen.getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "onclick" } });
    fireEvent.blur(name);

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "hero" },
    });
  });

  it("refuses an id another block already holds, and writes nothing", () => {
    // The engine reports this only as a warning and the field's validation
    // discards warnings, so without refusing here it saves and publishes.
    register();
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/heading", version: 1, props: {} },
        { id: "b", type: "acme/heading", version: 1, props: {}, cssId: "hero" },
      ],
    } as unknown as BlockDocument);
    render(<InspectorPanel editor={editor} />);
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "already uses that id"
    );
  });
});

describe("a shadowed id and a mistyped row at the same time", () => {
  it("still drops the shadowed id while holding the mistyped row", () => {
    /*
     * The two rules interacting. Holding the write because a row is a mistake
     * must not also hold back dropping an id the new CSS id shadows: those are
     * different reasons and only one is the author's to fix. Without this,
     * clearing the CSS id later brought the old bag id back to life.
     */
    const editor = mount({ attributes: { id: "old", "data-x": "1" } });
    openAdvanced();

    /*
     * Rows are shown in NAME order, so `data-x` is the first and `id` the
     * second — an earlier version of this test edited the row it did not mean
     * and passed for the wrong reason.
     */
    const first = screen.getByLabelText("Name of attribute 1");
    expect((first as HTMLInputElement).value).toBe("data-x");
    fireEvent.change(first, { target: { value: "onclick" } });
    fireEvent.blur(first);
    expect(editor.apply).not.toHaveBeenCalled();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "new" } });
    fireEvent.blur(field);

    // The id commits, and the shadowed bag id goes with it — `data-x` is kept
    // because the author is still fixing that row.
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "new", attributes: { "data-x": "1" } },
    });
  });
});

describe("the panel's own write does not fight the document", () => {
  it("removes one row while another is mistyped", () => {
    /*
     * Holding the whole write for a mistyped row used to mean this Remove did
     * nothing: the row vanished locally, no op removed it, and leaving the tab
     * brought it back. Origin tracking lets the mistyped row keep what it
     * replaced without freezing everything beside it.
     */
    const editor = mount({ attributes: { "data-a": "1", "data-b": "2" } });
    openAdvanced();

    const first = screen.getByLabelText("Name of attribute 1");
    expect((first as HTMLInputElement).value).toBe("data-a");
    fireEvent.change(first, { target: { value: "onclick" } });
    fireEvent.blur(first);
    expect(editor.apply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove data-b" }));

    // `data-b` is gone and `data-a` survives its own bad rename.
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { attributes: { "data-a": "1" } },
    });
  });

  it("points an id row at the field above rather than storing it", () => {
    // One route to an identifier. The renderer accepts an `id` here, so a
    // document from elsewhere can carry one — it is shown, explained, and not
    // rewritten under a new value.
    mount({ attributes: { id: "from-a-file" } });
    openAdvanced();

    expect(screen.getByRole("alert").textContent).toContain("CSS id field");
  });
});

describe("undo then redo, with the panel open", () => {
  it("follows the document back to the redone value", () => {
    /*
     * The panel skips re-reading the document when the incoming props are its
     * own write echoing back, or a local draft would be wiped by every save.
     * The marker for that has to be CONSUMED once matched: left in place it
     * goes on describing a state the document can return to, and a redo lands
     * exactly there — so the panel keeps showing the undone value while a later
     * blur writes from that stale draft and erases the redone edit.
     */
    register();
    const withId = (cssId?: string): BlockDocument =>
      ({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "a",
            type: "acme/heading",
            version: 1,
            props: {},
            ...(cssId === undefined ? {} : { cssId }),
          },
        ],
      }) as unknown as BlockDocument;

    const editor = editorFor(withId("one"));
    const { rerender } = render(<InspectorPanel editor={editor} />);
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "two" } });
    fireEvent.blur(field);
    expect(editor.apply).toHaveBeenCalled();

    // The write echoes back through the document.
    rerender(<InspectorPanel editor={editorFor(withId("two"))} />);
    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "two"
    );

    // Undo.
    rerender(<InspectorPanel editor={editorFor(withId("one"))} />);
    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "one"
    );

    // Redo — the field must follow, not sit on the undone value.
    rerender(<InspectorPanel editor={editorFor(withId("two"))} />);
    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "two"
    );
  });
});

describe("the Advanced tab inside the entry's form", () => {
  it("does not let Enter submit the form", () => {
    /*
     * The builder mounts inside the entry's `<form>`, and a single-line input
     * with nothing stopping the key implicitly submits it — so typing an
     * attribute and pressing Enter would save the whole entry. The CSS id field
     * already prevented it; the two row inputs did not.
     */
    const editor = mount({ attributes: { "data-x": "1" } });
    openAdvanced();

    for (const label of [
      "CSS id",
      "Name of attribute 1",
      "Value of attribute 1",
    ]) {
      const event = createEvent.keyDown(screen.getByLabelText(label), {
        key: "Enter",
      });
      fireEvent(screen.getByLabelText(label), event);
      expect(event.defaultPrevented, label).toBe(true);
    }
    // Nothing was written, because nothing was edited — swallowing the key
    // must not be mistaken for the commit being asserted below.
    expect(editor.apply).not.toHaveBeenCalled();

    // And Enter COMMITS, rather than merely being swallowed. Asserted on an
    // edit, because the check above passes on a panel that ignores the key
    // entirely and would have read as proof of a commit it never made.
    fireEvent.change(screen.getByLabelText("Value of attribute 1"), {
      target: { value: "2" },
    });
    fireEvent.keyDown(screen.getByLabelText("Value of attribute 1"), {
      key: "Enter",
    });
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { attributes: { "data-x": "2" } },
    });
  });

  it("reports a refused save instead of showing a value nothing stored", () => {
    /*
     * `apply` answers `null` when the op is refused — a value past the
     * document's byte limit is the reachable case — and the document is left
     * alone. Ignoring that told the panel its own write had landed, so it
     * stopped re-reading the document and went on showing the unsaved value.
     */
    register();
    const editor = editorFor(documentOf({}));
    editor.apply.mockReturnValue(null);
    render(<InspectorPanel editor={editor} />);
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(screen.getByRole("alert").textContent).toContain(
      "could not be saved"
    );
  });

  it("says nothing when the save DID land", () => {
    // The control: a refusal shown on every successful edit would be worse
    // than the silence it replaced.
    const editor = mount({});
    openAdvanced();
    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a node carrying both a css id and a legacy id attribute", () => {
  const both = { cssId: "kept", attributes: { id: "legacy", "data-x": "1" } };

  it("does not delete the legacy id just by being looked at", () => {
    /*
     * An imported node can hold both. The renderer ignores the bag one while
     * the field has a value, so it is dead data — but deleting it because
     * someone opened a tab is not the author asking for it to go, and if they
     * later clear the field it is what would render.
     */
    const editor = mount(both);
    openAdvanced();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("does not delete it when the requested id was REFUSED", () => {
    /*
     * A refusal keeps the id the node already had, which is still non-empty —
     * so a rule keyed on "the field holds something" fired and wrote an
     * attributes-only update, deleting data on a change that did not happen.
     */
    register();
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/heading", version: 1, props: {}, ...both },
        {
          id: "b",
          type: "acme/heading",
          version: 1,
          props: {},
          cssId: "taken",
        },
      ],
    } as unknown as BlockDocument);
    render(<InspectorPanel editor={editor} />);
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "taken" } });
    fireEvent.blur(field);

    // Two alerts are correct here — the field's collision, and the id row
    // pointing at the field — so this names the one under test.
    const said = screen
      .getAllByRole("alert")
      .map(each => each.textContent ?? "")
      .join(" ");
    expect(said).toContain("already uses that id");
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("DOES drop it when the author actually sets a new id", () => {
    // The control, and the behaviour an earlier finding asked for: once the
    // author sets the field, the bag value can never render again, so keeping
    // it would let a later clear bring a dead id back to life.
    const editor = mount(both);
    openAdvanced();
    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "fresh" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "fresh", attributes: { "data-x": "1" } },
    });
  });
});

describe("an attribute bag the document should not have held", () => {
  /*
   * A stored bag can hold anything an import or a script put there. The
   * renderer skips a non-string value and emits every attribute beside it, so
   * a panel that refused the WHOLE bag on one bad entry showed no rows for a
   * block that was visibly carrying attributes.
   */
  // Cast at the definition, because the whole point of this fixture is a node
  // holding what its own type forbids — which is what a stored document does
  // when an import or a script wrote it.
  const mixed = {
    attributes: { "data-keep": "yes", "data-bad": 5 },
  } as unknown as Partial<BlockNode>;

  it("offers the entries it CAN edit rather than none of them", () => {
    mount(mixed);
    openAdvanced();

    expect(
      (screen.getByLabelText("Name of attribute 1") as HTMLInputElement).value
    ).toBe("data-keep");
    // And only that one: the unreadable entry is not offered as a row, because
    // there is no value for the author to see or type over.
    expect(screen.queryByLabelText("Name of attribute 2")).toBeNull();
  });

  it("does not delete the valid attribute when another is added", () => {
    /*
     * The data loss this closes: with no rows shown, the first attribute the
     * author added was written from an empty view, and `data-keep` went with
     * it. Driven through the real store, because what matters is the document
     * the op leaves behind rather than the op's shape.
     */
    const before = {
      id: "a",
      type: "acme/heading",
      version: 1,
      props: {},
      ...mixed,
    } as unknown as BlockNode;
    const editor = mount(mixed);
    openAdvanced();

    fireEvent.click(screen.getByRole("button", { name: "Add attribute" }));
    fireEvent.change(screen.getByLabelText("Name of attribute 2"), {
      target: { value: "data-new" },
    });
    fireEvent.blur(screen.getByLabelText("Name of attribute 2"));

    expect(editor.apply).toHaveBeenCalled();
    const op = editor.apply.mock.calls.at(-1)?.[0] as never;
    const after = applyOp(
      { formatVersion: 1, kind: "page", nodes: [before] } as BlockDocument,
      op
    ).document.nodes[0] as BlockNode;
    expect(after.attributes).toEqual({ "data-keep": "yes", "data-new": "" });
  });

  it("leaves the bag alone entirely while only the id is edited", () => {
    /*
     * The unreadable entry cannot survive an edit to the attributes — `update`
     * refuses a bag holding a non-string, so no op could carry it — but an edit
     * to a different field must not take it. `htmlUpdate` names only what
     * changed, and this is the assertion that keeps it that way.
     */
    const editor = mount({ ...mixed, cssId: "old" });
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "new" } });
    fireEvent.blur(field);

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "new" },
    });
  });
});

describe("a panel that was only LOOKED at", () => {
  /*
   * Stored values the editor would spell differently: `cssId` is trimmed on the
   * way out and an attribute name is lowercased. Committing whenever the
   * normalized draft differed from the document therefore wrote a change the
   * author never made — an undo entry for opening a tab, and a moved anchor.
   */
  const noncanonical = {
    cssId: " hero ",
    attributes: { "DATA-X": "1" },
  };

  it("writes nothing when the tab is switched away", () => {
    const editor = mount(noncanonical);
    openAdvanced();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("writes nothing when a field is merely focused and left", () => {
    // The same cause through the other door: blur commits too, so a click into
    // the id field and out of it was enough to rewrite the value.
    const editor = mount(noncanonical);
    openAdvanced();
    fireEvent.blur(screen.getByLabelText("CSS id"));
    fireEvent.blur(screen.getByLabelText("Name of attribute 1"));

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("still normalizes once the author DOES edit", () => {
    /*
     * The control. Holding the write back until an edit must not mean the
     * editor stops normalizing what it writes — an author who changes the value
     * beside `DATA-X` gets the lowercased name stored, which is what the page
     * renders.
     */
    const editor = mount(noncanonical);
    openAdvanced();
    const value = screen.getByLabelText("Value of attribute 1");
    fireEvent.change(value, { target: { value: "2" } });
    fireEvent.blur(value);

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { attributes: { "data-x": "2" } },
    });
  });
});

describe("a refused row when the author leaves the tab", () => {
  it("keeps the draft and its reason to come back to", () => {
    /*
     * The tabs activate on `mousedown`, before blur. The commit correctly
     * declined to store `onclick` — but the panel was destroyed with it, so
     * returning to Advanced showed `data-x` again and nothing had said why the
     * rename did not take. The tab's content is force-mounted for this.
     */
    const editor = mount({ attributes: { "data-x": "1" } });
    openAdvanced();
    const name = screen.getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "onclick" } });

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    openAdvanced();

    // The document kept what it had: the rename was refused, not applied.
    expect(editor.apply).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("Name of attribute 1") as HTMLInputElement).value
    ).toBe("onclick");
    expect(screen.getByRole("alert").textContent).toContain(
      "does not put that attribute"
    );
  });

  it("keeps a VALID draft too, and commits it", () => {
    // The other half: leaving the tab still saves work that can be saved.
    const editor = mount({});
    openAdvanced();
    fireEvent.change(screen.getByLabelText("CSS id"), {
      target: { value: "hero" },
    });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "hero" },
    });
  });
});

describe("a refusal that no longer describes anything", () => {
  /*
   * `apply` answers `null` for a value past the document's byte limit, and the
   * panel says so. The message is about a PENDING change, so it has to go when
   * there is no longer one to fail — and a commit reaches that conclusion by
   * two different routes, which is why both are driven here.
   */
  const refusedFirst = (node: Partial<BlockNode>) => {
    register();
    const editor = editorFor(documentOf(node));
    editor.apply.mockReturnValue(null);
    render(<InspectorPanel editor={editor} />);
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "enormous" } });
    fireEvent.blur(field);
    // The control on both tests below: the alert was there to be cleared.
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be saved"
    );
    return field;
  };

  const sizeAlert = () =>
    screen
      .queryAllByRole("alert")
      .find(each => each.textContent?.includes("could not be saved"));

  it("clears when the field is put back to what it was", () => {
    // The first route: the draft matches what was loaded, so the commit stops
    // before it has anything to compare against the document.
    const field = refusedFirst({ cssId: "hero" });

    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(sizeAlert()).toBeUndefined();
  });

  it("clears when the draft still differs but stores the same thing", () => {
    /*
     * The second route, and the one the first cannot reach: the author reverts
     * the oversized id AND renames a row to a name that will not be stored. The
     * draft is not what was loaded, so the commit runs — and finds the document
     * already holds what the draft would store, which is the early return that
     * used to leave this alert standing.
     */
    const field = refusedFirst({
      cssId: "hero",
      attributes: { "data-x": "1" },
    });

    fireEvent.change(field, { target: { value: "hero" } });
    const name = screen.getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "onclick" } });
    fireEvent.blur(name);

    expect(sizeAlert()).toBeUndefined();
    // And the row's OWN reason is what the author is left looking at.
    expect(screen.getByRole("alert").textContent).toContain(
      "does not put that attribute"
    );
  });
});

describe("an id the editor tidied on the way in", () => {
  it("does not put the whitespace back on the next unrelated edit", () => {
    /*
     * Trimming only what the author typed needs the draft to be rebased onto
     * what LANDED, or the two disagree: the document holds `hero`, the draft
     * still holds `" hero "`, and the next commit sees an id unchanged from
     * what was loaded, skips the trim, and patches the spaces back — breaking
     * every fragment link to the block. The rows were rebased and the id was
     * not, which is the whole defect.
     */
    const editor = mount({ attributes: { "data-x": "1" } });
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: " hero " } });
    fireEvent.blur(field);
    // The control: it was stored trimmed, so there is a tidied value to lose.
    expect(editor.apply).toHaveBeenLastCalledWith({
      kind: "update",
      id: "a",
      patch: { cssId: "hero" },
    });
    // And the field shows what was actually saved, not what was typed.
    expect((field as HTMLInputElement).value).toBe("hero");

    const value = screen.getByLabelText("Value of attribute 1");
    fireEvent.change(value, { target: { value: "2" } });
    fireEvent.blur(value);

    /*
     * Replayed through the REAL store, both ops in order, because what matters
     * is the document they leave rather than the shape of either one. The spy
     * editor never updates what it hands back, so the second op is computed
     * against the first op's props — which is exactly the situation that let
     * the untrimmed id return.
     */
    let node = {
      id: "a",
      type: "acme/heading",
      version: 1,
      props: {},
      attributes: { "data-x": "1" },
    } as unknown as BlockNode;
    for (const call of editor.apply.mock.calls) {
      node = applyOp(
        { formatVersion: 1, kind: "page", nodes: [node] } as BlockDocument,
        call[0] as never
      ).document.nodes[0] as BlockNode;
    }
    expect(node.cssId).toBe("hero");
    expect(node.attributes).toEqual({ "data-x": "2" });
  });
});

describe("the Advanced tab stays mounted without staying on screen", () => {
  /*
   * Keeping the draft alive across a tab switch means keeping the panel
   * mounted, and Radix ties presence to visibility: `TabsContent` renders
   * `hidden={!present}` with `present` = `forceMount || isSelected`, so asking
   * it to stay mounted also told it it was on screen. The Advanced fields
   * appeared under Content and under Style.
   *
   * Retention and invisibility are therefore two claims, and the draft tests
   * above only make the first. This makes the second.
   */
  const panelOf = (element: HTMLElement): HTMLElement => {
    const panel = element.closest('[role="tabpanel"]');
    if (panel === null) throw new Error("no tabpanel above the CSS id field");
    return panel as HTMLElement;
  };

  it("is hidden under the Style tab, and shown again under Content", () => {
    mount({});
    openAdvanced();
    // The control: it really is on screen when chosen, so `hidden` below is
    // a state it moved INTO rather than one it never left.
    expect(panelOf(screen.getByLabelText("CSS id")).hidden).toBe(false);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    expect(panelOf(screen.getByLabelText("CSS id")).hidden).toBe(true);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Content" }));
    expect(panelOf(screen.getByLabelText("CSS id")).hidden).toBe(false);
  });

  it("keeps a half-typed row across a collapse of Advanced", () => {
    mount({});
    openAdvanced();
    fireEvent.change(screen.getByLabelText("CSS id"), {
      target: { value: "her" },
    });

    fireEvent.click(screen.getByText("Advanced", { selector: "summary" }));
    openAdvanced();

    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "her"
    );
  });

  it("names no section of either tab Advanced but Content's", () => {
    // One "Advanced": the Style tab's sections end at Effects.
    register();
    render(<InspectorPanel editor={editorFor(documentOf({}))} />);
    expect(screen.queryByRole("tab", { name: "Advanced" })).toBeNull();
    expect(screen.getAllByText("Advanced")).toHaveLength(1);
  });

  it("is out of the accessibility tree while hidden", () => {
    /*
     * `hidden` is the claim that matters to someone who cannot see the panel:
     * a mounted-but-offscreen tab that a screen reader still announces is the
     * same defect wearing different clothes. Asked by ROLE, which resolves
     * against the accessibility tree rather than the DOM.
     */
    mount({});
    openAdvanced();
    expect(screen.queryByRole("textbox", { name: "CSS id" })).not.toBeNull();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    expect(screen.queryByRole("textbox", { name: "CSS id" })).toBeNull();
    // Still MOUNTED, which is the whole point of hiding it rather than
    // removing it — the draft has to survive.
    expect(screen.queryByLabelText("CSS id")).not.toBeNull();
  });
});

describe("a refused id while an unrelated attribute saves", () => {
  it("keeps the author's id and its reason on screen", () => {
    /*
     * A colliding id is held out of the write while staying in the field, so
     * `wanted.cssId` is the value the node ALREADY had. Rebasing the field onto
     * what landed therefore replaced the text the author was fixing with the
     * old id, and took the collision message with it — because an unrelated
     * attribute happened to save.
     */
    register();
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/heading",
          version: 1,
          props: {},
          attributes: { "data-x": "1" },
        },
        { id: "b", type: "acme/heading", version: 1, props: {}, cssId: "hero" },
      ],
    } as unknown as BlockDocument);
    render(<InspectorPanel editor={editor} />);
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);
    // The control: refused, and both the text and the reason are present to be
    // lost by what follows.
    expect(editor.apply).not.toHaveBeenCalled();
    expect((field as HTMLInputElement).value).toBe("hero");

    const value = screen.getByLabelText("Value of attribute 1");
    fireEvent.change(value, { target: { value: "2" } });
    fireEvent.blur(value);

    // The attribute saved, and ONLY the attribute.
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: { attributes: { "data-x": "2" } },
    });
    expect((screen.getByLabelText("CSS id") as HTMLInputElement).value).toBe(
      "hero"
    );
    expect(
      screen
        .queryAllByRole("alert")
        .some(each => each.textContent?.includes("already uses that id"))
    ).toBe(true);
  });
});

describe("the block set the collision check answers about", () => {
  it("uses the resolver the canvas renders with, not the global registry", () => {
    /*
     * `Canvas` forwards `render.blocks` to `PageRenderer`, so a host can render
     * against definitions the global registry has never seen. A panel that
     * reached for the registry would call such a node a placeholder, free its
     * id, and let another block take an id the page already renders.
     *
     * `acme/host` is deliberately NOT registered: only the resolver passed in
     * knows it, so the id it holds can only be reserved by way of that
     * resolver.
     */
    register();
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/heading", version: 1, props: {} },
        { id: "b", type: "acme/host", version: 1, props: {}, cssId: "hero" },
      ],
    } as unknown as BlockDocument);
    render(
      <InspectorPanel
        editor={editor}
        blocks={createBlockResolver([
          { name: "acme/host", version: 1 } as never,
        ])}
      />
    );
    openAdvanced();

    const field = screen.getByLabelText("CSS id");
    fireEvent.change(field, { target: { value: "hero" } });
    fireEvent.blur(field);

    expect(editor.apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "already uses that id"
    );
  });

  it("falls back to the global registry when the host states none", () => {
    // The control, and the ordinary case: `PageRenderer` defaults the same way,
    // so a host that says nothing still has the two sides agreeing.
    register();
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "a", type: "acme/heading", version: 1, props: {} },
        {
          id: "b",
          type: "acme/heading",
          version: 1,
          props: {},
          cssId: "hero",
        },
      ],
    } as unknown as BlockDocument);
    render(<InspectorPanel editor={editor} />);
    openAdvanced();

    fireEvent.change(screen.getByLabelText("CSS id"), {
      target: { value: "hero" },
    });
    fireEvent.blur(screen.getByLabelText("CSS id"));

    expect(editor.apply).not.toHaveBeenCalled();
  });
});

describe("a node whose CSS id is present but empty", () => {
  /*
   * The rule treats the modelled field as PRESENT whenever it is a string, so
   * `cssId: ""` shadows any `id` in the attribute bag AND renders none of its
   * own, leaving the element with no id. The inspection
   * collapsed it with an absent field, so the panel showed an empty box, every
   * clear attempt read as untouched, and no `unset` could ever be emitted.
   *
   * Unreachable through the editor, which writes `unset` rather than `""`, so
   * it arrives by import or by a script — and then cannot be undone.
   */
  const shadowed = {
    cssId: "",
    attributes: { id: "from-bag" },
  } as unknown as Partial<BlockNode>;

  it("says the empty id is there and what it is doing", () => {
    mount(shadowed);
    openAdvanced();

    expect(screen.getByRole("status").textContent).toContain("empty id");
  });

  it("offers a way to remove it, and removes it", () => {
    const editor = mount(shadowed);
    openAdvanced();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove the empty id" })
    );

    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["cssId"],
    });
  });

  it("says nothing when the field is simply ABSENT", () => {
    // The control: the ordinary block has no id and no note, or every block
    // would carry a warning about a state it is not in.
    mount({ attributes: { id: "from-bag" } });
    openAdvanced();

    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove the empty id" })
    ).toBeNull();
  });

  it("says nothing when the id holds a value", () => {
    // The other control: a real id is not the empty-but-present state either.
    mount({ cssId: "hero" });
    openAdvanced();

    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("an empty id while an unrelated attribute is edited", () => {
  it("is NOT removed as a side effect of that edit", () => {
    /*
     * The removal has to stay the author's explicit decision. Treating an
     * untouched empty box as a request to drop the field meant any other save
     * carried `unset: ["cssId"]` with it — bypassing the button, and silently
     * unshadowing the bag's `id` so the rendered anchor changed because an
     * attribute was edited.
     */
    const editor = mount({
      cssId: "",
      attributes: { id: "from-bag", "data-x": "1" },
    } as unknown as Partial<BlockNode>);
    openAdvanced();

    /*
     * Row ONE, not two: `rowsOf` sorts by name, so `data-x` sits above `id`.
     * Editing by position without checking which row it is has passed for the
     * wrong reason here before.
     */
    const name = screen.getByLabelText("Name of attribute 1");
    expect((name as HTMLInputElement).value).toBe("data-x");
    const value = screen.getByLabelText("Value of attribute 1");
    fireEvent.change(value, { target: { value: "2" } });
    fireEvent.blur(value);

    expect(editor.apply).toHaveBeenCalled();
    const op = editor.apply.mock.calls.at(-1)?.[0] as {
      patch: Record<string, unknown>;
      unset?: string[];
    };
    expect(op.unset ?? []).not.toContain("cssId");
    // The control: the edit itself DID land, so this is not passing on a write
    // that never happened.
    expect(op.patch["attributes"]).toMatchObject({ "data-x": "2" });
  });

  it("still reports a refused removal instead of doing nothing", () => {
    /*
     * `apply` answers `null` for any refused op — a document with duplicate
     * node ids passes inspection and is refused by the store. The panel's other
     * writer says so through the refusal line; the button silently did nothing.
     */
    register();
    const editor = editorFor(
      documentOf({ cssId: "" } as unknown as Partial<BlockNode>)
    );
    editor.apply.mockReturnValue(null);
    render(<InspectorPanel editor={editor} />);
    openAdvanced();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove the empty id" })
    );

    expect(editor.apply).toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be saved"
    );
  });
});

describe("what the empty-id note promises", () => {
  it("does not claim to reveal an id the renderer would not emit", () => {
    /*
     * `isAllowedAttribute(" id ")` is false — the renderer checks the STORED
     * name, spaces and all — so no bag id reaches the page and removing the
     * empty modelled field reveals nothing. Reading the name through the
     * editor's own normalization, which trims, promised otherwise.
     */
    mount({
      cssId: "",
      attributes: { " id ": "never-rendered" },
    } as unknown as Partial<BlockNode>);
    openAdvanced();

    const note = screen.getByRole("status").textContent ?? "";
    // The control: the note IS shown, so this is not passing on its absence.
    expect(note).toContain("empty id");
    expect(note).not.toContain("is ignored");
  });

  it("DOES claim it when the renderer would emit one", () => {
    // The other half: the promise is right when the bag really is shadowed.
    mount({
      cssId: "",
      attributes: { ID: "revealed" },
    } as unknown as Partial<BlockNode>);
    openAdvanced();

    expect(screen.getByRole("status").textContent).toContain("is ignored");
  });
});

describe("removing an empty id while a row is refused", () => {
  it("keeps the refused row and its reason on screen", () => {
    /*
     * The removal wrote through its own `editor.apply` rather than the panel's
     * one writer, so it recorded no echo: the resulting prop change arrived at
     * the synchronisation effect looking like an edit from somewhere else, and
     * the effect replaced the draft with the stored rows — discarding the
     * refused name the author was fixing, and the explanation beside it.
     *
     * The module's own docblock names this shape: two commit paths for the same
     * pair of fields, disagreeing about what they had just written.
     */
    register();
    const document = documentOf({
      cssId: "",
      attributes: { "data-x": "1" },
    } as unknown as Partial<BlockNode>);
    const editor = editorFor(document);
    const { rerender } = render(<InspectorPanel editor={editor} />);
    openAdvanced();

    const name = screen.getByLabelText("Name of attribute 1");
    fireEvent.change(name, { target: { value: "onclick" } });
    fireEvent.blur(name);
    // The control: the refused draft and its reason are on screen to be lost.
    expect((name as HTMLInputElement).value).toBe("onclick");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove the empty id" })
    );
    /*
     * Re-rendered with the field GONE, which is what a real store does after
     * this op. A spy editor never re-renders, and the defect only appears when
     * the panel sees its own write arrive back through props.
     */
    rerender(
      <InspectorPanel
        editor={
          {
            ...editor,
            document: documentOf({
              attributes: { "data-x": "1" },
            } as unknown as Partial<BlockNode>),
          } as never
        }
      />
    );

    expect(
      (screen.getByLabelText("Name of attribute 1") as HTMLInputElement).value
    ).toBe("onclick");
    expect(screen.getByRole("alert").textContent).toContain(
      "does not put that attribute"
    );
  });
});

describe("a block inside an area locked to its content", () => {
  /*
   * Its content stays editable; everything else is SHOWN read-only, with the
   * reason, rather than hidden: an author sees what the block is set to and
   * is told why it holds. Asserted through `:disabled`, which a disabled
   * fieldset gives every control inside it, Radix's buttons included.
   */
  function mountHeld(top: "held" | "free" = "held") {
    registerBlocks(
      [
        {
          name: "acme/headline",
          version: 1,
          description: "A headline.",
          example: { props: {} },
          editor: { label: "Headline" },
          props: {
            text: { type: "text", role: "content" },
            align: { type: "select", options: ["left", "right"] },
          },
          // Declared so the Style tab draws controls for the lock to hold.
          supports: { spacing: { margin: true, padding: true } },
          render: () => null,
        },
        {
          name: "acme/hero",
          version: 1,
          description: "A hero.",
          example: { props: {} },
          editor: { label: "Hero" },
          slots: {
            body: {
              defaultBlock: [{ type: "acme/headline" }],
              lock: top === "held" ? "contentOnly" : undefined,
            },
          },
          render: () => null,
        },
      ] as never,
      { source: "inspector-panel-test" }
    );
    const editor = editorFor({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "h",
          type: "acme/hero",
          version: 1,
          props: {},
          slots: {
            body: [
              {
                id: "a",
                type: "acme/headline",
                version: 1,
                props: { text: "Title", align: "left" },
              },
            ],
          },
        },
      ],
    } as unknown as BlockDocument);
    render(<InspectorPanel editor={editor} />);
    return editor;
  }

  const isDisabled = (element: Element) => element.matches(":disabled");
  const controlsIn = (panel: Element) =>
    Array.from(
      panel.querySelectorAll("input, button, select, textarea")
    ).filter(control => control.getAttribute("role") !== "tab");

  it("keeps its content and its layer name editable", () => {
    mountHeld();

    expect(isDisabled(screen.getByLabelText("Text"))).toBe(false);
    // The layer name is the card's Rename, still offered.
    openCardMenu("Headline");
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeDefined();
  });

  it("shows its other settings read-only, and offers no change to its own lock", () => {
    mountHeld();

    // Align's two options are a row of radio buttons; every one is held.
    const align = within(screen.getByRole("radiogroup", { name: "Align" }));
    expect(align.getAllByRole("radio").every(isDisabled)).toBe(true);
    // The area pins the block's own lock with its design, so the card holds
    // Lock, and says why.
    openCardMenu("Headline");
    const lock = screen.getByRole("menuitem", { name: /^Lock/ });
    expect(lock.getAttribute("aria-disabled")).toBe("true");
    expect(lock.textContent).toContain("The area it sits in fixes this.");
  });

  it("says why, in the words the store's refusal uses, tied to the controls it holds", () => {
    mountHeld();

    const reason = screen.getByText(
      "This area of Hero is locked to its content. Headline's design and settings can't change here."
    );
    const held = screen.getByLabelText("Align").closest("fieldset");
    expect(held?.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("shows the Style tab and the Advanced section read-only", () => {
    mountHeld();

    // Controls that change something. A section's toggle, the state
    // switcher and the target chips only choose what is shown, so they stay
    // usable.
    const editingControls = (panel: Element) =>
      controlsIn(panel).filter(
        control =>
          !control.hasAttribute("aria-expanded") &&
          !control.hasAttribute("aria-pressed") &&
          control.getAttribute("role") !== "radio"
      );

    openAdvanced();
    const content = screen.getByRole("tabpanel", { name: "Content" });
    const advanced = content.querySelector(
      ".nx-inspector__advanced"
    ) as Element;
    expect(editingControls(advanced).length).toBeGreaterThan(0);
    expect(
      editingControls(advanced).filter(control => !isDisabled(control))
    ).toEqual([]);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    const style = screen.getByRole("tabpanel", { name: "Style" });
    expect(editingControls(style).length).toBeGreaterThan(0);
    expect(
      editingControls(style).filter(control => !isDisabled(control))
    ).toEqual([]);
  });

  it("holds nothing where the slot fixes no design", () => {
    mountHeld("free");

    expect(isDisabled(screen.getByLabelText("Align"))).toBe(false);
    expect(screen.queryByText(/locked to its content/)).toBeNull();
    openAdvanced();
    expect(isDisabled(screen.getByLabelText("CSS id"))).toBe(false);
    openCardMenu("Headline");
    expect(
      screen
        .getByRole("menuitem", { name: "Lock" })
        .getAttribute("aria-disabled")
    ).toBeNull();
  });
});

/** The test document, named apart from the page fixtures called `document`. */
function document_(): Document {
  return globalThis.document;
}
