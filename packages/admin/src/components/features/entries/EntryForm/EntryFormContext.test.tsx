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
 * offers them back, so the two states it can return are the contract: a renderer,
 * or null.
 */
function Consumer({ exclude }: { exclude: string }) {
  const render = useEntryFieldsPanel();
  if (render === null) return <p>no panel</p>;
  return <div data-testid="panel">{render(exclude)}</div>;
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
    // The provider is present but this form hides nothing, which must be
    // distinguishable from "there is a renderer that happens to draw nothing" —
    // the first means withhold the panel, the second means show an empty one.
    render(
      <EntryFormContextProvider collectionSlug="posts">
        <Consumer exclude="content" />
      </EntryFormContextProvider>
    );
    expect(screen.getByText("no panel")).toBeInTheDocument();
  });

  it("hands back the form's own renderer, and passes the excluded path to it", () => {
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
