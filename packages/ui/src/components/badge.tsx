import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, JSX } from "react";

import { cn } from "../lib/utils";
import type { VariantsFn } from "../lib/variants";

/** The arms `badgeVariants` is built from. Its type is read from them: {@link VariantsFn}. */
/** The status variants, and the solid each one's dot is drawn in. */
const STATUS_DOT = {
  success: "bg-success-solid",
  warning: "bg-warning-solid",
  destructive: "bg-danger-solid",
  info: "bg-info-solid",
} as const;

export const BADGE_VARIANT_MAP = {
  variant: {
    // Clear, legible chip in both modes (was bg-primary/5 at ~5% opacity,
    // which was nearly invisible on dark backgrounds).
    default: "bg-muted text-foreground",
    primary: "bg-primary/10 text-primary dark:bg-primary/20",
    // Status badges are quiet chips: card surface, a hairline edge, ordinary
    // text, and a dot in the status's solid colour (drawn by `Badge`). The
    // word carries the meaning; the dot only marks it, so colour is never the
    // only signal and a table full of statuses stays calm.
    success: "border border-border bg-card text-foreground",
    warning: "border border-border bg-card text-foreground",
    destructive: "border border-border bg-card text-foreground",
    info: "border border-border bg-card text-foreground",
    /*
     * The border colour is NOT important-marked. The base sets no border
     * colour, so nothing inside this component competes for it — the only
     * thing a mark could win against is the caller's own class. Seven
     * outline badges pass one, including a status pill whose comment gives
     * a 3:1 contrast reason for the colour it asks for, and every one of
     * them was being overridden without any sign that it had been.
     */
    outline:
      "border border-border bg-transparent text-foreground dark:text-muted-foreground dark:border-border",
  },
};

/**
 * Badge Component - Design System Specification
 *
 * Badges are non-interactive elements used to highlight important information,
 * such as status indicators, counts, or labels. They should not be focusable
 * or interactive.
 *
 * Accessibility:
 * - Badges are non-interactive (no keyboard focus or click handlers)
 * - Color is not the only indicator - text conveys meaning
 * - Use aria-label for icon-only badges to provide context
 * - Provide contextual information in surrounding UI
 *
 * Design Specs:
 * - Height: 22px
 * - Padding: 2px 10px (vertical × horizontal)
 * - Border radius: Full (pill shape)
 * - Font: 12px (text-xs), medium weight (500)
 * - Status variants (success, warning, destructive, info): a neutral chip with
 *   a 6px dot in the status's solid colour before the label
 *
 * Variants:
 * - default: muted background
 * - primary: primary tint
 * - success, warning, destructive, info: quiet chip with a status dot
 * - outline: transparent background with a border
 * @experimental
 */
const badgeVariants: VariantsFn<typeof BADGE_VARIANT_MAP> = cva(
  "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-0.5 h-[22px] text-xs font-medium transition-colors",
  {
    variants: BADGE_VARIANT_MAP,
    defaultVariants: {
      variant: "default",
    },
  }
);

/** @public */
export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

/** @public */
function Badge({
  className,
  variant = "default",
  children,
  ...props
}: BadgeProps): JSX.Element {
  const dot =
    variant && variant in STATUS_DOT
      ? STATUS_DOT[variant as keyof typeof STATUS_DOT]
      : null;
  return (
    <div
      data-slot={`badge.${variant}`}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          // Not `badge.dot`: the admin keeps table chips neutral with a rule on
          // every `[data-slot^="badge."]`, which would grey the dot out too.
          data-slot="badge-dot"
          className={cn("size-1.5 shrink-0 rounded-full", dot)}
        />
      ) : null}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
