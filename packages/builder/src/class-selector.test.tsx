// @vitest-environment jsdom

/**
 * The class selector, driven as an author drives it.
 *
 * `class-library.test.ts` asserts the rules against the compiled stylesheet and
 * establishes what one keystroke resolves to. What is only true HERE is the
 * wiring: that Enter takes the row the author can SEE highlighted, that
 * creating reports the intent the host can act on rather than a node write it
 * cannot, that removing a chip touches only that class, and that a library
 * still loading is not drawn as a library with nothing in it.
 *
 * @module class-selector.test
 */
import { MAX_CLASSES_PER_NODE, type NamedClass } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClassSelector, type ClassSelectorProps } from "./class-selector";

afterEach(cleanup);

const cls = (id: string, slug: string, orderIndex: number): NamedClass => ({
  id,
  slug,
  orderIndex,
  styles: {},
});

/** Stored out of precedence order, so a pass cannot come from reading it raw. */
const LIBRARY: NamedClass[] = [
  cls("id-card", "card", 2),
  cls("id-hero", "hero", 0),
  cls("id-badge", "badge", 1),
];

function draw(overrides: Partial<ClassSelectorProps> = {}): {
  onNodeClassesChange: ReturnType<typeof vi.fn>;
  onCreateClass: ReturnType<typeof vi.fn>;
} {
  // Answers the contract. A bare `vi.fn()` returns undefined, which is not
  // "refused" and so reads as success — the fake would then be asserting a
  // shape the real host cannot use.
  const onNodeClassesChange = vi.fn(() => "applied" as const);
  const onCreateClass = vi.fn();
  render(
    <ClassSelector
      library={LIBRARY}
      nodeClassIds={[]}
      onNodeClassesChange={onNodeClassesChange}
      onCreateClass={onCreateClass}
      {...overrides}
    />
  );
  return { onNodeClassesChange, onCreateClass };
}

/** The selector with a host that can hand it a different node. */
function drawFor(initial: { nodeClassIds: readonly string[] }): {
  rerender: (nodeClassIds: readonly string[]) => void;
} {
  const view = render(
    <ClassSelector
      library={LIBRARY}
      nodeClassIds={initial.nodeClassIds}
      onNodeClassesChange={vi.fn(() => "applied" as const)}
      onCreateClass={vi.fn()}
    />
  );
  return {
    rerender: nodeClassIds =>
      view.rerender(
        <ClassSelector
          library={LIBRARY}
          nodeClassIds={nodeClassIds}
          onNodeClassesChange={vi.fn(() => "applied" as const)}
          onCreateClass={vi.fn()}
        />
      ),
  };
}

const field = (): HTMLElement => screen.getByRole("combobox");

const type = (value: string): void => {
  fireEvent.change(field(), { target: { value } });
};

