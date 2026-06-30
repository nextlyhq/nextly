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
    if (ui.providers) meta.providers.push(...ui.providers);
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
