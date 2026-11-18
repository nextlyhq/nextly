// @vitest-environment jsdom

/**
 * The editing target: which document the editor edits, the page or a region
 * of its layout drawn from another document, and the two histories that keeps
 * apart. What is only true here is the routing: an edit, an undo and a step
 * recorded from outside the document reach the active state alone, the
 * region's history starts empty and is dropped on leaving, and the page's is
 * untouched throughout.
 *
 * @module editing-target.test
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  canvasEditingOf,
  regionEscape,
  useEditingTarget,
  type RegionEditing,
} from "./editing-target";
import { useEditorState } from "./editor-state";

function node(id: string): BlockNode {
  return { id, type: "core/box", version: 1, props: {} };
}

function doc(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

function ids(d: BlockDocument): string[] {
  return d.nodes.map(n => n.id);
}

const insert = (id: string, index: number) =>
  ({ kind: "insert", node: node(id), at: { index } }) as const;

/** The site header, as a host hands it over: its document and words. */
function header(nodes: BlockNode[] = [node("logo")]): RegionEditing {
  return {
    area: "header",
    document: { ...doc(nodes), kind: "component" },
    label: "Site header",
    words: {
      bar: "Editing the site header · changes show on 11 pages",
      done: "Done",
      entered: "Editing the site header. Changes show on 11 pages.",
      left: "Back to the page.",
    },
  };
}

function renderEditing() {
  return renderHook(() => {
    const page = useEditorState({ initialDocument: doc([node("hero")]) });
    const editing = useEditingTarget(page);
    return { page, editing };
  });
}

function step(calls: string[], name: string) {
  return {
    undo: () => {
      calls.push(`undo ${name}`);
      return Promise.resolve(true);
    },
    redo: () => {
      calls.push(`redo ${name}`);
      return Promise.resolve(true);
    },
  };
}

describe("the page as the target", () => {
  it("edits the page until a region is entered", () => {
    const { result } = renderEditing();
    expect(result.current.editing.target).toEqual({ kind: "page" });
    expect(result.current.editing.active).toBe(result.current.page);
    expect(canvasEditingOf(result.current.editing)).toBeUndefined();
  });
});

describe("two histories", () => {
  it("undoes the header's edits only, from an empty history, and keeps the page's", () => {
    const { result } = renderEditing();
    // An edit to the page first: its history holds one step.
    act(() => {
      result.current.editing.active.apply(insert("intro", 1));
    });
    expect(result.current.page.undoDepth).toBe(1);

    act(() => result.current.editing.enter(header()));
    const { active } = result.current.editing;
    expect(active).not.toBe(result.current.page);
    expect(ids(active.document)).toEqual(["logo"]);
    // The header's history starts empty, whatever the page's holds.
    expect(active.canUndo).toBe(false);

    act(() => {
      result.current.editing.active.apply(insert("nav", 1));
    });
    act(() => {
      result.current.editing.active.apply(insert("cta", 2));
    });
    expect(ids(result.current.editing.active.document)).toEqual([
      "logo",
      "nav",
      "cta",
    ]);

    // Three presses of Undo: the header's two come back, the third reaches
    // nothing, and the page's edit stays.
    for (let press = 0; press < 3; press += 1) {
      act(() => {
        result.current.editing.active.undo();
      });
    }
    expect(ids(result.current.editing.active.document)).toEqual(["logo"]);
    expect(result.current.editing.active.canUndo).toBe(false);
    expect(ids(result.current.page.document)).toEqual(["hero", "intro"]);
    expect(result.current.page.undoDepth).toBe(1);
  });

  it("leaves the page's document frozen while the header is edited", () => {
    const { result } = renderEditing();
    const before = result.current.page.document;
    act(() => result.current.editing.enter(header()));
    act(() => {
      result.current.editing.active.apply(insert("nav", 1));
    });
    expect(result.current.page.document).toBe(before);
    expect(result.current.page.canUndo).toBe(false);
  });

  it("drops the header's history at Done and restores the page's", () => {
    const { result } = renderEditing();
    act(() => {
      result.current.editing.active.apply(insert("intro", 1));
    });
    act(() => result.current.page.select("hero"));
    act(() => result.current.editing.enter(header()));
    act(() => {
      result.current.editing.active.apply(insert("nav", 1));
    });

    act(() => result.current.editing.leave());
    expect(result.current.editing.target).toEqual({ kind: "page" });
    expect(result.current.editing.active).toBe(result.current.page);
    // The page's selection as it was before entering.
    expect(result.current.page.selectedId).toBe("hero");

    // Undo after Done reaches the page's edit, never the header's.
    act(() => {
      result.current.editing.active.undo();
    });
    expect(ids(result.current.page.document)).toEqual(["hero"]);

    // Entering again starts from the header handed over, with no history.
    act(() => result.current.editing.enter(header([node("logo2")])));
    expect(ids(result.current.editing.active.document)).toEqual(["logo2"]);
    expect(result.current.editing.active.canUndo).toBe(false);
    expect(result.current.editing.active.canRedo).toBe(false);
  });

  it("starts the footer's history apart from the header's", () => {
    const { result } = renderEditing();
    act(() => result.current.editing.enter(header()));
    act(() => {
      result.current.editing.active.apply(insert("nav", 1));
    });
    act(() =>
      result.current.editing.enter({
        ...header([node("legal")]),
        area: "footer",
        label: "Site footer",
      })
    );
    expect(ids(result.current.editing.active.document)).toEqual(["legal"]);
    expect(result.current.editing.active.canUndo).toBe(false);
  });
});

