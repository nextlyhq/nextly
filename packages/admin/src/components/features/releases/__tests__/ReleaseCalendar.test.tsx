/**
 * The calendar as a rendered screen.
 *
 * The grid's arithmetic is tested next door against `release-calendar`; what
 * this covers is the composition: that the grid asks the server's calendar
 * for its window, draws each day from that answer, marks today, moves by
 * keyboard, and opens a day's full list from the list filtered to that day.
 *
 * @module components/features/releases/__tests__/ReleaseCalendar.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@admin/__tests__/utils";
import type { Release, ReleaseCalendarDay } from "@admin/types/releases";

const { calendarMock, fetchReleasesMock, dayListMock } = vi.hoisted(() => ({
  calendarMock: vi.fn(),
  fetchReleasesMock: vi.fn(),
  dayListMock: vi.fn(),
}));

// The overdue lookup runs for real, through its paging, over a mocked
// transport: what is under test is that it reads every page.
vi.mock("@admin/services/releaseApi", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchReleases: (...args: unknown[]) => fetchReleasesMock(...args),
}));

vi.mock("@admin/hooks/queries/useReleases", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReleaseCalendar: (...args: unknown[]) => calendarMock(...args),
  useReleaseListPage: (...args: unknown[]) => dayListMock(...args),
}));

import { readerZone } from "../release-timezone";
import { ReleaseCalendar } from "../ReleaseCalendar";

/**
 * The clock this suite runs on: midday UTC on Wednesday 21 October 2026, the
 * same date in every zone from UTC−11 to UTC+11, so the suite opens on the
 * same month and the same today whatever zone the machine is in.
 */
const FROZEN_NOW = new Date("2026-10-21T12:00:00.000Z");

const release = (id: string, over: Partial<Release> = {}): Release => ({
  id,
  title: `Launch ${id}`,
  description: null,
  scheduledAt: "2026-10-23T12:00:00.000Z",
  timezone: "UTC",
  state: "scheduled",
  publishedAt: null,
  createdBy: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...over,
});

/** A busy Friday: seven releases, of which the server sent the first three. */
const BUSY: ReleaseCalendarDay = {
  date: "2026-10-23",
  total: 7,
  counts: { draft: 0, scheduled: 6, published: 0, cancelled: 0, blocked: 1 },
  releases: [release("a"), release("b", { state: "blocked" }), release("c")],
};

