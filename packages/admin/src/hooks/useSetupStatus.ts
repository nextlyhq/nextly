"use client";

/**
 * Setup-status as a page reads it while it renders: undefined until the
 * server's answer (or the fail-safe that stands in for one) arrives, then that
 * answer. Asked through the shared setup-status read the route guards make,
 * so it adds no request of its own, and asked again whenever that read is
 * dropped (a retry abandoning a request the server holds, or a sign-out), so
 * a page never waits on a request nobody will answer.
 *
 * @module hooks/useSetupStatus
 */

import { useEffect, useState } from "react";

import {
  onSetupStatusReset,
  readSetupState,
  type SetupStatus,
} from "@admin/lib/auth/setup-status";

export function useSetupStatus(): SetupStatus | undefined {
  const [status, setStatus] = useState<SetupStatus | undefined>(undefined);
  useEffect(() => {
    let live = true;
    // The latest ask: an answer to one a retry has since dropped is still an
    // answer, but only the newest is waited on.
    let asking: Promise<SetupStatus> | null = null;
    const ask = () => {
      const pending = readSetupState();
      asking = pending;
      void pending.then(answer => {
        if (live && asking === pending) setStatus(answer);
      });
    };
    ask();
    const unsubscribe = onSetupStatusReset(() => {
      if (live) ask();
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return status;
}

/**
 * Whether the app takes sign-ups (`auth.allowRegistration`): undefined until
 * setup-status has answered, then its answer, which is no wherever the server
 * did not say yes.
 */
export function useRegistrationOpen(): boolean | undefined {
  return useSetupStatus()?.allowRegistration;
}
