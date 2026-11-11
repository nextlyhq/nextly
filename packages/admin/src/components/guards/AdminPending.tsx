"use client";

/**
 * What the admin shows when the server has kept it waiting too long, and when
 * the server could not say who is signed in.
 *
 * The wait itself is drawn by the admin's frame: the screen's outline, a line
 * under the bar, then a message once the server is plainly starting. A server
 * that holds the session request for good would leave that wait standing for
 * ever, and reloading restarts it, so past a point the visitor is offered a
 * way to ask again alongside waiting.
 */
import { Button } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useState } from "react";

import {
  DelayedReveal,
  WaitClockContext,
} from "@admin/components/shared/loading-frame/delayed-reveal";
import { restartSessionCheck } from "@admin/hooks/queries/useAuthSession";

/** From here asking again is offered alongside waiting. */
export const OFFER_RETRY_AFTER_MS = 45_000;

/**
 * "Try again" for a session check the server has held this long, below the
 * screen's outline in the frame. A retry starts a new wait, so the offer goes
 * until that one has run as long.
 */
export function SessionStallNotice(): React.JSX.Element {
  const queryClient = useQueryClient();
  // The wait being offered a retry: a new one per retry, timed from the retry.
  const [attempt, setAttempt] = useState(0);
  return (
    <StallOffer
      key={attempt}
      onRetry={() => {
        void restartSessionCheck(queryClient);
        setAttempt(previous => previous + 1);
      }}
      // The first wait is timed from the screen's opening, like the rest of
      // the frame's signs; a retried one from the retry.
      fromScreen={attempt === 0}
    />
  );
}

function StallOffer({
  onRetry,
  fromScreen,
}: {
  onRetry: () => void;
  fromScreen: boolean;
}): React.JSX.Element {
  const offer = (
    <div
      role="status"
      className="mx-auto mb-8 flex max-w-md flex-col items-center gap-3 px-6 text-center"
    >
      <p className="text-sm text-foreground">Still waiting for the server.</p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
  return fromScreen ? (
    <DelayedReveal after={OFFER_RETRY_AFTER_MS}>{offer}</DelayedReveal>
  ) : (
    <OwnClock>{offer}</OwnClock>
  );
}

/** Times its reveal from its own mount, outside the screen's clock. */
function OwnClock({ children }: { children: React.ReactNode }) {
  return (
    // No clock: the reveal is timed from this mount.
    <WaitClockContext.Provider value={null}>
      <DelayedReveal after={OFFER_RETRY_AFTER_MS}>{children}</DelayedReveal>
    </WaitClockContext.Provider>
  );
}

/** The full-height frame both states share, on the admin's own surface. */
function StatusFrame({
  role,
  children,
}: {
  role: "status" | "alert";
  children: React.ReactNode;
}) {
  return (
    <div
      role={role}
      aria-live={role === "status" ? "polite" : "assertive"}
      className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-6 text-center"
    >
      {children}
    </div>
  );
}

/** The server could not answer, after its retries. */
export function AdminUnavailable({
  onRetry,
}: {
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <StatusFrame role="alert">
      <p className="text-lg font-semibold text-foreground">
        The admin can&apos;t reach the server.
      </p>
      <p className="max-w-md text-base text-muted-foreground">
        It may still be starting, or it may be down. Try again in a moment.
      </p>
      <Button onClick={onRetry}>Try again</Button>
    </StatusFrame>
  );
}
