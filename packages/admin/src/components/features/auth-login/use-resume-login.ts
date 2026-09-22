"use client";

import { useEffect, useState } from "react";

import { ROUTES } from "@admin/constants/routes";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { publicApi } from "@admin/lib/api/publicApi";

/** What an interrupted sign-in left outstanding, once the page has asked. */
export interface ResumedLogin {
  challengeId: string;
  next: string | null;
}

export type ResumeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "resume"; pending: ResumedLogin }
  | { status: "none" };

/**
 * Resume a sign-in that an external provider started and a second factor
 * interrupted.
 *
 * The provider redirected the browser here with the pending token in an
 * HttpOnly cookie, which this page cannot read — so it asks the server which
 * challenge is outstanding. The token itself is never returned; the resolve
 * request carries the cookie instead.
 */
export function useResumeLogin(search?: string): ResumeState {
  const [state, setState] = useState<ResumeState>({ status: "idle" });

  useEffect(() => {
    const query =
      search ?? (typeof window === "undefined" ? "" : window.location.search);
    if (!new URLSearchParams(query).has("resume")) {
      setState({ status: "none" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    void (async () => {
      try {
        // 204 means nothing is outstanding — an expired cookie looks the same
        // as none, because there is nothing to resume either way.
        const pending = await publicApi.get<ResumedLogin | null>(
          "/auth/pending"
        );
        if (cancelled) return;
        setState(
          pending && pending.challengeId
            ? { status: "resume", pending }
            : { status: "none" }
        );
      } catch {
        // A failure here is not worth blocking sign-in over: the password form
        // is a working way in, so fall back to it rather than to an error.
        if (!cancelled) setState({ status: "none" });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `publicApi` is a module singleton rather than something `useApi()` hands
    // back per render: depending on the hook's return object would re-run this
    // effect on every render, and its own setState would make that endless.
  }, [search]);

  return state;
}

/**
 * Whether the provider redirect reported a failed sign-in.
 *
 * The reason is deliberately absent from the URL — it would say which account
 * was reached — so the page shows one generic message.
 */
export function hasSignInError(search?: string): boolean {
  const query =
    search ?? (typeof window === "undefined" ? "" : window.location.search);
  return new URLSearchParams(query).get("error") === "signin-failed";
}

/** A challenge the login page is currently showing. */
export interface ActiveChallenge {
  challengeType: string;
  /** Absent for a login resumed from a provider: its token is in a cookie. */
  pendingToken?: string;
  next: string | null;
}

export interface ChallengeFlow {
  challenge: ActiveChallenge | null;
  /** Called when a password login returns a challenge instead of a session. */
  start: (challenge: ActiveChallenge) => void;
  /** Post an answer. Navigates on success; returns the message on failure. */
  resolve: (response: Record<string, unknown>) => Promise<ChallengeAnswer>;
  /** Whether a provider redirect reported a generic sign-in failure. */
  signInFailed: boolean;
}

export interface ChallengeAnswer {
  ok: boolean;
  error?: string;
  /**
   * The challenge was answered and STILL no session exists, because the
   * account holds an admin-set password it must replace first.
   *
   * A distinct continuation rather than a success: treating it as one
   * navigated to the dashboard with no session, so the user was bounced back
   * to login and never saw the set-password view. Carries the token that view
   * needs, exactly as the ordinary login path does.
   */
  passwordChangeRequired?: { pendingToken: string };
}

/**
 * The whole second-factor step, kept out of the login component.
 *
 * The HOST owns the resolve request rather than the plugin's challenge view,
 * because a login resumed from a provider has no token to hand it — the cookie
 * travels with the request instead.
 */
export function useChallengeFlow(search?: string): ChallengeFlow {
  const resume = useResumeLogin(search);
  const [challenge, setChallenge] = useState<ActiveChallenge | null>(null);

  useEffect(() => {
    if (resume.status === "resume") {
      setChallenge({
        challengeType: resume.pending.challengeId,
        next: resume.pending.next,
      });
    }
  }, [resume]);

  async function resolve(
    response: Record<string, unknown>
  ): Promise<ChallengeAnswer> {
    try {
      const csrfToken = await getCsrfToken();
      const result = await publicApi.post<{
        next?: string;
        status?: string;
        pendingToken?: string;
      }>("/auth/challenge/resolve", {
        csrfToken,
        response,
        ...(challenge?.pendingToken
          ? { pendingToken: challenge.pendingToken }
          : {}),
      });

      // A successful RESPONSE is not necessarily a session. The forced
      // first-sign-in password change answers 200 with no cookies issued, so
      // navigating here lands on a page that immediately redirects back.
      if (
        result?.status === "password_change_required" &&
        result.pendingToken
      ) {
        return {
          ok: true,
          passwordChangeRequired: { pendingToken: result.pendingToken },
        };
      }

      window.location.href = result?.next ?? ROUTES.DASHBOARD;
      return { ok: true };
    } catch (error: unknown) {
      return {
        ok: false,
        error: apiErrorMessage(error, "That code was not accepted."),
      };
    }
  }

  return {
    challenge,
    start: setChallenge,
    resolve,
    signInFailed: hasSignInError(search),
  };
}
