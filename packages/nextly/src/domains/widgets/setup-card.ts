/**
 * The setup card on the server: who it shows to, what it answers, and what
 * each reader's card remembers for them.
 *
 * The card is a super-admin's alone (`dashboard-experience` D16), and only a
 * person's: an API key has no dashboard of its own. What it remembers per
 * reader is kept in the dashboard preferences (`nextly_dashboard_preferences`),
 * never in the layout, whose row means "this reader arranged the dashboard":
 * collapsing, dismissing or skipping a step there would stop the reader
 * following the default.
 *
 * - `setup-collapsed`: drawn as its one-line bar.
 * - `setup-dismissed`: removed by the reader, until they resume it.
 * - `setup-skipped`: the skippable steps they skipped.
 * - `setup-retired`: when it said "You're all set". It says so once, and the
 *   next load leaves it out for good.
 *
 * Loaded lazily by the card's declaration (`core-widgets/setup`), so the
 * widget list stays free of the permission and database graph this reaches.
 *
 * @module domains/widgets/setup-card
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../di/container";
import { getNextlyLogger } from "../../observability/logger";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { isSuperAdminOrRefuse } from "../../services/lib/permissions";
import { DashboardPreferences } from "../dashboard/dashboard-preferences";

import { conditionProbe } from "./condition-probe";
import { skippedKinds, withSkips } from "./setup";
import {
  SETUP_SKIPPABLE_KINDS,
  type SetupCardData,
  type SkippableSetupStepKind,
} from "./setup-steps";

/** How a yes is stored in a preference. */
const YES = "true";
const NO = "false";

/** What a reader's setup card remembers for them. */
export interface SetupState {
  collapsed: boolean;
  dismissed: boolean;
  /** When the card said "You're all set", as an ISO 8601 instant. */
  retiredAt: string | undefined;
  skipped: ReadonlySet<SkippableSetupStepKind>;
}

/** The repository over the booted instance's database. */
function preferences(): DashboardPreferences {
  return new DashboardPreferences(container.get<DrizzleAdapter>("adapter"), {
    warn: (message, context) =>
      getNextlyLogger().warn({
        kind: "dashboard-preferences-missing",
        message,
        ...context,
      }),
  });
}

/** What `userId`'s setup card remembers, each key read at once. */
export async function readSetupState(
  userId: string,
  repository: DashboardPreferences = preferences()
): Promise<SetupState> {
  const [collapsed, dismissed, retiredAt, skipped] = await Promise.all([
    repository.get(userId, "setup-collapsed"),
    repository.get(userId, "setup-dismissed"),
    repository.get(userId, "setup-retired"),
    repository.get(userId, "setup-skipped"),
  ]);
  return {
    collapsed: collapsed === YES,
    dismissed: dismissed === YES,
    retiredAt: retiredAt || undefined,
    skipped: skippedKinds(skipped),
  };
}

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
 * Whether the card shows for this caller: a super-admin person who has
 * neither dismissed it nor been told "You're all set". Judged before the card
 * loads, so a reader it does not show for has nothing fetched for it.
 */
export async function setupShownTo(caller: ReadCaller): Promise<boolean> {
  if (!(await isSetupReader(caller))) return false;
  const state = await readSetupState(caller.user.id);
  return !state.dismissed && state.retiredAt === undefined;
}

/**
 * The card's answer: the steps with this reader's skips, whether they
 * collapsed it, and whether every step is now done.
 *
 * When every step offered is done or skipped, the card says "You're all set"
 * this once, and that it did is recorded at `now`, so the next load leaves the
 * card out. A record that cannot be written leaves the card to say so again
 * next time, never the answer failed. Setup that is not known is never all
 * set.
 */
export async function setupCardData(
  caller: ReadCaller,
  now: Date
): Promise<SetupCardData> {
  const repository = preferences();
  const [state, answer] = await Promise.all([
    readSetupState(caller.user.id, repository),
    conditionProbe(caller).setup(),
  ]);
  const setup = withSkips(answer, state.skipped);
  const allSet = setup.known && setup.done === setup.total;
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
    const { kind, skipped } = change.skip;
    const current = new Set<SkippableSetupStepKind>(
      (await readSetupState(userId, repository)).skipped
    );
    if (skipped) current.add(kind);
    else current.delete(kind);
    // In the kinds' own order, so the stored value is one spelling per set.
    const value = SETUP_SKIPPABLE_KINDS.filter(name => current.has(name)).join(
      ","
    );
    writes.push(repository.set(userId, "setup-skipped", value));
  }
  await Promise.all(writes);
  return readSetupState(userId, repository);
}
