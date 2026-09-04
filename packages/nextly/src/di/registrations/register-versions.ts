/**
 * DI registration for the content-versioning read surface.
 *
 * @module di/registrations/register-versions
 */

import { VersionsService } from "../../domains/versions/versions-service";
import { container } from "../container";

import type { RegistrationContext } from "./types";

/** Register the versions read service as a singleton. */
export function registerVersionServices(ctx: RegistrationContext): void {
  const { adapter } = ctx;

  container.registerSingleton<VersionsService>(
    "versionsService",
    // The adapter satisfies VersionsDbApi structurally; reads run on the pool
    // (in-transaction capture passes its own tx context instead).
    () => new VersionsService(adapter)
  );
}
