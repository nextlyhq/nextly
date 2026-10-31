/**
 * What each reader's setup card remembers for them, and their setup as that
 * card counts it: the ONE answer the card's `load` (`setup-card`) and the
 * `onboarding:incomplete` condition (`conditions`) both read, so a reader's
 * skips finish setup for the two alike.
 *
 * Kept in the dashboard preferences (`nextly_dashboard_preferences`), never in
 * the layout, whose row means "this reader arranged the dashboard":
 *
 * - `setup-collapsed`: drawn as its one-line bar.
 * - `setup-dismissed`: removed by the reader, until they resume it.
 * - `setup-skipped-<kind>`: one key per skippable step, so two skips written at
 *   once, from two devices, each land on their own row and neither overwrites
 *   the other.
 * - `setup-retired`: when it said "You're all set". It says so once, and the
 *   next load leaves it out for good.
 *
 * Its own module, apart from the card's declaration, so the condition reads it
 * without the widget's own graph.
 *
 * @module domains/widgets/setup-reader
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../di/container";
import { getNextlyLogger } from "../../observability/logger";
import {
  DashboardPreferences,
  type DashboardPreferenceKey,
} from "../dashboard/dashboard-preferences";

import type { ConditionProbe } from "./condition-probe";
import { withSkips } from "./setup";
import {
  SETUP_SKIPPABLE_KINDS,
  type SetupAnswer,
  type SkippableSetupStepKind,
} from "./setup-steps";

/** How a yes is stored in a preference. */
export const YES = "true";
export const NO = "false";

/** What a reader's setup card remembers for them. */
export interface SetupState {
  collapsed: boolean;
  dismissed: boolean;
  /** When the card said "You're all set", as an ISO 8601 instant. */
  retiredAt: string | undefined;
  skipped: ReadonlySet<SkippableSetupStepKind>;
}

/** What a card nobody has touched remembers: nothing. */
const UNTOUCHED: SetupState = {
  collapsed: false,
  dismissed: false,
  retiredAt: undefined,
  skipped: new Set(),
};

/** The preference holding whether `kind` is skipped: one row per step. */
export function skipKey(kind: SkippableSetupStepKind): DashboardPreferenceKey {
  return `setup-skipped-${kind}`;
}

/** The repository over the booted instance's database. */
export function preferences(): DashboardPreferences {
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
  const [collapsed, dismissed, retiredAt, ...skips] = await Promise.all([
    repository.get(userId, "setup-collapsed"),
    repository.get(userId, "setup-dismissed"),
    repository.get(userId, "setup-retired"),
    ...SETUP_SKIPPABLE_KINDS.map(kind => repository.get(userId, skipKey(kind))),
  ]);
  return {
    collapsed: collapsed === YES,
    dismissed: dismissed === YES,
    retiredAt: retiredAt || undefined,
    skipped: new Set(
      SETUP_SKIPPABLE_KINDS.filter((_kind, index) => skips[index] === YES)
    ),
  };
}

/**
 * This reader's setup as their card counts it: the probe's steps with the
 * skips they stored applied, and what else their card remembers.
 *
 * An API key has no card of its own, and so nothing stored: its answer is the
 * steps as they stand, and no preference is read for it.
 */
export async function readerSetup(
  probe: ConditionProbe,
  repository?: DashboardPreferences
): Promise<{ state: SetupState; setup: SetupAnswer }> {
  const { caller } = probe;
  const [state, answer] = await Promise.all([
    caller.authenticatedScope?.actorType === "apiKey"
      ? UNTOUCHED
      : readSetupState(caller.user.id, repository),
    probe.setup(),
  ]);
  return { state, setup: withSkips(answer, state.skipped) };
}
