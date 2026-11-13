"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription, Button, Input } from "@nextlyhq/ui";
import type { JSX } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import {
  OFFER_RETRY_AFTER_MS,
  SessionStallNotice,
} from "@admin/components/guards/AdminPending";
import { ArrowRight, Loader2, Mail } from "@admin/components/icons";
import { AuthFormCard } from "@admin/components/shared/auth/AuthFormCard";
import { AuthRefusalNotice } from "@admin/components/shared/auth/AuthRefusalNotice";
import { PasswordVisibilityToggle } from "@admin/components/shared/auth/PasswordVisibilityToggle";
import {
  LOADING_FRAME_TIMES,
  useDelayedReveal,
} from "@admin/components/shared/loading-frame/delayed-reveal";
import { toast } from "@admin/components/ui";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { PUBLIC_ROUTE_PATHS, ROUTES } from "@admin/constants/routes";
import { useAppName } from "@admin/context/providers/BrandingProvider";
import { useApi } from "@admin/hooks/useApi";
import { useAuthRefusal } from "@admin/hooks/useAuthRefusal";
import { useServerAnswered } from "@admin/hooks/useServerAnswered";
import { useRegistrationOpen } from "@admin/hooks/useSetupStatus";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { apiErrorMessage, type ApiError } from "@admin/lib/api/parseApiError";
import type { ActionResponse } from "@admin/lib/api/response-types";
import { rememberSignedInHere } from "@admin/lib/device-memory/device-memory";

import {
  AuthUiExtras,
  AuthUiExtrasAfter,
  AuthChallenge,
  useAuthUi,
} from "./auth-ui-extras";
import { SetInitialPassword } from "./set-initial-password";
import { useChallengeFlow } from "./use-resume-login";

const formSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .trim(),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters"),
});

/**
 * Whether any plugin contributed something to show above the sign-in form.
 *
 * Named rather than spelled inline: three alternatives inside a JSX branch
 * read as one condition to a person and as three to anything counting them,
 * in a component that is over its complexity budget before this file is
 * touched. The wrapper exists only to space whatever `AuthUiExtras` renders,
 * so asking it for nothing would leave an empty gap.
 */
function hasPreFormUi(authUi: ReturnType<typeof useAuthUi>): boolean {
  return (
    authUi.providers.length > 0 ||
    authUi.slots.beforeForm.length > 0 ||
    authUi.slots.branding.length > 0
  );
}

type SignInValues = z.infer<typeof formSchema>;

/**
 * Where a finished sign-in lands. Drawn at the sign-in page (or another public
 * page), the dashboard; drawn in place of a screen the visitor asked for, that
 * screen, reloaded now that there is a session. Either way an address on this
 * page's own origin, never one taken from the query string.
 */
function afterSignInAddress(): string {
  const { pathname, search } = window.location;
  const onPublicPage = (PUBLIC_ROUTE_PATHS as readonly string[]).includes(
    pathname.replace(/\/$/, "")
  );
  return onPublicPage ? ROUTES.DASHBOARD : `${pathname}${search}`;
}

/**
 * What the form says while the server has not answered yet: nothing for the
 * first moment, then that it is connecting, then that the server is starting
 * and the sign-in will wait for it. Timed by the admin's one wait clock.
 */
function useConnectingNote(serverAnswered: boolean): string {
  const connecting = useDelayedReveal(
    !serverAnswered,
    LOADING_FRAME_TIMES.line
  );
  const starting = useDelayedReveal(
    !serverAnswered,
    LOADING_FRAME_TIMES.status
  );
  if (starting) {
    return "Starting the server. You can type now; signing in waits for it.";
  }
  return connecting ? "Connecting…" : "";
}

/**
 * A sign-in asked for before the server can answer it, sent once it can.
 *
 * The form is drawn, and can be filled in, while a starting server still holds
 * every request. Pressing Sign in then keeps the values instead of sending a
 * request the server would hold: they are sent as soon as the server answers,
 * exactly once, however often the button was pressed meanwhile (each press
 * replaces the values kept, never adds a second sign-in).
 */
