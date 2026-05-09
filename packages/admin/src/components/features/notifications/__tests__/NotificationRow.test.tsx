// F10 PR 5 — NotificationRow component tests.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { JournalRow } from "@admin/services/journalApi";

import { NotificationRow } from "../NotificationRow";

const baseRow: JournalRow = {
  id: "id-1",
  source: "ui",
  status: "success",
  scope: { kind: "collection", slug: "posts" },
  summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
  startedAt: "2026-04-30T11:59:58.000Z",
  endedAt: "2026-04-30T11:59:58.500Z",
  durationMs: 500,
  errorCode: null,
  errorMessage: null,
};

describe("NotificationRow", () => {
  it("renders a success row with title, summary, and duration", () => {
    render(<NotificationRow row={baseRow} />);
    expect(screen.getByText("Posts")).toBeInTheDocument();
    expect(screen.getByText(/1 field added/)).toBeInTheDocument();
    expect(screen.getByText(/500ms/)).toBeInTheDocument();
  });

  it("renders a failed row with error code and 'click to expand' affordance", () => {
    render(
      <NotificationRow
        row={{
          ...baseRow,
          status: "failed",
          errorCode: "DDL_FAILED",
          errorMessage: "syntax error at line 42",
        }}
      />
    );
    expect(screen.getByText(/DDL_FAILED/)).toBeInTheDocument();
    expect(screen.getByText(/click to expand/)).toBeInTheDocument();
    // Detail is hidden until expanded.
    expect(
      screen.queryByTestId("notification-row-error-detail")
    ).not.toBeInTheDocument();
  });

  it("clicking a failed row toggles the expanded error detail", () => {
    render(
      <NotificationRow
        row={{
          ...baseRow,
          status: "failed",
          errorCode: "DDL_FAILED",
          errorMessage: "syntax error at line 42",
        }}
      />
    );
    fireEvent.click(screen.getByTestId("notification-row"));
    const detail = screen.getByTestId("notification-row-error-detail");
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveTextContent("syntax error at line 42");

    fireEvent.click(screen.getByTestId("notification-row"));
    expect(
      screen.queryByTestId("notification-row-error-detail")
    ).not.toBeInTheDocument();
  });

  it("Enter key toggles the expanded detail (keyboard a11y)", () => {
    render(
      <NotificationRow
        row={{
          ...baseRow,
          status: "failed",
          errorCode: "X",
          errorMessage: "boom",
        }}
      />
    );
    const root = screen.getByTestId("notification-row");
    fireEvent.keyDown(root, { key: "Enter" });
    expect(
      screen.getByTestId("notification-row-error-detail")
    ).toBeInTheDocument();
  });

  it("renders an in-progress row with 'In progress…'", () => {
    render(
      <NotificationRow
        row={{
          ...baseRow,
          status: "in_progress",
          endedAt: null,
          durationMs: null,
          summary: null,
        }}
      />
    );
    expect(screen.getByText(/In progress/)).toBeInTheDocument();
  });

  it("renders fresh-push scope as 'Fresh setup'", () => {
    render(
      <NotificationRow
        row={{
          ...baseRow,
          scope: { kind: "fresh-push" },
        }}
      />
    );
    expect(screen.getByText("Fresh setup")).toBeInTheDocument();
  });

  it("renders null scope (legacy row) as 'Schema'", () => {
    render(
      <NotificationRow
        row={{
          ...baseRow,
          scope: null,
          summary: null,
          durationMs: null,
        }}
      />
    );
    expect(screen.getByText("Schema")).toBeInTheDocument();
    // The success-row body is rendered as a JSX fragment with multiple
    // text nodes; use a regex matcher so we don't depend on text-node
    // boundaries.
    expect(screen.getByText(/Schema apply/)).toBeInTheDocument();
  });

  it("does not make non-failed rows clickable", () => {
    render(<NotificationRow row={baseRow} />);
    const root = screen.getByTestId("notification-row");
    expect(root).not.toHaveAttribute("role", "button");
    expect(root).not.toHaveAttribute("tabindex");
  });

  it("a failed row WITHOUT errorMessage is not expandable", () => {
    render(
      <NotificationRow
        row={{
          ...baseRow,
          status: "failed",
          errorCode: "X",
          errorMessage: null,
        }}
      />
    );
    const root = screen.getByTestId("notification-row");
    expect(root).not.toHaveAttribute("role", "button");
  });

  it("data-status attribute reflects the row status (for styling/tests)", () => {
    const { rerender } = render(<NotificationRow row={baseRow} />);
    expect(screen.getByTestId("notification-row")).toHaveAttribute(
      "data-status",
      "success"
    );
    rerender(
      <NotificationRow
        row={{
          ...baseRow,
          status: "failed",
          errorCode: "X",
          errorMessage: "y",
        }}
      />
    );
    expect(screen.getByTestId("notification-row")).toHaveAttribute(
      "data-status",
      "failed"
    );
  });
});
