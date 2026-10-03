import type { AuthHooks, ChallengeDefinition } from "../auth/pipeline/types";

import type { ComponentPath } from "./admin-contributions";

/**
 * @experimental Plugin auth contributions. Hooks, challenge
 * definitions, and auth-page UI are normal contributions; auth *strategies* are
 * app-opt-in and live in `defineConfig({ auth: { strategies } })`, not here.
 * Ships `@experimental` until a first-party plugin exercises it.
 */
export interface PluginAuthContributions {
  /** Auth-flow hooks (modify / abort / challenge). */
  hooks?: AuthHooks;
  /** Challenge definitions this plugin can resolve (e.g. TOTP). */
  challenges?: ChallengeDefinition[];
  /** Auth-page UI — provider buttons, challenge views, and form slots. */
  ui?: {
    /** Buttons on the login screen that start a named strategy. */
    providers?: Array<{
      strategy: string;
      label: string;
      icon?: string;
      component?: ComponentPath;
      /**
       * A same-origin absolute path the button navigates to, for a provider
       * whose sign-in starts with a redirect rather than a form.
       *
       * Without it a plain provider button renders and does nothing: the host
       * has no handler to give it, so the only working buttons were the ones
       * that shipped their own component.
       *
       * The rule is a path starting with a single `/`, with no scheme, no
       * `//` and no backslash. It is deliberately NOT tied to `/admin/api`:
       * the API base path is configurable, and a plugin may mount its routes
       * at the root.
       */
      href?: string;
    }>;
    /** Map of `challengeType -> component` for rendering a challenge step. */
    challengeViews?: Record<string, ComponentPath>;
    /** Injection points around the login form. */
    slots?: {
      beforeForm?: ComponentPath;
      afterForm?: ComponentPath;
      branding?: ComponentPath;
    };
  };
}
