import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  EntryFormContextProvider,
  useEntryFieldsPanel,
} from "./EntryFormContext";

/**
 * The seam a takeover surface reaches the rest of the entry through.
 *
 * A field that covers the whole form — the page builder is the one that ships —
 * leaves its author unable to reach the entry's other fields without closing the
 * editor and losing its undo history. `useEntryFieldsPanel` is how that surface
 * offers them back, so the two states it can return are the contract: the fields
 * drawn, or null.
 *
 * It answers with the NODE rather than a renderer because a caller makes two
 * decisions from it — whether to offer a region, and what to put in it — and
 * those must not be able to disagree. A renderer could only be gated on its own
 * existence, which is true for every entry form whether or not it draws
 * anything; that is what put an empty panel on the page builder's rail.
 */
function Consumer({ exclude }: { exclude: string }) {
  const fields = useEntryFieldsPanel(exclude);
  if (fields === null) return <p>no panel</p>;
  return <div data-testid="panel">{fields}</div>;
}

describe("useEntryFieldsPanel", () => {
  it("returns null outside an entry form, so a surface offers no panel", () => {
    // Not a thrown error: a field rendered in a preview or a standalone harness
    // is a legitimate arrangement, and the caller needs an answer it can branch
    // on rather than an exception it must catch.
    render(<Consumer exclude="content" />);
    expect(screen.getByText("no panel")).toBeInTheDocument();
  });

  it("returns null when the form supplies no renderer", () => {
    // The provider is present but this form supplies no renderer at all, which
    // is a different fact from a form whose renderer finds nothing to draw.
    // Both now answer null, because a caller does the same thing with either —
    // offer no panel. Distinguishing them only ever produced an empty one.
    render(
      <EntryFormContextProvider collectionSlug="posts">
        <Consumer exclude="content" />
      </EntryFormContextProvider>
    );
    expect(screen.getByText("no panel")).toBeInTheDocument();
  });

  it("answers null when the form's renderer finds nothing to draw", () => {
    /*
     * The defect this shape exists to make unrepresentable. A form whose
     * renderer returns null for this path has nothing to offer, and the caller
     * must reach the same conclusion it reaches outside a form entirely —
     * otherwise it reserves a region and opens it blank. Before this, a caller
     * could only see that a renderer EXISTED, which every entry form's does.
     */
    render(
      <EntryFormContextProvider
        collectionSlug="posts"
        renderEntryFields={() => null}
      >
        <Consumer exclude="sections" />
      </EntryFormContextProvider>
    );
    expect(screen.getByText("no panel")).toBeInTheDocument();
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
  });

  it("draws the form's own fields, and passes the excluded path to it", () => {
    // The path travels to the renderer rather than being resolved here: which
    // field is asking is the CALLER's fact, and a context that guessed it would
    // be wrong for the second takeover surface a collection ever declares.
    render(
      <EntryFormContextProvider
        collectionSlug="posts"
        renderEntryFields={excludePath => (
          <span>fields beside {excludePath}</span>
        )}
      >
        <Consumer exclude="sections" />
      </EntryFormContextProvider>
    );
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(screen.getByText("fields beside sections")).toBeInTheDocument();
  });
});
