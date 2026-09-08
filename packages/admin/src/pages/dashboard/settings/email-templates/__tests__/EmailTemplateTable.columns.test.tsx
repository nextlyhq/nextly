// @vitest-environment jsdom
/**
 * The property under test: a column the reader's stored choice hides is gone
 * from the rendered table — header and cells both — while the columns kept
 * visible still render. Header queries are scoped to the table because the
 * toolbar's column menu lists every toggleable column by design.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import EmailTemplatesPage from "../index";

const { useEmailTemplates, useDeleteEmailTemplate, usePreviewEmailTemplate } =
  vi.hoisted(() => ({
    useEmailTemplates: vi.fn(),
    useDeleteEmailTemplate: vi.fn(),
    usePreviewEmailTemplate: vi.fn(),
  }));

vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useEmailTemplates: () => useEmailTemplates(),
  useDeleteEmailTemplate: () => useDeleteEmailTemplate(),
  usePreviewEmailTemplate: () => usePreviewEmailTemplate(),
}));

/** The email-templates list's toggleable columns, in declaration order. */
const TOGGLEABLE = ["slug", "subject", "providerId", "isActive", "createdAt"];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-email-templates",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  useDeleteEmailTemplate.mockReturnValue({ mutate: vi.fn(), isPending: false });
  usePreviewEmailTemplate.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  useEmailTemplates.mockReturnValue({
    data: [
      {
        id: "et_1",
        name: "Welcome Email",
        slug: "welcome",
        subject: "Welcome aboard",
        providerId: "resend",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  });
});

describe("EmailTemplateTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "subject"));
    render(<EmailTemplatesPage />);
    const table = screen.getByRole("table");
    // The Slug header is the positive control: a header this query CAN find
    // inside the table, so the Subject absence below is the hidden column and
    // not a string that never renders at all.
    expect(within(table).getAllByText("Slug").length).toBeGreaterThan(0);
    expect(within(table).queryByText("Subject")).toBeNull();
    expect(screen.queryByText("Welcome aboard")).toBeNull();
    expect(screen.getAllByText("Welcome Email").length).toBeGreaterThan(0);
  });
});
