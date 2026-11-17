// @vitest-environment jsdom

/**
 * The Styles tab's Block styles section, driven as an author meets it: its
 * heading and line, one folding group per block type with its tiles and
 * "+ New <block> style", the ★ and Hidden chips, each row's ⋯ menu offering
 * what the style may do, and the keys that reach each action.
 *
 * @module block-looks-group.test
 */
import type { NamedClass } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blockLookGroups } from "./block-look-rows";
import { BlockLooksGroup } from "./block-looks-group";
import type { BlockStyleActions } from "./block-style-actions";

afterEach(cleanup);

/** Each style after the one made before it, as a library orders them. */
let order = 0;
const look = (
  type: string,
  name: string,
  extra: Partial<NamedClass> = {}
): NamedClass => ({
  id: `look:core/${type}:${name.toLowerCase()}`,
  slug: `${type}-${name.toLowerCase()}`,
  label: name,
  orderIndex: order++,
  blockType: `core/${type}`,
  styles: {},
  ...extra,
});

const PRIMARY = look("button", "Primary", { isDefault: true });
const TEXT = look("button", "Text");
const GHOST: NamedClass = { ...look("button", "Ghost"), id: "ghost-id" };
const SQUARE = look("image", "Square", { isDefault: true });
const CIRCLE = look("image", "Circle");
const PLAIN = look("section", "Plain", { isDefault: true });
const HERO = look("section", "Hero");

/** The code's styles: every one but Ghost, which the site made. */
const BUILT_IN = new Set(
  [PRIMARY, TEXT, SQUARE, CIRCLE, PLAIN, HERO].map(entry => entry.id)
);

const LIBRARY = [PRIMARY, TEXT, GHOST, SQUARE, CIRCLE, PLAIN, HERO];

function actionsOf(
  overrides: Partial<BlockStyleActions> = {}
): BlockStyleActions {
  return {
    create: vi.fn(async () => ({ ok: true as const, id: "new-id" })),
    duplicate: vi.fn(async () => ({ ok: true as const, id: "copy-id" })),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    setHidden: vi.fn(async () => undefined),
    setDefault: vi.fn(async () => undefined),
    ...overrides,
  };
}

function draw(
  library: readonly NamedClass[],
  props: Partial<React.ComponentProps<typeof BlockLooksGroup>> = {}
) {
  const onEdit = vi.fn();
  const view = render(
    <BlockLooksGroup
      groups={blockLookGroups(library, BUILT_IN)}
      library={library}
      tokens={undefined}
      mode="light"
      editing={null}
      onEdit={onEdit}
      reachOf={() => undefined}
      blocksOf={() => undefined}
      chip={() => null}
      {...props}
    />
  );
  return {
    onEdit,
    view,
    section: screen.getByRole("region", { name: "Block styles" }),
  };
}

/** A row by the start of its name. */
const rowOf = (section: HTMLElement, name: string) =>
  within(section).getByRole("button", { name: new RegExp(`^${name}\\b`) });

/** Open a row's ⋯ menu and answer its items' names. */
async function menuOf(section: HTMLElement, name: string): Promise<string[]> {
  const more = within(section).getByRole("button", {
    name: `More actions for ${name}`,
  });
  fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
  const menu = await screen.findByRole("menu");
  return within(menu)
    .getAllByRole("menuitem")
    .map(item => item.textContent ?? "");
}

