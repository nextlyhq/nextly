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
import { createContext, useContext, useEffect, useMemo } from "react";

import { useMountRegistry } from "@admin/components/layout/lib/mount-registry";
import { cn } from "@admin/lib/utils";

import { LOADING_FRAME_TIMES, useDelayedReveal } from "./delayed-reveal";

interface ScreenWaitValue {
  waiting: boolean;
  register: (entry: symbol) => () => void;
}

/** Outside the frame a report goes nowhere, and nothing is waiting. */
const ScreenWaitContext = createContext<ScreenWaitValue>({
  waiting: false,
  register: () => () => {},
});

/** Holds the reports of the screen's waits, around both the screen and the frame's signs. */
export function ScreenWaitProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const { entries, register } = useMountRegistry<symbol>();
  const waiting = entries.length > 0;
  const value = useMemo(() => ({ waiting, register }), [waiting, register]);
  return (
    <ScreenWaitContext.Provider value={value}>
      {children}
    </ScreenWaitContext.Provider>
  );
}

/** Reports that the screen is waiting for its data, while `active` and mounted. */
export function useReportScreenWait(active: boolean): void {
  const { register } = useContext(ScreenWaitContext);
  useEffect(() => {
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
            "absolute bottom-6 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2.5",
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
