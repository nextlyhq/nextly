import type { DataFetcher, TableResponse } from "@revnixhq/ui";
import { type ColumnDef } from "@tanstack/react-table";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { mockUsers } from "@admin/__tests__/fixtures";
import {
  createMockDataFetcher,
  createFailingDataFetcher,
  createLargeDataset,
} from "@admin/__tests__/helpers/table";
import { render, screen, waitFor } from "@admin/__tests__/utils";

import { DataTable } from "./DataTable";

interface TestUser extends Record<string, unknown> {
  id: string;
  email: string;
  username: string;
  fullName?: string;
}

const testColumns = [
  {
    accessorKey: "username",
    header: "Username",
  },
  {
    accessorKey: "email",
    header: "Email",
  },
  {
    accessorKey: "fullName",
    header: "Full Name",
  },
];

describe("DataTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with title when provided", async () => {
    const fetcher = createMockDataFetcher(mockUsers);

    render(
      <DataTable
        columns={testColumns}
        fetcher={fetcher}
        title="User Management"
      />
    );

    expect(screen.getByText("User Management")).toBeInTheDocument();
  });

  it("does not render title when not provided", async () => {
    const fetcher = createMockDataFetcher(mockUsers);

    render(<DataTable columns={testColumns} fetcher={fetcher} />);

    // No h2 element should be present
    const headings = screen.queryAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(0);
  });

  it("shows search bar", async () => {
    const fetcher = createMockDataFetcher(mockUsers);

    render(<DataTable columns={testColumns} fetcher={fetcher} />);

    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("uses custom search placeholder", async () => {
    const fetcher = createMockDataFetcher(mockUsers);

    render(
      <DataTable
        columns={testColumns}
        fetcher={fetcher}
        searchPlaceholder="Search users..."
      />
    );

    expect(screen.getByPlaceholderText("Search users...")).toBeInTheDocument();
  });

  it("calls fetcher on mount", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      data: [],
      meta: { page: 0, pageSize: 10, total: 0, totalPages: 0 },
    });

    render(<DataTable columns={testColumns} fetcher={fetcher} />);

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  it("shows loading state initially", () => {
    const fetcher = vi.fn(
      () =>
        new Promise<TableResponse<TestUser>>(resolve =>
          setTimeout(
            () =>
              resolve({
                data: [],
                meta: { page: 0, pageSize: 10, total: 0, totalPages: 0 },
              }),
            100
          )
        )
    ) as DataFetcher<TestUser>;

    render(<DataTable columns={testColumns} fetcher={fetcher} />);

    // Should show loading skeleton
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders rows after data loads", async () => {
    const fetcher = createMockDataFetcher(mockUsers.slice(0, 3));

    render(<DataTable columns={testColumns} fetcher={fetcher} />);

    await waitFor(() => {
      expect(screen.getByText("admin")).toBeInTheDocument();
      expect(screen.getByText("editor")).toBeInTheDocument();
      expect(screen.getByText("author")).toBeInTheDocument();
    });
  });

  it("shows error state on fetch failure", async () => {
    const fetcher = createFailingDataFetcher("Network error");

    render(<DataTable columns={testColumns} fetcher={fetcher} />);

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("shows empty state when no data", async () => {
    const fetcher = createMockDataFetcher([]);

    render(<DataTable columns={testColumns} fetcher={fetcher} />);

    await waitFor(() => {
      expect(screen.getByText("No data available")).toBeInTheDocument();
    });
  });

  it("handles page change correctly", async () => {
    const largeDataset = createLargeDataset(50, i => ({
      id: `u${i}`,
      email: `user${i}@example.com`,
      username: `user${i}`,
      fullName: `User ${i}`,
    }));

    const fetcher = createMockDataFetcher(largeDataset);
    const user = userEvent.setup();

    render(
      <DataTable
        columns={testColumns}
        fetcher={fetcher}
        pagination={{ pageSize: 10 }}
      />
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText("user0")).toBeInTheDocument();
    });

    // Click page 2
    await user.click(screen.getByText("2"));

    // Should show page 2 data (users 10-19)
    await waitFor(() => {
      expect(screen.getByText("user10")).toBeInTheDocument();
    });
  });

  it("handles sorting correctly", async () => {
    const fetcher = createMockDataFetcher(mockUsers);
    const user = userEvent.setup();

    render(
      <DataTable columns={testColumns} fetcher={fetcher} enableSorting={true} />
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText("admin")).toBeInTheDocument();
    });

    // Click username header to sort
    const usernameHeader = screen.getByText("Username").closest("button");
    if (usernameHeader) {
      await user.click(usernameHeader);
    }

    // Data should be re-fetched with sorting params
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        expect.objectContaining({
          sorting: expect.arrayContaining([
            expect.objectContaining({
              field: "username",
              direction: expect.stringMatching(/asc|desc/),
            }),
          ]),
        })
      );
    });
  });

  it("disables sorting when enableSorting is false", async () => {
    const fetcher = createMockDataFetcher(mockUsers);

    render(
      <DataTable
        columns={testColumns}
        fetcher={fetcher}
        enableSorting={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("admin")).toBeInTheDocument();
    });

    // Column headers should not be buttons
    const usernameHeader = screen.getByText("Username");
    expect(usernameHeader.closest("button")).not.toBeInTheDocument();
  });

  it("handles search correctly", async () => {
    const fetcher = vi.fn(createMockDataFetcher(mockUsers));
    const user = userEvent.setup();

    render(
      <DataTable columns={testColumns} fetcher={fetcher} searchDelay={100} />
    );

    // Wait for initial load
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    // Type in search
    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "admin");

    // Should debounce and call fetcher with search params
    await waitFor(
      () => {
        expect(fetcher).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: expect.objectContaining({
              search: "admin",
            }),
          })
        );
      },
      { timeout: 1000 }
    );
  });

  it("debounces search input", async () => {
    const fetcher = vi.fn(createMockDataFetcher(mockUsers));
    const user = userEvent.setup();

    render(
      <DataTable columns={testColumns} fetcher={fetcher} searchDelay={300} />
    );

    // Wait for initial load
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    const initialCallCount = fetcher.mock.calls.length;

    // Type quickly
    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "test");

    // Should not call fetcher immediately for each keystroke
    expect(fetcher).toHaveBeenCalledTimes(initialCallCount);

    // After debounce delay, should call fetcher once
    await waitFor(
      () => {
        expect(fetcher).toHaveBeenCalledTimes(initialCallCount + 1);
      },
      { timeout: 500 }
    );
  });

  it("resets to page 0 when searching", async () => {
    const largeDataset = createLargeDataset(50, i => ({
      id: `u${i}`,
      email: `user${i}@example.com`,
      username: `user${i}`,
      fullName: `User ${i}`,
    }));

    const fetcher = vi.fn(createMockDataFetcher(largeDataset));
    const user = userEvent.setup();

    render(
      <DataTable
        columns={testColumns}
        fetcher={fetcher}
        searchDelay={100}
        pagination={{ pageSize: 10 }}
      />
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText("user0")).toBeInTheDocument();
    });

    // Go to page 2
    await user.click(screen.getByText("2"));

    await waitFor(() => {
      expect(screen.getByText("user10")).toBeInTheDocument();
    });

    // Search
    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "user1");

    // Should reset to page 0
    await waitFor(
      () => {
        const lastCall = fetcher.mock.calls[fetcher.mock.calls.length - 1];
        expect(lastCall[0].pagination.page).toBe(0);
      },
      { timeout: 500 }
    );
  });

  it("clears search when clear button clicked", async () => {
    const fetcher = vi.fn(createMockDataFetcher(mockUsers));
    const user = userEvent.setup();

    render(
      <DataTable columns={testColumns} fetcher={fetcher} searchDelay={100} />
    );

    // Type in search
    const searchInput = screen.getByPlaceholderText("Search...");
    await user.type(searchInput, "test");

    // Wait for search to apply
    await waitFor(() => {
      expect(screen.getByDisplayValue("test")).toBeInTheDocument();
    });

    // Click clear button
    const clearButton = screen.getByRole("button", { name: /clear/i });
    await user.click(clearButton);

    // Search should be cleared
    expect(screen.queryByDisplayValue("test")).not.toBeInTheDocument();
  });

  it("renders pagination controls", async () => {
    const largeDataset = createLargeDataset(50, i => ({
      id: `u${i}`,
      email: `user${i}@example.com`,
      username: `user${i}`,
      fullName: `User ${i}`,
    }));

    const fetcher = createMockDataFetcher(largeDataset);

    render(
      <DataTable
        columns={testColumns}
        fetcher={fetcher}
        pagination={{ pageSize: 10 }}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /previous/i })
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    });
  });

  it("handles custom pagination config", async () => {
    const fetcher = createMockDataFetcher(mockUsers);

    render(
      <DataTable
        columns={testColumns}
        fetcher={fetcher}
        pagination={{
          pageSize: 20,
          pageSizeOptions: [20, 40, 60],
          showPageSizeSelector: true,
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("admin")).toBeInTheDocument();
    });

    // Fetcher should be called with pageSize: 20
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        pagination: expect.objectContaining({
          pageSize: 20,
        }),
      })
    );
  });

  it("handles initial params correctly", async () => {
    const fetcher = vi.fn(createMockDataFetcher(mockUsers));

    render(
      <DataTable
        columns={testColumns}
        fetcher={fetcher}
        initialParams={{
          pagination: { page: 2, pageSize: 20 },
          filters: { search: "test" },
          sorting: [{ field: "username", direction: "asc" }],
        }}
      />
    );

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: expect.objectContaining({ page: 2, pageSize: 20 }),
          filters: expect.objectContaining({ search: "test" }),
          sorting: expect.arrayContaining([
            expect.objectContaining({ field: "username", direction: "asc" }),
          ]),
        })
      );
    });
  });

  it("shows table container with border", () => {
    const fetcher = createMockDataFetcher(mockUsers);
    const { container } = render(
      <DataTable columns={testColumns} fetcher={fetcher} />
    );

    // Parent container should have border classes
    const tableContainer = container.querySelector(".border");
    expect(tableContainer).toBeInTheDocument();
  });

  it("renders accessible table structure", async () => {
    const fetcher = createMockDataFetcher(mockUsers);

    render(<DataTable columns={testColumns} fetcher={fetcher} />);

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    // Should have proper table structure
    const table = screen.getByRole("table");
    expect(table.querySelector("thead")).toBeInTheDocument();
    expect(table.querySelector("tbody")).toBeInTheDocument();
  });
});
