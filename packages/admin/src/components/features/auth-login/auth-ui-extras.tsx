"use client";

import type { AuthUiMeta, AuthUiProvider } from "nextly/api/auth-ui-types";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { resolveIconName } from "@admin/components/features/widgets/archetypes/icon";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { ROUTES } from "@admin/constants/routes";
import { useApi } from "@admin/hooks/useApi";

// The `GET /auth/ui` contract (D57), imported from the server that serves it
// rather than restated, and re-exported for this feature's consumers.
export type { AuthUiMeta, AuthUiProvider };

const EMPTY: AuthUiMeta = {
  providers: [],
  challengeViews: {},
  slots: { beforeForm: [], afterForm: [], branding: [] },
};

/** The auth-page UI config, and whether the request for it has settled. */
export interface AuthUiState extends AuthUiMeta {
  /**
   * Whether `/auth/ui` has answered, successfully or not.
   *
   * The empty shape before it answers is indistinguishable from a server with
   * no auth-UI plugins, so a page that needs a challenge view has to wait on
   * this rather than read the empty `challengeViews` as "none registered".
   * True after a failure as well: a request that will never succeed must not
   * hold the page in a loading state.
   */
  loaded: boolean;
}

/**
 * Fetch the public auth-page UI config (D57). Returns an empty shape until loaded
 * and on any error (no auth-UI plugins, endpoint unavailable), so the login
 * screen degrades gracefully to the plain password form; `loaded` says which
 * of those the empty shape means.
 */
export function useAuthUi(): AuthUiState {
  const { api } = useApi();
  const [ui, setUi] = useState<AuthUiState>({ ...EMPTY, loaded: false });
  useEffect(() => {
    let active = true;
    void api.public
      .get<AuthUiMeta>("/auth/ui")
      .then(res => {
        if (active) setUi({ ...EMPTY, ...res, loaded: true });
      })
      .catch(() => {
        // Degrade to the plain form, and stop waiting on a view that will not
        // arrive.
        if (active) setUi({ ...EMPTY, loaded: true });
      });
    return () => {
      active = false;
    };
  }, [api.public]);
  return ui;
}

/**
 * A provider button.
 *
 * Three shapes, because providers start sign-in in three different ways: a
 * plugin component owns the whole flow, an `href` navigates to a route the
 * plugin mounted, or the host handles the click. A provider with neither an
 * `href` nor a component nor a handler used to render an inert button — it
 * looked like a way in and did nothing.
 */
function ProviderButton({
  provider,
  onProvider,
}: {
  provider: AuthUiProvider;
  onProvider?: (strategy: string) => void;
}): ReactNode {
  // Set on the first click of a navigating provider: the browser is leaving
  // for the provider, and a second click started a second authorize request
  // whose state cookie replaced the first one's.
  const [starting, setStarting] = useState(false);
  // Cleared when the browser shows this page again from its back-forward
  // cache: a person who cancelled at the provider and pressed Back would
  // otherwise find the button still disabled until they reloaded.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setStarting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const className =
    "flex w-full h-11 items-center justify-center gap-2 rounded-md border border-border " +
    "bg-background text-foreground hover:bg-muted transition-colors text-sm font-medium " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
    "aria-disabled:pointer-events-none aria-disabled:opacity-60";
  // The declared Lucide name, from the admin's curated set; an unknown name
  // draws nothing, as it does for a widget.
  const icon = resolveIconName(provider.icon);

  if (provider.component) {
    return (
      <PluginSlot
        path={provider.component}
        props={{
          provider,
          onStart: () => onProvider?.(provider.strategy),
        }}
      />
    );
  }

  if (provider.href) {
    // A navigation rather than a fetch: the provider flow leaves the page, and
    // the server validated the path before serving it.
    return (
      <a
        href={provider.href}
        className={className}
        aria-disabled={starting || undefined}
        aria-busy={starting || undefined}
        onClick={event => {
          // A modified or middle click opens the provider in another tab and
          // leaves this page where it is, so it does not count as starting.
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.button !== 0
          ) {
            return;
          }
          if (starting) {
            event.preventDefault();
            return;
          }
          setStarting(true);
        }}
      >
        {icon}
        {provider.label}
      </a>
    );
  }

  // Neither a component nor a path, so the HOST is the only thing that could
  // start the flow — and a host that did not hand one in has nothing to run.
  // Rendering anyway made a control that looked like a way in and did nothing.
  if (!onProvider) return null;

  return (
    <button
      type="button"
      onClick={() => onProvider(provider.strategy)}
      className={className}
    >
      {icon}
      {provider.label}
    </button>
  );
}

