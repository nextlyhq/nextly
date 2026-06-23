import type { AuthHooks, ChallengeDefinition } from "../auth/pipeline/types";

import type { ComponentPath } from "./admin-contributions";

/**
 * @experimental Plugin auth contributions (D71/D57). Hooks, challenge
 * definitions, and auth-page UI are normal contributions; auth *strategies* are
 * app-opt-in and live in `defineConfig({ auth: { strategies } })`, not here.
 * Ships `@experimental` until a first-party plugin exercises it (D55).
 */
export interface PluginAuthContributions {
  /** Auth-flow hooks (modify / abort / challenge). */
  hooks?: AuthHooks;
  /** Challenge definitions this plugin can resolve (e.g. TOTP). */
  challenges?: ChallengeDefinition[];
  /** Auth-page UI (D57) — provider buttons, challenge views, and form slots. */
  ui?: {
    /** Buttons on the login screen that start a named strategy. */
    providers?: Array<{
      strategy: string;
      label: string;
      icon?: string;
      component?: ComponentPath;
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
