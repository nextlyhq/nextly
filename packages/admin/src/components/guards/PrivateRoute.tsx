"use client";

import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useEffect, useState } from "react";

import { AdminUnavailable } from "@admin/components/guards/AdminPending";
import { ROUTES } from "@admin/constants/routes";
import {
  restartSessionCheck,
  useAuthSession,
} from "@admin/hooks/queries/useAuthSession";
import {
  holdLoginRedirect,
  redirectToLogin,
} from "@admin/lib/api/refreshInterceptor";
import {
  getCurrentUserId,
  invalidateSessionCache,
} from "@admin/lib/auth/session";
import {
  announceSignedOut,
  forgetPerson,
  hasSignedInHere,
  onSignedOutElsewhere,
  rememberSignedInHere,
} from "@admin/lib/device-memory/device-memory";
import { confirmDeviceMemory } from "@admin/lib/device-memory/server-answer";
import { navigateTo } from "@admin/lib/navigation";

interface PrivateRouteProps {
  /**
   * The admin's frame around the screen, given whether the server has
   * confirmed the session. Called with `false` while the session is checked
   * in a browser that has signed in here before, so the frame paints at once;
   * what it draws then must show none of the reader's data. Called with
   * `true` once the server has confirmed the session.
   */
  children: (sessionConfirmed: boolean) => React.ReactNode;
  /**
   * The sign-in form, drawn in place for a browser with no record of signing
   * in here, while the session is checked and after the server says there is
   * none. In place rather than at the sign-in address, so what a visitor
   * types while the server starts is kept when its answer arrives.
   */
  signIn: React.ReactNode;
}

/**
 * Where an unusable session has to send the visitor, or `null` when it is
 * usable.
 *
 * One answer, read by both the effect that navigates and the placeholder that
 * says where it is going. They used to decide separately from the same fields,
 * which is two implementations of one question: a change to either could send
 * someone to setup while telling them they were going to login.
 */
function redirectFor(session: {
  isSetup: boolean;
  isAuthenticated: boolean;
}): { path: string; destination: string } | null {
  if (!session.isSetup) return { path: ROUTES.SETUP, destination: "setup" };
  if (!session.isAuthenticated)
    return { path: ROUTES.LOGIN, destination: "login" };
  return null;
}

/** The themed placeholder shown for the moment before the browser moves. */
function RedirectNotice({ destination }: { destination: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground dark:text-muted-foreground">
        Redirecting to {destination}...
      </p>
    </div>
  );
}

/** What the guard draws: one answer, read from the session's state. */
type GuardScreen =
  | "unavailable"
  | "screen"
  | "frame"
  | "sign-in"
  | "redirecting";

/**
 * Which of the guard's screens the session's state calls for, in order: a
 * server that could not answer, a confirmed session, then, while nothing is
 * decided, the frame for a browser that has signed in here and the sign-in
 * form for any other, the form kept in place once the server says there is no
 * session, and otherwise the move to where the answer sends the visitor.
 */
function guardScreen(state: {
  /** The server could not answer, after the query's own retries. */
  unavailable: boolean;
  settled: boolean;
  confirmed: boolean;
  signedInHere: boolean;
  signInInPlace: boolean;
}): GuardScreen {
  if (state.unavailable) return "unavailable";
  if (state.confirmed) return "screen";
  // Nothing decided yet: the frame, with nothing in it read from the server,
  // or the sign-in form, the screen right for anyone, which can be filled in
  // while the server starts.
  if (!state.settled) return state.signedInHere ? "frame" : "sign-in";
  return state.signInInPlace ? "sign-in" : "redirecting";
}

export function PrivateRoute({
  children,
  signIn,
}: PrivateRouteProps): React.JSX.Element {
  // The shared session query, not a second verification of the same fact. The
  // data providers read this same key, so a session is fetched once and every
  // reader of it agrees.
  const { data, status, fetchStatus } = useAuthSession();
  const queryClient = useQueryClient();
  // Read once per visit: it chooses the first screen, and the answer below
  // decides everything after it.
  const [signedInHere] = useState(hasSignedInHere);

  // Only acted on once the query has DEFINITIVELY resolved with data. In React
  // Query v5 `isLoading` can be false while data is still undefined — an error
  // state, or a transient one during a route transition — and redirecting from
  // there sends the visitor to LOGIN on a result that never arrived, which
  // loops against PublicRoute.
  const settled = status === "success" && data !== undefined;
  const redirect = settled ? redirectFor(data) : null;
  const confirmed = settled && redirect === null;
  // A visitor already on the sign-in form stays on it when the server says
  // there is no session, rather than being moved to the same form at another
  // address with what they typed thrown away.
  const signInInPlace =
    !signedInHere && redirect !== null && redirect.path === ROUTES.LOGIN;

  // The device memory follows the server's answer: on a confirmed session the
  // record is kept and what was remembered is checked against the versions
  // the server serves; when the server says there is none, the session ended,
  // and everything remembered about the person goes, in every open tab.
  const isAuthenticated = settled ? data.isAuthenticated : null;
  useEffect(() => {
    if (isAuthenticated === true) {
      rememberSignedInHere();
      // Handed the lookup rather than its result, so the answer is tied to
      // the session this page is in now: a sign-out before the id arrives
      // leaves it unapplied.
      void confirmDeviceMemory(getCurrentUserId()).catch(() => {
        // No user id after all: nothing is labelled, so nothing is written.
      });
    }
    if (isAuthenticated === false && forgetPerson()) announceSignedOut();
  }, [isAuthenticated]);

  // Signed out in another tab: the session this tab holds is gone with it, so
  // it goes to the sign-in page too rather than drawing a person who left.
  useEffect(
    () =>
      onSignedOutElsewhere(() => {
        invalidateSessionCache();
        redirectToLogin();
      }),
    []
  );

  useEffect(() => {
    if (redirect && !signInInPlace) navigateTo(redirect.path);
  }, [redirect, signInInPlace]);

  const retry = () => void restartSessionCheck(queryClient);

  const screen = guardScreen({
    unavailable: status === "error" && fetchStatus !== "fetching",
    settled,
    confirmed,
    signedInHere,
    signInInPlace,
  });

  // While the sign-in form is drawn here, a background query refused for
  // want of a session leaves the visitor on it rather than moving them to the
  // sign-in page, which would draw the form afresh and lose what they typed.
  const signInShown = screen === "sign-in";
  useEffect(
    () => (signInShown ? holdLoginRedirect() : undefined),
    [signInShown]
  );

  return (
    <GuardScreenView
      screen={screen}
      draw={children}
      signIn={signIn}
      onRetry={retry}
      destination={redirect?.destination ?? "login"}
    />
  );
}

/**
 * Draws the screen `guardScreen` chose. Its own component, so the guard
 * decides and this draws, each simple enough to read whole.
 */
function GuardScreenView({
  screen,
  draw,
  signIn,
  onRetry,
  destination,
}: {
  screen: GuardScreen;
  draw: PrivateRouteProps["children"];
  signIn: React.ReactNode;
  onRetry: () => void;
  /** Where a settled answer that is not a session sends the visitor. */
  destination: string;
}): React.JSX.Element {
  switch (screen) {
    case "unavailable":
      return <AdminUnavailable onRetry={onRetry} />;
    case "screen":
      return <>{draw(true)}</>;
    case "frame":
      return <>{draw(false)}</>;
    case "sign-in":
      // The form makes its own offer to ask again when the server holds it,
      // wherever it is drawn, the sign-in page included.
      return <>{signIn}</>;
    case "redirecting":
      return <RedirectNotice destination={destination} />;
  }
}
