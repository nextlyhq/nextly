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

/** Which of the answers the header's account controls wait on are still unanswered. */
export interface HeaderAnswersPending {
  /** The workspace answer: the plugins (what they hide and add) and whether the builder runs. */
  workspace: boolean;
  /** The reader's permissions, which decide whether the notification bell is theirs. */
  permissions: boolean;
}

/**
 * Whether the controls left of the account menu are decided, so the row can be drawn whole.
 *
 * The row is right-aligned, so a control that appears after the first paint pushes every control
 * to its LEFT sideways, while the account menu at the right end holds still whatever arrives
 * beside it. The menu is therefore drawn from the first paint, and the rest of the row once the
 * answers deciding it are in: the workspace answer for the links, the plugins' controls and the
 * bell, and the permissions for the bell where it may be offered. Nothing is drawn on a guess, as
 * a control drawn and then taken back moves its neighbours just the same.
 *
 * `bellOffered` is read only once the workspace answer is in: whether the bell can show at all
 * (no plugin hides it, and the builder runs).
 */
export function headerControlsSettled(
  pending: HeaderAnswersPending,
  bellOffered: boolean
): boolean {
  if (pending.workspace) return false;
  return !(bellOffered && pending.permissions);
}
