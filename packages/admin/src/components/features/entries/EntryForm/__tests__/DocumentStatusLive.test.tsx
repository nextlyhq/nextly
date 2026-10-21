/**
 * DocumentStatusLive — settled status in one polite region, a failed save in an
 * assertive one.
 *
 * Each negative assertion carries its positive control on the same render: the
 * region itself is always queried first, so "the text is absent" cannot pass
 * because nothing rendered at all.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocumentStatusLive } from "../DocumentStatusLive";
import type { DocumentSaveState } from "../useDocumentActionBindings";

const SAVED: DocumentSaveState = {
  kind: "saved",
  at: new Date("2026-08-17T10:00:00Z"),
};
const FAILED: DocumentSaveState = {
  kind: "failed",
  message: "The slug is taken.",
  retry: () => Promise.resolve({ ok: true }),
};

function region() {
  return screen.getByTestId("document-status-live");
}

function failureRegion() {
  return screen.getByTestId("document-status-failure");
}

describe("DocumentStatusLive — the regions themselves", () => {
  it("has a polite status region and an assertive failure region, both present before they speak", () => {
    render(<DocumentStatusLive />);
    // Present up front: a region mounted and populated in the same commit is
    // not reliably announced, so its existence is the property under test.
    expect(region()).toHaveAttribute("role", "status");
    expect(region()).toHaveAttribute("aria-live", "polite");
    expect(failureRegion()).toHaveAttribute("aria-live", "assertive");
    expect(region().textContent).toBe("");
    expect(failureRegion().textContent).toBe("");
  });
});

describe("DocumentStatusLive — settled save states are announced politely", () => {
  it("announces stored work once a save lands", () => {
    render(<DocumentStatusLive saveState={SAVED} />);
    expect(region()).toHaveTextContent("Your work is stored");
  });

  it("announces unstored edits", () => {
    render(<DocumentStatusLive saveState={{ kind: "unsaved" }} />);
    expect(region()).toHaveTextContent(
      "You have edits that are not yet stored"
    );
  });

  it("announces unstored edits when they live only in a newer recovery point", () => {
    render(<DocumentStatusLive saveState={SAVED} pendingRecovery />);
    expect(region()).toHaveTextContent(
      "You have edits that are not yet stored"
    );
  });

  it("says nothing for an opened document nothing has been stored in yet", () => {
    render(<DocumentStatusLive saveState={{ kind: "saved", at: null }} />);
    expect(region()).toHaveAttribute("role", "status");
    expect(region().textContent).toBe("");
  });
});

describe("DocumentStatusLive — a failed save is announced at once", () => {
  it("announces the failure assertively, naming it, and not politely", () => {
    render(<DocumentStatusLive saveState={FAILED} />);
    expect(failureRegion()).toHaveTextContent("Not saved. The slug is taken.");
    expect(region()).toHaveAttribute("role", "status");
    expect(region().textContent).toBe("");
  });

  it("announces the same failure again after a save in between", () => {
    const { rerender } = render(<DocumentStatusLive saveState={FAILED} />);
    rerender(<DocumentStatusLive saveState={SAVED} />);
    // Cleared once the failure is over, so a repeat changes the region.
    expect(failureRegion().textContent).toBe("");
    rerender(<DocumentStatusLive saveState={FAILED} />);
    expect(failureRegion()).toHaveTextContent("Not saved. The slug is taken.");
  });
});

describe("DocumentStatusLive — the transient state is deliberately silent", () => {
  it("says nothing while a save is in flight", () => {
    render(<DocumentStatusLive saveState={{ kind: "saving" }} />);
    // Control: the region IS rendered, so an empty string here is a decision
    // not to announce rather than a component that failed to mount.
    expect(region()).toHaveAttribute("role", "status");
    expect(region().textContent).toBe("");
  });

  it("keeps the previous announcement rather than clearing it mid-save", () => {
    const { rerender } = render(<DocumentStatusLive saveState={SAVED} />);
    expect(region()).toHaveTextContent("Your work is stored");

    rerender(<DocumentStatusLive saveState={{ kind: "saving" }} />);
    // Clearing a live region is voiced as an interruption by some readers, so
    // the last settled message stays put while the transient state passes.
    expect(region()).toHaveTextContent("Your work is stored");
  });
});

describe("DocumentStatusLive — translation progress", () => {
  it("announces progress in a multilingual collection", () => {
    render(<DocumentStatusLive translatedCount={3} localeCount={5} />);
    expect(region()).toHaveTextContent("3 of 5 languages translated");
  });

  it("stays silent when only one language is configured", () => {
    render(<DocumentStatusLive translatedCount={1} localeCount={1} />);
    // Control paired: the multilingual case above proves the matcher resolves,
    // and the region is asserted present here on this render too.
    expect(region()).toHaveAttribute("role", "status");
    expect(region().textContent).toBe("");
  });

  it("combines both kinds of status in one region", () => {
    render(
      <DocumentStatusLive
        saveState={SAVED}
        translatedCount={2}
        localeCount={4}
      />
    );
    const el = region();
    expect(el).toHaveTextContent("Your work is stored");
    expect(el).toHaveTextContent("2 of 4 languages translated");
  });
});