function useSignInWhenServerAnswers(
  serverAnswered: boolean,
  send: (values: SignInValues) => Promise<void>
): (values: SignInValues) => void {
  const held = useRef<SignInValues | null>(null);
  const [holding, setHolding] = useState(false);
  // The latest `send`, read when the server answers: the one from the render
  // that pressed the button may have closed over a state since replaced.
  const latestSend = useRef(send);
  useLayoutEffect(() => {
    latestSend.current = send;
  });
  useEffect(() => {
    if (!serverAnswered || !holding) return;
    const values = held.current;
    held.current = null;
    setHolding(false);
    if (values !== null) void latestSend.current(values);
  }, [serverAnswered, holding]);
  return values => {
    if (serverAnswered) {
      void send(values);
      return;
    }
    held.current = values;
    setHolding(true);
  };
}

/**
 * Everything the form does while the server has not answered the page: the
 * held sign-in, the note under the button, whether the button reads as
 * unavailable, and whether the wait has gone on long enough to offer asking
 * again. A server that never answers would hold a pressed Sign in for good,
 * here as on any page the form is drawn on, so past the wait the frame allows
 * the form makes the frame's own offer to ask again.
 */
function useServerWait(send: (values: SignInValues) => Promise<void>): {
  signIn: (values: SignInValues) => void;
  note: string;
  stalled: boolean;
  unavailable: true | undefined;
} {
  const serverAnswered = useServerAnswered();
  const note = useConnectingNote(serverAnswered);
  const stalled = useDelayedReveal(!serverAnswered, OFFER_RETRY_AFTER_MS);
  const signIn = useSignInWhenServerAnswers(serverAnswered, send);
  return {
    signIn,
    note,
    stalled,
    unavailable: serverAnswered ? undefined : true,
  };
}

/** The note under the button while the server is awaited, and the offer to ask again. */
function ServerWaitNote({
  note,
  stalled,
}: {
  note: string;
  stalled: boolean;
}): JSX.Element {
  return (
    <>
      {/* Holds its line from the start, so the note arriving moves nothing
          below it. */}
      <p
        role="status"
        data-testid="sign-in-connecting"
        className="-mt-3 min-h-[18px] text-xs text-muted-foreground"
      >
        {note}
      </p>
      {stalled ? <SessionStallNotice /> : null}
    </>
  );
}

/**
 * The offer to sign up, made only where the app takes sign-ups
 * (`auth.allowRegistration`, off by default), and only once setup-status has
 * said so: offered on an app that takes none, it led to a form the server
 * refuses once it has been filled in.
 */
