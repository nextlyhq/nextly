"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { useApi } from "@admin/hooks/useApi";

/** A provider button on the login screen (D57). */
export interface AuthUiProvider {
  strategy: string;
  label: string;
  icon?: string;
  component?: string;
  /** A same-origin path the button navigates to, when it has no component. */
  href?: string;
}

/** The public auth-page UI contract served by `GET /auth/ui` (D57). */
export interface AuthUiMeta {
  providers: AuthUiProvider[];
  challengeViews: Record<string, string>;
  slots: { beforeForm: string[]; afterForm: string[]; branding: string[] };
}

const EMPTY: AuthUiMeta = {
  providers: [],
  challengeViews: {},
  slots: { beforeForm: [], afterForm: [], branding: [] },
};

/**
 * Fetch the public auth-page UI config (D57). Returns an empty shape until loaded
 * and on any error (no auth-UI plugins, endpoint unavailable), so the login
 * screen degrades gracefully to the plain password form.
 */
export function useAuthUi(): AuthUiMeta {
  const { api } = useApi();
  const [ui, setUi] = useState<AuthUiMeta>(EMPTY);
  useEffect(() => {
    let active = true;
    void api.public
      .get<AuthUiMeta>("/auth/ui")
      .then(res => {
        if (active && res) setUi({ ...EMPTY, ...res });
      })
      .catch(() => {
        /* degrade to the plain form */
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
  const className =
    "flex w-full h-11 items-center justify-center rounded-md border border-border " +
    "bg-background text-foreground hover:bg-muted transition-colors text-sm font-medium";

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
      <a href={provider.href} className={className}>
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
}: {
  authUi: AuthUiMeta;
  challengeType: string;
  /** @deprecated The host posts the answer; a resumed login has no token here. */
  pendingToken?: string;
  resolve: (
    response: Record<string, unknown>
  ) => Promise<ChallengeResolveResult>;
  onResolved: (next: string | null) => void;
}): ReactNode {
  return (
    <PluginSlot
      path={authUi.challengeViews[challengeType]}
      props={{ challengeType, pendingToken, resolve, onResolved }}
      fallback={
        <p
          className="text-sm text-muted-foreground"
          data-testid="challenge-fallback"
        >
          Additional verification is required to sign in, but no UI is
          registered for “{challengeType}”.
        </p>
      }
    />
  );
}
