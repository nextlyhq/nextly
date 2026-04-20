import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Pagination } from "./index";

/**
 * Pagination component with page controls, page size selector, and smart page numbering
 *
 * The Pagination component is a reusable pagination control that supports:
 * - Smart page numbers with ellipsis for many pages
 * - Page size selector (customizable options)
 * - First/Last/Previous/Next navigation buttons
 * - Loading states
 * - Responsive layout (stacks on mobile)
 */
const meta = {
  title: "Components/Navigation/Pagination",
  component: Pagination,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A pagination component with smart page numbering, page size selection, and navigation controls. Designed for data tables and lists with server-side or client-side pagination.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    currentPage: {
      control: { type: "number", min: 0 },
      description: "Current page index (0-based)",
      table: {
        type: { summary: "number" },
      },
    },
    totalPages: {
      control: { type: "number", min: 1 },
      description: "Total number of pages",
      table: {
        type: { summary: "number" },
      },
    },
    pageSize: {
      control: { type: "number", min: 1 },
      description: "Current page size (items per page)",
      table: {
        type: { summary: "number" },
      },
    },
    pageSizeOptions: {
      control: "object",
      description: "Available page size options",
      table: {
        type: { summary: "number[]" },
        defaultValue: { summary: "[10, 25, 50]" },
      },
    },
    showPageSizeSelector: {
      control: "boolean",
      description: "Whether to show the page size selector",
      table: {
        type: { summary: "boolean" },
        defaultValue: { summary: "true" },
      },
    },
    maxVisiblePages: {
      control: { type: "number", min: 3, max: 11, step: 2 },
      description: "Maximum number of visible page buttons",
      table: {
        type: { summary: "number" },
        defaultValue: { summary: "5" },
      },
    },
    isLoading: {
      control: "boolean",
      description: "Loading state (disables all controls)",
      table: {
        type: { summary: "boolean" },
        defaultValue: { summary: "false" },
      },
    },
  },
  args: {
    currentPage: 0,
    totalPages: 10,
    pageSize: 10,
    onPageChange: () => {},
  },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

// ========================================
// Default Story
// ========================================

export const Default: Story = {
  render: () => {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(10);

    return (
      <Pagination
        currentPage={page}
        totalPages={10}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    );
  },
};

// ========================================
// States
// ========================================

export const Loading: Story = {
  render: () => {
    const [page, setPage] = useState(2);
    const [pageSize, setPageSize] = useState(10);

    return (
      <Pagination
        currentPage={page}
        totalPages={10}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        isLoading={true}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Pagination in loading state. All controls are disabled.",
      },
    },
  },
};

export const FirstPage: Story = {
  render: () => {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(10);

    return (
      <Pagination
        currentPage={page}
        totalPages={10}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "First page. Previous and First buttons are disabled.",
      },
    },
  },
};

export const LastPage: Story = {
  render: () => {
    const [page, setPage] = useState(9);
    const [pageSize, setPageSize] = useState(10);

    return (
      <Pagination
        currentPage={page}
        totalPages={10}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Last page. Next and Last buttons are disabled.",
      },
    },
  },
};

// ========================================
// Page Counts
// ========================================

export const FewPages: Story = {
  render: () => {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    return (
      <Pagination
        currentPage={page}
        totalPages={3}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Few pages (3). All page numbers are visible, no ellipsis.",
      },
    },
  },
};

export const ManyPages: Story = {
  render: () => {
    const [page, setPage] = useState(10);
    const [pageSize, setPageSize] = useState(10);

    return (
      <Pagination
        currentPage={page}
        totalPages={50}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Many pages (50). Smart pagination shows ellipsis (...) for hidden pages.",
      },
    },
  },
};

export const SinglePage: Story = {
  render: () => {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(10);

    return (
      <Pagination
        currentPage={page}
        totalPages={1}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Single page. All navigation buttons are disabled.",
      },
    },
  },
};

// ========================================
// Max Visible Pages
// ========================================

export const ThreeVisiblePages: Story = {
  render: () => {
    const [page, setPage] = useState(5);
    const [pageSize, setPageSize] = useState(10);

    return (
      <Pagination
        currentPage={page}
        totalPages={20}
        pageSize={pageSize}
        maxVisiblePages={3}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Only 3 page numbers visible at a time (compact view).",
      },
    },
  },
};

export const SevenVisiblePages: Story = {
  render: () => {
    const [page, setPage] = useState(10);
    const [pageSize, setPageSize] = useState(10);

    return (
      <Pagination
        currentPage={page}
        totalPages={50}
        pageSize={pageSize}
        maxVisiblePages={7}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "7 page numbers visible at a time (extended view).",
      },
    },
  },
};

// ========================================
// Page Size Options
// ========================================

