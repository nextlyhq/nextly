/**
 * A day's full list, as the calendar's "+N more" opens it.
 *
 * What is held here is paging: the day's list is read a page at a time from
 * the list filtered to that day, and a day can shrink under the reader while
 * the sheet is open.
 *
 * @module components/features/releases/__tests__/ReleaseCalendarDaySheet.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "@admin/__tests__/utils";
import type { Release } from "@admin/types/releases";

const { dayListMock } = vi.hoisted(() => ({ dayListMock: vi.fn() }));

vi.mock("@admin/hooks/queries/useReleases", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReleaseListPage: (...args: unknown[]) => dayListMock(...args),
}));

import { ReleaseCalendarDaySheet } from "../ReleaseCalendarDaySheet";

const release = (n: number): Release => ({
  id: `r${n}`,
  title: `Launch ${String(n).padStart(2, "0")}`,
  description: null,
  scheduledAt: `2026-10-23T${String(n % 24).padStart(2, "0")}:00:00.000Z`,
  timezone: "UTC",
  state: "scheduled",
  publishedAt: null,
  createdBy: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

/** The day's releases as the server holds them right now. */
let held: Release[] = [];

/** One page of `held`, as the list filtered to the day answers it. */
function pageOf(params: { page: number; limit: number }) {
  const from = (params.page - 1) * params.limit;
  return {
    data: {
      items: held.slice(from, from + params.limit),
      meta: { total: held.length, hasNext: from + params.limit < held.length },
    },
    isPending: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  };
}

function renderSheet() {
  return render(
    <ReleaseCalendarDaySheet
      day="2026-10-23"
      zone="UTC"
      isToday={false}
      overdue={new Set()}
      now={Date.parse("2026-10-21T12:00:00.000Z")}
      onClose={() => undefined}
      onReturnFocus={() => undefined}
    />
  );
}

beforeEach(() => {
  held = Array.from({ length: 21 }, (_, i) => release(i + 1));
  dayListMock.mockReset();
  dayListMock.mockImplementation(pageOf);
});

describe("the day's list", () => {
  it("moves back to the last page when the page it is on empties", async () => {
    const view = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(await screen.findByText("Launch 21")).toBeTruthy();

    // The only release on page 2 is published, and the day now holds 20: a
    // page 2 that no longer exists, with no pager left to leave it by.
    held = held.slice(0, 20);
    view.rerender(
      <ReleaseCalendarDaySheet
        day="2026-10-23"
        zone="UTC"
        isToday={false}
        overdue={new Set()}
        now={Date.parse("2026-10-21T12:00:00.000Z")}
        onClose={() => undefined}
        onReturnFocus={() => undefined}
      />
    );

    await waitFor(() =>
      expect(dayListMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 })
      )
    );
    expect(await screen.findByText("Launch 01")).toBeTruthy();
    expect(screen.queryByText("Nothing runs on this day.")).toBeNull();
  });

  it("moves to the first page when the day empties", async () => {
    const view = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(await screen.findByText("Launch 21")).toBeTruthy();

    held = [];
    view.rerender(
      <ReleaseCalendarDaySheet
        day="2026-10-23"
        zone="UTC"
        isToday={false}
        overdue={new Set()}
        now={Date.parse("2026-10-21T12:00:00.000Z")}
        onClose={() => undefined}
        onReturnFocus={() => undefined}
      />
    );

    await waitFor(() =>
      expect(dayListMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 })
      )
    );
    expect(await screen.findByText("Nothing runs on this day.")).toBeTruthy();
  });
});
