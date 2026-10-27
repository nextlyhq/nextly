/**
 * Core's Team card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/team
 */

import type { WidgetDefinition } from "../definition";
import { TEAM_SOURCE_ID } from "../system-source-ids";
import { TEAM_GATE } from "../team-gate";

export const teamWidget = {
  id: "core/team",
  title: "Team",
  // Tier-neutral: a small card draws the people alone, and a reader may see only one count.
  description: "Your project's team at a glance.",
  archetype: "custom",
  // From a quarter, where its small tier draws the people alone, to half the row.
  size: {
    default: { w: 4, h: 4 },
    min: { w: 3, h: 2 },
    max: { w: 6, h: 4 },
  },
  defaultOrder: 70,
  component: "core#TeamSummary",
  link: { label: "All users", href: "/admin/users" },
  // Offered to the readers its source answers, by the one constant both read.
  requiredPermission: TEAM_GATE,
  query: { source: TEAM_SOURCE_ID, op: "list" },
} as const satisfies WidgetDefinition;
