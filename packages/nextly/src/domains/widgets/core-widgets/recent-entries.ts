/**
 * Core's Recent entries card, declared with `defineWidget`. One module per
 * widget; `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads one list, as the person asking: the collection's entries
 * under the card's Filter, in its Sort, each row asked by the collection's own
 * title field, its status where it has one and when it was updated, or
 * by the fields the reader chose instead of the last two. Asked as core's own
 * lists are: the rows the card's size and density hold, at most its "Number
 * of items", and one more, so the card can say more exist at every size.
 *
 * Through the public read services alone, as a plugin's card reads: the
 * collection as `describe` answers it (its title field, whether it has a draft
 * and published status, the fields this reader may read) decides the rows'
 * fields by the same knobs the admin applies, and heads its columns; `find`
 * answers the rows and, from the same read, how many it matched in all, which
 * the card's "View all (N)" names.
 *
 * @module domains/widgets/core-widgets/recent-entries
 */

import { rowsThatFit } from "../card-geometry";
import { defineWidget } from "../declaration/define-widget";
import { setting } from "../declaration/setting-builders";
import { effectiveWidgetLimit } from "../query-limits";

import { askedQuery } from "./asked";
import type { RecentEntriesWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import {
  CARD_FILTER,
  LIST_DENSITY_SETTING,
  LIST_ITEMS,
  TITLED_COLLECTION,
} from "./shared";

/** Recent entries' settings, in the order its settings sheet shows them. */
const RECENT_ENTRIES_SETTINGS = {
  // Titled: each row is asked by the collection's own title field, its
  // status where it has one, and when it was updated.
  collection: TITLED_COLLECTION,
  filter: CARD_FILTER,
  sort: setting.sort({
    of: "collection",
    label: "Sort",
    defaultValue: "-updatedAt",
  }),
  // The fields each row shows after its title, chosen from the ones the
  // reader may read; unset, its status and when it was updated.
  fields: setting.fields({ of: "collection", label: "Fields on each row" }),
  limit: LIST_ITEMS,
  density: LIST_DENSITY_SETTING,
};

export const recentEntriesWidget = defineWidget({
  id: CORE_WIDGET_ID.recentEntries,
  title: "Recent entries",
  description:
    "A collection's entries changed most recently, each linking to its entry.",
  // Added from a collection's group of the add panel, once per collection or
  // more, and never placed on the default dashboard.
  offered: "per-collection",
  // Half the row by default; from a third, where its rows still read, to the full width. Five
  // rows tall at the default density (h 5), from four (h 4) to the ten a list draws (h 8).
  size: {
    default: { w: 6, h: 5 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  settings: RECENT_ENTRIES_SETTINGS,
  load: async ({
    settings,
    services,
    size,
  }): Promise<RecentEntriesWidgetData> => {
    const described = await services.describe(settings.collection);
    // The rows the card's height holds at its density, at most its "Number of
    // items", and the one more that says more exist: the rule the card's own
    // rows are drawn by.
    const rows =
      Math.min(
        effectiveWidgetLimit(settings.limit),
        rowsThatFit(size, { density: settings.density })
      ) + 1;
    const asked = askedQuery(
      { op: "list", sort: "-updatedAt" },
      RECENT_ENTRIES_SETTINGS,
      settings,
      described
    );
    const title = asked.select?.[0];
    // A collection that names no title this reader may read has no row to
    // name: nothing is asked, as the card asked nothing from the browser.
    if (asked.source === undefined || title === undefined) {
      return { title: null, rows: [], columns: [] };
    }
    const select = asked.select;
    const { items, total, atLeast } = await services.find(settings.collection, {
      ...(select === undefined ? {} : { select }),
      ...(asked.sort === undefined ? {} : { sort: asked.sort }),
      ...(asked.where === undefined ? {} : { where: asked.where }),
      limit: rows,
      status: "all",
      // Counted by the same read, for "View all (N)".
      total: true,
    });
    // Each column the rows carry, title first, as the collection describes
    // it: what heads it, and how its values read.
    const columns = (select ?? []).flatMap(name => {
      const field = described?.fields.find(each => each.name === name);
      return field === undefined
        ? []
        : [
            {
              name: field.name,
              type: field.type,
              label: field.label,
              ...(field.choices === undefined
                ? {}
                : { choices: field.choices }),
            },
          ];
    });
    return {
      title,
      // As the browser receives them, so each row is what JSON carries.
      rows: items,
      columns,
      ...(total === undefined ? {} : { total }),
      ...(atLeast === true ? { atLeast: true } : {}),
    };
  },
  view: { component: "core#RecentEntries" },
  // It loads, and its add-panel row is sketched, as the table it draws: rows
  // on a narrow card, a table of its columns on a wide one.
  skeleton: "table",
  // The component draws its own empty state, with the line saying which
  // entries show here, which the frame's one line could not say.
  isEmpty: () => false,
});
