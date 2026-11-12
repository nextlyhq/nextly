"use client";

/**
 * Whether the screen in the admin's frame is waiting for its data, and the two
 * signs of that wait the frame itself draws: a thin moving line under the bar
 * from 0.5 s, and from 5 s one line saying the server is starting.
 *
 * The screen knows when it is waiting, and the frame is where the signs go, so
 * a screen's outline reports its wait for as long as it is mounted and the
 * frame draws the signs while any report stands. Drawn once by the frame, the
 * line and the message never appear twice, however many parts of a screen
 * are loading.
 *
 * @module components/shared/loading-frame/screen-wait
 */

import type { JSX, ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { useMountRegistry } from "@admin/components/layout/lib/mount-registry";
import { cn } from "@admin/lib/utils";

import {
  LOADING_FRAME_TIMES,
  useDelayedReveal,
  WaitClockContext,
} from "./delayed-reveal";

interface ScreenWaitValue {
  waiting: boolean;
  register: (entry: symbol) => () => void;
}

/** Outside the frame a report goes nowhere, and nothing is waiting. */
const ScreenWaitContext = createContext<ScreenWaitValue>({
  waiting: false,
  register: () => () => {},
});

/**
 * How long nothing must wait before the screen counts as loaded. A wait that
 * gives way to the next in the same moment (the session's outline to the
 * permissions', then to the data's) is one wait; one that starts after the
 * screen has stood loaded for this long is a new one.
 */
const LOADED_AFTER_MS = 100;

/**
 * Holds the reports of the screen's waits, around both the screen and the
 * frame's signs, and times them.
 *
 * The screen's first wait is timed from when it was opened, the clock above,
 * through every part that waits in turn while it opens. A wait that begins
 * once the screen has loaded (an editor switching its content language, say)
 * is timed from its own start: timed from the opening, its signs would all
 * appear at once.
 */
export function ScreenWaitProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const { entries, register } = useMountRegistry<symbol>();
  const waiting = entries.length > 0;
  const value = useMemo(() => ({ waiting, register }), [waiting, register]);
  const openedAt = useContext(WaitClockContext);
  // The opening whose screen has loaded, and the start of a wait after it,
  // each kept with the opening it belongs to so a new screen starts afresh.
  const [loaded, setLoaded] = useState<{ openedAt: number | null } | null>(
    null
  );
  const [restarted, setRestarted] = useState<{
    openedAt: number | null;
    at: number;
  } | null>(null);

  // Loaded once nothing has waited for a moment.
  useEffect(() => {
    if (waiting) return;
    const timer = setTimeout(() => setLoaded({ openedAt }), LOADED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting, openedAt]);

  // A wait beginning on a loaded screen starts its own clock. Before the
  // paint, as the waiting part reports itself before the paint too, so its
  // signs are never drawn on the old clock first.
  useLayoutEffect(() => {
    if (!waiting || loaded === null || loaded.openedAt !== openedAt) return;
    setLoaded(null);
    setRestarted({ openedAt, at: Date.now() });
  }, [waiting, loaded, openedAt]);

  const clock =
    restarted !== null && restarted.openedAt === openedAt
      ? restarted.at
      : openedAt;
  return (
    <WaitClockContext.Provider value={clock}>
      <ScreenWaitContext.Provider value={value}>
        {children}
      </ScreenWaitContext.Provider>
    </WaitClockContext.Provider>
  );
}

/**
 * Reports that the screen is waiting for its data, while `active` and
 * mounted. Before the paint, so the frame times the wait before any of its
 * signs is drawn.
 */
export function useReportScreenWait(active: boolean): void {
  const { register } = useContext(ScreenWaitContext);
  useLayoutEffect(() => {
    if (!active) return;
    // A fresh identity per report, so two parts of a screen waiting at once
    // release only their own (the registry releases by identity).
    return register(Symbol("screen-wait"));
  }, [active, register]);
}

/** The message shown once a wait has gone on long enough to need a word. */
const SLOW_WAIT_MESSAGE =
  "Starting the server. The first visit after a quiet spell takes a little longer.";

/**
 * The frame's signs of a wait: the line under the bar, then the message near
 * the foot of the main column. Both are positioned over the column, never in
 * its flow, so they move nothing as they come and go. Under reduced motion the
 * line is not drawn and the message has no spinner.
 */
export function ScreenWaitSigns(): JSX.Element | null {
  const { waiting } = useContext(ScreenWaitContext);
  const line = useDelayedReveal(waiting, LOADING_FRAME_TIMES.line);
  const status = useDelayedReveal(waiting, LOADING_FRAME_TIMES.status);
  return (
    <>
      {line ? (
        <div
          aria-hidden="true"
          data-testid="screen-wait-line"
          // Just under the bar, whose height the shell names once.
          className="pointer-events-none absolute inset-x-0 top-(--admin-bar-height) z-40 h-0.5 overflow-hidden motion-reduce:hidden"
        >
          <span className="absolute inset-y-0 left-0 w-[30%] animate-loading-line bg-foreground/55" />
        </div>
      ) : null}
      {status ? (
        <div
          role="status"
          data-testid="screen-wait-status"
          className={cn(
            // Centred by its two insets rather than a half-width shift, so on a
            // phone it takes the column's width before it wraps its words.
            "absolute inset-x-4 bottom-6 z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2.5",
            "rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground shadow-lg"
          )}
        >
          <span
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground motion-reduce:hidden"
          />
          {SLOW_WAIT_MESSAGE}
        </div>
      ) : null}
    </>
  );
}
