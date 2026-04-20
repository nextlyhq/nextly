/**
 * Template prompt configuration.
 *
 * Labels and hints shown in the CLI select prompt for template selection.
 * The AVAILABLE_TEMPLATES registry (in lib/templates.ts) is the source
 * of truth for what templates exist. This file only provides display labels.
 */

import pc from "picocolors";

import type { ProjectType } from "../types";

/**
 * Options for the template selection prompt.
 * Includes a disabled "coming soon" hint for future templates.
 */
export function getTemplatePromptOptions(): Array<{
  value: string;
  label: string;
  hint: string;
}> {
  return [
    {
      value: "blank",
      label: "Blank project",
      hint: "Start fresh with an empty config",
    },
    {
      value: "blog",
      label: "Blog",
      hint: "Posts, authors, categories, clean design",
    },
    {
      value: "_coming_soon",
      label: pc.dim("More templates coming soon"),
      hint: "website, portfolio, e-commerce",
    },
  ];
}

/**
 * Check if a prompt selection is a valid template (not the disabled hint).
 */
export function isValidTemplateSelection(value: string): value is ProjectType {
  return value !== "_coming_soon";
}
