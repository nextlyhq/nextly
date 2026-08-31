/**
 * The calendar as a rendered screen.
 *
 * The date arithmetic is tested next door against `release-calendar`; what this
 * covers is the composition — that the toolbar, the grid, the day panel and the
 * agenda are actually wired to the query and to each other. Those were split
 * into separate components to keep the nesting readable, and a split like that
 * fails by rendering NOTHING rather than by rendering something wrong.
 *
 * @module components/features/releases/__tests__/ReleaseCalendar.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

const { useReleasesMock } = vi.hoisted(() => ({ useReleasesMock: vi.fn() }));

vi.mock("@admin/hooks/queries/useReleases", () => ({
  useReleases: (...args: unknown[]) => useReleasesMock(...args),
}));

import { ReleaseCalendar } from "../ReleaseCalendar";

/** A release on 1 September 2026, 09:00 UTC. */
const SEPTEMBER = {
  id: "r1",
  title: "Autumn launch",
  description: null,
  scheduledAt: "2026-09-01T09:00:00.000Z",
  timezone: "Europe/Berlin",
  state: "scheduled",
  publishedAt: null,
};

function answer(over: Record<string, unknown> = {}) {
  return {
    data: { items: [SEPTEMBER], meta: { hasNext: false } },
    isPending: false,
    isError: false,
    ...over,
  };
}

beforeEach(() => {
  useReleasesMock.mockReset();
  useReleasesMock.mockReturnValue(answer());
  window.localStorage.clear();
});

describe("the calendar screen", () => {
  it("asks for ONE MONTH rather than every release", async () => {
    // The whole reason this needed no new endpoint. A calendar that dropped the
    // window would still render — on every release in the system.
    render(<ReleaseCalendar />);
    const params = useReleasesMock.mock.calls[0]?.[0] as {
      scheduledAfter?: string;
      scheduledBefore?: string;
    };
    expect(params.scheduledAfter).toBeTruthy();
    expect(params.scheduledBefore).toBeTruthy();
    expect(new Date(params.scheduledAfter as string).getTime()).toBeLessThan(
      new Date(params.scheduledBefore as string).getTime()
    );
  });

  it("renders the toolbar and a full six-week grid", async () => {
    // The composition check. Both were extracted from one function, and the way
    // that goes wrong is a component returning nothing at all.
    render(<ReleaseCalendar />);
    expect(screen.getByLabelText(/previous month/i)).toBeTruthy();
    expect(screen.getByLabelText(/next month/i)).toBeTruthy();
    // 42 day buttons, plus the two month arrows.
    const days = screen
      .getAllByRole("button")
      .filter(b =>
        /nothing scheduled|release/i.test(b.getAttribute("aria-label") ?? "")
      );
    expect(days).toHaveLength(42);
  });

  it("names the zone it is drawn in, on the page", async () => {
    // Two colleagues comparing this page have to be able to see they are
    // reading the same grid.
    render(<ReleaseCalendar />);
    expect(screen.getByText(/times shown in/i)).toBeTruthy();
  });

  it("says so when the month was truncated", async () => {
    // The list is ordered by instant DESCENDING, so a truncated month loses its
    // EARLIEST days — the grid looks emptiest exactly where the reader is
    // looking. Silence there would be a wrong answer rather than a partial one.
    useReleasesMock.mockReturnValue(
      answer({ data: { items: [SEPTEMBER], meta: { hasNext: true } } })
    );
    render(<ReleaseCalendar />);
    expect(screen.getByRole("status").textContent).toMatch(/more than/i);
  });

  it("does not claim the month is empty while still loading", async () => {
    // On a narrow screen the agenda is the only view, so an unanswered query
    // would otherwise render a confident "nothing scheduled".
    useReleasesMock.mockReturnValue(
      answer({ data: undefined, isPending: true })
    );
    render(<ReleaseCalendar />);
    expect(screen.queryByText(/nothing is scheduled this month/i)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/loading/i);
  });

  it("clears the selected day when the month changes", async () => {
    // A day belongs to the month it was chosen in. Paging without clearing
    // leaves the panel reporting on a date the new grid does not contain.
    render(<ReleaseCalendar />);
    const day = screen
      .getAllByRole("button")
      .find(b => (b.getAttribute("aria-label") ?? "").includes("release"));
    expect(day).toBeTruthy();
    fireEvent.click(day as HTMLElement);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText(/next month/i));
    // The panel is gone rather than showing a day from the previous month.
    expect(
      screen
        .queryAllByRole("heading")
        .filter(h => /2026/.test(h.textContent ?? ""))
    ).toHaveLength(0);
  });
});
