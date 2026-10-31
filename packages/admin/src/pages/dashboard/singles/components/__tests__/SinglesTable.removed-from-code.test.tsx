// @vitest-environment jsdom
/**
 * The Singles list keeps a Single removed from code, marked as removed, with
 * the notice's next step read out beside its name; a declared Single beside
 * it is unmarked.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import SinglesTable from "../SinglesTable";

const { useSingles } = vi.hoisted(() => ({ useSingles: vi.fn() }));

vi.mock("@admin/hooks/queries", () => ({
  useSingles: (params: unknown) => useSingles(params),
  useDeleteSingle: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkDeleteSingles: () => ({ mutate: vi.fn(), isPending: false }),
}));

const row = (
  slug: string,
  label: string,
  extra: Record<string, unknown> = {}
) => ({
  id: `single_${slug}`,
  label,
  slug,
  source: "code",
  migrationStatus: "applied",
  locked: true,
  admin: {},
  ...extra,
});

beforeEach(() => {
  localStorage.clear();
  useSingles.mockReturnValue({
    data: {
      items: [
        row("settings", "Settings"),
        row("banner", "Banner", {
          removedFromCode: true,
          removedFromCodeState: { state: "half-retired" },
        }),
      ],
      meta: { page: 1, pageSize: 10, totalItems: 2, totalPages: 1 },
    },
    isLoading: false,
    isFetching: false,
  });
});

describe("SinglesTable", () => {
  it("marks the Single removed from code and reads out its next step", () => {
    render(
      <TooltipProvider>
        <SinglesTable />
      </TooltipProvider>
    );

    // One mark wherever the Banner row is drawn (the table, and the cards a
    // narrow window shows), each in the Banner row and none in Settings'.
    const marks = screen.getAllByTestId("removed-from-code-mark");
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(mark).toHaveTextContent("Removed");
      expect(mark.parentElement).toHaveTextContent("Banner");
      expect(mark.parentElement).not.toHaveTextContent("Settings");
    }
    expect(screen.getAllByText("Banner")).toHaveLength(marks.length);
    for (const said of screen.getAllByText(
      /An earlier release left it part-retired.*nextly prune/
    )) {
      expect(said).toHaveTextContent(
        "“Banner” is no longer in the configuration"
      );
    }
  });
});
