import type { PluginMetadata } from "@admin/types/branding";

/**
 * Built-in admin header buttons a plugin may hide. The user/account dropdown is
 * intentionally not controllable (logout must stay reachable). Mirrors the core
 * `HeaderButtonId` (contributes.admin.header).
 */
export type HeaderButtonId = "github" | "discord" | "docs" | "notifications";

const ALL_BUTTONS: readonly HeaderButtonId[] = [
  "github",
  "discord",
  "docs",
  "notifications",
];

/**
 * Resolve which built-in header buttons are hidden, union-merged across plugins:
 * a button is hidden if ANY plugin sets `hideDefaults` or lists it in `hide`.
 *
 * Branding only carries enabled plugins' contributions (the server omits header
 * for disabled plugins), so no enabled-check is needed here.
 */
export function computeHiddenHeaderButtons(
  plugins: PluginMetadata[] | undefined
): Set<HeaderButtonId> {
  const hidden = new Set<HeaderButtonId>();
  for (const plugin of plugins ?? []) {
    const header = plugin.header;
    if (!header) continue;
    if (header.hideDefaults) {
      for (const id of ALL_BUTTONS) hidden.add(id);
    }
    for (const id of header.hide ?? []) hidden.add(id);
  }
  return hidden;
}