describe("a library that has not been read yet", () => {
  it("says it is loading rather than drawing an empty library", () => {
    // A site that has stored nothing legitimately has no classes. Drawing the
    // two the same way invites a create into a library about to be replaced.
    render(
      <ClassSelector
        library={undefined}
        nodeClassIds={[]}
        onNodeClassesChange={vi.fn(() => "applied" as const)}
        onCreateClass={vi.fn()}
      />
    );
    expect(screen.getByText(/loading classes/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("the classes already on the node", () => {
  it("lists them in library order, not the order the node stored them", () => {
    // Two nodes listing the same classes differently resolve identically, so
    // the stored order would imply a precedence the renderer ignores.
    draw({ nodeClassIds: ["id-card", "id-hero"] });
    const chips = screen
      .getAllByRole("listitem")
      .map(item => item.textContent ?? "");
    expect(chips[0]).toContain("hero");
    expect(chips[1]).toContain("card");
  });

  it("removes only the chip that was clicked", () => {
    const { onNodeClassesChange } = draw({
      nodeClassIds: ["id-hero", "id-card"],
    });
    fireEvent.click(
      screen.getByRole("button", { name: /remove hero from this element/i })
    );
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-card"]);
  });

  it("says so when the node carries none", () => {
    draw();
    expect(screen.getByText(/no classes on this element/i)).toBeTruthy();
  });
});

describe("what Enter does", () => {
  it("applies the highlighted row, appending rather than replacing", () => {
    const { onNodeClassesChange } = draw({ nodeClassIds: ["id-hero"] });
    type("car");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-hero", "id-card"]);
  });

  it("takes the row the author moved to, not the first one", () => {
    /*
     * The discriminating case for the highlight. `a` matches badge and card, so
     * a single-row query could not tell "applied the highlighted row" from
     * "applied the first row" — both would pass. Arrowing down once has to
     * change the answer.
     */
    const { onNodeClassesChange } = draw();
    type("a");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-card"]);
  });

  it("reports a creation as an intent, not as a node write", () => {
    // The class has no id until the host has stored it, so a node write here
    // would have to invent one.
    const { onCreateClass, onNodeClassesChange } = draw();
    type("call-to-action");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onCreateClass).toHaveBeenCalledWith("call-to-action");
    expect(onNodeClassesChange).not.toHaveBeenCalled();
  });

  it("applies an exact match rather than creating beside it", () => {
    // Create sits last precisely so this keystroke does not make a duplicate.
    const { onCreateClass, onNodeClassesChange } = draw();
    type("hero");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-hero"]);
    expect(onCreateClass).not.toHaveBeenCalled();
  });

  it("does nothing when the query resolves to no row at all", () => {
    // A name the engine's grammar rejects matches nothing and cannot be
    // created, so the keystroke must be inert rather than committing anything.
    const { onCreateClass, onNodeClassesChange } = draw();
    type("Not A Slug");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onCreateClass).not.toHaveBeenCalled();
    expect(onNodeClassesChange).not.toHaveBeenCalled();
  });
});

describe("a node that already holds as many classes as the page applies", () => {
  // The compiler reads the first `MAX_CLASSES_PER_NODE` and strict validation
  // rejects a document holding more, so an application here would be recorded
  // as done while rendering nothing and blocking publication.
  const full = Array.from(
    { length: MAX_CLASSES_PER_NODE },
    (_, index) => `id-filler-${index}`
  );

  it("refuses the application rather than appending a reference", () => {
    const { onNodeClassesChange } = draw({ nodeClassIds: full });
    type("hero");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNodeClassesChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/as many classes/i);
  });

  it("keeps the query so the author is not left guessing what failed", () => {
    draw({ nodeClassIds: full });
    type("hero");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(
      field().getAttribute("value") ?? (field() as HTMLInputElement).value
    ).toBe("hero");
  });

  it("refuses CREATION too, not just application", () => {
    /*
     * The create branch never reaches `withClassApplied` — the id does not
     * exist yet — so fixing the apply path left this one appending a 65th
     * reference through the host. Same bound, asked before the class exists.
     */
    const { onCreateClass } = draw({ nodeClassIds: full });
    type("call-to-action");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onCreateClass).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/as many classes/i);
  });

  it("still applies normally one below the limit", () => {
    // The control: the refusal above is about the boundary, not about the
    // component having stopped applying anything at all.
    const nearly = full.slice(0, MAX_CLASSES_PER_NODE - 1);
    const { onNodeClassesChange } = draw({ nodeClassIds: nearly });
    type("hero");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNodeClassesChange).toHaveBeenCalledWith([...nearly, "id-hero"]);
  });

  it("still CREATES normally one below the limit", () => {
    const nearly = full.slice(0, MAX_CLASSES_PER_NODE - 1);
    const { onCreateClass } = draw({ nodeClassIds: nearly });
    type("call-to-action");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onCreateClass).toHaveBeenCalledWith("call-to-action");
  });
});

describe("what assistive technology is told", () => {
  it("names the highlighted row from the field, and moves it", () => {
    /*
     * Focus stays in the input while the arrows change the highlight, so
     * `aria-selected` on the rows is invisible to a screen reader following
     * focus. `aria-activedescendant` is what names the row Enter would take.
     */
    draw();
    type("a");
    const active = (): string | null =>
      field().getAttribute("aria-activedescendant");
    const rowId = (index: number): string | null =>
      screen.getAllByRole("option")[index]?.getAttribute("id") ?? null;

    expect(active()).not.toBeNull();
    expect(active()).toBe(rowId(0));
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(active()).toBe(rowId(1));
  });

  it("names no row when there is nothing to choose", () => {
    // A stale id pointing at a row that is gone is worse than none: the reader
    // announces a class the keystroke would not apply.
    draw();
    type("Not A Slug");
    expect(field().getAttribute("aria-activedescendant")).toBeNull();
  });
});

