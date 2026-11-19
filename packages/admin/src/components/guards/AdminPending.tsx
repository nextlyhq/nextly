"use client";

/**
 * What the admin shows when the server has kept it waiting too long, when it
 * is busy and asked the admin to wait, and when it could not say who is
 * signed in.
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
import { useEffect, useRef, useState } from "react";

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

/**
 * Signed in, but the account holds no role, so there is no staff work here:
 * every action would be refused by the server. Says who is signed in and what
 * would change it, offers to check again once an administrator has given a
 * role, and to sign out, rather than drawing screens that refuse everything.
 */
export function AdminNoRole({
  email,
  onCheckAgain,
  onSignOut,
}: {
  email: string | null;
  onCheckAgain: () => void;
  onSignOut: () => void;
}): React.JSX.Element {
  return (
    <StatusFrame role="alert">
      <p className="text-lg font-semibold text-foreground">
        You don&apos;t have access to the admin yet.
      </p>
      <p className="max-w-md text-base text-muted-foreground">
        {email ? (
          <>
            You&apos;re signed in as{" "}
            <span className="font-medium text-foreground">{email}</span>, but
            your account has no role on this site.
          </>
        ) : (
          <>Your account has no role on this site.</>
        )}{" "}
        Ask an administrator to give you one, then check again.
      </p>
      <div className="flex gap-3">
        <Button onClick={onCheckAgain}>Check again</Button>
        <Button variant="outline" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </StatusFrame>
  );
}

/** One refusal from a busy server: how long it asked the admin to wait. */
export interface ServerBusyWait {
  readonly retryAfterSeconds: number;
}

/**
 * The server is up but refused for now (a 429) and said how long to wait.
 * Counts that wait down, then asks again by itself; "Try again now" asks
 * sooner. A status rather than an alert: nothing is wrong that the visitor
 * must act on. The ticking count is hidden from screen readers, which would
 * otherwise read it out every second; they are told the whole wait once.
 *
 * Each `wait` is one refusal, told apart by identity: a second refusal starts
 * its own wait, even one of the same length.
 */
export function AdminBusy({
  wait,
  onRetry,
}: {
  wait: ServerBusyWait;
  onRetry: () => void;
}): React.JSX.Element {
  const { retryAfterSeconds } = wait;
  const [secondsLeft, setSecondsLeft] = useState(retryAfterSeconds);
  // A new refusal while this screen stays drawn restarts the count from its
  // own wait, set during render so the stale count is never drawn.
  const [counting, setCounting] = useState(wait);
  if (counting !== wait) {
    setCounting(wait);
    setSecondsLeft(retryAfterSeconds);
  }
  // The latest retry, read when the wait ends, so a new function from the
  // parent's render does not restart the count.
  const retry = useRef(onRetry);
  useEffect(() => {
    retry.current = onRetry;
  }, [onRetry]);
  // The retry is timed on its own from the start of the wait, not by the
  // count, so it comes when the server said whatever the count's renders do.
  useEffect(() => {
    const tick = setInterval(
      () => setSecondsLeft(left => Math.max(left - 1, 0)),
      1_000
    );
    const due = setTimeout(
      () => retry.current(),
      wait.retryAfterSeconds * 1_000
    );
    return () => {
      clearInterval(tick);
      clearTimeout(due);
    };
  }, [wait]);
  return (
    <StatusFrame role="status">
      <p className="text-lg font-semibold text-foreground">
        The server is busy.
      </p>
      <p aria-hidden className="max-w-md text-base text-muted-foreground">
        Trying again in {secondsLeft} s.
      </p>
      <p className="sr-only">Trying again in {retryAfterSeconds} seconds.</p>
      <Button variant="outline" onClick={onRetry}>
        Try again now
      </Button>
    </StatusFrame>
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