describe("a Design-panel step while the header is edited", () => {
  it("joins the header's history and leaves it at Done", async () => {
    const calls: string[] = [];
    const { result } = renderEditing();
    act(() => result.current.editing.enter(header()));
    // What the site-style saves record: a step of the ACTIVE history.
    act(() => result.current.editing.active.recordStep(step(calls, "style")));
    expect(result.current.editing.active.canUndo).toBe(true);
    expect(result.current.page.canUndo).toBe(false);

    await act(async () => result.current.editing.active.undo());
    expect(calls).toEqual(["undo style"]);
    await act(async () => result.current.editing.active.redo());
    expect(calls).toEqual(["undo style", "redo style"]);

    act(() => result.current.editing.leave());
    // Saved to the site already; only its undo is gone.
    expect(result.current.editing.active.canUndo).toBe(false);
    await act(async () => result.current.editing.active.undo());
    expect(calls).toEqual(["undo style", "redo style"]);
  });
});

describe("what the region's editing says and draws", () => {
  it("announces entering and leaving in the host's words", () => {
    const { result } = renderEditing();
    expect(result.current.editing.announcement).toBe("");
    act(() => result.current.editing.enter(header()));
    expect(result.current.editing.announcement).toBe(
      "Editing the site header. Changes show on 11 pages."
    );
    act(() => result.current.editing.leave());
    expect(result.current.editing.announcement).toBe("Back to the page.");
  });

  it("counts a press on the dimmed page as one more pulse of Done", () => {
    const { result } = renderEditing();
    act(() => result.current.editing.enter(header()));
    const before = result.current.editing.pulse;
    act(() => result.current.editing.pulseDone());
    act(() => result.current.editing.pulseDone());
    expect(result.current.editing.pulse).toBe(before + 2);
  });

  it("hands the canvas the region's live document while it is edited", () => {
    const { result } = renderEditing();
    act(() => result.current.editing.enter(header()));
    act(() => {
      result.current.editing.active.apply(insert("nav", 1));
    });
    const drawn = canvasEditingOf(result.current.editing);
    expect(drawn?.area).toBe("header");
    expect(drawn?.document).toBe(result.current.editing.active.document);
  });

  it("leaves the region on Escape with nothing selected, else runs the host's own", () => {
    const { result } = renderEditing();
    const otherwise = vi.fn();
    const done = vi.fn();
    regionEscape(result.current.editing, { done, otherwise })();
    expect(otherwise).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();

    act(() => result.current.editing.enter(header()));
    regionEscape(result.current.editing, { done, otherwise })();
    expect(done).toHaveBeenCalledTimes(1);
    expect(otherwise).toHaveBeenCalledTimes(1);

    // Without a Done of the host's, Escape leaves at once.
    act(() => regionEscape(result.current.editing, { otherwise })());
    expect(result.current.editing.target.kind).toBe("page");
  });
});
