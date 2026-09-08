// @vitest-environment jsdom
/**
 * The property under test: a column the reader's stored choice hides is gone
 * from the rendered table — header and cells both — while the columns kept
 * visible still render. Header queries are scoped to the table because the
 * toolbar's column menu lists every toggleable column by design.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { EmailProviderTable } from "../index";

const {
  useEmailProviders,
  useEmailProviderTypes,
  useDeleteEmailProvider,
  useSetDefaultProvider,
  useTestProvider,
} = vi.hoisted(() => ({
  useEmailProviders: vi.fn(),
  useEmailProviderTypes: vi.fn(),
  useDeleteEmailProvider: vi.fn(),
  useSetDefaultProvider: vi.fn(),
  useTestProvider: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useEmailProviders: (params: unknown) => useEmailProviders(params),
  useEmailProviderTypes: () => useEmailProviderTypes(),
  useDeleteEmailProvider: () => useDeleteEmailProvider(),
  useSetDefaultProvider: () => useSetDefaultProvider(),
  useTestProvider: () => useTestProvider(),
}));

/** The email-providers list's toggleable columns, in declaration order. */
const TOGGLEABLE = [
  "type",
  "fromEmail",
  "configuration",
  "isDefault",
  "createdAt",
];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-email-providers",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  useDeleteEmailProvider.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useSetDefaultProvider.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useTestProvider.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useEmailProviderTypes.mockReturnValue({
    data: [
      {
        type: "resend",
        label: "Resend",
        capabilities: {},
        configFields: [],
      },
    ],
    isSuccess: true,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  useEmailProviders.mockReturnValue({
    data: {
      data: [
        {
          id: "ep_1",
          name: "Transactional",
          type: "resend",
          fromEmail: "hello@example.com",
          fromName: "Example",
          configuration: {},
          isDefault: false,
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      meta: { total: 1, page: 0, limit: 10, totalPages: 1 },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  });
});

describe("EmailProviderTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "type"));
    render(<EmailProviderTable />);
    const table = screen.getByRole("table");
    // The From header is the positive control: a header this query CAN find
    // inside the table, so the Type absence below is the hidden column and
    // not a string that never renders at all.
    expect(within(table).getAllByText("From").length).toBeGreaterThan(0);
    expect(within(table).queryByText("Type")).toBeNull();
    expect(screen.queryByText("resend")).toBeNull();
    expect(screen.getAllByText("Transactional").length).toBeGreaterThan(0);
  });
});
