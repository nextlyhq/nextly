"use client";

import { Eye, EyeOff } from "@admin/components/icons";

export interface PasswordVisibilityToggleProps {
  /** Whether the field beside it is currently showing the password. */
  visible: boolean;
  /** Flip it. */
  onToggle: () => void;
}

/**
 * The eye button that reveals a password, for the field it sits inside.
 *
 * It exists because the same button was written eleven times and the copies
 * had stopped agreeing: four carried an `aria-label` and seven carried
 * `tabIndex={-1}` instead. On those seven a screen reader announced an unnamed
 * button and a keyboard user could not reach it at all — the control that
 * exists to help someone check what they typed was the one control they could
 * not operate.
 *
 * One implementation cannot drift that way, which is why this is a component
 * rather than seven repaired copies.
 *
 * Positioned by the field that renders it: the field owns the `relative` box
 * and leaves room with `pr-10`.
 */
export function PasswordVisibilityToggle({
  visible,
  onToggle,
}: PasswordVisibilityToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? "Hide password" : "Show password"}
      className="absolute cursor-pointer right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
    >
      {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
    </button>
  );
}
