"use client";

/**
 * What the admin shows while it waits for the server to say who is signed in,
 * and when the server could not say.
 *
 * A server that is starting can take a minute or more to answer its first
 * request. The admin used to show an empty page for all of it, which reads as
 * broken and gets reloaded, and reloading restarts the wait. So the wait is
 * shown, and named once it is longer than a normal load, and the visitor gets a
 * way to ask again once waiting stops being the likely fix.
 */
import { Button, Spinner } from "@nextlyhq/ui";
import type React from "react";
import { useEffect, useState } from "react";

/** From here a wait no longer reads as a normal page load. */
export const SLOW_START_AFTER_MS = 8_000;
/** From here asking again is offered alongside waiting. */
export const OFFER_RETRY_AFTER_MS = 45_000;

type WaitStage = "loading" | "starting" | "stalled";

/** The stage of a wait that began when the component mounted or was reset. */
function useWaitStage(resetKey: number): WaitStage {
  const [stage, setStage] = useState<WaitStage>("loading");

  useEffect(() => {
    setStage("loading");
    const starting = setTimeout(
      () => setStage("starting"),
      SLOW_START_AFTER_MS
    );
    const stalled = setTimeout(() => setStage("stalled"), OFFER_RETRY_AFTER_MS);
    return () => {
      clearTimeout(starting);
      clearTimeout(stalled);
    };
  }, [resetKey]);

  return stage;
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

const WAIT_MESSAGE: Record<WaitStage, string> = {
  loading: "Loading the admin…",
  starting: "The server is starting. This can take up to a minute.",
  stalled: "Still waiting for the server.",
};

/**
 * Waiting for the server. Without `onRetry` it only waits, for the moment
 * before the admin knows its route.
 */
export function AdminPending({
  onRetry,
}: {
  onRetry?: () => void;
}): React.JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const stage = useWaitStage(attempt);

  return (
    <StatusFrame role="status">
      {/* The message below says what is happening; the spinner is decoration,
          and a second status region inside this one would be announced twice. */}
      <Spinner size="lg" role="presentation" aria-hidden="true" />
      <p className="text-base text-foreground">{WAIT_MESSAGE[stage]}</p>
      {stage === "stalled" && onRetry ? (
        <Button
          variant="outline"
          onClick={() => {
            onRetry();
            // The new request starts a new wait, so its messages start over.
            setAttempt(previous => previous + 1);
          }}
        >
          Try again
        </Button>
      ) : null}
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