describe("the Block styles section", () => {
  it("is named Block styles and says what block styles are and what ★ means", () => {
    const { section } = draw(LIBRARY);
    expect(
      within(section).getByRole("heading", { name: "Block styles" })
    ).toBeTruthy();
    const line =
      "Saved looks for one kind of block. ★ is the look a block has until you pick another.";
    expect(within(section).getByText(line)).toBeTruthy();
    // The line describes the section to a screen reader too.
    const describedBy = section.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe(line);
  });

  it("groups the styles by block type, each a tile, each type ending with its + New row", () => {
    const { section } = draw(LIBRARY, { actions: actionsOf() });
    const lists = ["Button", "Image", "Section"].map(title =>
      within(section).getByRole("list", { name: `${title} styles` })
    );
    expect(
      lists.map(list =>
        within(list)
          .getAllByRole("button", { pressed: false })
          .map(row => row.querySelector(".nx-vars__name")?.textContent)
      )
    ).toEqual([
      ["Primary", "Text", "Ghost"],
      ["Square", "Circle"],
      ["Plain", "Hero"],
    ]);
    // Each row draws the style on a sample of its block.
    expect(
      lists.map(list => list.querySelectorAll(".nx-look-tile__specimen").length)
    ).toEqual([3, 2, 2]);
    expect(
      within(section)
        .getAllByRole("button", { name: /^\+ New / })
        .map(button => button.textContent)
    ).toEqual([
      "+ New button style",
      "+ New image style",
      "+ New section style",
    ]);
    // Each type's heading folds it, counting its styles.
    expect(
      within(section)
        .getAllByRole("button", { expanded: true })
        .map(toggle => toggle.getAttribute("aria-label"))
    ).toEqual(["Button, 3", "Image, 2", "Section, 2"]);
  });

  it("folds a type, kept by the host, and opens every type while a search is on", () => {
    const onFold = vi.fn();
    const { section, view } = draw(LIBRARY, {
      folds: { folded: new Set(["block-styles:core/image"]), onFold },
    });
    expect(
      within(section).queryByRole("list", { name: "Image styles" })
    ).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "Image, 2" }));
    expect(onFold).toHaveBeenCalledWith("block-styles:core/image", false);
    fireEvent.click(within(section).getByRole("button", { name: "Button, 3" }));
    expect(onFold).toHaveBeenCalledWith("block-styles:core/button", true);
    view.rerender(
      <BlockLooksGroup
        groups={blockLookGroups(LIBRARY, BUILT_IN)}
        library={LIBRARY}
        tokens={undefined}
        mode="light"
        editing={null}
        folds={{ folded: new Set(["block-styles:core/image"]), onFold }}
        searching
        reachOf={() => undefined}
        blocksOf={() => undefined}
        chip={() => null}
      />
    );
    expect(
      within(screen.getByRole("region", { name: "Block styles" })).getByRole(
        "list",
        { name: "Image styles" }
      )
    ).toBeTruthy();
  });

  it("marks the block's own style ★ until another style carries it", () => {
    const { section } = draw(LIBRARY);
    expect(within(section).getAllByText("★ Default")).toHaveLength(3);
    expect(rowOf(section, "Primary").getAttribute("aria-label")).toBe(
      "Primary, default"
    );
    cleanup();
    const moved = draw(
      LIBRARY.map(entry =>
        entry === GHOST ? { ...GHOST, starred: true as const } : entry
      )
    ).section;
    const button = within(moved).getByRole("list", { name: "Button styles" });
    expect(rowOf(button, "Ghost").getAttribute("aria-label")).toBe(
      "Ghost, default"
    );
    expect(rowOf(button, "Primary").getAttribute("aria-label")).toBe("Primary");
    expect(within(button).getAllByText("★ Default")).toHaveLength(1);
  });

  it("shows a hidden built-in style, saying Hidden", () => {
    const { section } = draw(
      LIBRARY.map(entry =>
        entry === TEXT ? { ...TEXT, hidden: true as const } : entry
      )
    );
    expect(rowOf(section, "Text").getAttribute("aria-label")).toBe(
      "Text, hidden, built-in"
    );
    expect(within(section).getByText("Hidden")).toBeTruthy();
  });

  it("uses no word for the code underneath", () => {
    const { section } = draw(LIBRARY, { actions: actionsOf() });
    expect(section.textContent).not.toMatch(/\bclass(es)?\b/i);
    expect(section.textContent).not.toMatch(/\.nx-/);
  });

  it("offers no action while the author may not change the site's design", () => {
    const { section, onEdit } = draw(LIBRARY, {
      actions: actionsOf(),
      readOnly: true,
    });
    expect(
      within(section).queryByRole("button", { name: /^\+ New / })
    ).toBeNull();
    expect(
      within(section).queryByRole("button", { name: /^More actions/ })
    ).toBeNull();
    // Shown all the same, and opened in the style editor to look at.
    fireEvent.click(rowOf(section, "Ghost"));
    expect(onEdit).toHaveBeenCalledWith({
      id: GHOST.id,
      blockType: "core/button",
    });
  });
});

