"use client";

import { useEffect, useState, type JSX } from "react";

import { useDashboardUser } from "@admin/hooks/useDashboardUser";

/**
 * The id of the dashboard's level-one heading.
 *
 * Exported so the widget grid can send focus here when a notice it showed
 * closes, and as customise mode ends: the heading is the one landmark every
 * state of the page draws, so a reader whose focused element just went away
 * lands at the top of what they were reading rather than on `body`.
 */
export const DASHBOARD_HEADING_ID = "dashboard-heading";

/** The greeting for the reader's own hour, with their first name, or "Welcome" without one. */
export function greetingFor(
  name: string | null | undefined,
  now: Date
): string {
  const first = name?.trim().split(/\s+/)[0];
  if (!first) return "Welcome";
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${part}, ${first}`;
}

/** The time the greeting words itself against, moved on each minute. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The dashboard's one line above the cards, "Good afternoon, Ada": the page's
 * only level-one heading. The page's own action, Customize dashboard, is in the
 * admin's top bar rather than here.
 *
 * It renders in every state, from first paint: the heading is where a
 * screen-reader or keyboard user lands when they jump by heading, and every
 * card title (an `h2`) sits under it in the outline. While the signed-in user
 * is on its way the line keeps its height with a placeholder, so the cards
 * below do not move when the name arrives; it is named "Dashboard" meanwhile,
 * since a heading with no name is skipped by screen readers' heading lists.
 */
export function WelcomeHeader(): JSX.Element {
  const { user, isLoading } = useDashboardUser();
  const now = useMinuteClock();

  return (
    <h1
      id={DASHBOARD_HEADING_ID}
      // Focusable only PROGRAMMATICALLY (`-1` keeps it out of the Tab
      // sequence), so focus can be returned here when the element holding it
      // is taken off the page, and as customise mode ends.
      tabIndex={-1}
      // `min-h-7` is the line's own height (`text-xl` sets a 28px line), with
      // the placeholder or the greeting in it. The ring shows only where the
      // browser shows a keyboard's focus.
      className="mb-[18px] min-h-7 rounded-sm text-xl font-semibold tracking-[-0.01em] text-foreground focus:outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
      data-testid="dashboard-greeting"
    >
      {isLoading ? (
        <>
          <span className="sr-only">Dashboard</span>
          <span
            aria-hidden="true"
            data-testid="dashboard-greeting-placeholder"
            className="inline-block h-5 w-56 max-w-full rounded bg-primary/5 align-middle animate-pulse motion-reduce:animate-none"
          />
        </>
      ) : (
        greetingFor(user?.name, now)
      )}
    </h1>
  );
}
