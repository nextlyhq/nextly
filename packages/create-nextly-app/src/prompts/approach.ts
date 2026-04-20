/**
 * Schema approach prompt configuration.
 *
 * Options for how the user wants to define their content schema.
 * This is Nextly's unique differentiator - no other CMS offers
 * code-first, visual, and hybrid approaches in a single CLI.
 */

import type { ProjectApproach } from "../types";

/**
 * Labels shown in the CLI select prompt for each approach.
 */
export const APPROACH_LABELS: Record<
  ProjectApproach,
  { label: string; hint: string }
> = {
  "code-first": {
    label: "Code-first",
    hint: "Define in TypeScript config (like Payload CMS)",
  },
  visual: {
    label: "Visual",
    hint: "Create via Admin Panel UI (like Strapi/WordPress)",
  },
  both: {
    label: "Both",
    hint: "Core schemas in code, extend via Admin Panel",
  },
};

/**
 * Get approach prompt options in display order.
 */
export function getApproachPromptOptions(): Array<{
  value: ProjectApproach;
  label: string;
  hint: string;
}> {
  return (["code-first", "visual", "both"] as const).map(value => ({
    value,
    label: APPROACH_LABELS[value].label,
    hint: APPROACH_LABELS[value].hint,
  }));
}