describe("a block style's ⋯ menu", () => {
  it("offers a style the site made Edit, ★, Rename, Duplicate and Remove", async () => {
    const { section } = draw(LIBRARY, { actions: actionsOf() });
    expect(await menuOf(section, "Ghost")).toEqual([
      "Edit",
      "Set as default ★",
      "Rename",
      "Duplicate",
      "Remove",
    ]);
  });

  it("offers a built-in style Edit, ★, Duplicate and Hide, never Rename or Remove", async () => {
    const { section } = draw(LIBRARY, { actions: actionsOf() });
    expect(await menuOf(section, "Text")).toEqual([
      "Edit",
      "Set as default ★",
      "Duplicate",
      "Hide",
    ]);
  });

  it("moves ★, and gives it back to the block's own style", async () => {
    const actions = actionsOf();
    const starred = LIBRARY.map(entry =>
      entry === GHOST ? { ...GHOST, starred: true as const } : entry
    );
    const { section } = draw(starred, { actions });
    await menuOf(section, "Text");
    fireEvent.click(screen.getByRole("menuitem", { name: "Set as default ★" }));
    expect(actions.setDefault).toHaveBeenCalledWith("core/button", TEXT.id);
    await menuOf(section, "Primary");
    fireEvent.click(screen.getByRole("menuitem", { name: "Set as default ★" }));
    expect(actions.setDefault).toHaveBeenCalledWith("core/button", null);
  });

  it("hides a built-in style, and shows a hidden one again", async () => {
    const actions = actionsOf();
    const hidden = LIBRARY.map(entry =>
      entry === CIRCLE ? { ...CIRCLE, hidden: true as const } : entry
    );
    const { section } = draw(hidden, { actions });
    await menuOf(section, "Text");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(actions.setHidden).toHaveBeenCalledWith(TEXT.id, true);
    await menuOf(section, "Circle");
    fireEvent.click(screen.getByRole("menuitem", { name: "Show" }));
    expect(actions.setHidden).toHaveBeenCalledWith(CIRCLE.id, false);
  });

  it("duplicates a style and opens the copy in the style editor", async () => {
    const actions = actionsOf();
    const { section, onEdit } = draw(LIBRARY, { actions });
    await menuOf(section, "Text");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledWith({
        id: "copy-id",
        blockType: "core/button",
      })
    );
    expect(actions.duplicate).toHaveBeenCalledWith(TEXT.id);
  });

  it("says a removal's refusal under the row, naming where the style is used", async () => {
    const refusal =
      "Nothing was removed. Ghost is used on 2 documents: Home and About.";
    const actions = actionsOf({ remove: vi.fn(async () => refusal) });
    const { section } = draw(LIBRARY, {
      actions,
      // Nothing on the open page wears it, so the route is asked.
      blocksOf: () => ({ count: 0, complete: true }),
    });
    await menuOf(section, "Ghost");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect((await within(section).findByRole("alert")).textContent).toBe(
      refusal
    );
    expect(actions.remove).toHaveBeenCalledWith(GHOST.id);
  });
});