export const CustomPageSizes: Story = {
  render: () => {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(5);

    return (
      <Pagination
        currentPage={page}
        totalPages={10}
        pageSize={pageSize}
        pageSizeOptions={[5, 10, 20, 50, 100]}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Custom page size options: 5, 10, 20, 50, 100.",
      },
    },
  },
};

export const WithoutPageSizeSelector: Story = {
  render: () => {
    const [page, setPage] = useState(2);

    return (
      <Pagination
        currentPage={page}
        totalPages={10}
        pageSize={10}
        showPageSizeSelector={false}
        onPageChange={setPage}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Pagination without page size selector (fixed page size).",
      },
    },
  },
};

// ========================================
// Real-World Examples
// ========================================

export const UserListPagination: Story = {
  render: () => {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(25);

    const totalUsers = 487;
    const totalPages = Math.ceil(totalUsers / pageSize);
    const startUser = page * pageSize + 1;
    const endUser = Math.min((page + 1) * pageSize, totalUsers);

    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border p-4">
          <div className="text-sm text-muted-foreground mb-2">
            Showing users {startUser}-{endUser} of {totalUsers}
          </div>
          <div className="space-y-2">
            {Array.from({ length: Math.min(5, endUser - startUser + 1) }).map(
              (_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2 rounded-md border border-border"
                >
                  <div className="h-8 w-8 rounded-full bg-muted" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">
                      User {startUser + i}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      user{startUser + i}@example.com
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50, 100]}
          onPageChange={setPage}
          onPageSizeChange={newSize => {
            setPageSize(newSize);
            setPage(0); // Reset to first page
          }}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Real-world example: User list with 487 total users and pagination.",
      },
    },
  },
};

export const ProductCatalog: Story = {
  render: () => {
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(12);

    const totalProducts = 156;
    const totalPages = Math.ceil(totalProducts / pageSize);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: Math.min(12, totalProducts) }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-md border border-border bg-muted flex items-center justify-center text-sm text-muted-foreground"
            >
              Product {page * pageSize + i + 1}
            </div>
          ))}
        </div>

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          pageSize={pageSize}
          pageSizeOptions={[12, 24, 48]}
          onPageChange={setPage}
          onPageSizeChange={newSize => {
            setPageSize(newSize);
            setPage(0);
          }}
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Product catalog with 156 items. Page sizes optimized for grid layout (12, 24, 48).",
      },
    },
  },
};

// ========================================
// Interactive Demo
// ========================================

export const InteractiveDemo: Story = {
  render: () => {
    const [page, setPage] = useState(5);
    const [pageSize, setPageSize] = useState(10);
    const [totalPages, setTotalPages] = useState(20);
    const [maxVisiblePages, setMaxVisiblePages] = useState(5);
    const [isLoading, setIsLoading] = useState(false);

    const handlePageChange = (newPage: number) => {
      setIsLoading(true);
      setTimeout(() => {
        setPage(newPage);
        setIsLoading(false);
      }, 500);
    };

    const handlePageSizeChange = (newSize: number) => {
      setIsLoading(true);
      setTimeout(() => {
        setPageSize(newSize);
        setPage(0); // Reset to first page
        setIsLoading(false);
      }, 500);
    };

    return (
      <div className="space-y-6">
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          pageSize={pageSize}
          maxVisiblePages={maxVisiblePages}
          isLoading={isLoading}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />

        <div className="rounded-md border border-border p-4 space-y-4">
          <h3 className="text-sm font-semibold">Settings</h3>

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">
              Total Pages: {totalPages}
            </label>
            <input
              type="range"
              min="1"
              max="100"
              value={totalPages}
              onChange={e => setTotalPages(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">
              Max Visible Pages: {maxVisiblePages}
            </label>
            <input
              type="range"
              min="3"
              max="11"
              step="2"
              value={maxVisiblePages}
              onChange={e => setMaxVisiblePages(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div className="rounded-md border border-border p-4">
          <h3 className="text-sm font-semibold mb-2">State</h3>
          <div className="space-y-1 text-sm text-muted-foreground">
            <div>
              Current page: <span className="font-mono">{page + 1}</span>{" "}
              (index: {page})
            </div>
            <div>
              Total pages: <span className="font-mono">{totalPages}</span>
            </div>
            <div>
              Page size: <span className="font-mono">{pageSize}</span>
            </div>
            <div>
              Max visible: <span className="font-mono">{maxVisiblePages}</span>
            </div>
            <div>
              Loading:{" "}
              <span className="font-mono">{isLoading ? "true" : "false"}</span>
            </div>
          </div>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Interactive demo with configurable settings and state visualization. Simulates loading state on page changes.",
      },
    },
  },
};