describe("a refusal that must not outlive the node it described", () => {
  const full = Array.from(
    { length: MAX_CLASSES_PER_NODE },
    (_, index) => `id-filler-${index}`
  );

  it("stops claiming the element is full once it has room", () => {
    /*
     * The refusal was stored and cleared only by a later successful commit, so
     * removing a chip, an undo, or the host selecting a smaller node all left
     * an alert describing an element that no longer existed. Deriving it from
     * the CURRENT node is what makes that impossible rather than unlikely.
     */
    const { rerender } = drawFor({ nodeClassIds: full });
    type("hero");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toMatch(/as many classes/i);

    rerender(full.slice(0, MAX_CLASSES_PER_NODE - 1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a node the page cannot fully apply", () => {
  it("says how many stored classes style nothing", () => {
    // Otherwise an author has no way to discover the state from the canvas,
    // and a removal looks as though it applied a class it never touched.
    const over = [
      ...Array.from({ length: MAX_CLASSES_PER_NODE }, () => "id-badge"),
      "id-hero",
      "id-card",
    ];
    draw({ nodeClassIds: over });
    expect(screen.getByText(/lists 2 more class/i)).toBeTruthy();
  });

  it("says nothing for a node within the limit", () => {
    draw({ nodeClassIds: ["id-hero"] });
    expect(screen.queryByText(/lists .* more class/i)).toBeNull();
  });
});

describe("a write the document refuses", () => {
  /*
   * A different failure from the node being full: that one is predictable from
   * the ids in hand, this one is only knowable by asking the document — a page
   * at its byte limit rejects an edit whose class was perfectly valid.
   */
  function drawRefusing() {
    const onNodeClassesChange = vi.fn(() => "refused" as const);
    render(
      <ClassSelector
        library={LIBRARY}
        nodeClassIds={[]}
        onNodeClassesChange={onNodeClassesChange}
        onCreateClass={vi.fn()}
      />
    );
    return { onNodeClassesChange };
  }

  it("keeps the typed query rather than clearing it as though applied", () => {
    drawRefusing();
    type("hero");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect((field() as HTMLInputElement).value).toBe("hero");
  });

  it("says the change did not reach the document", () => {
    drawRefusing();
    type("hero");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toMatch(
      /could not be applied/i
    );
  });

  it("clears the query when the write DOES land", () => {
    // The control: the two outcomes must be distinguishable, or the assertion
    // above would hold for a selector that never cleared anything.
    draw();
    type("hero");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect((field() as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a refused REMOVAL too, not only a refused apply", () => {
    const onNodeClassesChange = vi.fn(() => "refused" as const);
    render(
      <ClassSelector
        library={LIBRARY}
        nodeClassIds={["id-hero"]}
        onNodeClassesChange={onNodeClassesChange}
        onCreateClass={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /remove hero from this element/i })
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /could not be applied/i
    );
  });
});

describe("who owns the tab sequence", () => {
  it("keeps option rows out of it, so Tab leaves the field once", () => {
    /*
     * The APG is explicit: with `aria-activedescendant`, only the composite
     * container is tabbable. A focusable child in each row put the whole list
     * into the tab order — an empty query offers up to `MAX_SELECTOR_OPTIONS`
     * rows — and once focus left the input the arrow handler stopped running,
     * so the keyboard lost the widget entirely.
     */
    draw();
    type("");
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.getAttribute("tabindex")).toBe("-1");
      expect(row.querySelector("button, a, input, [tabindex='0']")).toBeNull();
    }
  });

  it("still commits the row a pointer clicks", () => {
    // The control: removing the button must not remove the pointer target.
    const { onNodeClassesChange } = draw();
    type("badge");
    fireEvent.click(screen.getByRole("option"));
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-badge"]);
  });
});

describe("the pointer and the keyboard share one highlight", () => {
  it("moves the highlight to the row the pointer is over", () => {
    /*
     * Styling `:hover` separately would paint a second row while Enter still
     * committed the first — two rows looking chosen, one of them lying. The
     * pointer therefore moves the same state the arrows do.
     */
    draw();
    type("a");
    const rows = screen.getAllByRole("option");
    fireEvent.mouseEnter(rows[1]!);
    expect(field().getAttribute("aria-activedescendant")).toBe(
      rows[1]!.getAttribute("id")
    );
  });

  it("commits the hovered row on Enter, not the one arrowing left behind", () => {
    const { onNodeClassesChange } = draw();
    type("a");
    fireEvent.mouseEnter(screen.getAllByRole("option")[1]!);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-card"]);
  });
});

describe("a class whose id collides with the synthetic create row", () => {
  // A class id is any string the library accepted, `create` included. Keyed by
  // the bare id, the apply row and the create row would share a React key and
  // one row's state would be reused for the other.
  const COLLIDING: NamedClass[] = [cls("create", "cta", 0)];

  it("keeps the two rows distinct and separately committable", () => {
    const { onNodeClassesChange, onCreateClass } = draw({
      library: COLLIDING,
      nodeClassIds: [],
    });
    type("c");
    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(2);

    fireEvent.click(rows[0]!);
    expect(onNodeClassesChange).toHaveBeenCalledWith(["create"]);
    expect(onCreateClass).not.toHaveBeenCalled();
  });

  it("gives each row its own DOM id, so the field can name one of them", () => {
    draw({ library: COLLIDING, nodeClassIds: [] });
    type("c");
    const ids = screen
      .getAllByRole("option")
      .map(row => row.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives the two rows different REACT keys", () => {
    /*
     * The only observable consequence, and it took a passing break to find it:
     * duplicate keys leave both rows rendered, separately clickable and with
     * distinct DOM ids, so every assertion about the markup holds either way.
     * React itself is what notices, and the cost — one row's state reused for
     * the other across a re-render — is exactly what is invisible in a single
     * render.
     */
    const reported: unknown[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        reported.push(args);
      });
    try {
      draw({ library: COLLIDING, nodeClassIds: [] });
      type("c");
      // The control: two rows really were drawn, so an empty warning list is
      // about the keys and not about nothing having rendered.
      expect(screen.getAllByRole("option")).toHaveLength(2);
      const text = reported.map(entry => String(entry)).join(" ");
      expect(text).not.toMatch(/same key/i);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the list of options", () => {
  it("offers creation last, after the matches", () => {
    draw();
    type("ca");
    const rows = screen
      .getAllByRole("option")
      .map(row => row.textContent ?? "");
    expect(rows[0]).toContain("card");
    expect(rows[rows.length - 1]).toContain("Create");
  });

  it("marks exactly one row selected, and moves it with the arrow keys", () => {
    draw();
    type("a");
    const selected = (): string =>
      screen
        .getAllByRole("option")
        .find(row => row.getAttribute("aria-selected") === "true")
        ?.textContent ?? "";
    expect(selected()).toContain("badge");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(selected()).toContain("card");
  });

  it("wraps from the last row back to the first", () => {
    // The create row is at the bottom; wrapping is what makes it and the first
    // match one keystroke apart rather than a list's length apart.
    draw();
    type("a");
    const rows = screen.getAllByRole("option").length;
    for (let index = 0; index < rows; index += 1) {
      fireEvent.keyDown(field(), { key: "ArrowUp" });
    }
    expect(
      screen.getAllByRole("option")[0]?.getAttribute("aria-selected")
    ).toBe("true");
  });

  it("clears the field after a commit, ready for the next class", () => {
    draw();
    type("card");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect((field() as HTMLInputElement).value).toBe("");
  });

  it("offers no row for a class the node already carries", () => {
    draw({ nodeClassIds: ["id-hero"] });
    type("hero");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("applies the row that was clicked", () => {
    const { onNodeClassesChange } = draw();
    type("badge");
    fireEvent.click(screen.getByRole("option"));
    expect(onNodeClassesChange).toHaveBeenCalledWith(["id-badge"]);
  });
});