function SignUpOffer(): JSX.Element | null {
  if (useRegistrationOpen() !== true) return null;
  return (
    <div className="mt-8 text-left">
      <p className="text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href={ROUTES.REGISTER}
          className="text-primary cursor-pointer font-medium transition-colors"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}

export function Login(): JSX.Element {
  const { api } = useApi();
  const appName = useAppName();

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // A refused submission is shown in the form, where it stays while the
  // person acts on it; a toast is kept for every other failure.
  const authRefusal = useAuthRefusal();
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  // Auth-page UI contributed by plugins (provider buttons, slots, 2FA views) — D57.
  const authUi = useAuthUi();

  // The second-factor step, including a sign-in resumed from a provider.
  // Its logic lives in the hook so this component only renders.
  const challengeFlow = useChallengeFlow();

  const form = useForm<SignInValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // Suppressed on CRAP alone: cyclomatic 16 and cognitive 14 are both under
  // threshold. CRAP multiplies complexity by MISSING coverage, and the coverage
  // term here is estimated rather than measured.
  //
  // The figure was 29 cyclomatic / 210.7 CRAP while this function still read
  // its error through a chain of `error.response.data` branches — a shape the
  // admin fetcher never throws, so not one of them could execute. Taking the
  // code and the message off the parsed error instead is what halved it.
  //
  // The rest comes down by separating the two sign-in outcomes that still share
  // this body, never by restoring the branches.
  // fallow-ignore-next-line complexity
  async function onSubmit(values: SignInValues) {
    setIsLoading(true);
    authRefusal.clear();

    try {
      const csrfToken = await getCsrfToken();

      // POST to custom auth login endpoint. Capture the result so the
      // toast can surface the server-authored message.
      const result = await api.public.post<
        ActionResponse & {
          status?: string;
          challengeType?: string;
          pendingToken?: string;
        }
      >("/auth/login", {
        email: values.email,
        password: values.password,
        csrfToken,
      });

      // Multi-step auth (D71): the server paused login pending a challenge
      // (e.g. 2FA). Render the challenge view instead of completing the login.
      if (
        result?.status === "challenge" &&
        result.challengeType &&
        result.pendingToken
      ) {
        challengeFlow.start({
          challengeType: result.challengeType,
          pendingToken: result.pendingToken,
          next: null,
        });
        setIsLoading(false);
        return;
      }

      // Forced first-sign-in password change (ASVS 6.4.1): no session was
      // issued. Show the set-password view; setting it issues the session.
      if (
        result?.status === "password_change_required" &&
        result.pendingToken
      ) {
        challengeFlow.requirePasswordChange({
          pendingToken: result.pendingToken,
        });
        setIsLoading(false);
        return;
      }

      // Prefer `result.message` from the server; fall back to a
      // hard-coded string if the server omits it (defensive shim per
      // spec §9.7).
      toast.success(result?.message ?? "Login successful!", {
        description: `Welcome back to ${appName}`,
      });
      // The server has issued a session, so this browser now has signed in
      // here: the next visit opens on the admin's frame, not on this form.
      rememberSignedInHere();

      // Use full page redirect (not client-side navigateTo) after login.
      // Client-side navigation triggers Radix UI re-renders which cause
      // useInsertionEffect errors, which trigger React Fast Refresh in dev,
      // which remounts PublicRoute, creating an infinite loop.
      window.location.href = afterSignInAddress();
    } catch (error: unknown) {
      // Its own answers first: an unverified email is a 403 too, and this form
      // meets it with a resend action rather than a refusal.
      if (authRefusal.take(error, ["EMAIL_NOT_VERIFIED", "ACCOUNT_LOCKED"])) {
        setEmailNotVerified(false);
        return;
      }
      // The fetcher throws an `ApiError`, so the code and the message are read
      // off the parsed error. The server answers `EMAIL_NOT_VERIFIED` only
      // after the password was proven correct, which is what makes offering
      // the resend action here safe; every other refusal is the generic one.
      // `ACCOUNT_LOCKED` is not emitted by the core, whose lockout answers
      // generically, and is kept for a server that does name it.
      const errorCode =
        error instanceof Error ? ((error as ApiError).code ?? "") : "";
      const errorMessage = apiErrorMessage(error, "Invalid email or password.");

      if (
        errorCode === "EMAIL_NOT_VERIFIED" ||
        errorMessage === "EmailNotVerified"
      ) {
        setEmailNotVerified(true);
        toast.error("Email not verified", {
          description:
            "Please verify your email address before signing in. Check your inbox for a verification link.",
        });
      } else if (errorCode === "ACCOUNT_LOCKED") {
        setEmailNotVerified(false);
        toast.error("Account locked", {
          description: "Too many failed attempts. Please try again later.",
        });
      } else {
        setEmailNotVerified(false);
        toast.error("Login failed", {
          description: errorMessage,
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  // Whether the server has answered this page: until then a sign-in waits,
  // and the form says why.
  const wait = useServerWait(onSubmit);

  async function handleResendVerification() {
    const email = form.getValues("email");
    if (!email) {
      toast.error("Please enter your email address first.");
      return;
    }
    setResendingVerification(true);
    try {
      const csrfToken = await getCsrfToken();
      // Surface the server-authored message instead of duplicating
      // copy on the client.
      const result = await api.public.post<ActionResponse>(
        "/auth/verify-email/resend",
        { email, csrfToken }
      );
      toast.success(result?.message ?? "Verification email sent", {
        description: "Please check your inbox for the verification link.",
      });
    } catch {
      toast.error("Failed to resend verification email. Please try again.");
    } finally {
      setResendingVerification(false);
    }
  }

  return (
    <AuthFormCard
      title="Welcome Back"
      description={`Sign in to your ${appName} account`}
    >
      {challengeFlow.passwordChange ? (
        <SetInitialPassword
          // Absent for the resumed case, where the token is in the cookie.
          pendingToken={challengeFlow.passwordChange.pendingToken}
          // The server's own destination when it has one: the sanitized
          // `next` the pending token carried. Otherwise the dashboard.
          onDone={next => {
            window.location.href = next ?? afterSignInAddress();
          }}
          // The pending token is spent, so the step it stood for is over.
          // Clearing it brings the sign-in form back, which is the only
          // thing left that can help.
          onCredentialRejected={challengeFlow.abandonPasswordChange}
        />
      ) : challengeFlow.challenge && authUi.loaded ? (
        <>
          <AuthRefusalNotice refusal={challengeFlow.refusal} />
          <AuthChallenge
            authUi={authUi}
            challengeType={challengeFlow.challenge.challengeType}
            pendingToken={challengeFlow.challenge.pendingToken}
            // Answered and still no session — the account must replace its
            // admin-set password first — is raised by the hook itself, so this
            // passes the resolver straight through.
            resolve={challengeFlow.resolve}
            onResolved={next => {
              // A challenge view calls this when it reads the answer as "done".
              // A forced password change is accepted and NOT done: the host is
              // already rendering that step, and navigating would land on a page
              // with no session that bounces straight back to login. Checked
              // here rather than trusted to the view, which may predate the
              // `continues` field entirely.
              if (challengeFlow.isContinuing()) return;
              // The host has already sent the browser to the server's `next`;
              // the view's own value cannot be that, and navigating on it
              // replaced the destination with the dashboard.
              if (challengeFlow.hasNavigated()) return;
              window.location.href = next ?? afterSignInAddress();
            }}
          />
        </>
      ) : challengeFlow.resuming || challengeFlow.challenge ? (
        // The outstanding step is still being looked up. Showing the password
        // form meanwhile swapped it out from under the person a moment later,
        // and focus fell to the page.
        //
        // A challenge waits here too until `/auth/ui` has answered: before
        // then no view is registered for anything, so the challenge would
        // render the "no UI is registered" fallback, whose link back to
        // sign-in abandons a flow whose view is still on its way.
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="resuming-sign-in"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Continuing sign-in…
        </p>
      ) : (
        <>
          {challengeFlow.signInFailed && (
            <Alert
              variant="destructive"
              className="mb-6"
              data-testid="signin-failed"
            >
              <AlertDescription>
                Sign-in failed. Try again or use another method.
              </AlertDescription>
            </Alert>
          )}
          <AuthRefusalNotice refusal={authRefusal.refusal} />
          {challengeFlow.flowEnded && (
            <Alert
              variant="destructive"
              className="mb-6"
              data-testid="signin-ended"
            >
              <AlertDescription>
                That sign-in attempt ended. Please sign in again.
              </AlertDescription>
            </Alert>
          )}
          {hasPreFormUi(authUi) && (
            <div className="mb-6">
              <AuthUiExtras authUi={authUi} />
            </div>
          )}
          <FormProvider {...form}>
            <form
              onSubmit={e => {
                void form.handleSubmit(wait.signIn)(e);
              }}
              className="space-y-6"
            >
              {emailNotVerified && (
                <div className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-surface p-4 mb-6">
                  <Mail className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-foreground">
                      Email not verified
                    </p>
                    <p className="text-muted-foreground mt-1">
                      Please check your inbox and click the verification link
                      before signing in.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void handleResendVerification();
                      }}
                      disabled={resendingVerification}
                      className="mt-2 text-sm font-medium text-foreground underline underline-offset-2 hover:text-foreground/80 disabled:opacity-50"
                    >
                      {resendingVerification
                        ? "Sending..."
                        : "Resend verification email"}
                    </button>
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-foreground">
                      Email Address
                    </FormLabel>
                    <FormControl>
                      <Input
                        required
                        type="email"
                        autoComplete="email"
                        spellCheck={false}
                        placeholder="Enter your email address…"
                        {...field}
                        className="h-11 rounded-md border-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          required
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="Enter your password…"
                          {...field}
                          className="pr-10 h-11 rounded-md border-input"
                        />
                      </FormControl>
                      <PasswordVisibilityToggle
                        visible={showPassword}
                        onToggle={() => setShowPassword(!showPassword)}
                      />
                    </div>
                    <div className="flex justify-end">
                      <Link
                        href={ROUTES.FORGOT_PASSWORD}
                        className="text-sm text-primary cursor-pointer transition-colors font-medium mt-1"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                size="md"
                type="submit"
                disabled={isLoading}
                // Not `disabled` while the server has not answered: a press
                // is still taken, and the sign-in sent once it can be. It
                // reads as unavailable meanwhile, to the eye and to a reader.
                aria-disabled={wait.unavailable}
                className="w-full h-11 rounded-md shadow-none bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-100 mt-2 aria-disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
              <ServerWaitNote note={wait.note} stalled={wait.stalled} />
            </form>
          </FormProvider>
          {authUi.slots.afterForm.length > 0 && (
            <div className="mt-6">
              <AuthUiExtrasAfter authUi={authUi} />
            </div>
          )}
          <SignUpOffer />
        </>
      )}
    </AuthFormCard>
  );
}
