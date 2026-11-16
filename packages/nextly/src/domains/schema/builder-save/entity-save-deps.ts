/**
 * The Builder save writer's dependencies for a field group's or a Single's
 * save, kept apart from the writer itself (`entity-save`, `collection-save`):
 * a service decides whether it has a writer at all on every change, and only a
 * save that has one loads the writer, which brings the migration generator and
 * runner with it.
 *
 * @module domains/schema/builder-save/entity-save-deps
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { BuilderSaveSetup, CollectionSaveDeps } from "./collection-save";

/**
 * The writer's dependencies for a service's save, or undefined where no
 * writer is set up or no adapter is registered: the service then makes its
 * change alone, as before the writer.
 */
export function entitySaveDeps(
  setup: BuilderSaveSetup | undefined,
  adapter: DrizzleAdapter | undefined,
  logger: CollectionSaveDeps["logger"]
): CollectionSaveDeps | undefined {
  if (setup === undefined || adapter === undefined) return undefined;
  return {
    ...setup,
    adapter,
    logger,
    // Development runs each file and records it applied, as the Builder does
    // for a collection; elsewhere the deploy's `nextly migrate` does.
    applies: process.env.NODE_ENV === "development",
  };
}
