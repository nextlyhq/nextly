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
 * Render plugin-contributed auth-page slots + provider buttons (D57). Presentational
 * (takes `authUi` as a prop) so it's unit-testable. A provider with a `component`
 * renders that (it owns the click → provider flow); otherwise a labeled button
 * calls `onProvider`.
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
          {authUi.providers.map(prov =>
            prov.component ? (
              <PluginSlot
                key={prov.strategy}
                path={prov.component}
                props={{
                  provider: prov,
                  onStart: () => onProvider?.(prov.strategy),
                }}
              />
            ) : (
              <button
                key={prov.strategy}
                type="button"
                onClick={() => onProvider?.(prov.strategy)}
                className="w-full h-11 rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors text-sm font-medium"
              >
                {prov.label}
              </button>
            )
          )}
        </div>
      )}
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
