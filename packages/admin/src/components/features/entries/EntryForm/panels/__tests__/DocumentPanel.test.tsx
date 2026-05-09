import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { DocumentPanel, formatId, pillStateFromForm } from "../DocumentPanel";

describe("formatId", () => {
  it("returns em-dash for null/undefined/empty", () => {
    expect(formatId(undefined)).toBe("—");
    expect(formatId(null)).toBe("—");
    expect(formatId("")).toBe("—");
  });

  it("returns the original string for short ids (≤9 chars)", () => {
    // Why: at 9 chars or fewer the truncated form ('xxxxx…xxx') would
    // be longer than the original, so the helper just returns it.
    expect(formatId("abc")).toBe("abc");
    expect(formatId("abc12345")).toBe("abc12345");
    expect(formatId("123456789")).toBe("123456789");
  });

  it("truncates long ids as `first5…last3`", () => {
    expect(formatId("1234567890")).toBe("12345…890");
    expect(formatId("548e813c-8266-40c3-bd9c-ca1816f8")).toBe("548e8…6f8");
  });
});

describe("DocumentPanel", () => {
  beforeEach(() => {
    // Why: jsdom doesn't ship a clipboard implementation; install a
    // spy so the IdRow's copy button has something callable to await.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders nothing in create mode", () => {
    const { container } = render(
      <DocumentPanel mode="create" entry={null} hasStatus />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders ID + timestamps in edit mode", () => {
    render(
      <DocumentPanel
        mode="edit"
        entry={{
          id: "548e813c-8266-40c3-bd9c-ca1816f8",
          status: "draft",
          createdAt: "2026-03-05T14:14:00Z",
          updatedAt: "2026-03-05T14:30:00Z",
        }}
        hasStatus={false}
      />
    );

    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
    // Truncated id is what the user sees in the row.
    expect(screen.getByText("548e8…6f8")).toBeInTheDocument();
    // Status row is hidden when hasStatus is false.
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  it("shows Status pill when hasStatus is on", () => {
    render(
      <DocumentPanel
        mode="edit"
        entry={{ id: "x", status: "published" }}
        hasStatus
      />
    );

    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("defaults Status pill to Draft when entry.status missing", () => {
    render(<DocumentPanel mode="edit" entry={{ id: "x" }} hasStatus />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("copies the FULL id to clipboard, not the truncated label", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: { writeText },
    });

    render(
      <DocumentPanel
        mode="edit"
        entry={{ id: "548e813c-8266-40c3-bd9c-ca1816f8", status: "draft" }}
        hasStatus={false}
      />
    );

    await user.click(
      screen.getByRole("button", { name: /Copy ID to clipboard/i })
    );

    expect(writeText).toHaveBeenCalledWith("548e813c-8266-40c3-bd9c-ca1816f8");
  });

  it("renders the copy button without requiring hover", () => {
    render(
      <DocumentPanel
        mode="edit"
        entry={{ id: "abc12345-1234-5678-9012-deadbeefcafe" }}
        hasStatus={false}
      />
    );
    // Why: the previous implementation hid the copy button behind
    // group-hover:opacity-100; the heavy polish makes it persistent so
    // the affordance is discoverable on touch and at-rest.
    expect(
      screen.getByRole("button", { name: /Copy ID to clipboard/i })
    ).toBeInTheDocument();
  });

  it("renders the Modified pill when entry is published and form is dirty", () => {
    // pill shows that the published version exists AND there are local
    // edits not yet saved. Drafts never show Modified (they're inherently
    // work-in-progress) — covered separately below.
    render(
      <DocumentPanel
        mode="edit"
        entry={{ id: "x", status: "published" }}
        hasStatus
        isDirty
      />
    );
    expect(screen.getByText("Modified")).toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("does not render Modified when published entry is clean", () => {
    render(
      <DocumentPanel
        mode="edit"
        entry={{ id: "x", status: "published" }}
        hasStatus
        isDirty={false}
      />
    );
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
  });

  it("does not render Modified when draft entry is dirty (drafts can't be modified)", () => {
    render(
      <DocumentPanel
        mode="edit"
        entry={{ id: "x", status: "draft" }}
        hasStatus
        isDirty
      />
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
  });
});

describe("pillStateFromForm", () => {
  it("returns 'draft' when status is draft", () => {
    expect(pillStateFromForm("draft", false)).toBe("draft");
    expect(pillStateFromForm("draft", true)).toBe("draft");
  });

  it("returns 'published' when status is published and form is clean", () => {
    expect(pillStateFromForm("published", false)).toBe("published");
  });

  it("returns 'modified' when status is published and form is dirty", () => {
    expect(pillStateFromForm("published", true)).toBe("modified");
  });

  it("returns 'draft' when status is undefined", () => {
    expect(pillStateFromForm(undefined, false)).toBe("draft");
    expect(pillStateFromForm(undefined, true)).toBe("draft");
  });
});
