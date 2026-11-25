// @vitest-environment jsdom

/**
 * The page's save point, kept beside its history while the read-only page is
 * drawn.
 *
 * The editor counts its work as what lies away from the depth its history
 * stood at when the page was last stored. A history kept across the read-only
 * page without that depth would read a page saved before the lock was lost
 * as holding unsaved work. So the depth is kept with it, and starts the next
 * editor only where the history does: on the page it was left on.
 *
 * @module admin/editor/kept-editor.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { KeptEditorState } from "@nextlyhq/builder/shell";
import { renderHook } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useCurrentUserId: () => "author-1",
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "pages",
    documentId: "p1",
  }),
  useDocumentLocale: () => null,
}));

const { EditorKeeperContext, useKeptEditor } = await import("./kept-editor");
type EditorKeeper = import("./kept-editor").EditorKeeper;

/** Mounts the editor's side under `keeper`, as the view provides it. */
function mountUnder(keeper: EditorKeeper | undefined, document: BlockDocument) {
  return renderHook(() => useKeptEditor(document), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <EditorKeeperContext.Provider value={keeper}>
        {children}
      </EditorKeeperContext.Provider>
    ),
  });
}

function page(id: string): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [{ id, type: "core/box", version: 1, props: {} }],
  } as BlockDocument;
}

/** What an editor left on `document`, with a history of one edit. */
function left(document: BlockDocument): KeptEditorState {
  return {
    document,
    selection: { ids: [], primary: null },
    history: { undo: [], redo: [], forgotten: 1 },
  };
}

/** A keeper holding `kept`, recording what it is handed. */
function keeperHolding(
  kept: ReturnType<EditorKeeper["kept"]>
): EditorKeeper & { handed: unknown[]; takes: number } {
  const keeper = {
    handed: [] as unknown[],
    takes: 0,
    kept: () => kept,
    keep: (editor: KeptEditorState, savedAt: unknown) => {
      keeper.handed.push({ editor, savedAt });
    },
    taken: () => {
      keeper.takes += 1;
    },
  };
  return keeper;
}

describe("the save point kept with the history", () => {
  it("starts the editor where the kept history was last stored", () => {
    const keeper = keeperHolding({ editor: left(page("a")), savedAt: 1 });

    const { result } = mountUnder(keeper, page("a"));

    expect(result.current.savedAt).toBe(1);
    expect(result.current.keeping?.kept).toEqual(left(page("a")));
    // Read once, and then held no longer.
    expect(keeper.takes).toBe(1);
  });

  it("starts at the opening page on any other page, as the history does", () => {
    const keeper = keeperHolding({ editor: left(page("a")), savedAt: 1 });

    const { result } = mountUnder(keeper, page("x"));

    expect(result.current.savedAt).toBe(0);
  });

  it("hands the save point as it stands with the history the editor leaves", () => {
    const keeper = keeperHolding(undefined);
    const { result } = mountUnder(keeper, page("a"));
    expect(result.current.savedAt).toBe(0);

    result.current.report(2);
    result.current.keeping?.keep(left(page("b")));

    expect(keeper.handed).toEqual([{ editor: left(page("b")), savedAt: 2 }]);
  });

  it("keeps nothing for an editor with no keeper", () => {
    const { result } = mountUnder(undefined, page("a"));

    expect(result.current.keeping).toBeUndefined();
    expect(result.current.savedAt).toBe(0);
  });
});
