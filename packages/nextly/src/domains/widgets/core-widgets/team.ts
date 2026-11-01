/**
 * Core's Team card, declared with `defineWidget`. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads `system:team` as the caller its read services were bound
 * for: how many people there are, and how many roles for a reader who may see
 * them. The source asks the card's gate itself before it counts anyone, the
 * same `TEAM_GATE` the card is offered by, so the two cannot disagree.
 *
 * @module domains/widgets/core-widgets/team
 */

import { defineWidget } from "../declaration/define-widget";
import { TEAM_SOURCE_ID } from "../system-source-ids";
import { TEAM_GATE } from "../team-gate";

import type { TeamWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { readCoreList } from "./system-read";

export const teamWidget = defineWidget({
  id: CORE_WIDGET_ID.team,
  title: "Team",
  // Tier-neutral: a small card draws the people alone, and a reader may see only one count.
  description: "Your project's team at a glance.",
  // From a quarter, where its small tier draws the people alone, to half the row.
  size: {
    default: { w: 4, h: 4 },
    min: { w: 3, h: 2 },
    max: { w: 6, h: 4 },
  },
  // Offered to the readers its source answers, by the one constant both read.
  access: TEAM_GATE,
  load: async ({ services, signal, now }): Promise<TeamWidgetData> => {
    const { items } = await readCoreList(
      { source: TEAM_SOURCE_ID, op: "list" },
      { services, signal, now }
    );
    // Each count the source sent, by its figure; one it left out stays out,
    // so a count withheld from this reader is never drawn as zero.
    const countOf = (figure: "users" | "roles") => {
      const count = items.find(row => row.figure === figure)?.count;
      return typeof count === "number" ? count : undefined;
    };
    const users = countOf("users");
    const roles = countOf("roles");
    return {
      ...(users === undefined ? {} : { users }),
      ...(roles === undefined ? {} : { roles }),
    };
  },
  // Its own component, which draws a tile per count and the "All users" link
  // in the card's footer.
  view: { component: "core#TeamSummary" },
  // The component says itself when neither count came, as the frame's
  // unavailable state: the team is never empty for a reader it is offered to.
  isEmpty: () => false,
});
