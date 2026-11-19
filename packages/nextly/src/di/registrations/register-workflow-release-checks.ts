/**
 * Workflows' part in a release's checks: the "Not approved" check every release's readiness,
 * scheduling, Publish now and early stop ask, and the hold its run and a reader's projection of a
 * due release ask, both answering from one decision.
 *
 * Registered after the releases (`registerReleaseServices`), which register core's own checks
 * first: a boot with releases has workflows' check beside them, and registering it connects its
 * signal to the early stop.
 *
 * @module di/registrations/register-workflow-release-checks
 */
import type { GoingLiveHold } from "../../domains/releases/going-live-hold";
import { registerReleaseCheckSource } from "../../domains/releases/readiness/check-sources";
import {
  releaseApprovalHold,
  releaseApprovalSource,
} from "../../domains/workflows/release-approval-source";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerWorkflowReleaseChecks({
  adapter,
}: RegistrationContext): void {
  registerReleaseCheckSource(releaseApprovalSource(adapter));
  container.registerSingleton<GoingLiveHold>("releaseGoingLiveHold", () =>
    releaseApprovalHold(adapter)
  );
}
