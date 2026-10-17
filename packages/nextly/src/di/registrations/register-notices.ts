/**
 * The notices service: each person's own list of notices.
 *
 * Registered before the features that write notices, so a feature's own
 * registration can resolve it. The kinds themselves are registered by the
 * features that own them (`registerNoticeKind`), not here.
 *
 * @module di/registrations/register-notices
 */
import { NoticesService } from "../../domains/notices/notices-service";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerNoticeServices({
  adapter,
  logger,
}: RegistrationContext): void {
  container.registerSingleton<NoticesService>(
    "noticesService",
    () => new NoticesService({ db: adapter, logger })
  );
}
