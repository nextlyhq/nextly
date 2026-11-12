/**
 * The dashboard's one greeting line, its only level-one heading in every state.
 *
 * The heading is the page's landmark for screen-reader and keyboard users:
 * jumping by heading lands on it, every card title (an `h2`) sits under it in
 * the outline, and focus returns to it as customise mode ends. These render it
 * against each state of the user read.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type UserRead = {
  user: { id: string; name: string; email: string } | null;
  isLoading: boolean;
  error: Error | null;
};
let userRead: UserRead = { user: null, isLoading: true, error: null };
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => userRead,
}));

import { LOADING_FRAME_TIMES } from "@admin/components/shared/loading-frame/delayed-reveal";

import {
  DASHBOARD_HEADING_ID,
  greetingFor,
  WelcomeHeader,
} from "./WelcomeHeader";

const ADA = { id: "u1", name: "Ada Lovelace", email: "ada@example.com" };

const USER_STATES: Array<[string, UserRead]> = [
  ["the user still loading", { user: null, isLoading: true, error: null }],
  ["the user loaded", { user: ADA, isLoading: false, error: null }],
  [
    "the user read failed",
    { user: null, isLoading: false, error: new Error("network") },
  ],
];

afterEach(() => {
  userRead = { user: null, isLoading: true, error: null };
  vi.useRealTimers();
});

describe("the dashboard's greeting", () => {
  for (const [label, user] of USER_STATES) {
    it(`is the one level-one heading, with a name, and nothing else, with ${label}`, () => {
      userRead = user;
      const { container } = render(<WelcomeHeader />);

      const mains = screen.getAllByRole("heading", { level: 1 });
      expect(mains).toHaveLength(1);
      // A heading with no name is skipped by screen readers' heading lists.
      expect(mains[0]!.textContent?.trim()).not.toBe("");
      // The id whatever sends focus to the heading finds it by.
      expect(mains[0]).toHaveAttribute("id", DASHBOARD_HEADING_ID);
      // One line: no project name, badge, summary, freshness or controls.
      expect(container.childElementCount).toBe(1);
      expect(screen.queryAllByRole("button")).toEqual([]);
      expect(screen.queryAllByRole("link")).toEqual([]);
    });
  }

  it.each([
    [9, "Good morning, Ada"],
    [14, "Good afternoon, Ada"],
    [20, "Good evening, Ada"],
  ])("at %i o'clock reads %s", (hour, words) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 11, hour, 5));
    userRead = { user: ADA, isLoading: false, error: null };
    render(<WelcomeHeader />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      new RegExp(`^${words}$`)
    );
  });

  it("says Welcome to a reader with no name, or whose read failed", () => {
    userRead = {
      user: { ...ADA, name: "  " },
      isLoading: false,
      error: null,
    };
    render(<WelcomeHeader />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /^Welcome$/
    );
    cleanup();
    userRead = USER_STATES[2]![1];
    render(<WelcomeHeader />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /^Welcome$/
    );
  });

  it("holds the line's height while the reader is on its way, so the cards do not move when the name arrives", () => {
    vi.useFakeTimers();
    const view = render(<WelcomeHeader />);
    const heading = screen.getByRole("heading", { level: 1 });
    // jsdom lays nothing out: the hold is the line's own minimum height, the
    // same with the placeholder and with the greeting, and the placeholder is
    // a block the greeting's height, hidden from assistive tech.
    expect(heading).toHaveClass("min-h-7", "text-xl");
    // The placeholder follows the frame's timing: nothing for a quick answer.
    expect(screen.queryByTestId("dashboard-greeting-placeholder")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(LOADING_FRAME_TIMES.outline);
    });
    const placeholder = screen.getByTestId("dashboard-greeting-placeholder");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder).toHaveClass("inline-block", "h-5");
    // Still, never pulsing.
    expect(placeholder.className).not.toMatch(/animate-/);
    expect(heading).toHaveAccessibleName("Dashboard");

    userRead = { user: ADA, isLoading: false, error: null };
    view.rerender(<WelcomeHeader />);
    expect(screen.getByRole("heading", { level: 1 })).toBe(heading);
    expect(heading).toHaveClass("min-h-7", "text-xl");
    expect(screen.queryByTestId("dashboard-greeting-placeholder")).toBeNull();
  });

  it("can take focus when sent there, without being a Tab stop", () => {
    userRead = { user: ADA, isLoading: false, error: null };
    render(<WelcomeHeader />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveAttribute("tabindex", "-1");
    heading.focus();
    expect(heading).toHaveFocus();
  });

  it("words the greeting by the reader's own hour and first name", () => {
    expect(greetingFor("Ada Lovelace", new Date(2026, 9, 28, 11, 59))).toBe(
      "Good morning, Ada"
    );
    expect(greetingFor("Ada", new Date(2026, 9, 28, 12))).toBe(
      "Good afternoon, Ada"
    );
    expect(greetingFor("Ada", new Date(2026, 9, 28, 18))).toBe(
      "Good evening, Ada"
    );
    expect(greetingFor(null, new Date())).toBe("Welcome");
  });
});
