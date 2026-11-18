/**
 * The workflow's publish gate, registered as the `publishGate` core asks before every publish, so
 * a collection or Single with a workflow attached publishes a part only from a stage that allows
 * publishing with a current approval, or without review by someone who may. One with no workflow
 * attached is let through as before.
 *
 * @module di/registrations/register-workflow-publish-gate
 */
import type { PublishGate } from "../../domains/collections/services/publish-gate";
import { workflowPublishGate } from "../../domains/workflows/workflow-publish-gate";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerWorkflowPublishGate(ctx: RegistrationContext): void {
  // Built on each ask rather than kept as a singleton: it holds nothing but the adapter, and a
  // singleton's instance, once asked for, stays cached under the name, so a gate registered
  // later under `publishGate` would be shadowed by this one instead of replacing it.
  container.register<PublishGate>("publishGate", () =>
    workflowPublishGate(ctx.adapter)
  );
}
