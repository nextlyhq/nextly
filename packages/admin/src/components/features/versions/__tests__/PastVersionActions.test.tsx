/**
 * A past version's own actions, where the live document's Save and Publish
 * stand: Compare opens the full comparison of what is on screen, Back to
 * current returns to the live document, and Restore… opens the list of fields
 * the version would put back. Each surface that draws a past version's title
 * bar draws these, so none of them offers a different set.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  DocumentHistoryContext,
  type DocumentHistoryValue,
  type ViewedVersion,
} from "../document-history-context";
import { PastVersionActions } from "../PastVersionActions";
import { useVersionActions } from "../version-actions";

describe("a past version's actions", () => {
  it("offers Compare, Back to current and Restore…, in that order", () => {
    render(
      <PastVersionActions
        versionActions={{
          compareHref:
            "/admin/collections/posts/p1/versions?from=previous&to=4",
          returnToCurrent: vi.fn(),
          restore: vi.fn(),
          restoreDisabled: false,
        }}
      />
    );
    const compare = screen.getByRole("link", { name: "Compare" });
    const back = screen.getByRole("button", { name: "Back to current" });
    const restore = screen.getByRole("button", { name: "Restore…" });
    expect(compare).toHaveAttribute(
      "href",
      "/admin/collections/posts/p1/versions?from=previous&to=4"
    );
    // In reading order: Compare, then Back to current, then Restore….
    expect(
      compare.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      back.compareDocumentPosition(restore) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("returns to the live document, and opens the restore list", async () => {
    const returnToCurrent = vi.fn();
    const restore = vi.fn();
    render(
      <PastVersionActions
        versionActions={{ returnToCurrent, restore, restoreDisabled: false }}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Back to current" })
    );
    expect(returnToCurrent).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Restore…" }));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("offers no restore where restoring is not offered, and waits while the version loads", () => {
    const { rerender } = render(
      <PastVersionActions
        versionActions={{ returnToCurrent: vi.fn(), restoreDisabled: false }}
      />
    );
    expect(
      screen.queryByRole("button", { name: "Restore…" })
    ).not.toBeInTheDocument();
    // No comparison address, no Compare: a link that goes nowhere is worse
    // than none.
    expect(
      screen.queryByRole("link", { name: "Compare" })
    ).not.toBeInTheDocument();

    rerender(
      <PastVersionActions
        versionActions={{
          returnToCurrent: vi.fn(),
          restore: vi.fn(),
          restoreDisabled: true,
        }}
      />
    );
    expect(screen.getByRole("button", { name: "Restore…" })).toBeDisabled();
  });

  it("puts the host's class on each control, so a phone can hide them", () => {
    render(
      <PastVersionActions
        versionActions={{
          compareHref: "/x",
          returnToCurrent: vi.fn(),
          restore: vi.fn(),
          restoreDisabled: false,
        }}
        buttonClassName="wide-only"
      />
    );
    expect(screen.getByRole("link", { name: "Compare" })).toHaveClass(
      "wide-only"
    );
    expect(screen.getByRole("button", { name: "Back to current" })).toHaveClass(
      "wide-only"
    );
    expect(screen.getByRole("button", { name: "Restore…" })).toHaveClass(
      "wide-only"
    );
  });
});

describe("where Compare goes", () => {
  const viewing = (over: Partial<ViewedVersion>): ViewedVersion => ({
    versionNo: 4,
    snapshot: {},
    locale: "es",
    withheld: [],
    isLoading: false,
    error: null,
    scope: { kind: "collection", slug: "posts", entryId: "p1" },
    comparedWith: { kind: "version", versionNo: 3 },
    about: null,
    ...over,
  });
  function ComparedFrom({ value }: { value: DocumentHistoryValue }) {
    return (
      <DocumentHistoryContext.Provider value={value}>
        <Probe />
      </DocumentHistoryContext.Provider>
    );
  }
  function Probe() {
    const actions = useVersionActions(false);
    return <output>{actions?.compareHref ?? "none"}</output>;
  }
  const value = (v: ViewedVersion | null): DocumentHistoryValue => ({
    viewing: v,
    setViewing: vi.fn(),
    restore: null,
    setRestore: vi.fn(),
  });

  it("opens the full comparison of the version on screen with the one before it, in its language", () => {
    render(<ComparedFrom value={value(viewing({}))} />);
    const href = new URL(
      screen.getByRole("status").textContent ?? "",
      "http://localhost"
    );
    expect(href.pathname).toBe("/admin/collections/posts/p1/versions");
    expect(Object.fromEntries(href.searchParams)).toEqual({
      from: "previous",
      to: "4",
      locale: "es",
    });
  });

  it("names a Single's own comparison, with no language where the version holds none", () => {
    render(
      <ComparedFrom
        value={value(
          viewing({
            versionNo: 9,
            locale: null,
            scope: { kind: "single", slug: "homepage" },
          })
        )}
      />
    );
    const href = new URL(
      screen.getByRole("status").textContent ?? "",
      "http://localhost"
    );
    expect(href.pathname).toBe("/admin/singles/homepage/versions");
    expect(Object.fromEntries(href.searchParams)).toEqual({
      from: "previous",
      to: "9",
    });
  });
});