describe("removing a block style the open page uses", () => {
  it("is refused before the route is asked, the page's unsaved blocks counted", async () => {
    const actions = actionsOf();
    const { section } = draw(LIBRARY, {
      actions,
      blocksOf: row =>
        row.id === GHOST.id ? { count: 2, complete: true } : undefined,
    });
    await menuOf(section, "Ghost");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect((await within(section).findByRole("alert")).textContent).toBe(
      "Ghost is used on 2 blocks on this page. Take it off them first."
    );
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it("is refused while the page couldn't be read in full", async () => {
    const actions = actionsOf();
    const { section } = draw(LIBRARY, {
      actions,
      blocksOf: () => ({ count: 0, complete: false }),
    });
    await menuOf(section, "Ghost");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect((await within(section).findByRole("alert")).textContent).toBe(
      "Ghost can't be removed: this page has more blocks than could be read to check it isn't used."
    );
    expect(actions.remove).not.toHaveBeenCalled();
  });
});

describe("making a block style", () => {
  it("asks for a name, makes the style and opens it in the style editor", async () => {
    const actions = actionsOf();
    const { section, onEdit } = draw(LIBRARY, { actions });
    fireEvent.click(
      within(section).getByRole("button", { name: "+ New button style" })
    );
    const field = within(section).getByRole("textbox", {
      name: "New button style name",
    });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "Ghost two" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledWith({
        id: "new-id",
        blockType: "core/button",
      })
    );
    expect(actions.create).toHaveBeenCalledWith("core/button", "Ghost two");
  });

  it("keeps the field open with the refusal when the name can't be used", async () => {
    const reason =
      "Button already has a style named “Text”. Choose another name.";
    const actions = actionsOf({
      create: vi.fn(async () => ({ ok: false as const, reason })),
    });
    const { section, onEdit } = draw(LIBRARY, { actions });
    fireEvent.click(
      within(section).getByRole("button", { name: "+ New button style" })
    );
    const field = within(section).getByRole("textbox", {
      name: "New button style name",
    });
    fireEvent.change(field, { target: { value: "Text" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect((await within(section).findByRole("alert")).textContent).toBe(
      reason
    );
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("puts the field down on Escape, back on its + New row", async () => {
    const { section } = draw(LIBRARY, { actions: actionsOf() });
    fireEvent.click(
      within(section).getByRole("button", { name: "+ New image style" })
    );
    const field = within(section).getByRole("textbox", {
      name: "New image style name",
    });
    fireEvent.keyDown(field, { key: "Escape" });
    const add = within(section).getByRole("button", {
      name: "+ New image style",
    });
    await waitFor(() => expect(document.activeElement).toBe(add));
  });
});

describe("the keys on a block style's row", () => {
  it("renames a style the site made with F2, keeping the row's place", async () => {
    const actions = actionsOf();
    const { section } = draw(LIBRARY, { actions });
    fireEvent.keyDown(rowOf(section, "Ghost"), { key: "F2" });
    const field = within(section).getByRole("textbox", {
      name: "Rename Ghost",
    });
    fireEvent.change(field, { target: { value: "Soft ghost" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(actions.rename).toHaveBeenCalledWith(GHOST.id, "Soft ghost")
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(rowOf(section, "Ghost"))
    );
  });

  it("never renames a built-in style with F2", () => {
    const { section } = draw(LIBRARY, { actions: actionsOf() });
    fireEvent.keyDown(rowOf(section, "Text"), { key: "F2" });
    expect(within(section).queryByRole("textbox")).toBeNull();
  });

  it("closes a menu opened from the row back onto the row, on Escape", async () => {
    const { section } = draw(LIBRARY, { actions: actionsOf() });
    const row = rowOf(section, "Ghost");
    row.focus();
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("opens the ⋯ menu with Shift+F10 and with the menu key", async () => {
    const { section } = draw(LIBRARY, { actions: actionsOf() });
    fireEvent.keyDown(rowOf(section, "Ghost"), { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menu")).toBeTruthy();
    cleanup();
    const again = draw(LIBRARY, { actions: actionsOf() }).section;
    fireEvent.keyDown(rowOf(again, "Hero"), { key: "ContextMenu" });
    expect(await screen.findByRole("menu")).toBeTruthy();
  });
});
