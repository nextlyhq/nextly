/**
 * Core's Team activity card, declared with `defineWidget`: who created, saved,
 * published, unpublished or deleted which entry or Single, newest first,
 * limited to what the reader may read. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads `system:activity` as the caller its read services were
 * bound for, the same read the activity endpoint makes: it leaves out every
 * event about an entry, collection or Single the reader may not read, so the
 * card neither draws nor counts one. Asked as core's own lists are: the rows
 * the card's size and density hold, at most its "Number of items", and one
 * more, so the card can say more exist at every size.
 *
 * @module domains/widgets/core-widgets/team-activity
 */

import { rowsThatFit } from "../card-geometry";
import { defineWidget } from "../declaration/define-widget";
import { effectiveWidgetLimit } from "../query-limits";
import { ACTIVITY_SOURCE_ID } from "../system-source-ids";

import type { CoreListWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { LIST_DENSITY_SETTING, LIST_ITEMS } from "./shared";
import { readCoreList } from "./system-read";

export const teamActivityWidget = defineWidget({
  id: CORE_WIDGET_ID.teamActivity,
  title: "Team activity",
  description: "Who changed what in your content, newest first.",
  // Half the row by default; from a third, where its rows still read, to the full width. Five
  // rows tall at the default density (h 5), from four (h 4) to the ten a list draws (h 8).
  size: {
    default: { w: 6, h: 5 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  settings: { limit: LIST_ITEMS, density: LIST_DENSITY_SETTING },
  load: async ({
    settings,
    services,
    size,
    signal,
    now,
  }): Promise<CoreListWidgetData> =>
    readCoreList(
      {
        source: ACTIVITY_SOURCE_ID,
        op: "list",
        // The rows the card's height holds at its density, at most its "Number of items", and
        // the one more that says more exist: the rule the card's own rows are drawn by.
        limit:
          Math.min(
            effectiveWidgetLimit(settings.limit),
            rowsThatFit(size, { density: settings.density })
          ) + 1,
      },
      { services, signal, now }
    ),
  // Its own component, because a row is a sentence with an avatar and a time
  // read relative to now, which no list line draws.
  view: { component: "core#TeamActivity" },
  // The component draws its own empty state, which says what the feed holds.
  isEmpty: () => false,
});
