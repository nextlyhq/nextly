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
 * Both are handed to this module by `setup-card` when the dashboard's widgets
 * are registered (`provideSetupCard`), rather than imported: the widget list is
 * read by the admin's own tests and type check and by every reader of core's
 * ids, none of which should reach the permission and database graph the steps
 * read through. The caller is the one the card's read services were bound for,
 * so an API key is judged as itself, never as the person who made it.
 *
 * @module domains/widgets/core-widgets/setup
 */

import { NextlyError } from "../../../errors/nextly-error";
import {
  defineWidget,
  type WidgetReadServices,
} from "../declaration/define-widget";
import { processHeld } from "../process-held";
import type { SetupCardData } from "../setup-steps";

import { CORE_WIDGET_ID } from "./ids";

/** The card's two reads, for the caller a card's read services were bound for. */
interface SetupCardReads {
  shownTo: (services: WidgetReadServices) => Promise<boolean>;
  dataFor: (services: WidgetReadServices, now: Date) => Promise<SetupCardData>;
}

/**
 * The reads `setup-card` provided, held for the process (`processHeld`):
 * Next.js and Turbopack can evaluate this module in more than one server
 * graph, and the widgets registered at boot and the card answered on a request
 * can each hold a different copy.
 */
const provided = processHeld(
  "nextly.dashboard.setupCard",
  (): { reads?: SetupCardReads } => ({}),
  (held): held is { reads?: SetupCardReads } =>
    typeof held === "object" && held !== null
);

/** Hands the card its reads; `setup-card` does, when the dashboard's widgets are registered. */
export function provideSetupCard(reads: SetupCardReads): void {
  provided.reads = reads;
}

/** The provided reads, or a fault of the install: never a card answered on a guess. */
function setupReads(): SetupCardReads {
  const { reads } = provided;
  if (reads === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "setup-card-not-provided" },
    });
  }
  return reads;
}

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
  // Full width and two rows: a thin progress bar over one row of tiles, the
  // count in the header. It grows in place only while the reader has the
  // Singles' list open, or where its tiles wrap on a narrow screen.
  size: {
    default: { w: 12, h: 2 },
    min: { w: 12, h: 2 },
    max: { w: 12, h: 4 },
  },
  // A read that throws leaves the card out, and is logged as the widget's.
  shows: async ({ services }) => setupReads().shownTo(services),
  load: async ({ services, now }) => setupReads().dataFor(services, now),
  view: { component: "core#Setup" },
  // Never empty: `shows` decides whether the card is there, and while it is
  // it always has something to say, "could not check setup" included.
  isEmpty: () => false,
  preview: [
    { name: "Part way", data: PART_WAY },
    { name: "All set", data: ALL_SET },
  ],
});
