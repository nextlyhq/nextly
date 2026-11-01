/**
 * Core's Upcoming releases card, declared with `defineWidget`. One module per
 * widget; `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads `system:releases` as the caller its read services were
 * bound for: the upcoming releases, soonest first, and one row per reason
 * releases need attention. Asked as core's own lists are: the rows the card's
 * size and density hold, at most five, and one more, so the card can say more
 * exist at every size.
 *
 * @module domains/widgets/core-widgets/upcoming-releases
 */

import { rowsThatFit } from "../card-geometry";
import { defineWidget } from "../declaration/define-widget";
import { DEFAULT_WIDGET_LIMIT } from "../query-limits";
import { RELEASES_SOURCE_ID } from "../system-source-ids";

import type { CoreListWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { LIST_DENSITY_SETTING } from "./shared";
import { readCoreList } from "./system-read";

export const upcomingReleasesWidget = defineWidget({
  id: CORE_WIDGET_ID.upcomingReleases,
  title: "Upcoming releases",
  description: "Scheduled releases that have not shipped yet, soonest first.",
  // From a third, where its rows still read, to the full row: the dashboard widens it to 12
  // when it is the only card of its row that shows, which stays within its bounds. Four rows
  // tall by default (h 4), the height of Team, whose row of the default dashboard it shares,
  // and up to ten (h 8). Its list's "View all (N)" leads to Releases, so the card has no link
  // of its own.
  size: {
    default: { w: 4, h: 4 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  // Taken off the dashboard while nothing is scheduled, stopped or overdue: the answer is then
  // empty, since the source sends a row for each upcoming release and one per reason releases
  // need attention, and an empty card would only say there is nothing to say.
  hidesWhenEmpty: true,
  /*
   * 🔴 One of the two core cards with a gate, and the asymmetry is deliberate rather
   * than an inconsistency. `ReleasesService.find` opens with
   * `authorize(actor, "read")`, which THROWS -- so an ungranted reader does
   * not get an empty card, they get one stuck in its error state, reporting a
   * failure that is really a permission they were never meant to have. The
   * two outcomes a card can have here are "hidden" and "broken", and nothing
   * in between is reachable.
   *
   * A gate decides who is offered the widget at all, and the layout drops a
   * card whose gate this caller fails before it is ever loaded, keeping it in
   * the stored ROW so a reader whose grant is later widened gets it back
   * where it was.
   *
   * 🔴 THREE slugs, any of which opens it, because `authorize` does not treat
   * read as the only way to read: it returns early when the caller holds
   * `create` or `publish`, deliberately, so a role granted only `create` can
   * see the release it just made. The admin's `canViewReleases` capability
   * lists the same three. Gating on the read slug alone made this card a
   * third encoding of one rule and the only one that disagreed -- a
   * create-only editor could open the releases screen and never see its card.
   *
   * Each slug is `${action}-${resource}` and `parsePermissionSlug` splits on
   * the FIRST hyphen, so these parse to read/create/publish over
   * `content-releases` -- matching `RELEASES_RESOURCE` and the authorities
   * `api/releases.ts` requires of a human. Written out rather than composed
   * from the constants because importing them would pull the releases
   * service's wiring into this list, the same coupling `system-source-ids.ts`
   * exists to avoid; a test parses them back and compares.
   */
  access: {
    anyOf: [
      "read-content-releases",
      "create-content-releases",
      "publish-content-releases",
    ],
  },
  settings: { density: LIST_DENSITY_SETTING },
  load: async ({
    settings,
    services,
    size,
    signal,
    now,
  }): Promise<CoreListWidgetData> =>
    readCoreList(
      {
        source: RELEASES_SOURCE_ID,
        op: "list",
        // Selecting `reason` is what asks the source for the attention rows, and `entries` and
        // `issues` what ask it for each release's documents and the problems its checks
        // report; see `system:releases`. `id` is what each release row links to. `state` is
        // not asked: the source answers scheduled releases alone, so it would say nothing.
        select: [
          "kind",
          "id",
          "title",
          "scheduledAt",
          "entries",
          "issues",
          "reason",
          "count",
        ],
        // The rows the card's height holds at its density, at most five, and the one more
        // that says more exist: the rule the card's own rows are drawn by.
        limit:
          Math.min(
            DEFAULT_WIDGET_LIMIT,
            rowsThatFit(size, { density: settings.density })
          ) + 1,
      },
      { services, signal, now }
    ),
  // Its own component, so the line naming releases that need attention can sit above the
  // rows; the rows themselves are drawn as core's list cards draw them.
  view: { component: "core#UpcomingReleases" },
  // Nothing scheduled, stopped or overdue: the card leaves the dashboard.
  isEmpty: data => data.items.length === 0,
  // Seen in customise mode, where an empty card is shown marked as hidden.
  empty: {
    message: "Releases you schedule appear here, soonest first.",
    action: { label: "Open Releases", link: "releases" },
  },
});
