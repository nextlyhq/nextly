"use client";

/**
 * How old the dashboard's data is, said once for the page and only when it
 * matters: "Updated N min ago · Refresh" while the oldest answer a card shows
 * is more than five minutes old, and nothing otherwise. Cards draw no time of
 * their own. Refresh pressed from the keyboard leaves focus on the page's
 * heading once the fresh answers take the line away.
 *
 * @module components/features/dashboard/header/Freshness
 */

import { useEffect, useRef, type JSX, type MouseEvent } from "react";

/** How old the oldest answer may be before the header says so. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Where focus lands once a Refresh pressed here has taken the line, and itself, off the page: the
 * level-one heading of the header the line is drawn in, which is the place every state of the
 * dashboard draws and can take focus without being a control. Found from the button, so the line
 * names no heading of its own.
 */
function landingFor(button: HTMLElement): HTMLElement | null {
  return button.closest("header")?.querySelector<HTMLElement>("h1") ?? null;
}

export function Freshness({
  oldestAnswerAt,
  now,
  onRefresh,
}: {
  oldestAnswerAt: number | null;
  now: Date;
  onRefresh: () => void;
}): JSX.Element | null {
  const age = oldestAnswerAt === null ? 0 : now.getTime() - oldestAnswerAt;
  const stale = oldestAnswerAt !== null && age > STALE_AFTER_MS;
  // Set by a press of Refresh that held focus: once the fresh answers take the line away, focus
  // would otherwise fall to the page's body, and the next Tab start again from the top.
  const landing = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const target = landing.current;
    if (stale || target === null) return;
    landing.current = null;
    const active = document.activeElement;
    // Only when focus was lost with the button: a reader who moved on keeps where they went.
    if (active === null || active === document.body) target.focus();
  }, [stale]);

  if (!stale) return null;
  const refresh = (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    landing.current =
      document.activeElement === button ? landingFor(button) : null;
    onRefresh();
  };
  return (
    <p
      className="mt-[3px] text-xs text-muted-foreground"
      data-testid="dashboard-freshness"
    >
      Updated {Math.floor(age / 60_000)} min ago ·{" "}
      <button
        type="button"
        onClick={refresh}
        className="text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        data-testid="dashboard-refresh"
      >
        Refresh
      </button>
    </p>
  );
}
