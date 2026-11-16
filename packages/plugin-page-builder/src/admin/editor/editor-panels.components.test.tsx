// @vitest-environment jsdom

/**
 * What the editor hands the Components panel: the very read Add's
 * "Your components" group is handed, the drag, the place a "+" chose, and
 * "Edit component" only where the author may update components.
 *
 * The panels are replaced with recorders, because what is under test is the
 * props this file passes; what the panel does with them is the builder's
 * suite.
 *
 * @module admin/editor/editor-panels.components.test
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The props each recorder was last drawn with. */
const seen: Record<string, Record<string, unknown>> = {};

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  const recorder =
    (name: string) =>
    (props: Record<string, unknown>): null => {
      seen[name] = props;
      return null;
    };
  return {
    ...real,
    ComponentsPanel: recorder("components"),
    InsertPanel: recorder("add"),
  };
});

vi.mock("../pattern-library-client", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    usePatternLibrary: () => ({
      patterns: [],
      state: "ready",
      truncated: false,
      retry: () => {},
    }),
  };
});

const { editorPanelRenderer } = await import("./editor-panels");

afterEach(() => {
  cleanup();
  for (const key of Object.keys(seen)) delete seen[key];
});

/** The canvas's drag, one for every panel drawn. */
const beginInsertDrag = vi.fn();

/** A component read, in the shape the editor's mount holds it. */
function read(
  over: Partial<{
    state: string;
    components: readonly { id: string; title: string }[];
  }> = {}
) {
  return {
    definitions: new Map(),
    components: over.components ?? [{ id: "promo", title: "Promo card" }],
    titleOf: () => undefined,
    truncated: false,
    state: over.state ?? "ready",
    retry: vi.fn(),
  };
}

function draw(
  panel: "add" | "components",
  over: {
    offered?: ReturnType<typeof read>;
    library?: ReturnType<typeof read>;
    onEditComponent?: (componentId: string, nodeId?: string) => void;
    mayCreate?: boolean;
    insertInside?: string;
  } = {}
): void {
  const offered = over.offered ?? read();
  const renderer = editorPanelRenderer({
    editor: {} as never,
    componentLibrary: (over.library ?? offered) as never,
    componentVerbs: { mayCreate: over.mayCreate ?? false } as never,
    componentView: { onEditComponent: over.onEditComponent },
    drag: { beginInsertDrag } as never,
    offered: offered as never,
    offerablePatterns: patterns => patterns,
    requestPanel: () => {},
    insertInside: over.insertInside,
  } as never);
  render(<>{renderer?.(panel, { current: null, choose: () => {} })}</>);
}

describe("the Components panel the editor offers", () => {
  it("reads the one catalogue Add is handed, so a component is offered in both or neither", () => {
    // The whole library and the offered rows apart, as in a component's own
    // view, so a panel handed the library instead is told from one handed
    // what Add offers.
    const offered = read();
    const library = read();
    draw("add", { offered, library });
    draw("components", { offered, library });

    expect(seen.components?.components).toBe(offered.components);
    expect(seen.components?.components).toBe(seen.add?.components);
    expect(seen.components?.componentDefinitions).toBe(
      seen.add?.componentDefinitions
    );
  });

  it("places through the canvas's drag and the container a '+' chose, as Add does", () => {
    draw("add", { insertInside: "box" });
    draw("components", { insertInside: "box" });

    expect(seen.components?.inside).toBe("box");
    expect(seen.components?.inside).toBe(seen.add?.inside);
    expect(seen.components?.beginInsertDrag).toBe(seen.add?.beginInsertDrag);
  });

  it("offers Edit only where the author may update components", () => {
    const onEditComponent = vi.fn();
    draw("components", { onEditComponent });
    expect(seen.components?.onEditComponent).toBe(onEditComponent);
    cleanup();

    draw("components");
    expect(seen.components).not.toHaveProperty("onEditComponent");
  });

  it("says the read is on its way while it is", () => {
    draw("components", { offered: read({ state: "pending" }) });
    expect(seen.components?.loading).toBe(true);
    cleanup();

    draw("components");
    expect(seen.components?.loading).toBe(false);
  });

  it("counts the components left out of the document being edited", () => {
    // A component's own view offers the library without itself.
    const library = read({
      components: [
        { id: "promo", title: "Promo card" },
        { id: "band", title: "CTA band" },
      ],
    });
    draw("components", {
      library,
      offered: read({ components: [{ id: "band", title: "CTA band" }] }),
    });
    expect(seen.components?.withheld).toBe(1);
    cleanup();

    draw("components", { offered: library });
    expect(seen.components?.withheld).toBe(0);
  });

  it("tells the panel whether the author may make a component", () => {
    draw("components", { mayCreate: true });
    expect(seen.components?.mayCreate).toBe(true);
  });
});
