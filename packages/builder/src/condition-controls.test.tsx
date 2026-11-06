// @vitest-environment jsdom

/**
 * "Show when" in a block's Content tab: what it shows for a block with no
 * conditions, one AND group, groups set through the API and a condition the
 * page can't check, and what it writes.
 */
import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ShowWhen } from "./condition-controls";
import type { ContentServices, LoopCollection } from "./content-controls";
import { useEditorState, type EditorState } from "./editor-state";

afterEach(cleanup);

const POSTS: LoopCollection = {
  slug: "posts",
  label: "Posts",
  singular: "Post",
  fields: [
    { name: "title", label: "Title", kind: "text" },
    { name: "rating", label: "Reading time", kind: "number" },
  ],
  declared: ["id", "title", "rating", "secret"],
};

const services: ContentServices = {
  listLoopCollections: async () => [POSTS],
  entryCollection: "posts",
};

let editorRef: EditorState | null = null;

function Host({ document }: { document: BlockDocument }): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  return <ShowWhen editor={editor} nodeId="a" services={services} />;
}

function withConditions(conditions?: unknown): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "core/heading",
        version: 1,
        props: {},
        ...(conditions === undefined ? {} : { visibility: { conditions } }),
      },
    ],
  } as BlockDocument;
}

async function shown(document: BlockDocument): Promise<void> {
  render(<Host document={document} />);
  // The collections are read once, then the rows and their sentences draw.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Show when", () => {
  it("says a block with no conditions is always shown, and names its entry", async () => {
    await shown(withConditions());
    expect(screen.getByText("Always shown.")).toBeTruthy();
    expect(screen.getByText("This post")).toBeTruthy();
  });

  it("draws one AND group as sentences", async () => {
    await shown(
      withConditions([
        [
          { field: "title", op: "contains", value: "guide" },
          { field: "rating", op: "gt", value: 5 },
        ],
      ])
    );
    expect(
      screen.getByText(
        "Show this block only when all of these match this post."
      )
    ).toBeTruthy();
    expect(screen.getByTitle("Title contains “guide”")).toBeTruthy();
    // An older spelling reads as the operator it names.
    expect(screen.getByTitle("Reading time is more than 5")).toBeTruthy();
  });

  it("removes a condition, and the block's visibility with the last one", async () => {
    await shown(withConditions([[{ field: "title", op: "exists" }]]));
    act(() => {
      screen
        .getByRole("button", { name: "Remove condition: Title has a value" })
        .click();
    });
    expect(
      findNode(editorRef!.document.nodes, "a")?.visibility
    ).toBeUndefined();
  });

  it("says visitors never see a block whose condition the page can't check", async () => {
    await shown(withConditions([[{ field: "secret", op: "exists" }]]));
    expect(screen.getByRole("alert").textContent).toContain(
      "Visitors never see this block."
    );
  });

  it("shows groups set through the API, and keeps the first when asked", async () => {
    await shown(
      withConditions([
        [{ field: "title", op: "exists" }],
        [{ field: "rating", op: "less_than", value: 3 }],
      ])
    );
    expect(
      screen.getByText(
        "Shown when any of these groups match. They were set through the API."
      )
    ).toBeTruthy();
    act(() => {
      screen.getByRole("button", { name: "Edit as one group" }).click();
    });
    expect(findNode(editorRef!.document.nodes, "a")?.visibility).toEqual({
      conditions: [[{ field: "title", op: "exists" }]],
    });
  });
});
