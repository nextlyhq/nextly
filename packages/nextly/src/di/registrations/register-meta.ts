/**
 * Meta domain DI registration.
 *
 * Registers the `MetaService` — a small KV API over the `nextly_meta`
 * table. First consumer is the dashboard SeedDemoContentCard (writes
 * `seed.completedAt` / `seed.skippedAt`). Designed to host other
 * runtime flags as the admin grows.
 */

import { MetaService } from "../../domains/meta";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerMetaServices(ctx: RegistrationContext): void {
  const { adapter, logger } = ctx;

  container.registerSingleton<MetaService>(
    "metaService",
    () => new MetaService(adapter, logger)
  );
}
