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
  const { adapter, config } = ctx;

  // A working draft is one row per document per LOCALE, so the configured
  // locale count is how many rows one document can contribute to a
  // cross-document read. The service needs it to bound the scan behind the
  // recent-edits card; an install with no localization configured has exactly
  // one, which is the default the service applies when this is absent.
  const localeCount = config.localization?.locales.length;

  container.registerSingleton<VersionsService>(
    "versionsService",
    // The adapter satisfies VersionsDbApi structurally; reads run on the pool
    // (in-transaction capture passes its own tx context instead).
    () =>
      new VersionsService(adapter, {
        ...(localeCount !== undefined && {
          maxWorkingDraftsPerDocument: localeCount,
        }),
      })
  );
}
