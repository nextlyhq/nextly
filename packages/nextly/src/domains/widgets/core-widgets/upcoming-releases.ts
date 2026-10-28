/**
 * Core's Upcoming releases card, as a widget. One module per widget; `core-widgets/index.ts`
 * lists them in their order.
 *
 * @module domains/widgets/core-widgets/upcoming-releases
 */

import type { WidgetDefinition } from "../definition";
import { RELEASES_SOURCE_ID } from "../system-source-ids";

import { CORE_WIDGET_ID } from "./ids";
import { LIST_DENSITY } from "./shared";

export const upcomingReleasesWidget = {
  id: CORE_WIDGET_ID.upcomingReleases,
  title: "Upcoming releases",
  description: "Scheduled releases that have not shipped yet, soonest first.",
  // Its own component, so the line naming releases that need attention can sit above the
  // rows; the rows themselves are drawn as core's list cards draw them.
  archetype: "custom",
  component: "core#UpcomingReleases",
  // From a third, where its rows still read, to two thirds: a short list needs no more. Four
  // rows tall by default (h 4), the height of Team, whose row of the default dashboard it
  // shares, and up to ten (h 8). Its list's "View all (N)" leads to Releases, so the card has
  // no link of its own.
  size: {
    default: { w: 4, h: 4 },
    min: { w: 4, h: 4 },
    max: { w: 8, h: 8 },
  },
  // Beside its gate: offered once a release exists that the reader may
  // read, not as an empty card on a site that has never made one.
  lifecycle: "conditional",
  visibleWhen: "releases:present",
  /*
   * 🔴 One of the two core cards with a gate, and the asymmetry is deliberate rather
   * than an inconsistency. `ReleasesService.find` opens with
   * `authorize(actor, "read")`, which THROWS -- so an ungranted reader does
   * not get an empty card, they get one stuck in its error state, reporting a
   * failure that is really a permission they were never meant to have. The
   * two outcomes a card can have here are "hidden" and "broken", and nothing
   * in between is reachable.
   *
   * `partitionPlacements` drops a card whose `requiredPermission` this caller
   * lacks before the query is ever batched, and keeps it in the stored ROW so
   * a reader whose grant is later widened gets it back where it was.
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
  requiredPermission: [
    "read-content-releases",
    "create-content-releases",
    "publish-content-releases",
  ],
  /*
   * 🔴 TWO fields, and `state` is deliberately not one of them. The `list`
   * archetype destructures `const [labelField, detailField] = select` and
   * draws nothing past the second, so a third entry is not extra detail --
   * it is silently dropped. Selecting title, state, scheduledAt therefore
   * rendered each release beside the word "scheduled" and never showed WHEN,
   * on a card whose entire subject is when.
   *
   * `state` would carry no information even if it were drawn: `resolveReleases`
   * queries `state: "scheduled"` unconditionally, so every row this source can
   * return already has it. The invariant field is the one to drop.
   */
  query: {
    source: RELEASES_SOURCE_ID,
    op: "list",
    // Selecting `reason` is what asks the source for the attention rows; see `system:releases`.
    // `id` is what each release row links to.
    select: ["kind", "id", "title", "scheduledAt", "reason", "count"],
    limit: 5,
  },
  // Asked like core's lists: the rows its size draws and one more, for "more exist".
  sizedQuery: true,
  settings: [LIST_DENSITY],
} as const satisfies WidgetDefinition;
