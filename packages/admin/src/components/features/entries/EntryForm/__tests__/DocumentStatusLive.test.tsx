/**
 * DocumentStatusLive — one polite region, announcing only settled state.
 *
 * Each negative assertion carries its positive control on the same render: the
 * region itself is always queried first, so "the text is absent" cannot pass
 * because nothing rendered at all.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocumentStatusLive } from "../DocumentStatusLive";

const SAVED_AT = new Date("2026-08-17T10:00:00Z");

function region() {
  return screen.getByTestId("document-status-live");
}

describe("DocumentStatusLive — the region itself", () => {
  it("is a polite status region that exists before it has anything to say", () => {
    render(<DocumentStatusLive />);
    const el = region();
    // Present up front: a region mounted and populated in the same commit is
    // not reliably announced, so its existence is the property under test.
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-live", "polite");
    expect(el.textContent).toBe("");
  });
});

describe("DocumentStatusLive — settled autosave states are announced", () => {
  it("announces Saved when clean with a recovery point", () => {
    render(
      <DocumentStatusLive
        autosaveEnabled
        lastSavedAt={SAVED_AT}
        isDirty={false}
      />
    );
    expect(region()).toHaveTextContent("Saved");
  });

  it("announces Unsaved changes when dirty after a save", () => {
    render(
      <DocumentStatusLive autosaveEnabled lastSavedAt={SAVED_AT} isDirty />
    );
    expect(region()).toHaveTextContent("Unsaved changes");
  });

  it("announces Not saved when dirty with no recovery point yet", () => {
    render(<DocumentStatusLive autosaveEnabled lastSavedAt={null} isDirty />);
    expect(region()).toHaveTextContent("Not saved");
  });
});

describe("DocumentStatusLive — the transient state is deliberately silent", () => {
  it("says nothing while a save is in flight", () => {
    render(
      <DocumentStatusLive
        autosaveEnabled
        isSaving
        lastSavedAt={SAVED_AT}
        isDirty
      />
    );
    // Control: the region IS rendered, so an empty string here is a decision
    // not to announce rather than a component that failed to mount.
    expect(region()).toHaveAttribute("role", "status");
    expect(region().textContent).toBe("");
  });

  it("keeps the previous announcement rather than clearing it mid-save", () => {
    const { rerender } = render(
      <DocumentStatusLive
        autosaveEnabled
        lastSavedAt={SAVED_AT}
        isDirty={false}
      />
    );
    expect(region()).toHaveTextContent("Saved");

    rerender(
      <DocumentStatusLive
        autosaveEnabled
        isSaving
        lastSavedAt={SAVED_AT}
        isDirty
      />
    );
    // Clearing a live region is voiced as an interruption by some readers, so
    // the last settled message stays put while the transient state passes.
    expect(region()).toHaveTextContent("Saved");
  });
});

describe("DocumentStatusLive — nothing to report", () => {
  it("stays silent when autosave is not available", () => {
    render(
      <DocumentStatusLive autosaveEnabled={false} isDirty lastSavedAt={null} />
    );
    expect(region()).toHaveAttribute("role", "status");
    expect(region().textContent).toBe("");
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
        autosaveEnabled
        lastSavedAt={SAVED_AT}
        isDirty={false}
        translatedCount={2}
        localeCount={4}
      />
    );
    const el = region();
    expect(el).toHaveTextContent("Saved");
    expect(el).toHaveTextContent("2 of 4 languages translated");
  });
});
