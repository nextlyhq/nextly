/**
 * The setup card on the server: who it shows to, what it answers, and the
 * changes a reader makes to it.
 *
 * The card is a super-admin's alone (`dashboard-experience` D16), and only a
 * person's: an API key has no dashboard of its own. What it remembers per
 * reader, and their setup as it counts it, are `setup-reader`'s.
 *
 * Handed to the card's declaration (`core-widgets/setup`) when the dashboard's
 * widgets are registered (`registerSetupCard`), so the widget list stays free
 * of the permission and database graph this reaches.
 *
 * @module domains/widgets/setup-card
 */

import { getNextlyLogger } from "../../observability/logger";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { isSuperAdminOrRefuse } from "../../services/lib/permissions";
import type { DashboardPreferences } from "../dashboard/dashboard-preferences";

import { conditionProbe } from "./condition-probe";
import { provideSetupCard } from "./core-widgets/setup";
import { boundCaller } from "./declaration/read-services";
import {
  NO,
  preferences,
  readerSetup,
  readSetupState,
  skipKey,
  YES,
  type SetupState,
} from "./setup-reader";
import {
  drawnSetup,
  setupAllSet,
  type SampleRoute,
  type SetupCardData,
  type SkippableSetupStepKind,
} from "./setup-steps";

/**
 * Whether this caller is a person who holds super-admin. An API key is not:
 * the card is a person's own, as their preferences are. A role read that
 * fails refuses, so the card is left out rather than offered on a guess.
 */
export async function isSetupReader(caller: ReadCaller): Promise<boolean> {
  if (caller.authenticatedScope?.actorType === "apiKey") return false;
  return isSuperAdminOrRefuse(caller.user.id);
}

/**
 * Whether the card shows for this reader: a person, as the card is a person's
 * own, who has neither dismissed it nor been told "You're all set". Judged
 * before the card loads, so a reader it does not show for has nothing fetched
 * for it.
 *
 * Only what is this reader's own. That the card is a super-admin's is decided
 * earlier, where the dashboard's audience is (`SUPER_ADMIN_WIDGET_IDS` in
 * `widgetAudience`), so nobody else is placed it, offered it or handed it,
 * and their dashboard never draws it while this is asked. A super-admin's API
 * key passes that decision, and is left out here.
 */
export async function setupShownTo(caller: ReadCaller): Promise<boolean> {
  if (caller.authenticatedScope?.actorType === "apiKey") return false;
  const state = await readSetupState(caller.user.id);
  return !state.dismissed && state.retiredAt === undefined;
}

/**
 * The card's answer: the steps with this reader's skips, whether they
 * collapsed it, and whether every step it draws is now done.
 *
 * "All set" is judged over the steps the card DRAWS (`drawnSetup`), the one
 * function the admin counts "N of M done" with, so a sample step the
 * project's route refuses this reader never holds the card open. Only the
 * admin can ask that route: the card's own load is answered with
 * `sampleRefused: false`, and the admin, when the route refuses and what it
 * draws is all done, asks again with `true` (`retire` on `PUT /api/dashboard/setup`).
 *
 * When every step drawn is done or skipped, the card says "You're all set"
 * this once, and that it did is recorded at `now`, so the next load leaves the
 * card out. A record that cannot be written leaves the card to say so again
 * next time, never the answer failed. Setup that is not known is never all
 * set.
 */
export async function setupCardData(
  caller: ReadCaller,
  now: Date,
  route: SampleRoute = { sampleRefused: false }
): Promise<SetupCardData> {
  const repository = preferences();
  const { state, setup } = await readerSetup(
    conditionProbe(caller),
    repository
  );
  const allSet = setupAllSet(drawnSetup(setup, route));
  if (allSet && state.retiredAt === undefined) {
    try {
      await repository.set(caller.user.id, "setup-retired", now.toISOString());
    } catch (error) {
      getNextlyLogger().warn({
        kind: "setup-retirement-unrecorded",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { setup, collapsed: state.collapsed, allSet };
}

/**
 * A change a reader makes to their own setup card: collapse or expand it,
 * dismiss or resume it, or skip or restore one skippable step.
 */
export interface SetupStateChange {
  collapsed?: boolean;
  dismissed?: boolean;
  skip?: { kind: SkippableSetupStepKind; skipped: boolean };
}

/**
 * Applies `change` to `userId`'s setup card, and answers what it now
 * remembers. Only a skippable kind can be named, so no stored value names any
 * other.
 */
export async function changeSetupState(
  userId: string,
  change: SetupStateChange,
  repository: DashboardPreferences = preferences()
): Promise<SetupState> {
  const writes: Promise<void>[] = [];
  if (change.collapsed !== undefined) {
    writes.push(
      repository.set(userId, "setup-collapsed", change.collapsed ? YES : NO)
    );
  }
  if (change.dismissed !== undefined) {
    writes.push(
      repository.set(userId, "setup-dismissed", change.dismissed ? YES : NO)
    );
  }
  if (change.skip !== undefined) {
    // Its own key, written alone: no read of the other step's skip, so a skip
    // of the other step written at the same moment is never overwritten.
    const { kind, skipped } = change.skip;
    writes.push(repository.set(userId, skipKey(kind), skipped ? YES : NO));
  }
  await Promise.all(writes);
  return readSetupState(userId, repository);
}

/**
 * Hands the setup card its reads, each as the caller its card's read services
 * were bound for. Called where the dashboard's widgets are registered.
 */
export function registerSetupCard(): void {
  provideSetupCard({
    shownTo: services => setupShownTo(boundCaller(services)),
    dataFor: (services, now) => setupCardData(boundCaller(services), now),
  });
}
