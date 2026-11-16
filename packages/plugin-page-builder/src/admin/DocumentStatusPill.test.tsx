// @vitest-environment jsdom
/**
 * The editor's page status: the saved document's state, in the entry page's
 * words, and nothing about unsaved edits (the save chip reports those).
 *
 * The rule itself is the admin's (`savedPillState`), used here unmocked, so a
 * pill that drifted to a rule of its own would fail these cases. Unsaved edits
 * on a published page are covered where an edit can actually happen, in the
 * editor's own harness (`BlocksField.settingsPanel.test.tsx`).
 */
import type { DocumentStatus } from "@nextlyhq/plugin-sdk/admin";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** What the surrounding form reports, set by each case. */
let status: DocumentStatus | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDocumentStatus: () => status,
}));

const { DocumentStatusPill } = await import("./DocumentStatusPill");

afterEach(() => {
  cleanup();
  status = null;
});

/** The pill's visible words, without the screen-reader subject. */
function pillWords(): string {
  const pill = screen.getByText(/Page status/).parentElement;
  if (pill === null) throw new Error("the pill was not drawn");
  return pill.textContent?.replace("Page status: ", "") ?? "";
}

describe("DocumentStatusPill", () => {
  it.each([
    ["a draft", { status: "draft", hasWorkingDraft: false }, "Draft"],
    [
      "a published page",
      { status: "published", hasWorkingDraft: false },
      "Published",
    ],
    [
      "a published page with saved changes not yet live",
      { status: "published", hasWorkingDraft: true },
      "Changed",
    ],
    // A draft's working copy is the draft itself: still a draft.
    [
      "a draft with a working draft",
      { status: "draft", hasWorkingDraft: true },
      "Draft",
    ],
  ] as const)("reads %s as %s", (_name, facts, words) => {
    status = facts;
    render(<DocumentStatusPill />);
    expect(pillWords()).toBe(words);
  });

  it("draws nothing where no form reports a status", () => {
    status = null;
    const { container } = render(<DocumentStatusPill />);
    expect(container.childElementCount).toBe(0);
  });
});
