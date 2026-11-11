"use client";

/**
 * Whether the server has answered this page yet.
 *
 * A server that is starting holds every request until it is ready, and the
 * sign-in form is drawn before then so a visitor can type. What it needs to
 * know is when a sign-in sent now would be answered rather than held, and the
 * first answer the page gets says so. It asks setup-status, which every guard
 * already asks and which is shared, so this adds no request of its own.
 *
 * A failed request counts as an answer too: the server is past holding the
 * page, and the sign-in itself will then say what went wrong rather than wait
 * for ever on a check that cannot succeed.
 *
 * @module hooks/useServerAnswered
 */

import { useEffect, useState } from "react";

import {
  onSetupStatusReset,
  readSetupState,
} from "@admin/lib/auth/setup-status";

export function useServerAnswered(): boolean {
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    let live = true;
    // The latest ask: an answer to one a retry has since dropped is still an
    // answer, but only the newest is waited on.
    let asking: Promise<unknown> | null = null;
    const ask = () => {
      const pending = readSetupState();
      asking = pending;
      void pending.then(() => {
        if (live && asking === pending) setAnswered(true);
      });
    };
    ask();
    // A retry drops a request the server is holding and asks afresh: wait on
    // the new one, or a form waiting on the old would wait for ever.
    const unsubscribe = onSetupStatusReset(() => {
      if (live) ask();
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return answered;
}
