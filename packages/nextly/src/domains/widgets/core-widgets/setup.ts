/**
 * Core's "Set up your project" card, declared with `defineWidget` as a plugin
 * declares its own. One module per widget; `core-widgets/index.ts` lists them
 * in their order.
 *
 * One row of step tiles at full width, for super-admins only, detected from
 * the site's data (`domains/widgets/setup`): start with sample content, create
 * a collection, add a first entry, fill in the Singles, invite a teammate.
 *
 * - `shows` leaves it out for anyone but a super-admin person, and for one who
 *   dismissed it or was already told "You're all set", so nothing is fetched
 *   for them.
 * - `load` answers the steps with the reader's skips, whether they collapsed
 *   it, and whether every step is done; that last answer is said once and
 *   recorded, so the next load leaves the card out.
 *
 * Both reach the permission and database graph through a lazy import of
 * `setup-card`, so the widget list, which every reader of core's ids loads,
 * does not. The caller is the one the card's read services were bound for, so
 * an API key is judged as itself, never as the person who made it.
 *
 * @module domains/widgets/core-widgets/setup
 */

import { defineWidget } from "../declaration/define-widget";
import type { SetupCardData } from "../setup-steps";

import { CORE_WIDGET_ID } from "./ids";

/** A new project, part way through, for the preview page. */
const PART_WAY: SetupCardData = {
  setup: {
    known: true,
    steps: [
      { kind: "sample", status: "done" },
      { kind: "collection", status: "done" },
      { kind: "entry", status: "open", collection: "posts" },
      {
        kind: "singles",
        status: "open",
        singles: [
          { slug: "home", filledIn: true },
          { slug: "about", filledIn: false },
        ],
      },
      { kind: "invite", status: "open" },
    ],
    done: 2,
    total: 5,
  },
  collapsed: false,
  allSet: false,
};

/** Every step done, the once the card says so, for the preview page. */
const ALL_SET: SetupCardData = {
  setup: {
    known: true,
    steps: [
      { kind: "collection", status: "done" },
      { kind: "entry", status: "done" },
      { kind: "invite", status: "skipped" },
    ],
    done: 3,
    total: 3,
  },
  collapsed: false,
  allSet: true,
};

export const setupWidget = defineWidget({
  id: CORE_WIDGET_ID.setup,
  title: "Set up your project",
  description:
    "The setup steps left on a new project, detected from its data. For super-admins, until setup is done.",
  icon: "ListChecks",
  // Full width and two rows: one line of progress over one row of tiles. It
  // may grow, as a card does in place, while the Singles' list is open.
  size: {
    default: { w: 12, h: 2 },
    min: { w: 12, h: 2 },
    max: { w: 12, h: 4 },
  },
  shows: async ({ services }) => {
    const [{ setupShownTo }, { boundCaller }] = await Promise.all([
      import("../setup-card"),
      import("../declaration/read-services"),
    ]);
    return setupShownTo(boundCaller(services));
  },
  load: async ({ services, now }) => {
    const [{ setupCardData }, { boundCaller }] = await Promise.all([
      import("../setup-card"),
      import("../declaration/read-services"),
    ]);
    return setupCardData(boundCaller(services), now);
  },
  view: { component: "core#Setup" },
  // Never empty: `shows` decides whether the card is there, and while it is
  // it always has something to say, "could not check setup" included.
  isEmpty: () => false,
  preview: [
    { name: "Part way", data: PART_WAY },
    { name: "All set", data: ALL_SET },
  ],
});
