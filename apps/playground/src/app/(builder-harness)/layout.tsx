import { AdminShell } from "../admin-shell";

/**
 * The builder harness routes, grouped so they mount the same client shell the
 * panel does.
 *
 * A route group is parentheses on disk and nothing in the URL, so these three
 * still answer at `/builder-shell`, `/builder-canvas` and
 * `/builder-canvas-preview`. What it buys is one statement of what they need,
 * in one place, instead of three layouts that agree until one of them is edited.
 *
 * They mount the shell rather than doing without it because the components
 * under test are the panel's, and a harness that renders them inside a
 * different tree than the panel builds is testing a composition the product
 * never ships.
 *
 * @module app/(builder-harness)/layout
 */
export default function BuilderHarnessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
