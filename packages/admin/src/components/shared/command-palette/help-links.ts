/**
 * The help and community links: Documentation, GitHub and Discord.
 *
 * The one list of them. The command palette and the person's menu read it,
 * and the rail's Help item is meant to as well, so a link changed here
 * changes everywhere it is offered. Each id is a `HeaderButtonId`, the name a
 * plugin's `header.hide` uses to take the link away.
 *
 * @module components/shared/command-palette/help-links
 */

import type { HeaderButtonId } from "@admin/components/layout/header/header-visibility";

export interface HelpLink {
  id: Extract<HeaderButtonId, "docs" | "github" | "discord">;
  label: string;
  href: string;
}

export const HELP_LINKS: readonly HelpLink[] = [
  {
    id: "docs",
    label: "Documentation",
    href: "https://nextlyhq.com/docs",
  },
  {
    id: "github",
    label: "GitHub",
    href: "https://github.com/nextlyhq/nextly",
  },
  {
    id: "discord",
    label: "Discord",
    // The community server's invite, the same link nextlyhq.com carries.
    href: "https://discord.gg/t2qN6H5tMj",
  },
];

/** The help links a reader is offered: every one no plugin hides. */
export function visibleHelpLinks(
  hidden: ReadonlySet<HeaderButtonId>
): HelpLink[] {
  return HELP_LINKS.filter(link => !hidden.has(link.id));
}