/**
 * The plugin-contributed parts that belong ABOVE the sign-in form: branding,
 * the `beforeForm` slot, and the provider buttons.
 *
 * Split from {@link AuthUiExtrasAfter} because a single component rendered in
 * one place put every slot below the form, which made `beforeForm` a name that
 * described nothing — and pushed provider buttons under the password field
 * they are an alternative to.
 */
export function AuthUiExtras({
  authUi,
  onProvider,
}: {
  authUi: AuthUiMeta;
  onProvider?: (strategy: string) => void;
}): ReactNode {
  const hasProviders = authUi.providers.length > 0;
  return (
    <>
      {authUi.slots.branding.map((path, i) => (
        <PluginSlot key={`brand-${i}`} path={path} />
      ))}
      {authUi.slots.beforeForm.map((path, i) => (
        <PluginSlot key={`before-${i}`} path={path} />
      ))}
      {hasProviders && (
        <div data-testid="auth-providers" className="space-y-2">
          {authUi.providers.map(prov => (
            <ProviderButton
              key={prov.strategy}
              provider={prov}
              onProvider={onProvider}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** The plugin-contributed parts that belong below the sign-in form. */
export function AuthUiExtrasAfter({
  authUi,
}: {
  authUi: AuthUiMeta;
}): ReactNode {
  return (
    <>
      {authUi.slots.afterForm.map((path, i) => (
        <PluginSlot key={`after-${i}`} path={path} />
      ))}
    </>
  );
}

/** What a challenge component gets back from the host after it answers. */
export interface ChallengeResolveResult {
  ok: boolean;
  /** A message to show when `ok` is false. Generic by design. */
  error?: string;
  /**
   * The answer was accepted and the login is NOT finished.
   *
   * A forced password change ends here rather than in a session: the factor
   * was correct, so this is not a failure, but there is another step and the
   * host is already rendering it. A view that treats `ok` as "done" and calls
   * `onResolved` would navigate away from that step, to a page with no session
   * that bounces straight back to login.
   *
   * A view that does not know about this field is not broken by it: the host
   * ignores `onResolved` while a continuation is pending, so the redirect
   * cannot happen either way. Reading it lets a view skip the call entirely.
   */
  continues?: boolean;
  /**
   * Where the host is sending the browser, when the login finished. The host
   * navigates itself; a view calling `onResolved` afterwards does not move it.
   */
  next?: string;
}

/**
 * The props a plugin's challenge view receives, registered under
 * `contributes.auth.ui.challengeViews[challengeType]`.
 *
 * The view collects the factor and calls `resolve` with it; the host posts it
 * to `/auth/challenge/resolve`. When that answer finishes the login, the host
 * navigates to the login's destination itself, and a later `onResolved` call
 * does not move it. `onResolved` decides where to go only for a view that
 * posts its own answer with the deprecated `pendingToken`: it passes the path
 * to land on, or `null` for the default.
 */
export interface ChallengeViewProps {
  challengeType: string;
  /**
   * @deprecated The host posts the answer, so a view never needs the token,
   * and a login resumed from an external provider has none to give (it is in
   * an HttpOnly cookie). Removed in a later minor.
   */
  pendingToken?: string;
  resolve: (
    response: Record<string, unknown>
  ) => Promise<ChallengeResolveResult>;
  onResolved: (next: string | null) => void;
}

/**
 * Render the challenge step (D71 multi-step) when a login is interrupted by a
 * second factor. Resolves `challengeViews[challengeType]` through the component
 * registry; the plugin component collects the factor and calls `resolve`.
 *
 * The HOST posts to `/auth/challenge/resolve`, not the plugin component. A
 * login resumed from an external provider has no token in the browser at all —
 * it is in an HttpOnly cookie — so a component that posted its own token could
 * not complete that flow. `pendingToken` remains in the props for one minor,
 * deprecated and undefined in resume mode.
 */
export function AuthChallenge({
  authUi,
  challengeType,
  pendingToken,
  resolve,
  onResolved,
}: ChallengeViewProps & { authUi: AuthUiMeta }): ReactNode {
  const props: ChallengeViewProps = {
    challengeType,
    pendingToken,
    resolve,
    onResolved,
  };
  return (
    <PluginSlot
      path={authUi.challengeViews[challengeType]}
      props={{ ...props }}
      fallback={
        <div data-testid="challenge-fallback" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Additional verification is required to sign in, but no UI is
            registered for “{challengeType}”.
          </p>
          {/* The only way on from here: without it the page held a message
              and nothing to act on. */}
          <a
            href={ROUTES.LOGIN}
            className="text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
          >
            Back to sign in
          </a>
        </div>
      }
    />
  );
}
