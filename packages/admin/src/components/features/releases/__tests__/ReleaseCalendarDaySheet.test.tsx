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

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@admin/__tests__/utils";
import type { Release } from "@admin/types/releases";

const { dayListMock } = vi.hoisted(() => ({ dayListMock: vi.fn() }));

vi.mock("@admin/hooks/queries/useReleases", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReleaseListPage: (...args: unknown[]) => dayListMock(...args),
}));

import { ReleaseCalendarDaySheet } from "../ReleaseCalendarDaySheet";
import { SINGLES_HIDDEN_EMPTY } from "../ReleaseListCells";

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
  it("lists a page's releases in the order of the times it shows", () => {
    // The page arrives by scheduled time; the 09:00 release went out at
    // 11:00 and is shown at 11:00, after the one that went out at 10:00.
    held = [
      {
        ...release(1),
        id: "late",
        title: "Went out late",
        state: "published",
        scheduledAt: "2026-10-23T09:00:00.000Z",
        publishedAt: "2026-10-23T11:00:00.000Z",
      },
      {
        ...release(2),
        id: "on-time",
        title: "Went out on time",
        state: "published",
        scheduledAt: "2026-10-23T10:00:00.000Z",
        publishedAt: "2026-10-23T10:00:00.000Z",
      },
    ];
    renderSheet();
    const titles = screen
      .getAllByRole("link")
      .map(link => link.textContent)
      .filter(text => text?.startsWith("Went out"));
    expect(titles).toEqual(["Went out on time", "Went out late"]);
  });

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

describe("single-document releases in the day's list", () => {
  it("marks a single-document release as the list does, and no other", () => {
    held = [
      { ...release(1), title: "Opening hours", kind: "single" },
      release(2),
    ];
    renderSheet();
    const rows = screen.getAllByRole("listitem");
    const single = rows.find(row => row.textContent?.includes("Opening hours"));
    const ordinary = rows.find(row => row.textContent?.includes("Launch 02"));
    // The mark is the parent of its words' own span.
    const mark = within(single as HTMLElement).getByText(
      "Single document"
    ).parentElement;
    expect(mark?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(
      within(ordinary as HTMLElement).queryByText("Single document")
    ).toBeNull();
  });

  it("names a single-document release's link with its mark, as the list's row is named", () => {
    held = [
      { ...release(1), title: "Opening hours", kind: "single" },
      release(2),
    ];
    renderSheet();
    // The list's row is one link holding the title and the mark, so a screen
    // reader hears both; the day's link must be heard the same way.
    expect(
      screen.getByRole("link", { name: "Opening hours Single document" })
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Launch 02" })).toBeTruthy();
  });

  it("asks for ordinary releases only while single documents are hidden", () => {
    render(
      <ReleaseCalendarDaySheet
        day="2026-10-23"
        zone="UTC"
        isToday={false}
        overdue={new Set()}
        now={Date.parse("2026-10-21T12:00:00.000Z")}
        kind="release"
        onClose={() => undefined}
        onReturnFocus={() => undefined}
      />
    );
    expect(dayListMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "release" })
    );
  });

  it("says the day is empty because single documents are hidden, as the list says it", () => {
    held = [];
    render(
      <ReleaseCalendarDaySheet
        day="2026-10-23"
        zone="UTC"
        isToday={false}
        overdue={new Set()}
        now={Date.parse("2026-10-21T12:00:00.000Z")}
        kind="release"
        onClose={() => undefined}
        onReturnFocus={() => undefined}
      />
    );
    expect(screen.getByText(SINGLES_HIDDEN_EMPTY)).toBeInTheDocument();
    expect(screen.queryByText("Nothing runs on this day.")).toBeNull();
  });

  it("says nothing runs on the day when nothing is hidden", () => {
    held = [];
    renderSheet();
    expect(screen.getByText("Nothing runs on this day.")).toBeInTheDocument();
    expect(screen.queryByText(SINGLES_HIDDEN_EMPTY)).toBeNull();
  });
});
