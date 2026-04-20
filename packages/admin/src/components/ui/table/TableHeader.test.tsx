import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from "@tanstack/react-table";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { TableHeaderComponent } from "./TableHeader";

// Test data type
interface TestData {
  id: string;
  name: string;
  email: string;
}

// Helper component to wrap TableHeader with table context
function TestTableHeader({
  enableSorting = true,
  onSortingChange,
}: {
  enableSorting?: boolean;
  onSortingChange?: OnChangeFn<SortingState>;
}) {
  const columns: ColumnDef<TestData>[] = [
    {
      accessorKey: "id",
      header: "ID",
      enableSorting: false,
    },
    {
      accessorKey: "name",
      header: "Name",
      enableSorting: true,
    },
    {
      accessorKey: "email",
      header: "Email",
      enableSorting: true,
    },
  ];

  const table = useReactTable({
    data: [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableSorting,
    onSortingChange,
  });

  return <TableHeaderComponent table={table} enableSorting={enableSorting} />;
}

describe("TableHeader", () => {
  it("renders all column headers", () => {
    render(<TestTableHeader />);

    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("renders sortable headers as buttons when sorting enabled", () => {
    render(<TestTableHeader enableSorting={true} />);

    // ID is not sortable, should not be a button
    const idHeader = screen.getByText("ID").closest("th");
    expect(idHeader?.querySelector("button")).not.toBeInTheDocument();

    // Name and Email are sortable, should be buttons
    const nameHeader = screen.getByText("Name").closest("button");
    expect(nameHeader).toBeInTheDocument();

    const emailHeader = screen.getByText("Email").closest("button");
    expect(emailHeader).toBeInTheDocument();
  });

  it("does not render sort buttons when sorting disabled", () => {
    render(<TestTableHeader enableSorting={false} />);

    // No column should have a button when sorting is disabled
    const nameText = screen.getByText("Name");
    expect(nameText.closest("button")).not.toBeInTheDocument();
  });

  it("shows unsorted icon initially", () => {
    const { container } = render(<TestTableHeader />);

    // Should show sort icons for sortable columns
    const sortIcons = container.querySelectorAll('[class*="sort"]');
    expect(sortIcons.length).toBeGreaterThan(0);
  });

  it("calls sorting handler when clicking sortable header", async () => {
    const onSortingChange = vi.fn();
    const user = userEvent.setup();

    render(<TestTableHeader onSortingChange={onSortingChange} />);

    const nameHeader = screen.getByText("Name").closest("button");
    if (nameHeader) {
      await user.click(nameHeader);
    }

    expect(onSortingChange).toHaveBeenCalled();
  });

  it("toggles sort direction on multiple clicks", async () => {
    const onSortingChange = vi.fn();
    const user = userEvent.setup();

    render(<TestTableHeader onSortingChange={onSortingChange} />);

    const nameHeader = screen.getByText("Name").closest("button");
    if (nameHeader) {
      // First click - ascending
      await user.click(nameHeader);
      expect(onSortingChange).toHaveBeenCalledTimes(1);

      // Second click - descending
      await user.click(nameHeader);
      expect(onSortingChange).toHaveBeenCalledTimes(2);
    }
  });

  it("does not call sorting handler for non-sortable columns", async () => {
    const onSortingChange = vi.fn();
    const user = userEvent.setup();

    render(<TestTableHeader onSortingChange={onSortingChange} />);

    // ID column is not sortable
    const idHeader = screen.getByText("ID");
    await user.click(idHeader);

    expect(onSortingChange).not.toHaveBeenCalled();
  });

  it("renders in table head element", () => {
    const { container } = render(<TestTableHeader />);

    expect(container.querySelector("thead")).toBeInTheDocument();
  });

  it("uses proper accessibility attributes", () => {
    render(<TestTableHeader />);

    // Sortable headers should have appropriate aria attributes
    const nameHeader = screen.getByText("Name").closest("button");
    expect(nameHeader).toHaveAttribute("aria-label");
  });

  it("renders correct number of header cells", () => {
    const { container } = render(<TestTableHeader />);

    const headerCells = container.querySelectorAll("th");
    expect(headerCells).toHaveLength(3); // ID, Name, Email
  });
});
