import type { PluginDefinition } from "../../plugins/plugin-context";

/**
 * A provider button rendered on the login screen (D57). Clicking it starts the
 * named auth strategy.
 */
export interface AuthUiProvider {
  strategy: string;
  label: string;
  icon?: string;
  component?: string;
  /** A same-origin path the button navigates to, when it has no component. */
  href?: string;
}

/**
 * The aggregated, public auth-page UI contract (D57). Served pre-auth to the
 * login screen so it can render provider buttons, the right challenge view for a
 * `{ status: "challenge" }` login response, and any injected form slots.
 *
 * Slots are arrays so multiple plugins can compose (e.g. two plugins each adding
 * something after the form).
 */
export interface AuthUiMeta {
  providers: AuthUiProvider[];
  /** challengeType → component path (last plugin wins on a collision). */
  challengeViews: Record<string, string>;
  slots: {
    beforeForm: string[];
    afterForm: string[];
    branding: string[];
  };
}

/**
 * Whether a value is a path this origin will serve, rather than somewhere else.
 *
 * A login button is the most valuable place on a site to plant an open
 * redirect, so the check is by construction rather than by recognising hostile
 * URLs: exactly one leading slash, and a second character that cannot begin an
 * authority. That rejects `//evil`, `/\\evil`, every scheme, and the encodings
 * of those, including ones not yet invented.
 */
export function isSameOriginPath(href: string): boolean {
  if (typeof href !== "string" || !href.startsWith("/")) return false;
  if (href.length > 1 && (href[1] === "/" || href[1] === "\\")) return false;
  // A control character can split or truncate the attribute it lands in.
  for (let i = 0; i < href.length; i++) {
    const code = href.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

/**
 * The providers whose buttons can safely be rendered.
 *
 * One with an unusable `href` is dropped rather than failing boot: a single bad
 * button should not stop a site from starting, and a provider missing from the
 * login page is a visible failure an operator can act on.
 */
function usableProviders(
  pluginName: string,
  providers: readonly AuthUiProvider[]
): AuthUiProvider[] {
  return providers.filter(provider => {
    if (provider.href === undefined || isSameOriginPath(provider.href)) {
      return true;
    }
    console.warn(
      `[nextly] Ignoring provider "${provider.strategy}" from ${pluginName}: ` +
        `href must be a same-origin path beginning with a single "/".`
    );
    return false;
  });
}

/** Fold every plugin's `contributes.auth.ui` into one served {@link AuthUiMeta}. */
export function aggregateAuthUi(plugins: PluginDefinition[]): AuthUiMeta {
  const meta: AuthUiMeta = {
    providers: [],
    challengeViews: {},
    slots: { beforeForm: [], afterForm: [], branding: [] },
  };
  for (const plugin of plugins) {
    const ui = plugin.contributes?.auth?.ui;
    if (!ui) continue;
    meta.providers.push(...usableProviders(plugin.name, ui.providers ?? []));
    if (ui.challengeViews)
      Object.assign(meta.challengeViews, ui.challengeViews);
    if (ui.slots?.beforeForm) meta.slots.beforeForm.push(ui.slots.beforeForm);
    if (ui.slots?.afterForm) meta.slots.afterForm.push(ui.slots.afterForm);
    if (ui.slots?.branding) meta.slots.branding.push(ui.slots.branding);
  }
  return meta;
}

/**
 * GET /auth/ui — public, pre-auth endpoint serving the aggregated auth-page UI
 * (D57). The admin login screen fetches this before the user is authenticated,
 * so it carries no secrets — only component paths + labels the client resolves
 * through its string-path component registry.
 */
export function handleAuthUi(
  _request: Request,
  deps: { authUi: AuthUiMeta }
): Response {
  return new Response(JSON.stringify(deps.authUi), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