function calendarAnswer(days: ReleaseCalendarDay[] = [BUSY]) {
  return {
    data: { timezone: "UTC", from: "", to: "", days },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(FROZEN_NOW);
  calendarMock.mockReset();
  calendarMock.mockReturnValue(calendarAnswer());
  fetchReleasesMock.mockReset();
  fetchReleasesMock.mockResolvedValue({
    items: [],
    meta: { total: 0, hasNext: false },
  });
  dayListMock.mockReset();
  dayListMock.mockReturnValue({
    data: { items: BUSY.releases, meta: { total: 7 } },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The day button for `date`. */
function dayButton(date: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-day="${date}"]`);
  if (!found) throw new Error(`no day button for ${date}`);
  return found;
}

describe("the calendar screen", () => {
  it("asks the server's calendar for the grid's six weeks, in the reader's zone", () => {
    render(<ReleaseCalendar />);
    // October 2026 opens on a Thursday, so its grid starts Monday 28
    // September and ends 42 days later, on Sunday 8 November.
    expect(calendarMock).toHaveBeenCalledWith({
      from: "2026-09-28",
      to: "2026-11-08",
      timezone: readerZone(),
    });
  });

  it("marks today, says so out loud, and offers Today on the current month", () => {
    render(<ReleaseCalendar />);
    const marked = document.querySelectorAll('[aria-current="date"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute("data-day")).toBe("2026-10-21");
    expect(marked[0]?.getAttribute("aria-label")).toMatch(/, today, /);
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
  });

  it("draws a busy day's chips with time, title and state, and '+N more' from the day's total", async () => {
    render(<ReleaseCalendar />);
    const cell = dayButton("2026-10-23").closest("td") as HTMLElement;
    const chips = within(cell).getAllByRole("link");
    // Two chips and "+5 more": the day holds seven, whatever was sent.
    expect(chips).toHaveLength(2);
    expect(chips[0]?.textContent).toContain("Launch a");
    expect(chips[0]?.textContent).toMatch(/\d{1,2}:00/);
    // Scheduled once the overdue answer is in, and not before.
    await waitFor(() => expect(chips[0]?.textContent).toContain("Scheduled"));
    expect(chips[1]?.textContent).toContain("Stopped");
    expect(
      within(cell).getByRole("button", { name: /^\+5 more/ })
    ).toBeTruthy();
    expect(dayButton("2026-10-23").getAttribute("aria-label")).toMatch(
      /7 releases, 1 stopped$/
    );
  });

  it("moves by arrow key, and pages by Page Down", () => {
    render(<ReleaseCalendar />);
    const start = dayButton("2026-10-21");
    expect(start.tabIndex).toBe(0);
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-10-22");
    // One tab stop: the day just left is no longer one.
    expect(dayButton("2026-10-21").tabIndex).toBe(-1);

    fireEvent.keyDown(dayButton("2026-10-22"), { key: "PageDown" });
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-11-22");
    expect(calendarMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: "2026-10-26", to: "2026-12-06" })
    );
  });

  it("opens a day's full list from the list filtered to that day, in the calendar's zone", () => {
    render(<ReleaseCalendar />);
    fireEvent.click(dayButton("2026-10-23"));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText(/Friday, October 23, 2026/)).toBeTruthy();
    expect(within(sheet).getByText("7 releases")).toBeTruthy();
    expect(dayListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        day: { date: "2026-10-23", timezone: readerZone() },
        page: 1,
      })
    );
  });

  it("marks a release overdue from the server's overdue read, however many pages it runs to", async () => {
    // Two hundred and one overdue releases in the window: a full first page,
    // and the 201st alone on the second. A lookup that read one page would
    // call "c" scheduled.
    const firstPage = Array.from({ length: 200 }, (_, i) => ({
      id: `overdue-${i + 1}`,
    }));
    fetchReleasesMock.mockImplementation(
      (params: { tab?: string; page?: number }) =>
        Promise.resolve(
          params.tab === "attention" && params.page === 1
            ? { items: firstPage, meta: { total: 201, hasNext: true } }
            : params.tab === "attention" && params.page === 2
              ? { items: [{ id: "c" }], meta: { total: 201, hasNext: false } }
              : { items: [], meta: { total: 0, hasNext: false } }
        )
    );
    calendarMock.mockReturnValue(
      calendarAnswer([{ ...BUSY, total: 3, releases: [release("c")] }])
    );
    render(<ReleaseCalendar />);
    const cell = dayButton("2026-10-23").closest("td") as HTMLElement;
    await waitFor(() =>
      expect(within(cell).getByRole("link").textContent).toContain("Overdue")
    );
    // Asked of Needs attention's overdue part, not worked out here.
    expect(fetchReleasesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "attention",
        reason: "overdue",
        page: 2,
      })
    );
  });

  it("claims no Scheduled state while the overdue answer is on its way", async () => {
    fetchReleasesMock.mockImplementation((params: { tab?: string }) =>
      params.tab === "attention"
        ? new Promise(() => undefined)
        : Promise.resolve({ items: [], meta: { total: 0, hasNext: false } })
    );
    render(<ReleaseCalendar />);
    const cell = dayButton("2026-10-23").closest("td") as HTMLElement;
    await waitFor(() => expect(fetchReleasesMock).toHaveBeenCalled());
    const chips = within(cell).getAllByRole("link");
    // The time is known; whether it is overdue is not.
    expect(chips[0]?.textContent).toMatch(/\d{1,2}:00/);
    expect(chips[0]?.textContent).not.toContain("Scheduled");
    // A state that does not hang on overdue is still said.
    expect(chips[1]?.textContent).toContain("Stopped");
  });

  it("says the overdue answer failed, with a retry, and claims no Scheduled state", async () => {
    fetchReleasesMock.mockImplementation((params: { tab?: string }) =>
      params.tab === "attention"
        ? Promise.reject(new Error("refused"))
        : Promise.resolve({ items: [], meta: { total: 0, hasNext: false } })
    );
    render(<ReleaseCalendar />);
    expect(
      await screen.findByText("Overdue releases could not be checked")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    const cell = dayButton("2026-10-23").closest("td") as HTMLElement;
    for (const chip of within(cell).getAllByRole("link")) {
      expect(chip.textContent).not.toContain("Scheduled");
    }
  });

  it("draws a day's releases in the order of the times it shows", () => {
    // Sent by scheduled time: 09:00 (published at 11:00), then 10:00
    // (published on time). Drawn at 11:00 and 10:00, so 10:00 comes first.
    calendarMock.mockReturnValue(
      calendarAnswer([
        {
          date: "2026-10-23",
          total: 2,
          counts: {
            draft: 0,
            scheduled: 0,
            published: 2,
            cancelled: 0,
            blocked: 0,
          },
          releases: [
            release("late", {
              state: "published",
              scheduledAt: "2026-10-23T09:00:00.000Z",
              publishedAt: "2026-10-23T11:00:00.000Z",
            }),
            release("on-time", {
              state: "published",
              scheduledAt: "2026-10-23T10:00:00.000Z",
              publishedAt: "2026-10-23T10:00:00.000Z",
            }),
          ],
        },
      ])
    );
    render(<ReleaseCalendar />);
    const cell = dayButton("2026-10-23").closest("td") as HTMLElement;
    expect(
      within(cell)
        .getAllByRole("link")
        .map(chip => chip.textContent)
    ).toEqual([
      expect.stringContaining("Launch on-time"),
      expect.stringContaining("Launch late"),
    ]);
  });

  it("says where drafts are, since a draft has no day to be drawn on", () => {
    render(<ReleaseCalendar />);
    // The grid is described by the note, so a screen reader hears it too.
    const grid = screen.getByRole("grid");
    const note = document.getElementById(
      grid.getAttribute("aria-describedby") ?? ""
    );
    expect(note?.textContent).toMatch(/Drafts have no date yet/);
    expect(note?.textContent).toMatch(/Drafts tab/);
  });

  it("says the month could not be loaded rather than drawing it empty", () => {
    calendarMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(<ReleaseCalendar />);
    expect(
      screen.getByText("This month's releases could not be loaded")
    ).toBeTruthy();
    // No grid of days that would each say "no releases" about a month that
    // was never read.
    expect(screen.queryByRole("grid")).toBeNull();
    expect(document.querySelectorAll("[data-day]")).toHaveLength(0);
  });
});
